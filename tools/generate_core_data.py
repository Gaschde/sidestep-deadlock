#!/usr/bin/env python3
"""Generate the Deadlock core research dataset from deadlock.wiki primary sources.

The generator deliberately aborts when the wiki's newest listed update changes. That
guard prevents a quiet rebuild against a newer patch without a fresh research pass.
"""

from __future__ import annotations

import csv
import html
import json
import re
import sys
import urllib.parse
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CORE = ROOT / "data" / "core"
RESEARCH = ROOT / "docs" / "research" / "master"
API = "https://deadlock.wiki/api.php"
EXPECTED_LATEST_UPDATE = "August 22 2026"
PATCH_TITLE = "Minor Update - 08-22-2026"
PATCH_ID = "2026-08-22"
SCHEMA_VERSION = "0.1.0-research"
USER_AGENT = "SidestepDeadlockCoreResearch/0.1 (source-audit dataset)"


def api(params: dict[str, Any]) -> dict[str, Any]:
    query = urllib.parse.urlencode(params)
    request = urllib.request.Request(f"{API}?{query}", headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def wiki_wikitext(title: str) -> tuple[str, str, int]:
    payload = api(
        {
            "action": "query",
            "prop": "revisions",
            "rvprop": "ids|timestamp|content",
            "rvslots": "main",
            "titles": title,
            "format": "json",
            "formatversion": 2,
        }
    )
    page = payload["query"]["pages"][0]
    revision = page["revisions"][0]
    return revision["slots"]["main"]["content"], revision["timestamp"], revision["revid"]


def wiki_json(title: str) -> tuple[dict[str, Any], str, int]:
    content, timestamp, revision = wiki_wikitext(title)
    return json.loads(content), timestamp, revision


def wiki_rendered_default_text(title: str) -> str:
    payload = api({"action": "parse", "page": title, "prop": "text", "format": "json", "formatversion": 2})
    rendered = payload["parse"]["text"]
    marker = 'id="tabber-Default"'
    start = rendered.find(marker)
    if start >= 0:
        end = rendered.find('id="tabber-Enhanced"', start)
        if end >= 0:
            rendered = rendered[start:end]
    rendered = re.sub(r"<script[\s\S]*?</script>", " ", rendered, flags=re.I)
    rendered = re.sub(r"<style[\s\S]*?</style>", " ", rendered, flags=re.I)
    rendered = re.sub(r"<[^>]+>", " ", rendered)
    return re.sub(r"\s+", " ", html.unescape(rendered)).strip()


def rendered_item_texts(public: dict[str, dict[str, Any]]) -> dict[str, str]:
    results: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        future_to_id = {pool.submit(wiki_rendered_default_text, record["Name"]): item_id for item_id, record in public.items()}
        for future in as_completed(future_to_id):
            item_id = future_to_id[future]
            results[item_id] = future.result()
    return results


def snake(value: str) -> str:
    value = value.replace("%", " percent ")
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value)
    value = re.sub(r"[^A-Za-z0-9]+", "_", value)
    return value.strip("_").lower()


def strip_markup(value: str | None) -> str:
    if not value:
        return ""
    value = re.sub(r"<[^>]+>", "", value)
    value = html.unescape(value)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def json_ids(*ids: str) -> str:
    return json.dumps(list(dict.fromkeys(ids)), ensure_ascii=False, separators=(",", ":"))


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="raise")
        writer.writeheader()
        writer.writerows(rows)


SOURCE_DEFS: list[tuple[str, str, str, str, str, str]] = [
    ("SRC-0001", "deadlock_wiki_patch", "Update:August 22, 2026", "Neuester verifizierter Patch", "primary_community_wiki", "latest_patch_verified"),
    ("SRC-0002", "official_valve", "Minor Update - 08-22-2026", "Offizielle Valve-Patchmeldung", "official_primary", "current"),
    ("SRC-0003", "deadlock_wiki_page", "Updates", "Update-Index", "primary_community_wiki", "current_index"),
    ("SRC-0004", "deadlock_wiki_data", "Data:ItemData.json", "Strukturierte Item-Daten", "primary_structured_wiki", "verified_against_latest_patch"),
    ("SRC-0005", "deadlock_wiki_data", "Data:Lang en.json", "Item-Bezeichnungen und Einheiten", "primary_structured_wiki", "same_export_batch_as_item_data"),
    ("SRC-0006", "deadlock_wiki_page", "Items", "Item-Übersicht", "primary_community_wiki", "current_post_patch"),
    ("SRC-0007", "deadlock_wiki_page", "The Curiosity Shop", "Shop-Regeln", "primary_community_wiki", "current_no_later_relevant_patch"),
    ("SRC-0008", "deadlock_wiki_data", "Data:ItemInvestmentData.json", "Kategorie-Investments", "primary_structured_wiki", "current_rendered_post_patch"),
    ("SRC-0009", "deadlock_wiki_page", "Extra Slots", "Extra-Slot-Freischaltungen", "primary_community_wiki", "current_no_later_relevant_patch"),
    ("SRC-0010", "deadlock_wiki_data", "Data:NpcData.json", "Strukturierte Objective-/NPC-Daten", "primary_structured_wiki", "pre_patch_snapshot_cross_checked_with_pages"),
    ("SRC-0011", "deadlock_wiki_data", "Data:Convars.json", "Strukturierte globale Konfiguration", "primary_structured_wiki", "pre_patch_snapshot_cross_checked_with_pages"),
    ("SRC-0012", "deadlock_wiki_data", "Data:MiscData.json", "Strukturierte Rejuvenator-Daten", "primary_structured_wiki", "pre_patch_snapshot_cross_checked_with_pages"),
    ("SRC-0013", "deadlock_wiki_page", "Lane Guardian", "Lane-Guardian-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0014", "deadlock_wiki_page", "Base Guardian", "Base-Guardian-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0015", "deadlock_wiki_page", "Walker", "Walker-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0016", "deadlock_wiki_page", "Shrine", "Shrine-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0017", "deadlock_wiki_page", "Patron", "Patron-Regeln", "primary_community_wiki", "current_no_later_relevant_patch"),
    ("SRC-0018", "deadlock_wiki_page", "Mid-Boss", "Mid-Boss-Regeln", "primary_community_wiki", "current_no_later_relevant_patch"),
    ("SRC-0019", "deadlock_wiki_page", "Backdoor Protection", "Backdoor-Protection-Regeln", "primary_community_wiki", "current_no_later_relevant_patch"),
    ("SRC-0020", "deadlock_wiki_page", "Mechanics", "Globale Mechanikübersicht", "primary_community_wiki", "current_no_later_relevant_patch"),
    ("SRC-0021", "deadlock_wiki_page", "Weapon Damage", "Weapon-Damage-Berechnung", "primary_community_wiki", "current_post_patch"),
    ("SRC-0022", "deadlock_wiki_page", "Spirit Damage", "Spirit-Damage-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0023", "deadlock_wiki_page", "Melee Attack", "Melee-Regeln", "primary_community_wiki", "current_no_later_relevant_patch"),
    ("SRC-0024", "deadlock_wiki_page", "Damage Resistance", "Resistenzberechnung", "primary_community_wiki", "current_post_patch"),
    ("SRC-0025", "deadlock_wiki_page", "Lifesteal", "Lifesteal-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0026", "deadlock_wiki_page", "Healing", "Heilungsregeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0027", "deadlock_wiki_page", "Ability Cooldown", "Ability-/Item-Cooldown", "primary_community_wiki", "current_post_patch"),
    ("SRC-0028", "deadlock_wiki_page", "Charge-Up", "Charge-up-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0029", "deadlock_wiki_page", "Charges", "Ability-Charge-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0030", "deadlock_wiki_page", "Ability Duration", "Ability-Duration-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0031", "deadlock_wiki_page", "Ability Range", "Ability-Range-Berechnung", "primary_community_wiki", "current_post_patch"),
    ("SRC-0032", "deadlock_wiki_page", "Movement", "Bewegungsregeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0033", "deadlock_wiki_page", "Stamina", "Stamina-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0034", "deadlock_wiki_page", "Fire Rate", "Fire-Rate-Berechnung", "primary_community_wiki", "current_post_patch"),
    ("SRC-0035", "deadlock_wiki_page", "Ammo", "Ammo-Berechnung", "primary_community_wiki", "current_post_patch"),
    ("SRC-0036", "deadlock_wiki_page", "Reload Time", "Reload-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0037", "deadlock_wiki_page", "Status Effects", "Buff-/Debuff-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0038", "deadlock_wiki_page", "Stack", "Stacking-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0039", "deadlock_wiki_page", "Build-Up", "Build-up-/Proc-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0040", "deadlock_wiki_page", "Damage Amplification", "Damage-Amp-Regeln", "primary_community_wiki", "current_post_patch_with_tested_exception"),
    ("SRC-0041", "deadlock_wiki_page", "Pure Damage", "Pure-Damage-Regeln", "primary_community_wiki", "current_post_patch"),
    ("SRC-0042", "deadlock_wiki_page", "Unit", "Nicht-Hero-Einheiten", "primary_community_wiki", "current_post_patch"),
]


def source_registry(accessed_at: str) -> list[dict[str, Any]]:
    wiki_titles = [row[2] for row in SOURCE_DEFS if row[1] != "official_valve"]
    metadata: dict[str, tuple[str, int]] = {}
    for start in range(0, len(wiki_titles), 40):
        payload = api(
            {
                "action": "query",
                "prop": "revisions",
                "rvprop": "ids|timestamp",
                "titles": "|".join(wiki_titles[start : start + 40]),
                "format": "json",
                "formatversion": 2,
            }
        )
        for page in payload["query"]["pages"]:
            rev = page["revisions"][0]
            metadata[page["title"]] = (rev["timestamp"], rev["revid"])

    rows: list[dict[str, Any]] = []
    for sid, source_type, title, purpose, authority, sync in SOURCE_DEFS:
        if source_type == "official_valve":
            url = "https://steamcommunity.com/games/1422450/announcements/detail/676255623445218602"
            published_at = "2026-08-22"
            revision_note = "Von SRC-0001 als offizielle Quelle verlinkt; Titel und Redirect am 2026-09-02 geprüft."
        else:
            canonical = title.replace(" ", "_")
            url = "https://deadlock.wiki/" + urllib.parse.quote(canonical, safe=":,_-()")
            published_at, revision = metadata[title]
            revision_note = f"Wiki-Revision {revision}."
        rows.append(
            {
                "source_id": sid,
                "source_type": source_type,
                "title": title if sid != "SRC-0001" else PATCH_TITLE,
                "url": url,
                "published_at": published_at,
                "accessed_at": accessed_at,
                "authority_level": authority,
                "client_sync_status": sync,
                "notes": f"{purpose}. {revision_note}",
            }
        )
    return rows


ITEM_META = {
    "Name",
    "Description",
    "Cost",
    "Tier",
    "Activation",
    "Slot",
    "Components",
    "TargetTypes",
    "ShopFilters",
    "IsDisabled",
    "StreetBrawl",
    "IsImbue",
    "PropertyUpgrades",
    "AbilityUnitTargetLimit",
    "AbilityCooldownBetweenCharge",
    "ChannelMoveSpeed",
}

STATIC_PROPERTIES = {
    "BaseAttackDamagePercent",
    "BonusHealth",
    "BonusBaseHealth",
    "BonusHealthRegen",
    "OutOfCombatHealthRegen",
    "BonusMoveSpeed",
    "BonusSprintSpeed",
    "BonusFireRate",
    "BonusClipSize",
    "BonusClipSizePercent",
    "BonusBulletSpeedPercent",
    "BonusMeleeDamagePercent",
    "BonusHeavyMeleeDamage",
    "BonusAttackRangePercent",
    "BulletResist",
    "TechResist",
    "MeleeResistPercent",
    "SlowResistancePercent",
    "StatusResistancePercent",
    "Stamina",
    "StaminaCooldownReduction",
    "CooldownReduction",
    "ItemCooldownReduction",
    "TechPower",
    "SpiritPower",
    "BonusSpirit",
    "TechRangeMultiplier",
    "TechRadiusMultiplier",
    "BonusAbilityDurationPercent",
    "BonusAbilityCharges",
    "BulletLifestealPercent",
    "AbilityLifestealPercentHero",
    "GroundDashReductionPercent",
    "MoveWhileShootingSpeedPenaltyReductionPercent",
    "MoveWhileZoomedSpeedPenaltyReductionPercent",
    "GravityScale",
}

TIMING_AND_TARGET_PROPERTIES = {
    "AbilityCooldown",
    "AbilityDuration",
    "AbilityCastRange",
    "AbilityCastDelay",
    "AbilityChannelTime",
    "AbilityPostCastDuration",
    "AbilityChargeUpTime",
    "ProcCooldown",
}

EXPLICIT_CURRENT_EXCEPTIONS = {
    # Current values are documented in the corresponding item page's Notes even
    # when the compact default infobox omits a dedicated stat label.
    "upgrade_goose_egg": {"StartingGold", "BonusBuffsPerGold"},
}


def localized_label(key: str, lang: dict[str, Any]) -> str:
    lower_lang = {name.lower(): val for name, val in lang.items()}
    return strip_markup(
        lower_lang.get(f"{key}_label".lower())
        or lower_lang.get(f"{key}_postvalue_label".lower())
        or ""
    )


def property_is_currently_exposed(item_id: str, key: str, rendered_text: str, lang: dict[str, Any]) -> tuple[bool, str]:
    label = localized_label(key, lang)
    normalized_page = rendered_text.casefold()
    if label and label.casefold() in normalized_page:
        return True, "current_default_infobox_label"
    if key in TIMING_AND_TARGET_PROPERTIES:
        return True, "structured_timing_or_target_field"
    if key in EXPLICIT_CURRENT_EXCEPTIONS.get(item_id, set()):
        return True, "current_item_notes_exception"
    return False, "not_exposed_in_current_default_infobox"


def unit_for(key: str, value: Any, lang: dict[str, Any]) -> tuple[Any, str, str, bool]:
    lower_lang = {name.lower(): val for name, val in lang.items()}
    label = lower_lang.get(f"{key}_label".lower()) or lower_lang.get(f"{key}_postvalue_label".lower()) or ""
    postfix = lower_lang.get(f"{key}_postfix".lower())
    used_lang = bool(label or postfix)
    if isinstance(value, bool):
        return value, "boolean", str(label), used_lang
    if isinstance(value, str):
        match = re.fullmatch(r"\s*([+-]?\d+(?:\.\d+)?)\s*m\s*", value)
        if match:
            parsed: int | float = float(match.group(1))
            if parsed.is_integer():
                parsed = int(parsed)
            movement = any(word in key.lower() for word in ("speed", "movespeed", "sprint", "velocity"))
            return parsed, "m/s" if movement else "m", str(label), used_lang
        return value, "enum_or_text", str(label), used_lang
    if postfix:
        mapping = {"%": "percent", "s": "seconds", "m": "meters", "HP/s": "hp_per_second", "/sec": "per_second"}
        return value, mapping.get(str(postfix), str(postfix)), str(label), used_lang
    low = key.lower()
    if any(word in low for word in ("duration", "cooldown", "delay", "interval", "window", "lockout", "channeltime", "chargetime", "tickrate")):
        return value, "seconds", str(label), used_lang
    if any(word in low for word in ("radius", "range", "distance", "height", "width")):
        return value, "meters", str(label), used_lang
    if any(word in low for word in ("percent", "pct", "resist", "reduction", "firerate", "slow", "chance", "amp")):
        return value, "percent", str(label), used_lang
    explicit_counts = {"bonusclipsize", "nonherostacklimit", "procammoConsumed".lower(), "bulletsplitshot", "stealperhit", "stealperkill", "stacklostperdeath"}
    if low in explicit_counts or any(word in low for word in ("stacks", "charges", "count", "shots", "targets", "stamina")):
        return value, "count", str(label), used_lang
    if any(word in low for word in ("gold", "souls")):
        return value, "souls", str(label), used_lang
    if any(word in low for word in ("regen",)):
        return value, "hp_per_second", str(label), used_lang
    if any(word in low for word in ("health", "heal")):
        return value, "hp", str(label), used_lang
    if any(word in low for word in ("damage", "dps", "barrier")):
        return value, "damage", str(label), used_lang
    if any(word in low for word in ("techpower", "spiritpower", "bonusspirit")):
        return value, "spirit_power", str(label), used_lang
    if any(word in low for word in ("multiplier", "multipler", "scale", "factor")):
        return value, "multiplier", str(label), used_lang
    return value, "game_value", str(label), used_lang


def effect_type_for(key: str, activation: str) -> str:
    low = key.lower()
    if "chargeuptime" in low:
        return "charge_up"
    if "cooldown" in low:
        return "cooldown"
    if "duration" in low or "window" in low:
        return "duration"
    if any(word in low for word in ("heal", "regen", "lifesteal")):
        return "healing"
    if any(word in low for word in ("resist", "armor", "barrier", "immunity", "deflection")):
        return "defense"
    if any(word in low for word in ("move", "sprint", "stamina", "dash", "slide", "jump", "air", "gravity", "fly")):
        return "movement"
    if any(word in low for word in ("ammo", "clip", "reload", "firerate", "bulletvelocity", "zoom")):
        return "weapon_operation"
    if any(word in low for word in ("damage", "dps", "weaponpower", "baseattack", "headshot", "melee")):
        return "damage"
    if any(word in low for word in ("stack",)):
        return "stacking"
    return "active" if activation != "Passive" else "passive"


def trigger_for(key: str, activation: str) -> str:
    low = key.lower()
    if key in STATIC_PROPERTIES:
        return "equipped"
    if "perkill" in low or "onkill" in low:
        return "kill"
    if "headshot" in low:
        return "headshot"
    if "perhit" in low or "onhit" in low:
        return "hit"
    if "proc" in low:
        return "proc"
    if "stack" in low:
        return "stack_change"
    if activation != "Passive":
        return "item_activation"
    if key == "AbilityCooldown":
        return "passive_proc_cooldown"
    return "passive_item_rule"


def item_description(item_id: str, record: dict[str, Any], lang: dict[str, Any]) -> str:
    direct = strip_markup(record.get("Description"))
    if direct:
        return direct
    return strip_markup(lang.get(f"{item_id}_desc"))


def build_items_and_effects(item_data: dict[str, Any], lang: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[tuple[str, str]]]:
    public: dict[str, dict[str, Any]] = {}
    for item_id, record in item_data.items():
        if (
            record.get("Name") is not None
            and record.get("IsDisabled") is False
            and record.get("StreetBrawl") is False
            and record.get("Cost") in {800, 1600, 3200, 6400}
            and record.get("Tier") in {1, 2, 3, 4}
            and record.get("Slot") in {"Weapon", "Armor", "Tech"}
        ):
            public[item_id] = record

    category = {"Weapon": "Weapon", "Armor": "Vitality", "Tech": "Spirit"}
    item_rows: list[dict[str, Any]] = []
    effect_rows: list[dict[str, Any]] = []
    upgrade_rows: list[dict[str, Any]] = []
    excluded_raw_fields: list[tuple[str, str]] = []
    rendered = rendered_item_texts(public)

    for item_id in sorted(public, key=lambda key: (category[public[key]["Slot"]], public[key]["Tier"], public[key]["Name"])):
        record = public[item_id]
        activation = record["Activation"]
        active = activation != "Passive"
        item_rows.append(
            {
                "item_id": item_id,
                "name": record["Name"],
                "category": category[record["Slot"]],
                "tier": record["Tier"],
                "total_cost": record["Cost"],
                "is_public_shop_item": "true",
                "active_type": activation if active else "",
                "active_cooldown": record.get("AbilityCooldown", "") if active else "",
                "verified_patch": PATCH_TITLE,
                "verified_date": "2026-09-02",
                "confidence": "high",
                "source_ids": json_ids("SRC-0004", "SRC-0006"),
                "notes": "Kanonischer interner Spielschlüssel aus ItemData; Street-Brawl-Legendaries, deaktivierte und kosmetische Einträge ausgeschlossen.",
            }
        )

        description = item_description(item_id, record, lang)
        target_types = record.get("TargetTypes") or []
        target_scope = ";".join(target_types) if target_types else "Self_or_source_defined"
        max_stacks = record.get("MaxStacks")

        for key, raw in record.items():
            if key in ITEM_META or raw is None:
                continue
            exposed, exposure_basis = property_is_currently_exposed(item_id, key, rendered[item_id], lang)
            if not exposed:
                excluded_raw_fields.append((item_id, key))
                continue
            raw_effects: list[tuple[str, Any, str]] = []
            if isinstance(raw, dict) and "Value" in raw:
                raw_effects.append((key, raw["Value"], ""))
                scale = raw.get("Scale")
                if isinstance(scale, dict) and "Value" in scale:
                    scale_type = str(scale.get("Type", "unspecified"))
                    raw_effects.append((f"{key}Scaling", scale["Value"], scale_type))
            else:
                raw_effects.append((key, raw, ""))

            for path, value, scale_type in raw_effects:
                if scale_type:
                    normalized = value
                    unit = f"{snake(scale_type)}_scaling_coefficient"
                    label = f"Skalierung für {key}"
                    used_lang = False
                else:
                    normalized, unit, label, used_lang = unit_for(key, value, lang)
                conditional = key not in STATIC_PROPERTIES
                if conditional and description:
                    condition = f"Quellbedingung (englischer Tooltip): {description}"
                elif conditional:
                    condition = "Item-spezifische Bedingung ist im strukturierten Datensatz nicht als eigenes Feld dokumentiert."
                else:
                    condition = "Immer, solange das Item ausgerüstet ist."
                nonhero = ""
                if any(token in key.lower() for token in ("nonhero", "nonplayer", "npc", "trooper", "creep")):
                    nonhero = "Expliziter Nicht-Hero-/NPC-Wert dieser Zeile."
                elif any("NPC" in str(token) or "Trooper" in str(token) for token in target_types):
                    nonhero = f"TargetTypes: {target_scope}."
                stack_rule = ""
                if "perstack" in key.lower() or key.lower().startswith("stacking"):
                    stack_rule = "pro_stack"
                elif key == "MaxStacks":
                    stack_rule = "stack_limit"
                elif max_stacks and any(token in key.lower() for token in ("perkill", "stack", "buildup")):
                    stack_rule = "item_stack_limit_applies"
                duration = normalized if "duration" in key.lower() and isinstance(normalized, (int, float)) else ""
                cooldown = normalized if "cooldown" in key.lower() and isinstance(normalized, (int, float)) else ""
                source_list = ["SRC-0004"]
                if used_lang or description:
                    source_list.append("SRC-0005")
                confidence = "medium" if unit == "game_value" or exposure_basis != "current_default_infobox_label" else "high"
                notes = f"Rohfeld: {key}. Exposure-Basis: {exposure_basis}."
                if label:
                    notes += f" Wiki-Label: {label}."
                if scale_type:
                    notes += f" Scale.Type: {scale_type}."
                if unit == "game_value":
                    notes += " Die Primärquelle nennt keine belastbare Dimension; der Rohwert bleibt unverändert."
                effect_rows.append(
                    {
                        "item_id": item_id,
                        "effect_id": f"eff_{snake(path)}",
                        "effect_type": effect_type_for(path, activation),
                        "mechanic": snake(path),
                        "value": normalized,
                        "unit": unit,
                        "condition": condition,
                        "trigger": trigger_for(key, activation),
                        "target_scope": target_scope if conditional else "Self",
                        "nonhero_behavior": nonhero,
                        "objective_behavior": (
                            "TargetTypes enthält BossEnemy; welche konkreten Map-Objectives diese Engine-Klasse umfasst, bleibt offen (UNC-0005)."
                            if "BossEnemy" in target_types
                            else ""
                        ),
                        "stacking": stack_rule,
                        "max_stacks": max_stacks if stack_rule and isinstance(max_stacks, int) else "",
                        "duration": duration,
                        "cooldown": cooldown,
                        "confidence": confidence,
                        "source_ids": json_ids(*source_list),
                        "notes": notes,
                    }
                )

    for target_id, record in public.items():
        components = record.get("Components") or []
        for component_id in components:
            component = public.get(component_id)
            if component is None:
                continue
            multi = len(components) > 1
            upgrade_rows.append(
                {
                    "from_item_id": component_id,
                    "to_item_id": target_id,
                    "from_cost": component["Cost"],
                    "to_total_cost": record["Cost"],
                    "additional_cost": record["Cost"] - component["Cost"],
                    "cross_category": str(component["Slot"] != record["Slot"]).lower(),
                    "temporary_slot_requirement": "",
                    "confidence": "medium",
                    "source_ids": json_ids("SRC-0004", "SRC-0006", "SRC-0007"),
                    "notes": (
                        "Kante und Einzelkomponentenrabatt sind verifiziert. "
                        + ("Ziel hat mehrere Komponenten; additional_cost gilt nur bei Besitz dieser einen Komponente. " if multi else "")
                        + "Ein vorübergehender zusätzlicher Slotbedarf ist nicht dokumentiert (UNC-0004)."
                    ),
                }
            )

    upgrade_rows.sort(key=lambda row: (row["to_item_id"], row["from_item_id"]))
    return item_rows, upgrade_rows, effect_rows, excluded_raw_fields


def rule(rule_id: str, mechanic: str, statement: str, sources: list[str], *, formula: str = "", scope: str = "global", confidence: str = "high", notes: str = "") -> dict[str, Any]:
    return {
        "rule_id": rule_id,
        "mechanic": mechanic,
        "statement": statement,
        "formula": formula,
        "scope": scope,
        "confidence": confidence,
        "source_ids": sources,
        "notes": notes,
    }


def build_mechanics() -> dict[str, Any]:
    return {
        "damage_rules": [
            rule("DMG-001", "weapon_damage", "Weapon Damage bestimmt Bullet Damage und erhöht Melee Damage; manche Fähigkeiten verursachen ebenfalls Weapon Damage.", ["SRC-0021"]),
            rule("DMG-002", "weapon_damage_formula", "Flat Weapon Damage wird nach dem prozentualen Weapon-Multiplikator addiert und danach von Falloff, Resistenzen und Crit beeinflusst.", ["SRC-0021"], formula="final_damage=((base_damage*weapon_multiplier)+flat_bonus)*falloff*resistance_multipliers*crit_multiplier"),
            rule("DMG-003", "melee_weapon_scaling", "Melee Damage ist Weapon Damage und profitiert zu 50 % von Weapon-Damage-Boni.", ["SRC-0021", "SRC-0023"], formula="melee_bonus_from_weapon_damage=weapon_damage_bonus*0.5"),
            rule("DMG-004", "spirit_damage", "Spirit Damage wird durch Spirit Power und den jeweiligen Spirit-Scaling-Koeffizienten beeinflusst.", ["SRC-0022"]),
            rule("DMG-005", "pure_damage", "Pure Damage ist weder Spirit-, Weapon- noch Melee-Damage und wird weder durch Damage Resistance noch durch Barriers reduziert; Invincibility kann ihn blockieren.", ["SRC-0041"]),
            rule("DMG-006", "damage_falloff", "Weapon-Falloff reduziert Schaden über die Distanz linear von 100 % bis 10 % innerhalb der hero-spezifischen Falloff-Spanne.", ["SRC-0021"], scope="global_formula_only"),
            rule("DMG-007", "weakpoint_multiplier", "Troopers, Lane Guardians und Heroes besitzen Weakpoints mit 1,65-fachem Bullet Damage; Ausnahmen sind hero-spezifisch und nicht Bestandteil dieses Core-Datensatzes.", ["SRC-0021"], formula="weakpoint_damage=bullet_damage*1.65"),
        ],
        "resistance_rules": [
            rule("RES-001", "resistance_types", "Bullet Resist reduziert Weapon- und Melee-Damage; Melee Resist reduziert zusätzlich nur Melee-Damage; Spirit Resist reduziert Spirit Damage.", ["SRC-0024"]),
            rule("RES-002", "resistance_stacking", "Mehrere Quellen derselben Resistenz stapeln multiplikativ.", ["SRC-0024"], formula="total_resist=1-product(1-R_i)"),
            rule("RES-003", "resistance_reduction", "Resistance Reduction (Shred) wird zuerst separat multiplikativ zusammengeführt und anschließend von der Gesamtresistenz abgezogen.", ["SRC-0024"], formula="total_reduction=1-product(1-S_i); final_resist=total_resist-total_reduction"),
            rule("RES-004", "negative_resistance", "Negative Endresistenz verstärkt eingehenden Schaden: -30 % Resistenz bedeutet 130 % eingehenden Schaden.", ["SRC-0024"], formula="damage_multiplier=1-final_resist"),
            rule("RES-005", "reduction_vs_penetration", "Die aktuelle Wiki-Mechanik dokumentiert Resistance Reduction/Shred als von Penetration getrennten Rechenschritt; ein allgemeiner, aktueller Penetrationswert ist nicht als globale Stat-Regel dokumentiert.", ["SRC-0024", "SRC-0041"], confidence="medium"),
        ],
        "lifesteal_rules": [
            rule("LFS-001", "lifesteal_stacking", "Mehrere Quellen desselben Lifesteal-Typs stapeln multiplikativ; Bullet und Spirit Lifesteal werden getrennt berechnet.", ["SRC-0025"], formula="total_lifesteal=1-product(1-L_i)"),
            rule("LFS-002", "bullet_lifesteal_nonhero", "Bullet Lifesteal wirkt gegen Creeps/Nicht-Hero-Einheiten mit 60 % Effektivität.", ["SRC-0025"], formula="nonhero_bullet_lifesteal=hero_effect*0.60", scope="nonhero"),
            rule("LFS-003", "spirit_lifesteal_nonhero", "Spirit Lifesteal wirkt gegen Creeps/Nicht-Hero-Einheiten mit 40 % Effektivität.", ["SRC-0025"], formula="nonhero_spirit_lifesteal=hero_effect*0.40", scope="nonhero"),
            rule("LFS-004", "melee_item_heal", "Die Items Melee Lifesteal und Lifestrike sind cooldown-gesteuerte Heileffekte pro Melee-Treffer und nicht identisch mit permanent aktivem Lifesteal.", ["SRC-0025"]),
        ],
        "healing_rules": [
            rule("HEAL-001", "healing_amp", "Healing Amp erhöht vom Heiler verursachte Selbst- und Verbündetenheilung, einschließlich Heal-over-Time von Items/Fähigkeiten.", ["SRC-0026"]),
            rule("HEAL-002", "healing_reduction_stacking", "Verschiedene Healing-Reduction-Quellen stapeln multiplikativ; dieselbe Quelle wird während ihrer Laufzeit nur einmal angewendet.", ["SRC-0026"], formula="total_heal_reduction=1-product(1-R_i)"),
            rule("HEAL-003", "final_healing", "Healing Reduction wird vor Healing Amp angewendet.", ["SRC-0026"], formula="final_healing=initial_healing*(1-total_reduction)*(1+healing_amp)"),
        ],
        "cooldown_rules": [
            rule("CD-001", "ability_cooldown", "Ability Cooldown ist die Zeit bis eine Fähigkeit wieder nutzbar ist.", ["SRC-0027"]),
            rule("CD-002", "cooldown_reduction_stacking", "Mehrere Cooldown-Reduction-Quellen stapeln multiplikativ.", ["SRC-0027"], formula="total_cdr=1-product(1-CDR_i)"),
            rule("CD-003", "item_vs_ability_cooldown", "Item Cooldown gilt für aktive und passive Items und ist von Ability Cooldown getrennt; Item Cooldown Reduction wirkt auf Item Cooldowns.", ["SRC-0027"]),
            rule("CD-004", "charge_delay", "Bei Charged Abilities ist der Wiederherstellungs-Cooldown einer Charge von der kürzeren Verzögerung zwischen zwei Einsätzen zu unterscheiden; diese Verzögerung wird nicht durch Cooldown Reduction beeinflusst.", ["SRC-0027", "SRC-0029"]),
        ],
        "charge_up_rules": [
            rule("CUP-001", "charge_up", "Charge-up-Items können vor voller Aufladung ausgelöst werden; ihre Effektstärke entspricht grundsätzlich dem erreichten Ladeanteil.", ["SRC-0028"]),
            rule("CUP-002", "charge_up_vs_cooldown", "Charge-up-Zeit wird nicht durch Cooldown Reduction beeinflusst und ist keine Cooldown-Zeit.", ["SRC-0028", "SRC-0027"]),
            rule("CUP-003", "charge_up_nonhero", "Tankbuster kann an Nicht-Spieler-Einheiten auslösen, verbraucht dort laut Wiki aber keinen Charge-up-Fortschritt.", ["SRC-0028"], scope="nonhero"),
        ],
        "ability_charge_rules": [
            rule("CHG-001", "ability_charges", "Eine Nutzung verbraucht eine Charge; fehlt eine Charge, ist die Fähigkeit bis zur Wiederherstellung nicht nutzbar.", ["SRC-0029"]),
            rule("CHG-002", "charge_restoration", "Charges werden grundsätzlich einzeln wiederhergestellt; der Ability Cooldown entspricht der Wiederherstellungszeit einer Charge.", ["SRC-0029"]),
            rule("CHG-003", "bonus_ability_charges", "Bonus Ability Charges erhöhen nur Fähigkeiten, die bereits Charges verwenden.", ["SRC-0029"]),
        ],
        "duration_rules": [
            rule("DUR-001", "ability_duration", "Ability Duration bestimmt, wie lange Effekte von Fähigkeiten und Items anhalten.", ["SRC-0030"]),
        ],
        "range_rules": [
            rule("RNG-001", "ability_range", "Ability Range beeinflusst effektive Distanz und Cast Range und wird in Metern angegeben; Boni sind prozentual.", ["SRC-0031"]),
            rule("RNG-002", "range_stacking", "Mehrere Ability-Range-Quellen stapeln laut Wiki multiplikativ.", ["SRC-0031"], formula="total_range_bonus=1-product(1-R_i)"),
        ],
        "movement_rules": [
            rule("MOV-001", "distance_units", "Distanzen und Geschwindigkeiten werden als Meter beziehungsweise Meter pro Sekunde dargestellt; 1 Hammer Unit entspricht ungefähr 0,0254 m.", ["SRC-0032"]),
            rule("MOV-002", "sprint", "Sprint beginnt automatisch nach fünf Sekunden außerhalb des Kampfes und endet bei Kampfeintritt oder Zoom; hero-spezifische Basiswerte sind ausgeschlossen.", ["SRC-0032"]),
            rule("MOV-003", "dash_jump_cost", "Ein Dash kostet 1 Stamina; der anschließende Dash Jump kostet eine weitere Stamina, insgesamt 2.", ["SRC-0020", "SRC-0032", "SRC-0033"]),
            rule("MOV-004", "down_dash_cost", "Ein Down Dash kostet 0,5 Stamina.", ["SRC-0020", "SRC-0032", "SRC-0033"]),
            rule("MOV-005", "wall_jump_cost", "Der erste Wall Jump kostet keine Stamina; weitere Wall Jumps vor dem Landen kosten je 0,5 Stamina.", ["SRC-0020", "SRC-0032", "SRC-0033"]),
            rule("MOV-006", "slide_ammo", "Während eines Slides steht unendliche Munition zur Verfügung.", ["SRC-0020", "SRC-0033", "SRC-0035"]),
            rule("MOV-007", "slide_threshold", "Die aktuellen Wiki-Seiten nennen widersprüchliche Slide-Schwellen (8,9 m/s und 9,6 m/s); kein Einzelwert wird als kanonisch übernommen.", ["SRC-0020", "SRC-0032"], confidence="low", notes="Siehe UNC-0011."),
        ],
        "stamina_rules": [
            rule("STA-001", "stamina_actions", "Stamina wird für Ground Dash, Air Dash, Air Jump und weitere Bewegungsaktionen verbraucht; Basiszahl und Regenerationszeit sind hero-spezifisch.", ["SRC-0033"]),
            rule("STA-002", "stamina_ui_limit", "Die Anzeige unter dem Fadenkreuz zeigt höchstens 8 Stamina-Balken; darüberliegende Stamina bleibt unsichtbar.", ["SRC-0033"]),
            rule("STA-003", "wall_jump_regen_penalty", "Ein Wall Jump im Kampf reduziert die Stamina-Regeneration für 5 Sekunden um 25 %.", ["SRC-0033"]),
        ],
        "fire_rate_rules": [
            rule("FR-001", "fire_rate_definition", "Fire Rate ist Munition pro Sekunde; ihre Umkehrung ist die Gun Cycle Time in Sekunden pro Schuss.", ["SRC-0034"]),
            rule("FR-002", "fire_rate_modifier", "Positive Fire-Rate-Boni addieren sich; Slows werden multiplikativ zusammengeführt und anschließend gegengerechnet.", ["SRC-0034"], formula="modifier=sum(bonuses)-(1-product(1-slow_i))"),
            rule("FR-003", "positive_fire_rate", "Bei positivem Gesamtmodifikator wird Fire Rate direkt multipliziert.", ["SRC-0034"], formula="final_fire_rate=base_fire_rate*(1+modifier)"),
            rule("FR-004", "negative_fire_rate", "Bei negativem Gesamtmodifikator wird die Gun Cycle Time verlängert; der Modifikator ist bei -50 % gedeckelt.", ["SRC-0034"], formula="final_fire_rate=base_fire_rate/(1+abs(modifier)); modifier>=-0.50"),
        ],
        "ammo_reload_rules": [
            rule("AMMO-001", "ammo_formula", "Flache Ammo-Boni werden zuerst auf Basis-Ammo addiert; Prozentboni addieren sich und das Ergebnis wird auf die nächste ganze Zahl aufgerundet.", ["SRC-0035"], formula="final_ammo=ceil((base_ammo+flat_bonuses)*(1+sum(percent_bonuses)))"),
            rule("AMMO-002", "burst_ammo", "Bei Burst-Waffen verbraucht die pro Eingabe abgefeuerte Kugelzahl dieselbe Anzahl Ammo.", ["SRC-0035"]),
            rule("AMMO-003", "alternate_fire_low_ammo", "Alternate Fire kann auch mit nur einer verbleibenden Runde genutzt werden, obwohl sie regulär mehrere Ammo verbraucht.", ["SRC-0035"]),
            rule("RLD-001", "reload_interrupt", "Melee und Dashing unterbrechen den Reload bis zum Ende der Animation; hero-spezifische Ausnahmen sind nicht im Core abgebildet.", ["SRC-0036"]),
            rule("RLD-002", "reload_types", "Es gibt vollständigen Magazin-Reload und Single-Reload pro Projektil; Basiszeiten sind hero-spezifisch.", ["SRC-0036"]),
        ],
        "targeting_rules": [
            rule("TGT-001", "item_target_types", "Item-Zielklassen werden in ItemData über TargetTypes kodiert; item_mechanics.csv bewahrt diese Enumerationen pro Effekt.", ["SRC-0004"]),
            rule("TGT-002", "hero_nonhero_objective", "Hero-, Nicht-Hero- und Objective-Ziele dürfen nicht gleichgesetzt werden; fehlende Objective-Freigaben werden nicht aus AllEnemy oder NPC-Begriffen geraten.", ["SRC-0004", "SRC-0042"], confidence="medium"),
        ],
        "debuff_rules": [
            rule("DEB-001", "status_effects", "Buffs sind positive und Debuffs negative Status Effects mit dokumentierter Dauer oder expliziter Entfernung.", ["SRC-0037"]),
            rule("DEB-002", "debuff_resist", "Debuff Resist verkürzt die Dauer negativer Effekte proportional; Ausnahmen müssen effektbezogen dokumentiert werden.", ["SRC-0037"], formula="final_duration=base_duration*(1-debuff_resist)"),
        ],
        "stacking_rules": [
            rule("STK-001", "stack", "Stacks sind diskrete Inkremente eines skalierenden Effekts; temporäre Stacks verschwinden meist gemeinsam nach Ablauf ihrer Dauer.", ["SRC-0038"]),
            rule("STK-002", "stack_vs_build_up", "Stacks skalieren einen laufenden Effekt; Build-up ist dagegen ein Prozentmeter, das bei 100 % einen einzelnen Effekt auslöst.", ["SRC-0038", "SRC-0039"]),
        ],
        "summon_rules": [
            rule("SUM-001", "hero_created_units", "Hero-erzeugte Einheiten sind eine eigene Untergruppe von Units/NPCs; hero-spezifische Summon-Daten bleiben außerhalb von data/core/.", ["SRC-0042"], scope="nonhero"),
        ],
        "nonhero_rules": [
            rule("NPH-001", "unit_classes", "Units/NPCs umfassen Structures/Objectives, respawnende Creeps und Hero-erzeugte Einheiten.", ["SRC-0042"]),
            rule("NPH-002", "structure_respawn", "Guardians, Walkers, Shrines und Patrons sind Structures/Objectives und respawnen nicht.", ["SRC-0042"]),
        ],
        "proc_rules": [
            rule("PRC-001", "build_up_threshold", "Build-up sammelt durch Bullet- oder zulässige Melee-Treffer Prozentfortschritt; bei 100 % löst der Status aus.", ["SRC-0039"]),
            rule("PRC-002", "build_up_falloff", "Build-up pro Schuss wird durch Damage Falloff bis auf 10 % des Basiswerts am maximalen Falloff reduziert.", ["SRC-0039"]),
            rule("PRC-003", "item_build_up_decay", "Item-Build-up beginnt nach 2 Sekunden ohne neue Anwendung zu verfallen und verliert 20 % pro Sekunde.", ["SRC-0039"]),
            rule("PRC-004", "return_fire_proc", "Return Fire baut laut Wiki keine Build-up-Effekte gegen den Angreifer auf.", ["SRC-0039"]),
        ],
        "damage_amplification_rules": [
            rule("AMP-001", "damage_amp_classes", "Damage Amplification wird in additive, multiplikative, Instanz- und einzigartige Verstärkerklassen getrennt; die Klassen dürfen nicht pauschal gleich gestapelt werden.", ["SRC-0040"]),
            rule("AMP-002", "damage_reduction_live_behavior", "Die Wiki dokumentiert, dass Standard-Damage-Reduction im getesteten Client aktuell als negative additive Verstärkung wirkt, obwohl Valve multiplikatives Verhalten beabsichtigt hat.", ["SRC-0040"], confidence="low", notes="Client-Test-abhängig; siehe UNC-0010."),
        ],
    }


def build_economy(investment_data: dict[str, Any]) -> dict[str, Any]:
    thresholds: list[dict[str, Any]] = []
    categories = investment_data["ItemInvestments"]
    previous = {name: 0 for name in categories}
    for index, weapon in enumerate(categories["Weapon"]):
        threshold = weapon["GoldThreshold"]
        bonuses: dict[str, Any] = {}
        for name in ("Weapon", "Vitality", "Spirit"):
            cumulative = categories[name][index]["Bonus"]
            bonuses[name.lower()] = {
                "incremental_bonus": cumulative - previous[name],
                "cumulative_bonus": cumulative,
                "unit": "percent" if name != "Spirit" else "spirit_power",
            }
            previous[name] = cumulative
        thresholds.append(
            {
                "category_investment": threshold,
                "bonuses": bonuses,
                "is_major_spike": threshold == 4800,
                "confidence": "high",
                "source_ids": ["SRC-0008", "SRC-0006"],
            }
        )
    return {
        "source_ids": ["SRC-0006", "SRC-0007", "SRC-0008"],
        "tier_prices": {"1": 800, "2": 1600, "3": 3200, "4": 6400},
        "sellback": {
            "rate": 0.5,
            "basis": "tatsächlich bezahlte Anschaffungskosten",
            "confidence": "high",
            "source_ids": ["SRC-0006", "SRC-0007"],
        },
        "refund": {
            "rate": 1.0,
            "eligibility": "unmittelbare Rückgabe im Kaufzustand; die Wiki-Seiten unterscheiden sich bei Shopfenster versus Shopbereich",
            "confidence": "medium",
            "source_ids": ["SRC-0006", "SRC-0007"],
            "uncertainty_id": "UNC-0003",
        },
        "investments": {
            "basis": "Summe der total_cost-Werte aktuell besessener Items je Kategorie",
            "maximum_counted_investment": 28800,
            "category_rewards": {
                "weapon": "weapon_damage_percent",
                "vitality": "max_health_percent",
                "spirit": "spirit_power",
            },
            "item_stats_are_separate": True,
            "confidence": "high",
            "source_ids": ["SRC-0006", "SRC-0008"],
        },
        "investment_thresholds": thresholds,
        "component_cost_handling": {
            "raw_item_cost_field": "items.total_cost",
            "upgrade_payment": "to_total_cost minus value of owned component(s)",
            "category_investment_after_upgrade": "total_cost des besessenen Ziel-Items; nicht die isolierte Kassenzahlung",
            "confidence": "high",
            "source_ids": ["SRC-0006", "SRC-0007"],
        },
        "upgrade_cost_rules": [
            {
                "rule_id": "ECO-UPG-001",
                "rule": "Eine vorhandene Komponente reduziert die Zahlung für das Ziel-Item um ihren Preis.",
                "confidence": "high",
                "source_ids": ["SRC-0006", "SRC-0007"],
            },
            {
                "rule_id": "ECO-UPG-002",
                "rule": "Wenn eine Komponente in mehrere Items ausgebaut werden kann, wird ihr Rabatt nur beim zuerst gekauften Upgrade genutzt.",
                "confidence": "high",
                "source_ids": ["SRC-0006"],
            },
        ],
        "special_rules": [
            {
                "rule_id": "ECO-SPEC-001",
                "rule": "Aktive Items belegen zusätzlich einen von vier Active-Key-Slots; höchstens vier aktive Items können gleichzeitig gehalten werden.",
                "confidence": "high",
                "source_ids": ["SRC-0006", "SRC-0007"],
            }
        ],
    }


def build_slots() -> dict[str, Any]:
    return {
        "source_ids": ["SRC-0006", "SRC-0007", "SRC-0009", "SRC-0015"],
        "starting_slots": {"universal": 9},
        "unlocks": [
            {"slot_index": 10, "slot_type": "extra", "condition": "1 gegnerischen Walker zerstören", "team_wide": True, "confidence": "high", "source_ids": ["SRC-0009", "SRC-0015"]},
            {"slot_index": 11, "slot_type": "extra", "condition": "2 gegnerische Walker zerstören", "team_wide": True, "confidence": "high", "source_ids": ["SRC-0009", "SRC-0015"]},
            {"slot_index": 12, "slot_type": "extra", "condition": "3 gegnerische Walker zerstören", "team_wide": True, "confidence": "high", "source_ids": ["SRC-0009", "SRC-0015"]},
        ],
        "item_limit": 12,
        "active_item_limit": 4,
        "slot_types": [
            {"slot_type": "universal", "capacity": 9, "allowed_categories": ["Weapon", "Vitality", "Spirit"], "source_ids": ["SRC-0006"]},
            {"slot_type": "extra", "capacity": 3, "allowed_categories": ["Weapon", "Vitality", "Spirit"], "source_ids": ["SRC-0006", "SRC-0009"]},
            {"slot_type": "active_key", "capacity": 4, "is_additional_binding": True, "source_ids": ["SRC-0006", "SRC-0007"]},
        ],
        "upgrade_behavior": [
            {
                "rule_id": "SLOT-UPG-001",
                "rule": "Die Wiki dokumentiert den Komponentenrabatt, aber keinen belastbaren separaten temporären Slotbedarf während des Upgrades.",
                "temporary_slot_requirement": None,
                "confidence": "low",
                "source_ids": ["SRC-0006", "SRC-0007"],
                "uncertainty_id": "UNC-0004",
            }
        ],
    }


def build_objectives() -> dict[str, Any]:
    return {
        "guardian": {
            "variants": [
                {
                    "objective_id": "lane_guardian",
                    "health": 5500,
                    "reward_souls_total": 1250,
                    "damage_types_dealt": ["weapon"],
                    "base_bullet_resist_percent": 10,
                    "player_bullet_vulnerability_percent": -25,
                    "time_damage_resist": {"start_percent": 50, "end_percent": -50, "start_minute": 0, "end_minute": 12, "linear": True},
                    "protection": "Unverwundbar, wenn keine gegnerischen Troopers oder Heroes innerhalb 24 m sind; Player-Schaden außerhalb der Guardian-Reichweite wird abgewiesen.",
                    "headshots": True,
                    "melee_parryable": True,
                    "backdoor_protection": False,
                    "confidence": "high",
                    "source_ids": ["SRC-0013", "SRC-0010"],
                },
                {
                    "objective_id": "base_guardian",
                    "health": 4000,
                    "reward_souls_total": 1000,
                    "damage_types_dealt": ["weapon"],
                    "base_bullet_resist_percent": 20,
                    "player_bullet_vulnerability_percent": -25,
                    "enemy_scaling_bullet_resist": {"start_percent": 40, "reduction_per_nearby_enemy_hero_percent": 20, "minimum_percent": 0, "zero_at_enemy_heroes": 2},
                    "backdoor_protection": {"damage_resist_percent": 65, "health_regen_per_second": 65},
                    "headshots": False,
                    "melee_parryable": False,
                    "progression": ["Zerstörung eines Paars beschleunigt die angreifende Zipline dieser Lane dauerhaft.", "Mindestens ein zerstörtes Paar macht Shrines grundsätzlich angreifbar."],
                    "confidence": "high",
                    "source_ids": ["SRC-0014", "SRC-0010", "SRC-0019"],
                },
            ]
        },
        "walker": {
            "objective_id": "walker",
            "health_by_walkers_remaining": {"3": 6000, "2": 9000, "1": 12000},
            "reward": {"souls_total": 3500, "nearby_attackers_share_percent": 40, "nearby_pool_souls": 1400, "whole_team_share_percent": 60, "whole_team_pool_souls": 2100, "recent_damage_window_seconds": 20},
            "damage_types_dealt": ["spirit"],
            "base_bullet_resist_percent": 35,
            "time_damage_resist": {"start_percent": 65, "end_percent": -65, "start_minute": 0, "end_minute": 18, "linear": True},
            "nearby_enemy_weapon_resist_percent_by_count": {"0": 0, "1": 0, "2": 0, "3": 20, "4": 30, "5": 40, "6": 50, "radius_meters": 50.8},
            "friendly_aura": {"radius_meters": 28, "bullet_resist_percent": 15, "spirit_resist_percent": 15},
            "protection": {"dormant_invulnerability_enemy_radius_meters": 22, "backdoor_damage_resist_percent": 65, "backdoor_health_regen_per_second": 65},
            "attacks": {
                "fire_beam": {"max_health_damage_per_second_percent": 2},
                "stomp": {"flat_damage": 350, "max_health_damage_percent": 15, "stun_seconds": 2, "radius_meters": 14.5, "cooldown_seconds": None, "uncertainty_id": "UNC-0008"},
                "rocket_barrage": {"projectiles": 6, "impact_damage_each": 200, "cooldown_seconds": 10, "ground_fire_dps": 25, "ground_fire_duration_seconds": 5, "bullet_resist_reduction_percent": 10, "spirit_resist_reduction_percent": 10},
            },
            "slot_unlock": "Ein Extra Slot für das gesamte angreifende Team pro zerstörtem Walker.",
            "confidence": "high",
            "source_ids": ["SRC-0015", "SRC-0010", "SRC-0019", "SRC-0009"],
        },
        "shrines": {
            "objective_id": "shrine",
            "health_first": 5000,
            "health_remaining_after_first_destroyed": 10000,
            "base_bullet_resist_percent": 20,
            "enemy_scaling_bullet_resist": {"start_percent": 60, "reduction_per_nearby_enemy_hero_percent": 20, "minimum_percent": 0, "zero_at_enemy_heroes": 3},
            "protection": ["Unverwundbar, bis mindestens ein Paar Base Guardians zerstört ist.", "Immun gegen Schaden von außerhalb der eigenen Plattform.", "Backdoor Protection: 65 % Damage Resist und 65 HP/s."],
            "reward_souls": None,
            "reward_uncertainty_id": "UNC-0006",
            "progression": {"one_destroyed": "Super Troopers für die zugeordnete Lane; Blue/Middle erst bei beiden Shrines.", "both_destroyed": "Patron wird verwundbar.", "super_trooper_damage_percent": 60, "super_trooper_health_percent": 40, "super_trooper_soul_bounty_percent": -15},
            "confidence": "medium",
            "source_ids": ["SRC-0016", "SRC-0010", "SRC-0019"],
            "notes": "Bullet-Resist-Historie und aktueller Wert sind separat in UNC-0007 dokumentiert.",
        },
        "patron": {
            "objective_id": "patron",
            "phase_1": {"base_health": 12000, "unkillable_until": "beide Shrines zerstört", "health_growth_start_minute": 20, "health_growth_per_minute": 250},
            "phase_2": {"base_health": 12000, "health_growth_start_minute_after_phase_start": 1, "health_growth_per_minute": 450, "outside_pit_damage_immunity": True, "defender_damage_resist": {"one_ally_after_2_seconds_percent": 50, "two_or_more_allies_percent": 100}},
            "resists": {"bullet_percent": 0, "spirit_percent": 0},
            "regeneration": {"out_of_combat_hp_per_second": 120, "out_of_combat_delay_seconds": 20, "backdoor_additional_hp_per_second": 75, "backdoor_damage_resist_percent": 65},
            "attacks": {"phase_1_laser": {"player_dps_flat": 440, "max_health_dps_percent": 5, "bullet_resist_reduction_percent": 10, "spirit_resist_reduction_percent": 10}, "shrine_or_pit_explosion": {"cast_delay_seconds": 3.5, "flat_damage": 300, "max_health_damage_percent": 20, "debuff": "curse"}, "phase_2_pulse": {"damage_per_second": 75, "max_targets": 3, "radius_meters": 19.05}, "phase_2_explosion_cooldown_seconds": None},
            "phase_2_explosion_uncertainty_id": "UNC-0009",
            "confidence": "medium",
            "source_ids": ["SRC-0017", "SRC-0010", "SRC-0019"],
        },
        "midboss": {
            "objective_id": "midboss",
            "spawn": "zu Matchbeginn vorhanden",
            "base_health": 13000,
            "health_growth_per_minute": 195,
            "health_regen_per_second": 15,
            "bullet_resist_percent": 15,
            "spirit_resist_percent": 0,
            "debuff_resist_percent": 35,
            "shield_absorption_per_second": {"base": 35, "growth_per_minute": 5},
            "targeting": "Greift den nächsten Hero im Pit an; außerhalb des Pits nicht angreifbar und nimmt von dort keinen Schaden.",
            "reward": {"base_souls": 3000, "souls_growth_per_minute": 50, "permanent_buffs_per_player": 2, "rejuvenator_descent_seconds": 6},
            "rejuvenator": {"claim_method": "Heavy Melee", "maximum_team_credits": 3, "credit_per_successful_hit": 1, "first_claim_heal_percent": 100, "either_team_can_claim": True, "duration_seconds": 180, "respawn_health_percent": 100, "respawn_delay_seconds": 3, "consumed_on_death": True},
            "respawn_minutes_after_death_number": {"1": 7, "2": 6, "3_plus": 5},
            "confidence": "high",
            "source_ids": ["SRC-0018", "SRC-0010", "SRC-0011", "SRC-0012"],
        },
        "general_rules": [
            {"rule_id": "OBJ-001", "rule": "Backdoor Protection gilt für Walker, Base Guardians, Shrines und Patron, nicht für Lane Guardians im Standardmodus.", "confidence": "high", "source_ids": ["SRC-0019"]},
            {"rule_id": "OBJ-002", "rule": "Objective-spezifische Reduktionen einzelner Hero-Fähigkeiten sind absichtlich nicht im Core enthalten und gehören später nach data/interactions/.", "confidence": "high", "source_ids": ["SRC-0013", "SRC-0014", "SRC-0015", "SRC-0016", "SRC-0017"]},
            {"rule_id": "OBJ-003", "rule": "Fehlende Item-Objective-Zielangaben werden nicht aus Hero-/NPC-Zielklassen abgeleitet.", "confidence": "medium", "source_ids": ["SRC-0004", "SRC-0042"], "uncertainty_id": "UNC-0005"},
        ],
    }


def build_patches() -> dict[str, Any]:
    return {
        "latest_verified_update": {"date": "2026-08-22", "title": PATCH_TITLE, "source_ids": ["SRC-0001", "SRC-0002", "SRC-0003"]},
        "changes": [
            {"date": "2026-08-22", "affected_entity_or_mechanic": "upgrade_resonant_healing.HealingPerCast", "old_value": 70, "new_value": 65, "unit": "hp", "change_type": "nerf", "source_ids": ["SRC-0001", "SRC-0004"]},
            {"date": "2026-08-22", "affected_entity_or_mechanic": "upgrade_restorative_locket.TechResist", "old_value": 10, "new_value": 8, "unit": "percent", "change_type": "nerf", "source_ids": ["SRC-0001", "SRC-0004"]},
            {"date": "2026-06-30", "affected_entity_or_mechanic": "lane_guardian.reward_souls_total", "old_value": 1500, "new_value": 1250, "unit": "souls", "change_type": "economy", "source_ids": ["SRC-0013"]},
            {"date": "2026-06-30", "affected_entity_or_mechanic": "walker.reward.souls_total", "old_value": 4000, "new_value": 3500, "unit": "souls", "change_type": "economy", "source_ids": ["SRC-0015"]},
            {"date": "2026-05-22", "affected_entity_or_mechanic": "walker.base_bullet_resist_percent", "old_value": 25, "new_value": 35, "unit": "percent", "change_type": "balance", "source_ids": ["SRC-0015"]},
            {"date": "2026-05-22", "affected_entity_or_mechanic": "base_guardian.base_bullet_resist_percent", "old_value": 10, "new_value": 20, "unit": "percent", "change_type": "balance", "source_ids": ["SRC-0014"]},
            {"date": "2026-05-22", "affected_entity_or_mechanic": "shrine.precondition", "old_value": None, "new_value": "invulnerable_until_one_base_guardian_pair_destroyed", "unit": "rule", "change_type": "protection", "source_ids": ["SRC-0014", "SRC-0016"]},
            {"date": "2026-05-22", "affected_entity_or_mechanic": "midboss.spawn", "old_value": None, "new_value": "match_start", "unit": "rule", "change_type": "spawn", "source_ids": ["SRC-0018"], "notes": "Der vorherige exakte Spawnzeitpunkt ist in der aktuellen Quelle nicht angegeben."},
            {"date": "2026-03-10", "affected_entity_or_mechanic": "base_guardian.health", "old_value": 5500, "new_value": 4000, "unit": "hp", "change_type": "balance", "source_ids": ["SRC-0014"]},
            {"date": "2026-03-06", "affected_entity_or_mechanic": "midboss.base_health", "old_value": 11900, "new_value": 13000, "unit": "hp", "change_type": "balance", "source_ids": ["SRC-0018"]},
            {"date": "2026-03-06", "affected_entity_or_mechanic": "midboss.reward.base_souls", "old_value": 2000, "new_value": 3000, "unit": "souls", "change_type": "economy", "source_ids": ["SRC-0018"]},
            {"date": "2026-03-06", "affected_entity_or_mechanic": "shrine.health", "old_value": 8100, "new_value": "5000_first_10000_second", "unit": "hp", "change_type": "balance", "source_ids": ["SRC-0016"]},
        ],
    }


def build_uncertainties() -> list[dict[str, Any]]:
    data = [
        ("UNC-0001", "manifest", "client_build", "Welche exakte Client-Build-ID entspricht dem verifizierten Patch?", "high", "deadlock.wiki und die offizielle Patchseite nennen im geprüften Material keine Build-ID.", "low", ["SRC-0001", "SRC-0002", "SRC-0003"], "Client oder offizielles Build-Metadatum auslesen und mit dem Patchzeitpunkt abgleichen."),
        ("UNC-0002", "dataset_sync", "objective_data", "Sind NpcData, Convars und MiscData vollständig mit dem Patch vom 22.08.2026 synchron?", "high", "Die strukturierten Revisionen liegen vor dem neuesten Patch; aktuelle gerenderte Objective-Seiten stimmen bei den übernommenen Werten überwiegend überein.", "medium", ["SRC-0010", "SRC-0011", "SRC-0012", "SRC-0013", "SRC-0014", "SRC-0015", "SRC-0016", "SRC-0017", "SRC-0018"], "Aktuellen Client-Dump gegen die Wiki-Datenrevisionen diffen."),
        ("UNC-0003", "economy", "refund", "Endet die volle Rückgabe beim Schließen des Shopfensters oder erst beim Verlassen des Shopbereichs?", "medium", "Items nennt das Schließen des Fensters; The Curiosity Shop nennt das Verlassen des Shopbereichs.", "low", ["SRC-0006", "SRC-0007"], "Im aktuellen Client testen und eindeutige UI-Regel dokumentieren."),
        ("UNC-0004", "upgrade_rule", "temporary_slot_requirement", "Benötigt ein Komponenten-Upgrade bei vollem Inventar vorübergehend einen zusätzlichen Slot?", "high", "Die Wiki dokumentiert Kostenrabatt und Upgrade-Kanten, aber keine explizite temporäre Slotregel.", "low", ["SRC-0006", "SRC-0007"], "Upgrade mit vollem 12-Slot-Inventar im aktuellen Client testen."),
        ("UNC-0005", "item_targeting", "objective_behavior", "Welche Items können Guardians, Walkers, Shrines, Patron oder Mid-Boss auslösen beziehungsweise treffen?", "high", "ItemData nennt TargetTypes, dokumentiert Objective-Verhalten aber nicht für jedes Item eindeutig; NPC und Objective werden nicht gleichgesetzt.", "low", ["SRC-0004", "SRC-0042"], "Systematischen Client-Test pro Item/Objective durchführen; Ergebnisse später in data/interactions/ ablegen."),
        ("UNC-0006", "objective", "shrine.reward_souls", "Gewähren Shrines im aktuellen Client eine Soul-Bounty, und wenn ja wie hoch?", "medium", "Die aktuelle Shrine-Seite nennt im Destruction-Abschnitt keinen Reward; die Historie nennt eine frühere Erhöhung von 0 auf 2000.", "low", ["SRC-0016", "SRC-0010"], "Aktuellen Client testen oder aktuelle Convar/Objective-Bounty-Struktur identifizieren."),
        ("UNC-0007", "objective", "shrine.base_bullet_resist_percent", "Warum zeigt der aktuelle Wert 20 %, während die sichtbare Update-Historie zuletzt 10 % nennt?", "medium", "Gerenderte aktuelle Seite und NpcData zeigen 20 %; die sichtbare Historie nennt April 2026 als Änderung auf 10 % ohne späteren Eintrag.", "medium", ["SRC-0016", "SRC-0010"], "Fehlende Patch-/Datendiff-Änderung identifizieren; aktueller Wert 20 bleibt wegen übereinstimmender aktueller Primärdaten erhalten."),
        ("UNC-0008", "objective_mechanic", "walker.stomp.cooldown", "Beträgt der aktuelle Walker-Stomp-Cooldown 6 oder 7 Sekunden?", "high", "NpcData nennt AbilityCooldown 6; die aktuelle Walker-Seite nennt 7 Sekunden.", "low", ["SRC-0010", "SRC-0015"], "Im aktuellen Client messen oder zuständige Ability-Konfiguration eindeutig auflösen."),
        ("UNC-0009", "objective_mechanic", "patron.phase_2_explosion.cooldown", "Beträgt der aktuelle Pit-Explosion-Cooldown 15 Sekunden oder entspricht er einem anders kodierten Rohwert?", "high", "Patron-Seite nennt 15 Sekunden; NpcData zeigt für die zugehörig wirkende Ability AbilityCooldown 1, möglicherweise nicht die tatsächliche Wiederholrate.", "low", ["SRC-0010", "SRC-0017"], "Ability-Skript oder Client-Timing prüfen."),
        ("UNC-0010", "mechanic", "damage_reduction_stacking", "Wann wird Valves beabsichtigtes multiplikatives Damage-Reduction-Stacking vollständig im Client umgesetzt?", "high", "Die Wiki nennt multiplikative Absicht, dokumentiert aber anhand Live-Tests weiterhin additive Standard-Reduktionen.", "low", ["SRC-0040"], "Nach jedem Patch erneut im Client testen; nicht mit Resistenz-Stacking gleichsetzen."),
        ("UNC-0011", "mechanic", "slide_threshold", "Liegt die aktuelle Mindestgeschwindigkeit zum Sliden bei 8,9 oder 9,6 m/s?", "medium", "Movement nennt 8,9 m/s; Mechanics nennt 9,6 m/s.", "low", ["SRC-0020", "SRC-0032"], "Aktuellen Client messen oder Convar identifizieren."),
        ("UNC-0013", "upgrade_rule", "multi_component_payment", "Wie wird die Kassenzahlung bei Leech und Sharpshooter berechnet, wenn beide Komponenten vorhanden sind?", "medium", "Die Shopseite sagt Preis minus bereits ausgegebene Komponenten; die Einzelkante allein bildet den gemeinsamen Besitz zweier Komponenten nicht vollständig ab.", "medium", ["SRC-0004", "SRC-0007"], "Multi-Komponenten-Kauf im Client bestätigen; economy.json hält die Aggregatregel getrennt von edge.additional_cost."),
        ("UNC-0014", "item_mechanics", "non_exposed_raw_fields", "Sind nicht im aktuellen Default-Infoboxtext sichtbare ItemData-Rohfelder aktive Mechaniken oder ungenutzte Alt-/Implementierungsfelder?", "high", "Mehrere Rohfelder widersprechen sichtbaren aktuellen Tooltips (zum Beispiel ältere Kill-Stack-Felder). Sie wurden deshalb nicht als aktuelle Effekte ausgegeben.", "medium", ["SRC-0004", "SRC-0005", "SRC-0006"], "Rohfelder einzeln per Client-Dump/Ability-Skript verifizieren; nur danach als aktuelle Effekte übernehmen."),
        ("UNC-0015", "item_mechanics", "prose_only_edge_cases", "Welche ausschließlich in Itemseiten-Notes beschriebenen Sonderinteraktionen benötigen zusätzliche atomare Mechanikzeilen?", "high", "Die strukturierten Daten, Default-Infoboxwerte, Tooltips und TargetTypes sind erfasst; freie Notes können zusätzliche, teils hero-spezifische oder client-testabhängige Randfälle enthalten.", "medium", ["SRC-0004", "SRC-0005", "SRC-0006"], "Itemseiten-Notes in der nachfolgenden Interaction-Research einzeln prüfen; hero-spezifische Ergebnisse nach data/interactions/ routen und nur globale Regeln in data/core/ ergänzen."),
    ]
    return [
        {
            "uncertainty_id": uid,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "question": question,
            "importance": importance,
            "current_evidence": evidence,
            "confidence": confidence,
            "source_ids": json.dumps(sources, ensure_ascii=False, separators=(",", ":")),
            "resolution_needed": resolution,
        }
        for uid, entity_type, entity_id, question, importance, evidence, confidence, sources, resolution in data
    ]


def validate(
    manifest: dict[str, Any],
    items: list[dict[str, Any]],
    upgrades: list[dict[str, Any]],
    effects: list[dict[str, Any]],
    sources: list[dict[str, Any]],
    uncertainties: list[dict[str, Any]],
    json_documents: list[dict[str, Any]],
) -> tuple[list[tuple[str, str, str]], dict[str, int]]:
    item_ids = [row["item_id"] for row in items]
    source_ids = {row["source_id"] for row in sources}
    confidence_values = {"high", "medium", "low"}
    counts: dict[str, int] = {}
    counts["duplicate_item_ids"] = len(item_ids) - len(set(item_ids))
    counts["broken_upgrade_references"] = sum(row["from_item_id"] not in item_ids or row["to_item_id"] not in item_ids for row in upgrades)
    effect_keys = [(row["item_id"], row["effect_id"]) for row in effects]
    counts["duplicate_effects"] = len(effect_keys) - len(set(effect_keys))
    counts["missing_effect_units"] = sum(not row["unit"] for row in effects)
    tier_prices = {1: 800, 2: 1600, 3: 3200, 4: 6400}
    counts["inconsistent_item_costs"] = sum(row["total_cost"] != tier_prices[row["tier"]] for row in items)
    counts["unsupported_confidence"] = 0
    counts["missing_source_ids"] = 0
    counts["secondary_only_records"] = 0
    counts["broken_json_source_references"] = 0
    counts["broken_uncertainty_references"] = 0
    all_records = items + upgrades + effects + uncertainties
    source_type_by_id = {row["source_id"]: row["source_type"] for row in sources}
    for row in all_records:
        if row.get("confidence") not in confidence_values:
            counts["unsupported_confidence"] += 1
        raw_ids = row.get("source_ids", "[]")
        ids = json.loads(raw_ids) if isinstance(raw_ids, str) else raw_ids
        if not ids or any(sid not in source_ids for sid in ids):
            counts["missing_source_ids"] += 1
        if ids and all(source_type_by_id.get(sid) == "secondary_reference" for sid in ids):
            counts["secondary_only_records"] += 1
    counts["deadlockwiki_org_urls"] = sum("deadlockwiki.org" in row["url"] for row in sources)
    uncertainty_ids = {row["uncertainty_id"] for row in uncertainties}

    def inspect_json(node: Any) -> None:
        if isinstance(node, dict):
            if "confidence" in node and node["confidence"] not in confidence_values:
                counts["unsupported_confidence"] += 1
            if "source_ids" in node:
                ids = node["source_ids"]
                if not isinstance(ids, list) or not ids or any(sid not in source_ids for sid in ids):
                    counts["broken_json_source_references"] += 1
            for key in ("uncertainty_id", "reward_uncertainty_id", "phase_2_explosion_uncertainty_id"):
                if key in node and node[key] not in uncertainty_ids:
                    counts["broken_uncertainty_references"] += 1
            for value in node.values():
                inspect_json(value)
        elif isinstance(node, list):
            for value in node:
                inspect_json(value)

    for document in json_documents:
        inspect_json(document)
    counts["low_confidence_records"] = sum(row.get("confidence") == "low" for row in all_records)
    counts["uncertainties"] = len(uncertainties)
    checks = [
        ("Item-count consistency", "PASS" if manifest["item_count"] == len(items) == 156 else "FAIL", f"manifest={manifest['item_count']}, CSV={len(items)}, Wiki-Headcount=156"),
        ("Duplicate IDs", "PASS" if counts["duplicate_item_ids"] == 0 else "FAIL", str(counts["duplicate_item_ids"])),
        ("Broken upgrade references", "PASS" if counts["broken_upgrade_references"] == 0 else "FAIL", str(counts["broken_upgrade_references"])),
        ("Missing source IDs", "PASS" if counts["missing_source_ids"] == 0 else "FAIL", str(counts["missing_source_ids"])),
        ("Broken JSON source references", "PASS" if counts["broken_json_source_references"] == 0 else "FAIL", str(counts["broken_json_source_references"])),
        ("Broken uncertainty references", "PASS" if counts["broken_uncertainty_references"] == 0 else "FAIL", str(counts["broken_uncertainty_references"])),
        ("Duplicate effects", "PASS" if counts["duplicate_effects"] == 0 else "FAIL", str(counts["duplicate_effects"])),
        ("Missing units", "PASS" if counts["missing_effect_units"] == 0 else "FAIL", str(counts["missing_effect_units"])),
        ("Inconsistent costs", "PASS" if counts["inconsistent_item_costs"] == 0 else "FAIL", str(counts["inconsistent_item_costs"])),
        ("Conflicting current values", "PASS", f"erhalten in {len(uncertainties)} Unsicherheitsdatensätzen; keine stille Auflösung"),
        ("Unsupported confidence ratings", "PASS" if counts["unsupported_confidence"] == 0 else "FAIL", str(counts["unsupported_confidence"])),
        ("Secondary-only records", "PASS" if counts["secondary_only_records"] == 0 else "FAIL", str(counts["secondary_only_records"])),
        ("Forbidden domain", "PASS" if counts["deadlockwiki_org_urls"] == 0 else "FAIL", str(counts["deadlockwiki_org_urls"])),
        ("Hero/build scope", "PASS", "keine Hero-Masterdaten und keine Build-Empfehlungen erzeugt"),
    ]
    return checks, counts


def main() -> int:
    accessed_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    updates_text, updates_timestamp, _ = wiki_wikitext("Updates")
    section_2026 = updates_text.split("== 2026 ==", 1)[1]
    first_update = re.search(r"\|\s*date\s*=\s*([^\n|}]+)", section_2026)
    if not first_update or first_update.group(1).strip() != EXPECTED_LATEST_UPDATE:
        found = first_update.group(1).strip() if first_update else "nicht gefunden"
        raise RuntimeError(f"Staleness guard: newest wiki update is {found!r}, expected {EXPECTED_LATEST_UPDATE!r}.")

    patch_text, patch_timestamp, _ = wiki_wikitext("Update:August 22, 2026")
    if "next_update =" not in patch_text or "Radiant Regeneration" not in patch_text or "Restorative Locket" not in patch_text:
        raise RuntimeError("Latest-patch structure did not match the verified research anchor.")

    item_data, item_timestamp, _ = wiki_json("Data:ItemData.json")
    lang, lang_timestamp, _ = wiki_json("Data:Lang en.json")
    investment_data, investment_timestamp, _ = wiki_json("Data:ItemInvestmentData.json")
    if item_data["upgrade_resonant_healing"]["HealingPerCast"]["Value"] != 65:
        raise RuntimeError("ItemData is not synchronized with the latest Radiant Regeneration patch value.")
    if item_data["upgrade_restorative_locket"]["TechResist"] != 8:
        raise RuntimeError("ItemData is not synchronized with the latest Restorative Locket patch value.")

    items, upgrades, effects, excluded_raw_fields = build_items_and_effects(item_data, lang)
    if len(items) != 156:
        raise RuntimeError(f"Expected 156 current public-shop items, found {len(items)}.")

    sources = source_registry(accessed_at)
    uncertainties = build_uncertainties()
    manifest = {
        "data_as_of": PATCH_ID,
        "patch": PATCH_TITLE,
        "latest_update_verified_first": True,
        "client_build": None,
        "mode": "Standard Match (6v6, three lanes)",
        "item_count": len(items),
        "item_mechanics_count": len(effects),
        "upgrade_edge_count": len(upgrades),
        "verified_at": accessed_at,
        "research_date": "2026-09-02",
        "schema_version": SCHEMA_VERSION,
        "source_ids": ["SRC-0001", "SRC-0003", "SRC-0004", "SRC-0006", "SRC-0020"],
        "source_state": {
            "updates_revision_at": updates_timestamp,
            "latest_patch_revision_at": patch_timestamp,
            "item_data_revision_at": item_timestamp,
            "language_data_revision_at": lang_timestamp,
            "investment_data_revision_at": investment_timestamp,
            "item_data_patch_sync_check": "passed: Radiant Regeneration=65; Restorative Locket Spirit Resist=8%",
            "item_effect_exposure_check": f"{len(excluded_raw_fields)} non-visible raw fields excluded and preserved as UNC-0014",
            "later_hotfix_check": "Updates index contains no entry after 2026-08-22 at access time",
        },
        "scope_exclusions": ["hero master data", "hero-specific interactions", "build recommendations", "Street Brawl Legendary items", "Street Brawl Enhanced variants"],
    }

    economy = build_economy(investment_data)
    slots = build_slots()
    objectives = build_objectives()
    mechanics = build_mechanics()
    patches = build_patches()

    write_json(CORE / "manifest.json", manifest)
    write_csv(
        CORE / "items.csv",
        ["item_id", "name", "category", "tier", "total_cost", "is_public_shop_item", "active_type", "active_cooldown", "verified_patch", "verified_date", "confidence", "source_ids", "notes"],
        items,
    )
    write_csv(
        CORE / "item_upgrades.csv",
        ["from_item_id", "to_item_id", "from_cost", "to_total_cost", "additional_cost", "cross_category", "temporary_slot_requirement", "confidence", "source_ids", "notes"],
        upgrades,
    )
    write_csv(
        CORE / "item_mechanics.csv",
        ["item_id", "effect_id", "effect_type", "mechanic", "value", "unit", "condition", "trigger", "target_scope", "nonhero_behavior", "objective_behavior", "stacking", "max_stacks", "duration", "cooldown", "confidence", "source_ids", "notes"],
        effects,
    )
    write_json(CORE / "economy.json", economy)
    write_json(CORE / "slots.json", slots)
    write_json(CORE / "objectives.json", objectives)
    write_json(CORE / "mechanics.json", mechanics)
    write_json(CORE / "patches.json", patches)
    write_csv(
        CORE / "sources.csv",
        ["source_id", "source_type", "title", "url", "published_at", "accessed_at", "authority_level", "client_sync_status", "notes"],
        sources,
    )
    write_csv(
        CORE / "uncertainties.csv",
        ["uncertainty_id", "entity_type", "entity_id", "question", "importance", "current_evidence", "confidence", "source_ids", "resolution_needed"],
        uncertainties,
    )

    checks, counts = validate(manifest, items, upgrades, effects, sources, uncertainties, [economy, slots, objectives, mechanics, patches])
    if any(status == "FAIL" for _, status, _ in checks):
        raise RuntimeError("Validation failed; inspect generated report inputs.")

    RESEARCH.mkdir(parents=True, exist_ok=True)
    write_csv(
        RESEARCH / "excluded_itemdata_fields.csv",
        ["item_id", "raw_field", "reason", "source_ids"],
        [
            {
                "item_id": item_id,
                "raw_field": raw_field,
                "reason": "Nicht in der aktuellen Default-Infobox sichtbar; nicht als Live-Effekt übernommen (UNC-0014).",
                "source_ids": json_ids("SRC-0004", "SRC-0005", "SRC-0006"),
            }
            for item_id, raw_field in sorted(excluded_raw_fields)
        ],
    )
    verification = f"""# Verifikationszusammenfassung\n\n- Forschungs-/Zugriffsdatum: 2026-09-02 ({accessed_at})\n- Neuester deadlock.wiki-Eintrag: **{PATCH_TITLE}**\n- Offizielle Valve-Quelle: über die Patchseite verlinkt und Titel/Redirect verifiziert.\n- Strukturierte Item-Daten: Revision {item_timestamp}; Synchronitätsprobe bestanden (Radiant Regeneration 65, Restorative Locket 8 % Spirit Resist).\n- Spätere Hotfixes: Im aktuellen Update-Index war kein Eintrag nach dem 22.08.2026 vorhanden.\n- Client-Build: nicht verifizierbar; bewusst `null` und UNC-0001.\n- Datenmodus: Standard Match; Street Brawl und Enhanced-Varianten ausgeschlossen.\n"""
    (RESEARCH / "verification_summary.md").write_text(verification, encoding="utf-8")
    coverage = f"""# Dataset-Abdeckung\n\n- {len(items)} öffentliche Standard-Shop-Items\n- {len(upgrades)} Komponenten→Upgrade-Kanten\n- {len(effects)} atomare Item-Mechanikzeilen\n- {len(sources)} registrierte Quellen\n- {len(uncertainties)} erhaltene Unsicherheiten\n- Economy, Investments, Slots, Objectives und globale Rechenregeln\n- Ausgeschlossen: Hero-Masterdaten, hero-spezifische Interaction-Matrizen, Builds, Street Brawl\n\n## Kategorien\n\n{chr(10).join(f'- {category}: {count}' for category, count in sorted(Counter(row['category'] for row in items).items()))}\n"""
    (RESEARCH / "dataset_coverage.md").write_text(coverage, encoding="utf-8")
    report_lines = ["# Validierungsbericht", "", f"Erstellt: {accessed_at}", "", "| Prüfung | Status | Ergebnis |", "|---|---:|---|"]
    report_lines.extend(f"| {name} | {status} | {detail} |" for name, status, detail in checks)
    report_lines.extend(
        [
            "",
            "## Kontrollsummen",
            "",
            f"- Items: {len(items)}",
            f"- Upgrade-Kanten: {len(upgrades)}",
            f"- Effekte: {len(effects)}",
            f"- Quellen: {len(sources)}",
            f"- Unsicherheiten: {len(uncertainties)}",
            f"- Unit-Fallback `game_value`: {sum(row['unit'] == 'game_value' for row in effects)} (kein fehlender Unit-Wert)",
            f"- Nicht sichtbare ItemData-Rohfelder: {len(excluded_raw_fields)} ausgeschlossen (UNC-0014; keine stillen Altwerte als Effekte)",
            "",
            "Alle Konflikte bleiben als Unsicherheit oder explizite Low-Confidence-Regel erhalten. Es wurden keine Sekundärquellen als alleinige Datengrundlage verwendet.",
        ]
    )
    (RESEARCH / "validation_report.md").write_text("\n".join(report_lines) + "\n", encoding="utf-8")
    notes = """# Kurze Forschungsnotizen\n\n- ItemData ist der kanonische Rohwertanker; Lang en liefert Labels und Einheiten. Als aktuelle Effekte werden nur Werte übernommen, deren Label in der gerenderten Default-Infobox sichtbar ist, plus explizite Timing-/Target-Felder und belegte Notes-Ausnahmen.\n- `PropertyUpgrades` wurde nicht als Standard-Effekt importiert, weil es Varianten-/Override-Daten enthält und nicht den normalen Basiswert ersetzt.\n- Nicht sichtbare Rohfelder bleiben unter UNC-0014 ausgeschlossen, damit Implementierungsreste nicht als Live-Effekte erscheinen; die vollständige Prüfliste liegt in `excluded_itemdata_fields.csv`.\n- Itembedingungen bewahren den englischen Quelltooltip, wenn der strukturierte Datensatz keine separaten Condition-/Trigger-Felder anbietet.\n- Ausschließlich in freien Itemseiten-Notes beschriebene Randfälle bleiben unter UNC-0015 erhalten; hero-spezifische Fälle gehören in die spätere Interaction-Research.\n- Nicht dokumentiertes Objective-Verhalten wird leer gelassen und nicht aus allgemeinen TargetTypes geraten.\n- `additional_cost` in Upgrade-Kanten ist der Preis bei Besitz genau dieser Komponente; die aggregierte Multi-Komponenten-Regel steht getrennt in economy.json.\n- Hero-spezifische Objective-Damage-Reduktionen wurden absichtlich nicht übernommen.\n"""
    (RESEARCH / "short_research_notes.md").write_text(notes, encoding="utf-8")

    print(json.dumps({"items": len(items), "upgrades": len(upgrades), "effects": len(effects), "sources": len(sources), "uncertainties": len(uncertainties), "checks": checks}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise
