#!/usr/bin/env python3
"""Versioned importer for the public Deadlock Assets API.

The importer is deliberately conservative:

* API responses are archived byte-for-byte below ``archive/api/versions``.
* mapped data and diffs are review artifacts, never canonical data;
* an existing raw file is never replaced with different bytes;
* canonical CSV files can only be changed through an explicit approval file.

The module uses only the Python standard library so fixture runs work offline.
The default API is documented at https://api.deadlock-api.com/docs.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping, Sequence


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BASE_URL = "https://api.deadlock-api.com"
API_DOCS_URL = "https://api.deadlock-api.com/openapi.json"
API_SCHEMA_VERSION = "0.1.0-api-import"
DEFAULT_DELAY = 0.25

ENDPOINTS: dict[str, str] = {
    "items": "/v1/assets/items",
    "heroes": "/v1/assets/heroes",
    "generic_data": "/v1/assets/generic-data",
    "npc_units": "/v1/assets/npc-units",
    "misc_entities": "/v1/assets/misc-entities",
    "loot_tables": "/v1/assets/loot-tables",
    "map": "/v1/assets/map",
    "ranked_seasons": "/v1/assets/ranked-seasons",
}

CSV_DATASETS: dict[str, tuple[str, tuple[str, ...]]] = {
    "items": ("data/core/items.csv", ("item_id",)),
    "item_mechanics": ("data/core/item_mechanics.csv", ("item_id", "effect_id")),
    "item_upgrades": ("data/core/item_upgrades.csv", ("from_item_id", "to_item_id")),
    "heroes": ("data/heroes/heroes.csv", ("hero_id",)),
    "hero_stats": ("data/heroes/hero_stats.csv", ("hero_id", "stat_id")),
    "abilities": ("data/heroes/abilities.csv", ("ability_id",)),
    "ability_mechanics": ("data/heroes/ability_mechanics.csv", ("ability_id", "effect_id")),
}


class ImportErrorWithContext(RuntimeError):
    """An actionable importer error that is safe to show to the user."""


def now_utc() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def snake(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", text)
    text = re.sub(r"[^A-Za-z0-9]+", "_", text)
    return text.strip("_").lower()


def scalar(value: Any) -> Any:
    """Extract common API property wrappers without guessing nested rules."""
    if isinstance(value, Mapping):
        for key in ("value", "amount", "base", "default", "current", "value_float", "value_int"):
            if key in value and not isinstance(value[key], (Mapping, list)):
                return value[key]
    return value


def first(record: Mapping[str, Any], *keys: str, default: Any = None) -> Any:
    for key in keys:
        if key in record and record[key] is not None:
            return record[key]
    return default


def as_list(payload: Any, dataset: str) -> list[Any]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, Mapping):
        for key in (dataset, "data", "results", "items", "heroes", "records"):
            if isinstance(payload.get(key), list):
                return payload[key]
    raise ImportErrorWithContext(f"{dataset}: erwartete Liste, erhalten {type(payload).__name__}")


def canonical_id_candidates(record: Mapping[str, Any]) -> list[str]:
    values: list[str] = []
    for key in ("class_name", "classname", "className", "id", "name", "display_name"):
        value = record.get(key)
        if value is not None:
            values.append(str(value))
    return values


def id_from_record(record: Mapping[str, Any], kind: str, hero_id: str | None = None) -> str:
    for value in canonical_id_candidates(record):
        candidate = snake(value)
        if kind == "hero":
            return candidate.removeprefix("hero_")
        if kind == "item" and candidate.startswith(("upgrade_", "weapon_", "ability_")):
            return candidate
        if kind == "ability" and candidate.startswith("ability_"):
            return candidate
    name = snake(first(record, "name", "display_name", default="unknown"))
    if kind == "hero":
        return name
    if kind == "ability":
        return f"{hero_id}_{name}" if hero_id else name
    item_type = snake(first(record, "type", "item_type", "category", default="item"))
    return f"{item_type}_{name}" if item_type not in name else name


def json_bytes(payload: Any) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ImportErrorWithContext(f"Ungültige JSON-Datei {path}: {exc}") from exc


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        atomic_write(path, b"\n")
        return
    fields = list(rows[0])
    output: list[str] = []
    from io import StringIO

    buffer = StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    def cell(value: Any) -> Any:
        if value is None:
            return ""
        if isinstance(value, bool):
            return "true" if value else "false"
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        return value
    writer.writerows({key: cell(value) for key, value in row.items()} for row in rows)
    atomic_write(path, buffer.getvalue().encode("utf-8"))


def hash_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def portable_path(path: Path) -> str:
    """Use repository-relative paths in normal runs, absolute paths in temp runs."""
    try:
        value = path.resolve().relative_to(ROOT)
    except ValueError:
        value = path.resolve()
    return str(value).replace("\\", "/")


@dataclass(frozen=True)
class ApiResponse:
    body: bytes
    payload: Any
    url: str
    fetched_at: str


class ApiClient:
    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        api_key: str | None = None,
        delay: float = DEFAULT_DELAY,
        timeout: float = 45.0,
        retries: int = 3,
        opener: Callable[..., Any] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.delay = max(0.0, delay)
        self.timeout = timeout
        self.retries = max(0, retries)
        self.opener = opener or urllib.request.urlopen
        self._last_request = 0.0

    def get(self, path: str, params: Mapping[str, Any] | None = None) -> ApiResponse:
        query = urllib.parse.urlencode({k: v for k, v in (params or {}).items() if v is not None})
        url = f"{self.base_url}{path}" + (f"?{query}" if query else "")
        headers = {"Accept": "application/json", "User-Agent": "SidestepDeadlockApiImporter/0.1"}
        if self.api_key:
            headers["X-API-KEY"] = self.api_key
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            wait = self.delay - (time.monotonic() - self._last_request)
            if wait > 0:
                time.sleep(wait)
            request = urllib.request.Request(url, headers=headers, method="GET")
            self._last_request = time.monotonic()
            try:
                with self.opener(request, timeout=self.timeout) as response:
                    body = response.read()
                    status = getattr(response, "status", 200)
                if status >= 400:
                    raise urllib.error.HTTPError(url, status, "HTTP error", {}, None)
                payload = json.loads(body.decode("utf-8"))
                return ApiResponse(body=body, payload=payload, url=url, fetched_at=now_utc())
            except urllib.error.HTTPError as exc:
                last_error = exc
                retryable = exc.code == 429 or 500 <= exc.code < 600
                if not retryable or attempt >= self.retries:
                    break
                retry_after = exc.headers.get("Retry-After") if exc.headers else None
                time.sleep(float(retry_after) if retry_after and retry_after.isdigit() else min(30.0, 2**attempt))
            except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
                last_error = exc
                if attempt >= self.retries:
                    break
                time.sleep(min(30.0, 2**attempt))
        raise ImportErrorWithContext(f"API-Aufruf fehlgeschlagen: {url}: {last_error}") from last_error


class FixtureClient(ApiClient):
    """Offline API client. Fixture filenames are endpoint basenames plus .json."""

    def __init__(self, fixture_dir: Path) -> None:
        self.fixture_dir = fixture_dir
        self.base_url = "fixture://deadlock-api"
        self.api_key = None
        self.delay = 0.0
        self.timeout = 0.0
        self.retries = 0
        self._last_request = 0.0

    def get(self, path: str, params: Mapping[str, Any] | None = None) -> ApiResponse:
        basename = "client_versions" if path.endswith("client-versions") else path.rstrip("/").rsplit("/", 1)[-1].replace("-", "_")
        path_candidates = [self.fixture_dir / f"{basename}.json", self.fixture_dir / path.lstrip("/")]
        fixture = next((candidate for candidate in path_candidates if candidate.exists()), None)
        if fixture is None:
            raise ImportErrorWithContext(f"Fixture fehlt für {path}: {path_candidates[0]}")
        body = fixture.read_bytes()
        try:
            payload = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError as exc:
            raise ImportErrorWithContext(f"Ungültiges Fixture {fixture}: {exc}") from exc
        return ApiResponse(body=body, payload=payload, url=f"fixture://{fixture.name}", fetched_at=now_utc())


def discover_latest_client_version(client: ApiClient) -> tuple[int, ApiResponse]:
    response = client.get("/v1/assets/client-versions")
    raw = response.payload
    values = raw if isinstance(raw, list) else first(raw, "client_versions", "versions", "data", default=[])
    if not isinstance(values, list):
        raise ImportErrorWithContext("client-versions: keine Versionsliste gefunden")
    try:
        versions = sorted({int(value) for value in values})
    except (TypeError, ValueError) as exc:
        raise ImportErrorWithContext("client-versions enthält nichtnumerische Werte") from exc
    if not versions:
        raise ImportErrorWithContext("client-versions ist leer")
    return versions[-1], response


def version_values(payload: Any) -> set[int]:
    values = payload if isinstance(payload, list) else first(payload, "client_versions", "versions", "data", default=[])
    if not isinstance(values, list):
        return set()
    return {int(value) for value in values}


def value_from_property(properties: Any, key: str) -> Any:
    if not isinstance(properties, Mapping):
        return None
    if key in properties:
        return scalar(properties[key])
    wanted = snake(key)
    for name, value in properties.items():
        if snake(name) == wanted:
            return scalar(value)
    return None


def category_for(record: Mapping[str, Any]) -> str:
    value = first(record, "slot_type", "item_slot_type", "category", "type", default="")
    mapping = {"spirit": "Spirit", "vitality": "Vitality", "weapon": "Weapon", "upgrade": "Upgrade"}
    return mapping.get(snake(value), str(value or ""))


def activation_for(record: Mapping[str, Any]) -> str:
    value = snake(first(record, "activation", "active_type", default=""))
    if value in {"", "passive"}:
        return ""
    return {
        "press": "Press",
        "instant_cast": "InstantCast",
        "instant_cast_toggle": "InstantCastToggle",
        "toggle": "Toggle",
        "hold": "Hold",
    }.get(value, str(first(record, "activation", "active_type", default="")))


def bool_value(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "active", "public"}
    return default if value is None else bool(value)


def numeric(value: Any) -> Any:
    value = scalar(value)
    if isinstance(value, str):
        try:
            parsed = float(value)
            return int(parsed) if parsed.is_integer() else parsed
        except ValueError:
            return value
    return value


def map_api_records(raw: Mapping[str, Any], canonical: Mapping[str, list[dict[str, str]]], version: int) -> dict[str, Any]:
    """Map flexible API records into the repository's existing logical columns."""
    items = as_list(raw["items"].payload, "items")
    heroes = as_list(raw["heroes"].payload, "heroes")
    current_items = canonical.get("items", [])
    current_heroes = canonical.get("heroes", [])
    current_abilities = canonical.get("abilities", [])
    item_ids = {row.get("item_id", "") for row in current_items}
    hero_ids = {row.get("hero_id", "") for row in current_heroes}
    ability_ids = {row.get("ability_id", "") for row in current_abilities}

    item_lookup: dict[str, str] = {}
    for record in items:
        if not isinstance(record, Mapping):
            continue
        generated = id_from_record(record, "item")
        candidates = canonical_id_candidates(record)
        mapped = next((snake(value) for value in candidates if snake(value) in item_ids), generated)
        for candidate in candidates:
            item_lookup[str(candidate)] = mapped
            item_lookup[snake(candidate)] = mapped

    hero_lookup: dict[str, str] = {}
    mapped_heroes: list[dict[str, Any]] = []
    for record in heroes:
        if not isinstance(record, Mapping):
            continue
        generated = id_from_record(record, "hero")
        class_token = snake(first(record, "class_name", "classname", default=""))
        note_match = next((row.get("hero_id", "") for row in current_heroes if class_token and class_token in row.get("notes", "").casefold()), "")
        mapped = note_match or next((snake(value).removeprefix("hero_") for value in canonical_id_candidates(record) if snake(value).removeprefix("hero_") in hero_ids), generated)
        for candidate in canonical_id_candidates(record):
            hero_lookup[str(candidate)] = mapped
            hero_lookup[snake(candidate)] = mapped
        selectable = first(record, "player_selectable", "is_selectable", "selectable", "IsSelectable")
        disabled = first(record, "is_disabled", "disabled", "IsDisabled", default=False)
        development = first(record, "in_development", "is_in_development", "InDevelopment", default=False)
        public = bool_value(selectable, True) and not bool_value(disabled) and not bool_value(development)
        mapped_heroes.append({
            "hero_id": mapped,
            "name": first(record, "name", "class_name", default=mapped),
            "display_name": first(record, "display_name", "name", default=mapped),
            "availability": "public_standard" if public else "internal_or_unused",
            "publicly_playable": public,
            "release_status": "",
            "_api_id": first(record, "id", "hero_id"),
            "_api_class_name": first(record, "class_name", "classname"),
            "_raw_fields": sorted(record),
            "_provenance": {"client_version": version, "source": "deadlock-api"},
        })

    mapped_items: list[dict[str, Any]] = []
    item_mechanics: list[dict[str, Any]] = []
    item_upgrades: list[dict[str, Any]] = []
    abilities: list[dict[str, Any]] = []
    ability_mechanics: list[dict[str, Any]] = []

    ability_bindings: dict[str, tuple[str, str]] = {}
    generic_innates = {"citadel_ability_dash", "citadel_ability_sprint", "citadel_ability_melee_parry"}
    for record in heroes:
        if not isinstance(record, Mapping):
            continue
        class_or_id = first(record, "class_name", "id", "name", default="")
        owner_id = hero_lookup.get(str(class_or_id), hero_lookup.get(snake(class_or_id), id_from_record(record, "hero")))
        bindings = record.get("items")
        if not isinstance(bindings, Mapping):
            continue
        for slot, class_name in bindings.items():
            slot_name = snake(slot)
            if slot_name.startswith("signature") or slot_name.startswith("ability_innate"):
                if slot_name.startswith("ability_innate") and snake(class_name) in generic_innates:
                    continue
                canonical_slot = slot_name.removeprefix("signature") if slot_name.startswith("signature") else "innate"
                ability_bindings[snake(class_name)] = (owner_id, canonical_slot)

    for record in items:
        if not isinstance(record, Mapping):
            continue
        item_id = item_lookup.get(str(first(record, "class_name", "classname", "id", "name", default="")), id_from_record(record, "item"))
        properties = first(record, "properties", "stats", "attributes", default={})
        cooldown = numeric(first(record, "active_cooldown", "cooldown", default=value_from_property(properties, "AbilityCooldown")))
        if cooldown == 0 or cooldown == 0.0:
            cooldown = ""
        item_type = snake(first(record, "type", "item_type", "category", default=""))
        is_shop_upgrade = item_type == "upgrade" or item_id.startswith("upgrade_")
        active_type = activation_for(record)
        if is_shop_upgrade:
            cost = numeric(first(record, "cost", "soul_cost", "total_cost", default=""))
            shopable = bool_value(first(record, "shopable", "is_shop_item", "shop_item", "available", default=None), default=isinstance(cost, (int, float)) and cost > 0)
            mapped_items.append({
                "item_id": item_id,
                "name": first(record, "name", "display_name", default=item_id),
                "category": category_for(record),
                "tier": numeric(first(record, "tier", "item_tier", default="")),
                "total_cost": cost,
                "is_public_shop_item": shopable and not bool_value(first(record, "disabled", "is_disabled", default=False)),
                "active_type": active_type,
                "active_cooldown": cooldown if active_type else "",
                "_api_id": first(record, "id", "item_id"),
                "_api_class_name": first(record, "class_name", "classname"),
                "_raw_fields": sorted(record),
                "_provenance": {"client_version": version, "source": "deadlock-api"},
            })
        hero_ref = first(record, "hero", "hero_id", "owner_hero_id")
        if hero_ref is None and isinstance(record.get("heroes"), list) and len(record["heroes"]) == 1:
            hero_ref = record["heroes"][0]
        hero_id = hero_lookup.get(str(hero_ref), hero_lookup.get(snake(hero_ref), "")) if hero_ref is not None else ""
        class_token = snake(first(record, "class_name", default=""))
        binding = ability_bindings.get(class_token)
        if binding:
            hero_id = binding[0]
        canonical_ability = next((row.get("ability_id", "") for row in current_abilities if class_token and class_token in row.get("notes", "").casefold()), "")
        if not canonical_ability and class_token in ability_ids:
            canonical_ability = class_token
        is_ability = item_type == "ability" and bool(binding or canonical_ability)
        if is_ability:
            ability_id = canonical_ability or id_from_record(record, "ability", hero_id or None)
            behaviours = [snake(value) for value in record.get("behaviours", [])] if isinstance(record.get("behaviours"), list) else []
            explicit_passive = first(record, "is_passive", "passive", default=None)
            passive: Any = bool_value(explicit_passive) if explicit_passive is not None else (True if any("passive" in value for value in behaviours) else "")
            api_ability_type = snake(first(record, "ability_type", default=""))
            abilities.append({
                "ability_id": ability_id,
                "hero_id": hero_id,
                "name": first(record, "name", "display_name", default=ability_id),
                "ability_slot": binding[1] if binding else first(record, "slot", "ability_slot", "order", default=""),
                "ability_type": "",
                "is_innate": api_ability_type == "innate",
                "is_passive": passive,
                "is_active": (not passive) if isinstance(passive, bool) else "",
                "max_upgrade_level": numeric(first(record, "max_upgrade_level", "max_level", default=3)),
                "base_cooldown": cooldown,
                "base_charge_count": numeric(first(record, "charges", "charge_count", "base_charge_count", default="")),
                "charge_restore_time": numeric(first(record, "charge_restore_time", "charge_recharge_time", default="")),
                "cast_type": first(record, "cast_type", default=""),
                "targeting_type": first(record, "targeting_type", "targeting", default=""),
                "_api_id": first(record, "id", "item_id"),
                "_raw_fields": sorted(record),
                "_provenance": {"client_version": version, "source": "deadlock-api"},
            })
            for key, raw_value in (properties.items() if isinstance(properties, Mapping) else []):
                value = numeric(raw_value)
                if isinstance(value, (dict, list)) or value is None:
                    continue
                effect_id = snake(key)
                ability_mechanics.append({
                    "ability_id": ability_id,
                    "effect_id": effect_id,
                    "effect_type": "",
                    "mechanic": snake(key),
                    "value": value,
                    "unit": "",
                    "scaling_attribute": "",
                    "scaling_coefficient": "",
                    "calculation_rule": "",
                    "condition": "",
                    "trigger": "",
                    "target_scope": "",
                    "nonhero_behavior": "",
                    "objective_behavior": "",
                    "stacking": "",
                    "max_stacks": "",
                    "duration": "",
                    "cooldown": "",
                    "charge_up_time": "",
                    "tick_interval": "",
                    "_raw_key": key,
                    "_provenance": {"client_version": version, "source": "deadlock-api"},
                })
        if is_shop_upgrade:
            for key, raw_value in (properties.items() if isinstance(properties, Mapping) else []):
                value = numeric(raw_value)
                if isinstance(value, (dict, list)) or value is None:
                    continue
                item_mechanics.append({
                    "item_id": item_id,
                    "effect_id": f"eff_{snake(key)}",
                    "effect_type": "",
                    "mechanic": snake(key),
                    "value": value,
                    "unit": "",
                    "condition": "",
                    "trigger": "",
                    "target_scope": "",
                    "nonhero_behavior": "",
                    "objective_behavior": "",
                    "stacking": "",
                    "max_stacks": "",
                    "duration": "",
                    "cooldown": "",
                    "_raw_key": key,
                    "_provenance": {"client_version": version, "source": "deadlock-api"},
                })
        components = first(record, "components", "component_items", "upgrade_from", default=[])
        if is_shop_upgrade and isinstance(components, list):
            target_cost = numeric(first(record, "cost", "soul_cost", "total_cost", default=""))
            for component in components:
                component_key = component.get("class_name", component.get("id", component.get("item_id"))) if isinstance(component, Mapping) else component
                from_id = item_lookup.get(str(component_key), item_lookup.get(snake(component_key), snake(component_key)))
                from_cost = next((row.get("total_cost", "") for row in mapped_items if row.get("item_id") == from_id), "")
                extra = target_cost - numeric(from_cost) if isinstance(target_cost, (int, float)) and isinstance(numeric(from_cost), (int, float)) else ""
                item_upgrades.append({
                    "from_item_id": from_id,
                    "to_item_id": item_id,
                    "from_cost": from_cost,
                    "to_total_cost": target_cost,
                    "additional_cost": extra,
                    "cross_category": "",
                    "temporary_slot_requirement": "",
                    "_provenance": {"client_version": version, "source": "deadlock-api"},
                })

    hero_stats: list[dict[str, Any]] = []
    for record in heroes:
        if not isinstance(record, Mapping):
            continue
        hero_id = hero_lookup.get(str(first(record, "class_name", "id", "name", default="")), id_from_record(record, "hero"))
        stats = first(record, "stats", "starting_stats", "hero_stats", default={})
        if isinstance(stats, Mapping):
            for key, raw_value in stats.items():
                value = numeric(raw_value)
                if isinstance(value, (dict, list)) or value is None:
                    continue
                if snake(key) in {"reload_speed", "tech_duration", "tech_range"} and isinstance(value, (int, float)):
                    value = (value - 1) * 100
                hero_stats.append({
                    "hero_id": hero_id, "stat_id": snake(key), "stat_group": "", "mechanic": snake(key),
                    "base_value": value, "value_per_level": "", "max_value": "", "unit": "",
                    "condition": "", "calculation_rule": "",
                    "_raw_key": key, "_provenance": {"client_version": version, "source": "deadlock-api"},
                })

    mapped: dict[str, Any] = {
        "items": mapped_items,
        "item_mechanics": item_mechanics,
        "item_upgrades": item_upgrades,
        "heroes": mapped_heroes,
        "hero_stats": hero_stats,
        "abilities": abilities,
        "ability_mechanics": ability_mechanics,
    }
    for name, response in raw.items():
        if name not in {"items", "heroes"}:
            mapped[name] = {"payload": response.payload, "_provenance": {"client_version": version, "source": "deadlock-api"}}
    return mapped


def compare_value(value: Any) -> Any:
    if value == "":
        return None
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "false"}:
            return lowered == "true"
        unit_number = re.fullmatch(r"\s*([+-]?\d+(?:\.\d+)?)\s*(?:m|s|%)\s*", value, flags=re.IGNORECASE)
        if unit_number:
            parsed = float(unit_number.group(1))
            return int(parsed) if parsed.is_integer() else parsed
        try:
            return numeric(value)
        except Exception:
            return value
    return value


def diff_rows(mapped: Mapping[str, Any], canonical: Mapping[str, list[dict[str, str]]], version: int) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for dataset, (_, key_fields) in CSV_DATASETS.items():
        api_rows = mapped.get(dataset, [])
        if not isinstance(api_rows, list):
            continue
        current_rows = canonical.get(dataset, [])
        current_by_key = {tuple(row.get(field, "") for field in key_fields): row for row in current_rows}
        api_by_key = {tuple(str(row.get(field, "")) for field in key_fields): row for row in api_rows if isinstance(row, Mapping)}
        fields = set().union(*(row.keys() for row in api_rows if isinstance(row, Mapping))) - {"_raw_fields", "_provenance", "_api_id", "_api_class_name", "_raw_key"}
        for key, row in api_by_key.items():
            current = current_by_key.get(key)
            if current is None:
                changes.append(change(dataset, key, "__record__", None, clean_record(row), "new", version))
                continue
            for field in sorted(fields):
                if field in key_fields or field not in current:
                    continue
                old = compare_value(current.get(field, ""))
                new = compare_value(row.get(field, ""))
                if new is not None and old != new:
                    changes.append(change(dataset, key, field, old, new, "conflict", version))
        for key, current in current_by_key.items():
            if key not in api_by_key:
                changes.append(change(dataset, key, "__record__", clean_record(current), None, "missing_from_api", version))
    return changes


def clean_record(record: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in record.items() if not key.startswith("_")}


def change(dataset: str, key: Sequence[str], field: str, current: Any, api_value: Any, kind: str, version: int) -> dict[str, Any]:
    identity = f"{version}|{dataset}|{'|'.join(key)}|{field}|{json.dumps(api_value, ensure_ascii=False, sort_keys=True)}"
    return {
        "change_id": hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16],
        "dataset": dataset,
        "key": list(key),
        "field": field,
        "current_value": current,
        "api_value": api_value,
        "change_type": kind,
        "status": "review_required",
        "client_version": version,
    }


def collect_schema_observations(raw: Mapping[str, Any]) -> dict[str, Any]:
    observations: dict[str, Any] = {}
    for name, response in raw.items():
        payload = response.payload
        records = payload if isinstance(payload, list) else [payload]
        fields: set[str] = set()
        field_paths: set[str] = set()
        non_object_count = 0
        def walk(value: Any, prefix: str = "") -> None:
            if isinstance(value, Mapping):
                for key, child in value.items():
                    path = f"{prefix}.{key}" if prefix else str(key)
                    field_paths.add(path)
                    if len(path.split(".")) < 4:
                        walk(child, path)
            elif isinstance(value, list) and len(prefix.split(".")) < 3:
                for child in value[:3]:
                    walk(child, prefix + "[]")

        for record in records:
            if isinstance(record, Mapping):
                fields.update(str(key) for key in record)
                walk(record)
            else:
                non_object_count += 1
        observations[name] = {"observed_top_level_fields": sorted(fields), "observed_field_paths": sorted(field_paths), "non_object_records": non_object_count}
    return observations


def validate_bundle(raw: Mapping[str, Any], version: int) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []
    for required in ENDPOINTS:
        if required not in raw:
            errors.append(f"Fehlender Datensatz: {required}")
    for name in ("items", "heroes"):
        if name in raw:
            try:
                records = as_list(raw[name].payload, name)
            except ImportErrorWithContext as exc:
                errors.append(str(exc))
                continue
            seen: set[str] = set()
            for index, record in enumerate(records):
                if not isinstance(record, Mapping):
                    errors.append(f"{name}[{index}] ist kein Objekt")
                    continue
                identity = str(first(record, "class_name", "classname", "id", "name", default=""))
                if not identity:
                    warnings.append(f"{name}[{index}] hat keine stabile ID oder class_name")
                if identity in seen:
                    errors.append(f"{name}: doppelte API-ID {identity}")
                seen.add(identity)
    return {"status": "FAIL" if errors else ("PASS_WITH_WARNINGS" if warnings else "PASS"), "errors": errors, "warnings": warnings, "client_version": version}


def load_canonical() -> dict[str, list[dict[str, str]]]:
    return {dataset: read_csv(ROOT / relative) for dataset, (relative, _) in CSV_DATASETS.items()}


def save_json(path: Path, payload: Any) -> None:
    atomic_write(path, json_bytes(payload))


def archive_response(version_dir: Path, dataset: str, response: ApiResponse) -> dict[str, Any]:
    target = version_dir / "raw" / f"{dataset}.json"
    digest = hash_bytes(response.body)
    storage = target
    existed_before = target.exists()
    if existed_before:
        existing = target.read_bytes()
        if hash_bytes(existing) != digest:
            revision = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            storage = version_dir / "revisions" / revision / "raw" / f"{dataset}.json"
            suffix = 1
            while storage.exists():
                storage = version_dir / "revisions" / f"{revision}-{suffix}" / "raw" / f"{dataset}.json"
                suffix += 1
    if not storage.exists():
        atomic_write(storage, response.body)
    return {"endpoint": response.url, "file": portable_path(storage), "fetched_at": response.fetched_at, "bytes": len(response.body), "sha256": digest, "unchanged_existing": existed_before and storage == target}


def update_index(output_dir: Path, version: int, run_manifest: Mapping[str, Any]) -> None:
    index_path = output_dir / "manifest.json"
    index = read_json(index_path) if index_path.exists() else {"schema_version": API_SCHEMA_VERSION, "versions": {}}
    index.setdefault("schema_version", API_SCHEMA_VERSION)
    index.setdefault("versions", {})
    index["latest_client_version"] = max(int(key) for key in [*index["versions"], str(version)])
    index["api_docs"] = API_DOCS_URL
    index["versions"].setdefault(str(version), {"client_version": version, "runs": []})
    index["versions"][str(version)]["runs"].append({"run_id": run_manifest["run_id"], "manifest": run_manifest["manifest_file"], "created_at": run_manifest["created_at"]})
    save_json(index_path, index)


def apply_approved_changes(approval_path: Path, changes: list[dict[str, Any]]) -> int:
    approval = read_json(approval_path)
    approved_ids = {str(value) for value in (approval.get("change_ids", []) if isinstance(approval, Mapping) else [])}
    if not approved_ids:
        raise ImportErrorWithContext("Approval-Datei benötigt ein nichtleeres Feld 'change_ids'.")
    change_by_id = {row["change_id"]: row for row in changes}
    missing = approved_ids - change_by_id.keys()
    if missing:
        raise ImportErrorWithContext(f"Approval enthält unbekannte change_id(s): {sorted(missing)}")
    applied = 0
    for change_id in sorted(approved_ids):
        row = change_by_id[change_id]
        if row["field"] == "__record__" or row["change_type"] != "conflict":
            raise ImportErrorWithContext(f"Nur bestehende Konfliktfelder dürfen freigegeben werden: {change_id}")
        dataset = row["dataset"]
        relative, key_fields = CSV_DATASETS[dataset]
        path = ROOT / relative
        records = read_csv(path)
        wanted = tuple(str(value) for value in row["key"])
        matched = [record for record in records if tuple(record.get(field, "") for field in key_fields) == wanted]
        if len(matched) != 1:
            raise ImportErrorWithContext(f"Approval-Ziel nicht eindeutig in {relative}: {wanted}")
        if compare_value(matched[0].get(row["field"], "")) != compare_value(row["current_value"]):
            raise ImportErrorWithContext(f"Kanondaten haben sich seit dem Diff geändert: {change_id}")
        matched[0][row["field"]] = row["api_value"]
        write_csv(path, records)
        applied += 1
    return applied


def run_import(args: argparse.Namespace) -> dict[str, Any]:
    fixture = Path(args.fixture_dir).resolve() if args.fixture_dir else None
    client: ApiClient = FixtureClient(fixture) if fixture else ApiClient(
        base_url=args.base_url,
        api_key=os.environ.get(args.api_key_env),
        delay=args.request_delay,
        retries=args.retries,
    )
    latest, version_response = discover_latest_client_version(client)
    version = int(args.client_version) if args.client_version is not None else latest
    if args.client_version is not None and version not in version_values(version_response.payload):
        raise ImportErrorWithContext(f"Client-Version {version} ist laut API nicht verfügbar.")
    raw: dict[str, ApiResponse] = {"client_versions": version_response}
    for name, endpoint in ENDPOINTS.items():
        raw[name] = client.get(endpoint, {"client_version": version})
    validation = validate_bundle(raw, version)
    if validation["status"] == "FAIL":
        raise ImportErrorWithContext("Validierung fehlgeschlagen: " + "; ".join(validation["errors"]))
    canonical = load_canonical()
    mapped = map_api_records(raw, canonical, version)
    changes = diff_rows(mapped, canonical, version)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    output_dir = Path(args.output_dir).resolve()
    version_dir = output_dir / "versions" / str(version)
    raw_manifest: dict[str, Any] = {}
    if not args.dry_run:
        for name, response in raw.items():
            raw_manifest[name] = archive_response(version_dir, name, response)
        run_dir = version_dir / "runs" / timestamp
        for name, payload in mapped.items():
            save_json(run_dir / "mapped" / f"{name}.json", payload)
        save_json(run_dir / "diff.json", changes)
        save_json(run_dir / "review_required.json", changes)
        save_json(run_dir / "validation.json", validation)
        save_json(run_dir / "schema_observations.json", collect_schema_observations(raw))
        run_manifest = {
            "schema_version": API_SCHEMA_VERSION,
            "run_id": timestamp,
            "client_version": version,
            "created_at": now_utc(),
            "api_base_url": client.base_url,
            "api_docs": API_DOCS_URL,
            "raw": raw_manifest,
            "mapped_dir": portable_path(run_dir / "mapped"),
            "diff_file": portable_path(run_dir / "diff.json"),
            "review_file": portable_path(run_dir / "review_required.json"),
            "validation_file": portable_path(run_dir / "validation.json"),
            "change_count": len(changes),
            "review_required_count": len(changes),
            "canonical_data_modified": False,
            "api_key_used": bool(client.api_key),
            "rate_limit_policy": {"minimum_delay_seconds": getattr(client, "delay", 0), "retries": getattr(client, "retries", 0), "retryable_statuses": [429, 500, 502, 503, 504]},
        }
        manifest_file = version_dir / "runs" / timestamp / "manifest.json"
        run_manifest["manifest_file"] = portable_path(manifest_file)
        save_json(manifest_file, run_manifest)
        save_json(version_dir / "manifest.json", {"client_version": version, "latest_run": timestamp, "runs_preserved": True, "run_manifest": run_manifest["manifest_file"], "raw": raw_manifest})
        update_index(output_dir, version, run_manifest)
    result = {"client_version": version, "latest_client_version": latest, "validation": validation, "change_count": len(changes), "review_required_count": len(changes), "dry_run": bool(args.dry_run), "raw_datasets": sorted(raw), "canonical_data_modified": False}
    if args.apply_approved:
        if args.dry_run:
            raise ImportErrorWithContext("--apply-approved kann nicht gemeinsam mit --dry-run verwendet werden.")
        applied = apply_approved_changes(Path(args.apply_approved).resolve(), changes)
        result["canonical_data_modified"] = applied > 0
        result["applied_changes"] = applied
    return result


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description="Versionierter, konservativer Deadlock-API-Importer")
    result.add_argument("--base-url", default=DEFAULT_BASE_URL, help=f"API-Basis-URL (Standard: {DEFAULT_BASE_URL})")
    result.add_argument("--client-version", type=int, help="Bestimmte Client-Version; Standard ist die neueste verfügbare")
    result.add_argument("--output-dir", default=str(ROOT / "archive" / "api"), help="Archivziel (Standard: archive/api)")
    result.add_argument("--fixture-dir", help="Offline-JSON-Fixtures statt Netzwerk verwenden")
    result.add_argument("--dry-run", action="store_true", help="Abrufen, validieren und diffen, ohne Dateien zu schreiben")
    result.add_argument("--validate", action="store_true", help="Strukturelle Validierung explizit anfordern (ist standardmäßig aktiv)")
    result.add_argument("--request-delay", type=float, default=DEFAULT_DELAY, help="Mindestabstand zwischen Requests in Sekunden")
    result.add_argument("--retries", type=int, default=3, help="Wiederholungen für 429/5xx/Netzwerkfehler")
    result.add_argument("--api-key-env", default="DEADLOCK_API_KEY", help="Name der Umgebungsvariable für X-API-KEY")
    result.add_argument("--apply-approved", help="JSON-Datei mit explizit freigegebenen change_ids")
    return result


def main(argv: Sequence[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        result = run_import(args)
    except ImportErrorWithContext as exc:
        print(json.dumps({"status": "FAIL", "error": str(exc)}, ensure_ascii=False, indent=2), file=sys.stderr)
        return 2
    print(json.dumps({"status": "PASS", **result}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
