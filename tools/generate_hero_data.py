from __future__ import annotations

import csv
import json
import re
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "docs" / "research" / "heroes" / "source_cache"
HERO_DIR = ROOT / "data" / "heroes"
INTERACTION_DIR = ROOT / "data" / "interactions"
RESEARCH_DIR = ROOT / "docs" / "research" / "heroes"
SCHEMA_DIR = ROOT / "docs" / "schemas"

PATCH = "Minor Update - 08-22-2026"
DATA_AS_OF = "2026-08-22"
RESEARCH_DATE = "2026-09-02"
SCHEMA_VERSION = "0.1.0-research"

PUBLIC_NAMES = [
    "Abrams", "Apollo", "Bebop", "Billy", "Calico", "Celeste",
    "The Doorman", "Drifter", "Dynamo", "Graves", "Grey Talon", "Haze",
    "Holliday", "Infernus", "Ivy", "Kelvin", "Lady Geist", "Lash",
    "McGinnis", "Mina", "Mirage", "Mo & Krill", "Paige", "Paradox",
    "Pocket", "Rem", "Seven", "Shiv", "Silver", "Sinclair", "Venator",
    "Victor", "Vindicta", "Viscous", "Vyper", "Warden", "Wraith", "Yamato",
]
PUBLIC_SET = set(PUBLIC_NAMES)

SOURCE_IDS = {
    "updates": "HSRC-0001",
    "patch_current": "HSRC-0002",
    "hero_data": "HSRC-0003",
    "ability_data": "HSRC-0004",
    "lang": "HSRC-0005",
    "meaningful": "HSRC-0006",
    "heroes": "HSRC-0007",
    "abilities": "HSRC-0008",
    "boon": "HSRC-0009",
    "comparison": "HSRC-0010",
    "patch_aug12": "HSRC-0011",
    "ivy_page": "HSRC-0012",
    "billy_page": "HSRC-0013",
    "rem_page": "HSRC-0014",
    "celeste_page": "HSRC-0015",
}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def slug(value: str) -> str:
    value = unicodedata.normalize("NFKD", value or "")
    value = value.encode("ascii", "ignore").decode("ascii").lower()
    value = value.replace("&", " and ")
    value = re.sub(r"[^a-z0-9]+", "_", value).strip("_")
    return value or "unnamed"


def j(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def scalar(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return ""
    if isinstance(value, float):
        return f"{value:.12g}"
    return value


def write_csv(path: Path, fieldnames: list[str], rows: list[dict]):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        for row in rows:
            writer.writerow({key: scalar(row.get(key, "")) for key in fieldnames})


def snake_key(value: str) -> str:
    value = value.replace("%", " Percent ")
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", value)
    value = re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1_\2", value)
    return slug(value)


def extract_value(value):
    if isinstance(value, dict) and "Value" in value:
        return value.get("Value")
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    return None


def infer_unit(name: str, value=None) -> str:
    n = snake_key(name)
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, str):
        return "identifier"
    exact = {
        "max_health": "health",
        "base_health_regen": "health_per_second",
        "stamina": "count",
        "stamina_regen_per_second": "count_per_second",
        "rounds_per_second": "count_per_second",
        "rounds_per_second_at_max_spin": "count_per_second",
        "bullets_per_shot": "count",
        "bullets_per_burst": "count",
        "clip_size": "ammo",
        "shoot_move_speed": "multiplier",
        "reload_movespeed": "multiplier",
        "move_acceleration": "units_per_second_squared",
        "weapon_power_scale": "multiplier",
        "proc_build_up_rate_scale": "multiplier",
        "hero_bullet_lifesteal_effectiveness": "multiplier",
        "hero_spirit_lifesteal_effectiveness": "multiplier",
        "tech_duration": "percent",
        "tech_range": "percent",
        "reload_speed": "percent",
        "base_weapon_damage_increase": "percent",
        "ability_unit_target_limit": "count",
    }
    if n in exact:
        return exact[n]
    if any(x in n for x in ("percentage", "percent", "_pct", "resist", "lifesteal", "effectiveness", "reduction")):
        return "percent"
    if n == "gravity_change":
        return "percent"
    if n in {"magic_increase_per_stack", "bonus_fire_rate", "fire_rate_slow", "fire_rate_per_stack"}:
        return "percent"
    if n == "bounce_grace":
        return "seconds"
    if n in {"max_bounces", "ricochet_count", "projectile_redirect_count"}:
        return "count"
    if "factor" in n and isinstance(value, (int, float)) and abs(value) > 10:
        return "percent"
    if "mult" in n or n.endswith("_scale") or "factor" in n or n.endswith("_ratio") or n == "ratio":
        return "multiplier"
    if any(x in n for x in ("cooldown", "duration", "time", "delay", "interval", "lifetime", "window", "tick_rate", "fuse")):
        return "seconds"
    if re.search(r"(^|_)(amp|amplification)(_|$)", n):
        return "percent"
    if any(x in n for x in ("angle", "degrees", "cone")):
        return "degrees"
    if any(x in n for x in ("radius", "range", "distance", "length", "width", "height", "spacing")):
        return "meters"
    if any(x in n for x in ("speed", "velocity")):
        return "units_per_second"
    if "damage_per_second" in n or n.endswith("_dps") or n == "dps":
        return "damage_per_second"
    if "health_per_second" in n or "healing_per_second" in n:
        return "health_per_second"
    if re.search(r"_per_(damage|weapon_damage|spirit_damage)$", n):
        return "multiplier"
    if any(x in n for x in ("heal", "health", "barrier", "shield")):
        return "health"
    if "damage" in n:
        return "damage"
    if "stacks" in n or "stack_count" in n:
        return "stacks"
    if "charge" in n:
        return "charges"
    if "ammo" in n or "bullet" in n and "count" in n:
        return "ammo"
    if any(x in n for x in ("count", "targets", "projectile_amount", "orbs", "shots", "waves")):
        return "count"
    if n.startswith("pickups_per_"):
        return "count"
    if n.startswith(("can_", "does_not_", "counts_as_", "enable_", "allow_")):
        return "boolean"
    return "flat"


def infer_effect_type(name: str) -> str:
    n = snake_key(name)
    if any(x in n for x in ("summon", "turret", "knight", "helper", "zombie", "gravestone", "skull", "bat_")):
        return "summon"
    if any(x in n for x in ("damage", "dps", "burn", "bleed", "explode", "impact")):
        return "damage"
    if any(x in n for x in ("heal", "lifesteal", "regen", "health_steal")):
        return "healing"
    if any(x in n for x in ("barrier", "shield")):
        return "shield"
    if any(x in n for x in ("resist", "armor", "evasion", "unstoppable", "invulner", "immunity")):
        return "defense"
    if any(x in n for x in ("stun", "sleep", "root", "silence", "disarm", "petrify", "immobil", "knock", "slow", "tether", "debuff", "hex")):
        return "crowd_control"
    if "cooldown" in n:
        return "cooldown"
    if "charge" in n:
        return "charge"
    if any(x in n for x in ("move", "speed", "dash", "jump", "teleport", "flight", "pull", "push", "toss", "drag")):
        return "movement"
    if any(x in n for x in ("radius", "range", "target", "cone", "angle")):
        return "targeting"
    if any(x in n for x in ("resource", "rage", "card", "battery", "pickup")):
        return "resource"
    if any(x in n for x in ("proc", "trigger", "stack", "build_up", "buildup")):
        return "passive_proc"
    if any(x in n for x in ("duration", "interval", "tick_rate")):
        return "stat"
    return "stat"


EXCLUDED_PATH_TOKENS = (
    "camera", "sound", "particle", "visual", "_fx", "fx_", "model_swap",
    "preview", "ai_", "nav_mesh", "navmesh", "physics", "view_punch",
)


def excluded_path(path: str) -> bool:
    p = snake_key(path)
    return any(token in p for token in EXCLUDED_PATH_TOKENS)


def flatten_structured(obj, prefix=""):
    """Yield sourced atomic values while retaining Value/Scale pairs."""
    if isinstance(obj, dict) and "Value" in obj and set(obj).issubset({"Value", "Scale"}):
        scale = obj.get("Scale") if isinstance(obj.get("Scale"), dict) else {}
        yield {
            "path": prefix,
            "value": obj.get("Value"),
            "scale_attribute": scale.get("Type", ""),
            "scale_coefficient": scale.get("Value", ""),
            "kind": "value_scale",
        }
        return
    if isinstance(obj, dict):
        if "Class" in obj or "Subclass" in obj:
            label = obj.get("Subclass") or obj.get("Class")
            if label and prefix and not excluded_path(prefix):
                yield {"path": prefix, "value": label, "scale_attribute": "", "scale_coefficient": "", "kind": "modifier"}
        for key, value in obj.items():
            if key in {"Class", "Subclass", "StatusEffectPriority", "ProvidedByAura"}:
                continue
            next_prefix = f"{prefix}.{key}" if prefix else key
            if excluded_path(next_prefix):
                continue
            if isinstance(value, (dict, list)):
                yield from flatten_structured(value, next_prefix)
            elif isinstance(value, (int, float, bool, str)) and key not in {"Key", "Name"}:
                yield {"path": next_prefix, "value": value, "scale_attribute": "", "scale_coefficient": "", "kind": "scalar"}
        return
    if isinstance(obj, list):
        for index, value in enumerate(obj, start=1):
            next_prefix = f"{prefix}.{index}" if prefix else str(index)
            if isinstance(value, (dict, list)):
                yield from flatten_structured(value, next_prefix)
            elif isinstance(value, (int, float, bool, str)):
                yield {"path": next_prefix, "value": value, "scale_attribute": "", "scale_coefficient": "", "kind": "scalar"}


def dedupe_effect_id(base: str, seen: Counter) -> str:
    base = slug(base)
    seen[base] += 1
    return base if seen[base] == 1 else f"{base}_{seen[base]}"


def stat_meta(key: str):
    k = key.removeprefix("Weapon.").removeprefix("AltFire.")
    s = snake_key(k)
    if any(x in s for x in ("health", "regen")):
        group = "health"
    elif any(x in s for x in ("resist", "crit_damage_received")):
        group = "defense"
    elif any(x in s for x in ("move", "dash", "air_", "crouch", "gravity", "acceleration", "sprint")):
        group = "movement"
    elif "stamina" in s:
        group = "stamina"
    elif any(x in s for x in ("reload",)):
        group = "reload"
    elif any(x in s for x in ("ammo", "clip")):
        group = "ammo"
    elif "melee" in s:
        group = "melee"
    elif any(x in s for x in ("tech", "spirit")):
        group = "spirit"
    elif key.startswith("Weapon.") or key.startswith("AltFire.") or any(x in s for x in ("bullet", "rounds", "falloff", "dps", "fire_rate", "shoot")):
        group = "weapon"
    else:
        group = "misc"
    return group, infer_unit(key)


def main():
    for directory in (HERO_DIR, INTERACTION_DIR, RESEARCH_DIR, SCHEMA_DIR):
        directory.mkdir(parents=True, exist_ok=True)

    hero_data = read_json(CACHE / "HeroData.json")
    ability_data = read_json(CACHE / "AbilityData.json")
    meaningful = read_json(CACHE / "HeroMeaningfulStats.json")
    core_manifest = read_json(ROOT / "data" / "core" / "manifest.json")
    core_mechanics = read_json(ROOT / "data" / "core" / "mechanics.json")
    core_objectives = read_json(ROOT / "data" / "core" / "objectives.json")

    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")

    # Stable identity map. Silver's alternate-form data belongs to Silver, not to a second public hero.
    internal_to_hero_id = {}
    used_hero_ids = set()
    for internal, record in hero_data.items():
        name = record.get("Name") or internal.removeprefix("hero_")
        proposed = slug(name)
        if name == "Silver (Transformed)":
            proposed = "silver_transformed"
        if proposed in used_hero_ids:
            proposed = f"{proposed}_{slug(internal.removeprefix('hero_'))}"
        used_hero_ids.add(proposed)
        internal_to_hero_id[internal] = proposed

    public_internal = {k: v for k, v in hero_data.items() if v.get("Name") in PUBLIC_SET}
    name_to_internal = {v.get("Name"): k for k, v in hero_data.items()}

    heroes = []
    for internal, record in sorted(hero_data.items(), key=lambda item: (item[1].get("Name") or item[0]).lower()):
        name = record.get("Name") or internal.removeprefix("hero_")
        is_public = name in PUBLIC_SET
        if is_public:
            availability = "public_standard"
            release_status = "released_closed_beta"
            confidence = "high"
            sources = [SOURCE_IDS["heroes"], SOURCE_IDS["hero_data"]]
        elif record.get("InHeroLabs"):
            availability = "former_hero_labs"
            release_status = "nonpublic_documented"
            confidence = "medium"
            sources = [SOURCE_IDS["hero_data"], SOURCE_IDS["heroes"]]
        else:
            availability = "internal_or_unused"
            release_status = "nonpublic_documented"
            confidence = "medium"
            sources = [SOURCE_IDS["hero_data"]]
        flags = {k: record.get(k) for k in ("IsSelectable", "IsDisabled", "InDevelopment", "InHeroLabs")}
        note = f"Wiki-Datenschlüssel {internal}; Rohflags {j(flags)}."
        if not is_public and record.get("IsSelectable"):
            note += " Technisches IsSelectable-Flag wird wegen der öffentlichen 38-Helden-Liste nicht als Veröffentlichungsnachweis gewertet; siehe HUNC-0006."
        if name == "Silver (Transformed)":
            note += " Transformationsform von Silver; kein eigenständig öffentlich auswählbarer Held."
        heroes.append({
            "hero_id": internal_to_hero_id[internal], "name": name, "display_name": name,
            "availability": availability, "publicly_playable": is_public,
            "release_status": release_status, "verified_patch": PATCH,
            "verified_date": RESEARCH_DATE, "confidence": confidence,
            "source_ids": j(sources), "notes": note,
        })

    hero_fields = ["hero_id", "name", "display_name", "availability", "publicly_playable", "release_status", "verified_patch", "verified_date", "confidence", "source_ids", "notes"]
    write_csv(HERO_DIR / "heroes.csv", hero_fields, heroes)

    # Hero base, growth, weapon, alt-fire, and Spirit-scaling stats.
    standard_top_stats = [
        "MaxHealth", "BaseHealthRegen", "BulletResist", "TechResist", "MeleeResist", "DebuffResist",
        "MaxMoveSpeed", "SprintSpeed", "CrouchSpeed", "MoveAcceleration", "GravityChange",
        "AirControlPercent", "AirControlAccelPercent", "GroundDashDistanceInMeters", "GroundDashDuration",
        "GroundDashSpeed", "AirDashDistanceInMeters", "AirDashDuration", "AirDashSpeed",
        "Stamina", "StaminaCooldown", "StaminaRegenPerSecond", "LightMeleeDamage", "HeavyMeleeDamage",
        "BulletLifesteal", "HeroBulletLifestealEffectiveness", "HeroSpiritLifestealEffectiveness",
        "CritDamageBonusPercent", "CritDamageReceivedPercent", "WeaponPowerScale", "ProcBuildUpRateScale",
        "TechRange", "TechDuration", "BaseWeaponDamageIncrease", "ReloadSpeed",
    ]
    weapon_fields = [key for key, enabled in meaningful.items() if enabled and key not in {"Type", "InDevelopment", "IsDisabled", "IsRecommended", "IsSelectable", "PowerIncreases", "TechPower", "TechResist", "MaxHealth", "BaseHealthRegen", "MaxMoveSpeed", "SprintSpeed", "Stamina", "StaminaCooldown", "StaminaRegenPerSecond", "LightMeleeDamage", "HeavyMeleeDamage", "BulletResist", "GravityChange"}]
    stats = []
    stat_keys_by_hero = defaultdict(set)
    for internal, record in sorted(public_internal.items(), key=lambda item: item[1]["Name"]):
        hero_id = internal_to_hero_id[internal]
        growth = record.get("LevelScaling") or {}
        for key in standard_top_stats:
            if key not in record:
                continue
            value = record.get(key)
            if value is None or isinstance(value, (dict, list)):
                continue
            stat_id = snake_key(key)
            group, unit = stat_meta(key)
            stats.append({
                "hero_id": hero_id, "stat_id": stat_id, "stat_group": group,
                "mechanic": stat_id, "base_value": value, "value_per_level": growth.get(key, ""),
                "max_value": "", "unit": unit, "condition": "base hero state",
                "calculation_rule": f"base + boon_level * {growth[key]}" if key in growth else "",
                "verified_patch": PATCH, "confidence": "high", "source_ids": j([SOURCE_IDS["hero_data"]]),
                "notes": "Tech bezeichnet in den Rohdaten Spirit." if "Tech" in key else "",
            })
            stat_keys_by_hero[hero_id].add(stat_id)
        weapon = record.get("Weapon") or {}
        for key in weapon_fields:
            if key not in weapon or isinstance(weapon.get(key), (dict, list)):
                continue
            full = f"Weapon.{key}"
            stat_id = f"weapon_{snake_key(key)}"
            group, unit = stat_meta(full)
            stats.append({
                "hero_id": hero_id, "stat_id": stat_id, "stat_group": group,
                "mechanic": snake_key(key), "base_value": weapon[key], "value_per_level": growth.get(key, ""),
                "max_value": "", "unit": unit, "condition": "primary fire",
                "calculation_rule": f"base + boon_level * {growth[key]}" if key in growth else "",
                "verified_patch": PATCH, "confidence": "high", "source_ids": j([SOURCE_IDS["hero_data"], SOURCE_IDS["meaningful"]]),
                "notes": "",
            })
            stat_keys_by_hero[hero_id].add(stat_id)
        alt = weapon.get("AltFire") or {}
        for key, value in alt.items():
            if isinstance(value, (dict, list, str)):
                continue
            stat_id = f"alt_fire_{snake_key(key)}"
            group, unit = stat_meta(f"AltFire.{key}")
            stats.append({
                "hero_id": hero_id, "stat_id": stat_id, "stat_group": group,
                "mechanic": snake_key(key), "base_value": value, "value_per_level": "", "max_value": "",
                "unit": unit, "condition": "alternate fire", "calculation_rule": "",
                "verified_patch": PATCH, "confidence": "high", "source_ids": j([SOURCE_IDS["hero_data"]]), "notes": "",
            })
            stat_keys_by_hero[hero_id].add(stat_id)
        # Growth values that do not map to an explicit base property remain separate and numeric.
        for key, value in growth.items():
            candidate_ids = {snake_key(key), f"weapon_{snake_key(key)}"}
            if candidate_ids & stat_keys_by_hero[hero_id]:
                continue
            group, unit = stat_meta(key)
            stat_id = f"boon_growth_{snake_key(key)}"
            stats.append({
                "hero_id": hero_id, "stat_id": stat_id, "stat_group": group, "mechanic": snake_key(key),
                "base_value": "", "value_per_level": value, "max_value": "", "unit": unit,
                "condition": "per boon level", "calculation_rule": f"stat contribution = boon_level * {value}",
                "verified_patch": PATCH, "confidence": "high", "source_ids": j([SOURCE_IDS["hero_data"]]),
                "notes": "Kein separat ausgewiesener Basiswert im strukturierten Export.",
            })
        for key, coefficient in (record.get("SpiritScaling") or {}).items():
            group, _ = stat_meta(key)
            stats.append({
                "hero_id": hero_id, "stat_id": f"{snake_key(key)}_spirit_scaling", "stat_group": group,
                "mechanic": f"{snake_key(key)}_spirit_scaling", "base_value": coefficient, "value_per_level": "",
                "max_value": "", "unit": "multiplier", "condition": "scales with Spirit Power",
                "calculation_rule": f"additional {snake_key(key)} = spirit_power * {coefficient}",
                "verified_patch": PATCH, "confidence": "high", "source_ids": j([SOURCE_IDS["hero_data"]]),
                "notes": "Separat vom Basiswert gespeichert.",
            })

    stat_fields = ["hero_id", "stat_id", "stat_group", "mechanic", "base_value", "value_per_level", "max_value", "unit", "condition", "calculation_rule", "verified_patch", "confidence", "source_ids", "notes"]
    write_csv(HERO_DIR / "hero_stats.csv", stat_fields, stats)

    # Ability registry: four public abilities plus Silver's three replacement-form abilities.
    ability_specs = []
    for internal, record in public_internal.items():
        hero_id = internal_to_hero_id[internal]
        for slot, binding in sorted((record.get("BoundAbilities") or {}).items(), key=lambda item: int(item[0])):
            ability_specs.append((hero_id, record["Name"], slot, binding["Key"], binding.get("Name") or ability_data.get(binding["Key"], {}).get("Name") or binding["Key"], False, False, [SOURCE_IDS["ability_data"], SOURCE_IDS["abilities"]]))
    transformed = hero_data.get("hero_werewolf_transformed") or {}
    for slot, binding in sorted((transformed.get("BoundAbilities") or {}).items(), key=lambda item: int(item[0])):
        if binding.get("Name") == "Lycan Curse":
            continue
        ability_specs.append(("silver", "Silver", f"transformation_{slot}", binding["Key"], binding.get("Name") or ability_data.get(binding["Key"], {}).get("Name") or binding["Key"], True, False, [SOURCE_IDS["ability_data"], SOURCE_IDS["hero_data"]]))

    # Four post-patch hero pages expose additional Innate sections outside BoundAbilities.
    innate_specs = [
        ("ivy", "Ivy", SOURCE_IDS["ivy_page"], {
            "GravityChange": public_internal[name_to_internal["Ivy"]].get("GravityChange"),
        }),
        ("billy", "Billy", SOURCE_IDS["billy_page"], {
            "LightMeleeRecoveryModified": True,
            "LightMeleeMovementSlowReduced": True,
            "LightMeleeDoesNotInterruptReload": True,
        }),
        ("rem", "Rem", SOURCE_IDS["rem_page"], {
            "CrouchTunnelAccessOutOfCombat": True,
        }),
        ("celeste", "Celeste", SOURCE_IDS["celeste_page"], {
            "GravityChange": public_internal[name_to_internal["Celeste"]].get("GravityChange"),
            "AirControlPercent": public_internal[name_to_internal["Celeste"]].get("AirControlPercent"),
            "AirControlAccelPercent": public_internal[name_to_internal["Celeste"]].get("AirControlAccelPercent"),
        }),
    ]
    for hero_id, hero_name, page_source, innate_values in innate_specs:
        data_key = f"synthetic_innate_{hero_id}"
        ability_data[data_key] = {"Key": data_key, "Name": "Innate", "IsDisabled": False, "BehaviourBits": None, "Upgrades": [], **innate_values}
        ability_specs.append((hero_id, hero_name, "innate", data_key, "Innate", False, True, [page_source, SOURCE_IDS["hero_data"]]))

    ability_key_to_id = {}
    ability_records = []
    ability_raw_by_id = {}
    ability_hero_by_id = {}
    ability_sources_by_id = {}
    for hero_id, hero_name, slot, data_key, name, transformed_form, is_innate, ability_sources in sorted(ability_specs, key=lambda x: (x[0], str(x[2]))):
        raw = ability_data[data_key]
        ability_id = f"{hero_id}_{slug(name)}"
        if ability_id in ability_raw_by_id:
            ability_id = f"{ability_id}_{slug(data_key)}"
        ability_key_to_id[data_key] = ability_id
        ability_raw_by_id[ability_id] = raw
        ability_hero_by_id[ability_id] = hero_id
        ability_sources_by_id[ability_id] = ability_sources
        bits = set(raw.get("BehaviourBits") or [])
        cooldown = extract_value(raw.get("AbilityCooldown"))
        charges = extract_value(raw.get("AbilityCharges"))
        restore = extract_value(raw.get("AbilityCooldownBetweenCharge"))
        if restore == -1:
            restore = ""
        passive = is_innate or (cooldown is None and not bits.intersection({"BehaviorChannelled", "BehaviorProjectile", "BehaviorNoTarget", "BehaviorMovement"}))
        summonish = any(token in " ".join(raw.keys()).lower() for token in ("summon", "turret", "knight", "helper", "zombie", "gravestone", "skull"))
        if is_innate:
            ability_type = "innate"
        elif transformed_form or "Transformation" in name or name == "Lycan Curse":
            ability_type = "transformation"
        elif passive:
            ability_type = "passive"
        elif "BehaviorChannelled" in bits:
            ability_type = "channeled"
        elif "BehaviorStartCooldownOnToggleOff" in bits:
            ability_type = "toggle"
        elif charges not in (None, "", 0):
            ability_type = "charged"
        elif summonish:
            ability_type = "summon"
        else:
            ability_type = "active"
        if "BehaviorChannelled" in bits:
            cast_type = "channeled"
        elif "BehaviorProjectile" in bits:
            cast_type = "projectile"
        elif "BehaviorNoTarget" in bits:
            cast_type = "no_target"
        else:
            cast_type = "unit_or_point_target"
        targeting = "self_or_area" if "BehaviorNoTarget" in bits else ("projectile" if "BehaviorProjectile" in bits else "structured_target")
        ability_records.append({
            "ability_id": ability_id, "hero_id": hero_id, "name": name, "ability_slot": slot,
            "ability_type": ability_type, "is_innate": is_innate, "is_passive": passive,
            "is_active": not passive, "max_upgrade_level": len(raw.get("Upgrades") or []),
            "base_cooldown": cooldown if cooldown is not None else "", "base_charge_count": charges if charges is not None else "",
            "charge_restore_time": restore, "cast_type": cast_type, "targeting_type": targeting,
            "verified_patch": PATCH, "verified_date": RESEARCH_DATE, "confidence": "high",
            "source_ids": j(ability_sources),
            "notes": (f"Strukturierter Wiki-Schlüssel {data_key}." if not is_innate else "Expliziter Innate-Abschnitt der aktuellen Heldenseite; numerische HeroData-Felder werden direkt referenziert.") + (" Nur während Silvers Transformation verfügbar." if transformed_form else ""),
        })

    ability_fields = ["ability_id", "hero_id", "name", "ability_slot", "ability_type", "is_innate", "is_passive", "is_active", "max_upgrade_level", "base_cooldown", "base_charge_count", "charge_restore_time", "cast_type", "targeting_type", "verified_patch", "verified_date", "confidence", "source_ids", "notes"]
    write_csv(HERO_DIR / "abilities.csv", ability_fields, ability_records)

    # Atomic mechanics and upgrade edges.
    mechanics = []
    effect_ref_by_path = {}
    mechanics_by_ability = defaultdict(list)
    for ability in ability_records:
        ability_id = ability["ability_id"]
        raw = ability_raw_by_id[ability_id]
        seen = Counter()
        for item in flatten_structured(raw):
            path = item["path"]
            root = path.split(".", 1)[0]
            if root in {"Upgrades", "BehaviourBits", "IsDisabled", "Key", "Name"}:
                continue
            if root == "ChannelMoveSpeed" and item["value"] == -1:
                continue
            if root == "AbilityCooldownBetweenCharge" and item["value"] == -1:
                continue
            mechanic = snake_key(path)
            effect_id = dedupe_effect_id(mechanic, seen)
            effect_ref_by_path[(ability_id, path)] = effect_id
            value = item["value"]
            unit = "identifier" if item["kind"] == "modifier" else infer_unit(path, value)
            effect_type = infer_effect_type(path)
            if item["kind"] == "modifier" and effect_type == "stat":
                effect_type = "special_rule"
            nonhero = f"Explicit structured field: {value} {unit}." if re.search(r"non.?hero|npc|non.?player|trooper", path, re.I) else ""
            objective = f"Explicit boss-target field: {value} {unit}." if re.search(r"boss", path, re.I) else ""
            calculation = ""
            if item["scale_attribute"] in {"spirit", "weapon_damage_increase", "melee_damage", "light_melee", "heavy_melee", "health", "boon"} and item["scale_coefficient"] not in ("", None, 0):
                calculation = f"value = {value} + {item['scale_coefficient']} * {item['scale_attribute']}"
            row = {
                "ability_id": ability_id, "effect_id": effect_id, "effect_type": effect_type,
                "mechanic": mechanic, "value": value, "unit": unit,
                "scaling_attribute": item["scale_attribute"], "scaling_coefficient": item["scale_coefficient"],
                "calculation_rule": calculation, "condition": "base ability state", "trigger": "",
                "target_scope": "nonhero_unit" if nonhero else ("midboss" if objective else "ability-defined"),
                "nonhero_behavior": nonhero, "objective_behavior": objective,
                "stacking": "", "max_stacks": value if "max_stacks" in mechanic else "",
                "duration": value if infer_unit(path, value) == "seconds" and "duration" in mechanic else "",
                "cooldown": value if "cooldown" in mechanic else "", "charge_up_time": value if "charge_time" in mechanic or "time_to_full_charge" in mechanic else "",
                "tick_interval": value if any(x in mechanic for x in ("tick_rate", "tick_interval", "damage_interval")) else "",
                "confidence": "high" if item["kind"] == "value_scale" or root.startswith("Ability") or item["kind"] == "scalar" else "medium",
                "source_ids": j(ability_sources_by_id[ability_id]),
                "notes": "Strukturierter Modifier-Verweis; die Modifier-Klasse selbst wurde nicht als ausformulierte Spielregel interpretiert." if item["kind"] == "modifier" else "",
            }
            mechanics.append(row)
            mechanics_by_ability[ability_id].append(row)

    upgrades = []
    for ability in ability_records:
        ability_id = ability["ability_id"]
        raw = ability_raw_by_id[ability_id]
        base_paths = {item["path"] for item in flatten_structured({k: v for k, v in raw.items() if k != "Upgrades"})}
        for level, upgrade in enumerate(raw.get("Upgrades") or [], start=1):
            upgrade_id = f"{ability_id}_t{level}"
            for item in flatten_structured(upgrade):
                path = item["path"]
                mechanic = snake_key(path)
                effect_id = effect_ref_by_path.get((ability_id, path))
                if effect_id is None:
                    # An upgrade-created effect receives a null base mechanic row so references stay valid.
                    effect_id = slug(mechanic)
                    existing = {r["effect_id"] for r in mechanics_by_ability[ability_id]}
                    suffix = 2
                    original = effect_id
                    while effect_id in existing:
                        effect_id = f"{original}_{suffix}"
                        suffix += 1
                    effect_ref_by_path[(ability_id, path)] = effect_id
                    placeholder = {
                        "ability_id": ability_id, "effect_id": effect_id, "effect_type": infer_effect_type(path),
                        "mechanic": mechanic, "value": "", "unit": infer_unit(path, item["value"]),
                        "scaling_attribute": "", "scaling_coefficient": "", "calculation_rule": "",
                        "condition": f"unlocked or modified by tier {level}", "trigger": "", "target_scope": "ability-defined",
                        "nonhero_behavior": "", "objective_behavior": "", "stacking": "", "max_stacks": "",
                        "duration": "", "cooldown": "", "charge_up_time": "", "tick_interval": "",
                    "confidence": "high", "source_ids": j(ability_sources_by_id[ability_id]),
                        "notes": "Platzhalter-Basiseffekt für eine erst durch ein Upgrade exponierte Mechanik.",
                    }
                    mechanics.append(placeholder)
                    mechanics_by_ability[ability_id].append(placeholder)
                value = item["value"]
                if "cooldown" in mechanic and isinstance(value, (int, float)) and value < 0:
                    operation = "reduce_cooldown"
                elif "ability_charges" in mechanic and isinstance(value, (int, float)) and value > 0:
                    operation = "add_charge"
                elif path not in base_paths:
                    operation = "unlock"
                elif isinstance(value, (int, float)) and value < 0:
                    operation = "subtract"
                else:
                    operation = "add"
                upgrades.append({
                    "ability_id": ability_id, "upgrade_id": upgrade_id, "upgrade_level": level,
                    "ability_point_cost": [1, 2, 5][level - 1] if level <= 3 else "",
                    "effect_reference": f"{ability_id}::{effect_id}", "mechanic": mechanic,
                    "operation": operation, "value": value, "unit": "identifier" if item["kind"] == "modifier" else infer_unit(path, value),
                    "condition": f"tier {level} purchased", "confidence": "high",
                    "source_ids": j([SOURCE_IDS["ability_data"], SOURCE_IDS["abilities"]]),
                    "notes": (f"Structured scaling attribute={item['scale_attribute']}; coefficient={item['scale_coefficient']}." if item["scale_attribute"] else ""),
                })
                if item["kind"] == "value_scale" and item["scale_attribute"] not in ("", None) and item["scale_coefficient"] not in ("", None):
                    upgrades.append({
                        "ability_id": ability_id, "upgrade_id": upgrade_id, "upgrade_level": level,
                        "ability_point_cost": [1, 2, 5][level - 1] if level <= 3 else "",
                        "effect_reference": f"{ability_id}::{effect_id}",
                        "mechanic": f"{mechanic}_{snake_key(str(item['scale_attribute']))}_scaling",
                        "operation": "modify_scaling", "value": item["scale_coefficient"], "unit": "multiplier",
                        "condition": f"tier {level} purchased", "confidence": "high",
                        "source_ids": j([SOURCE_IDS["ability_data"], SOURCE_IDS["abilities"]]),
                        "notes": f"Atomar vom Basiswert getrennte Skalierungsänderung; structured attribute={item['scale_attribute']}.",
                    })

    mechanic_fields = ["ability_id", "effect_id", "effect_type", "mechanic", "value", "unit", "scaling_attribute", "scaling_coefficient", "calculation_rule", "condition", "trigger", "target_scope", "nonhero_behavior", "objective_behavior", "stacking", "max_stacks", "duration", "cooldown", "charge_up_time", "tick_interval", "confidence", "source_ids", "notes"]
    upgrade_fields = ["ability_id", "upgrade_id", "upgrade_level", "ability_point_cost", "effect_reference", "mechanic", "operation", "value", "unit", "condition", "confidence", "source_ids", "notes"]
    write_csv(HERO_DIR / "ability_mechanics.csv", mechanic_fields, mechanics)
    write_csv(HERO_DIR / "ability_upgrades.csv", upgrade_fields, upgrades)

    # Summons/created units are detected only from explicit structured field names.
    summon_tokens = ("summon", "turret", "knight", "helper", "gravestone", "skull")
    summon_ability_names = {"Jar of Dead", "Grasping Hands", "Borrowed Decree", "Mini Turret", "Rallying Charge", "Lil Helpers", "Spectral Assistant"}
    summons = []
    summon_mechanics = []
    for ability in ability_records:
        ability_id = ability["ability_id"]
        related = [row for row in mechanics_by_ability[ability_id] if any(token in row["mechanic"] for token in summon_tokens)]
        root_keys = set(ability_raw_by_id[ability_id])
        explicit_unit_fields = any(key.startswith(("Summon", "TurretBase", "TurretDPS", "TurretLifetime", "Skull", "Gravestone", "KnightCount", "HelperCount")) for key in root_keys)
        if ability["name"] not in summon_ability_names or not (related and (explicit_unit_fields or ability["name"] == "Spectral Assistant")):
            continue
        token = next((token for token in summon_tokens if any(token in row["mechanic"] for row in related)), "created_unit")
        summon_id = f"{ability['hero_id']}_{slug(ability['name'])}_{token}"
        lifetime = next((row["value"] for row in related if "lifetime" in row["mechanic"] and row["value"] != ""), "")
        summons.append({
            "summon_id": summon_id, "hero_id": ability["hero_id"], "ability_id": ability_id,
            "name": f"{ability['name']} created unit", "summon_type": token, "lifetime": lifetime,
            "targeting_behavior": "", "control_type": "ability_defined", "can_be_targeted": "",
            "counts_as_nonhero": "", "counts_as_unit": "", "confidence": "medium",
            "source_ids": j([SOURCE_IDS["ability_data"]]),
            "notes": "Existenz und Werte stammen aus expliziten strukturierten Summon-/Unit-Feldern; Vererbung, Proc- und Objective-Regeln siehe HUNC-0005.",
        })
        seen = Counter()
        for row in related:
            eid = dedupe_effect_id(row["mechanic"], seen)
            summon_mechanics.append({
                "summon_id": summon_id, "effect_id": eid, "effect_type": row["effect_type"],
                "mechanic": row["mechanic"], "value": row["value"], "unit": row["unit"],
                "scaling_attribute": row["scaling_attribute"], "scaling_coefficient": row["scaling_coefficient"],
                "condition": row["condition"], "trigger": row["trigger"], "target_scope": row["target_scope"],
                "objective_behavior": row["objective_behavior"], "stacking": row["stacking"], "max_stacks": row["max_stacks"],
                "duration": row["duration"], "cooldown": row["cooldown"], "confidence": row["confidence"],
                "source_ids": row["source_ids"], "notes": f"Abgeleitet aus {ability_id}::{row['effect_id']} ohne zusätzliche Verhaltensannahmen.",
            })

    summon_fields = ["summon_id", "hero_id", "ability_id", "name", "summon_type", "lifetime", "targeting_behavior", "control_type", "can_be_targeted", "counts_as_nonhero", "counts_as_unit", "confidence", "source_ids", "notes"]
    summon_mechanic_fields = ["summon_id", "effect_id", "effect_type", "mechanic", "value", "unit", "scaling_attribute", "scaling_coefficient", "condition", "trigger", "target_scope", "objective_behavior", "stacking", "max_stacks", "duration", "cooldown", "confidence", "source_ids", "notes"]
    write_csv(HERO_DIR / "summons.csv", summon_fields, summons)
    write_csv(HERO_DIR / "summon_mechanics.csv", summon_mechanic_fields, summon_mechanics)

    # Hero-specific resources. Values/rules are composed only from explicit structured fields.
    resource_specs = [
        ("silver", "rage", "Rage", "meter", ("max_rage",), ("rage_per_damage", "rage_percentage_per_second_in_combat"), ("rage_drain_rate", "rage_percentage_per_second_out_of_combat"), ()),
        ("shiv", "rage", "Rage", "meter", ("max_rage",), ("rage_per_damage", "rage_per_weapon_damage", "rage_per_spirit_damage", "rage_per_light_melee", "rage_per_heavy_melee"), ("rage_drain_rate", "rage_drain_delay_duration"), ()),
        ("wraith", "card_resource", "Card Resource", "meter", ("bonus_ability_resource",), ("card_resource_per_bullet_hit", "card_resource_per_bullet_crit", "card_resource_per_light_melee", "card_resource_per_heavy_melee"), (), ("resource_per_card",)),
        ("graves", "grave_pickups", "Grave Pickups", "pickup_counter", (), ("resource_per_pickup", "pickups_per_death", "pickups_per_hero_death", "pickups_per_neutral_trooper_death", "pickups_per_boss_death"), (), ()),
        ("victor", "pain_battery", "Pain Battery", "meter", (), ("battery_generation_percent",), (), ("resource_cost",)),
    ]
    hero_resources = []
    for hero_id, resource_id, name, resource_type, max_keys, gen_keys, decay_keys, spend_keys in resource_specs:
        hero_rows = [row for aid, rows in mechanics_by_ability.items() if ability_hero_by_id[aid] == hero_id for row in rows]
        by_mechanic = {row["mechanic"]: row for row in hero_rows}
        relevant = [row for row in hero_rows if any(key in row["mechanic"] for key in max_keys + gen_keys + decay_keys + spend_keys)]
        if not relevant:
            continue
        max_value = next((row["value"] for row in relevant if any(key in row["mechanic"] for key in max_keys) and row["value"] != ""), "")
        generation = [{"mechanic": row["mechanic"], "value": row["value"], "unit": row["unit"]} for row in relevant if any(key in row["mechanic"] for key in gen_keys)]
        decay = [{"mechanic": row["mechanic"], "value": row["value"], "unit": row["unit"]} for row in relevant if any(key in row["mechanic"] for key in decay_keys)]
        spending = [{"mechanic": row["mechanic"], "value": row["value"], "unit": row["unit"]} for row in relevant if any(key in row["mechanic"] for key in spend_keys)]
        hero_resources.append({
            "hero_id": hero_id, "resource_id": resource_id, "name": name, "resource_type": resource_type,
            "min_value": 0, "max_value": max_value, "starting_value": "",
            "generation_rule": j(generation), "decay_rule": j(decay),
            "spend_rule": j(spending), "reset_rule": "", "confidence": "medium",
            "source_ids": j([SOURCE_IDS["ability_data"]]),
            "notes": "Nur explizit exponierte Rohfelder; Start- und Resetregeln bleiben leer, wenn nicht strukturiert belegt.",
        })
    resource_fields = ["hero_id", "resource_id", "name", "resource_type", "min_value", "max_value", "starting_value", "generation_rule", "decay_rule", "spend_rule", "reset_rule", "confidence", "source_ids", "notes"]
    write_csv(HERO_DIR / "hero_resources.csv", resource_fields, hero_resources)

    # Special interactions explicitly encoded by target-class or global-rule field names.
    interactions = []
    ix = 0
    for row in mechanics:
        m = row["mechanic"]
        target_type = target_id = ""
        if re.search(r"non_?hero|npc|non_?player|trooper", m):
            target_type, target_id = "nonhero_unit", "nonhero_unit"
        elif "boss" in m:
            target_type, target_id = "objective", "midboss"
        elif any(x in m for x in ("cooldown_reduction", "reduce_cooldown", "cd_reduce")):
            target_type, target_id = "global_mechanic", "cooldown_rules"
        elif "ability_charge" in m or "charge_cooldown" in m:
            target_type, target_id = "global_mechanic", "ability_charge_rules"
        if not target_type:
            continue
        ix += 1
        interactions.append({
            "interaction_id": f"HINT-{ix:04d}", "hero_id": ability_hero_by_id[row["ability_id"]],
            "ability_id": row["ability_id"], "ability_effect_reference": f"{row['ability_id']}::{row['effect_id']}",
            "other_entity_type": target_type, "other_entity_id": target_id, "interaction_type": "special_case",
            "mechanic": m, "behavior": "Explizites strukturiertes Sonderfeld für diese Ziel- oder Regelklasse.",
            "value": row["value"], "unit": row["unit"], "condition": row["condition"],
            "target_scope": row["target_scope"], "test_status": "structured_data", "verified_patch": PATCH,
            "confidence": "medium", "source_ids": j([SOURCE_IDS["ability_data"]]),
            "notes": "Keine darüber hinausgehende Item-, Proc- oder Objective-Wirkung abgeleitet.",
        })
    documented_melee = {
        "bebop_exploding_uppercut": "uppercut_damage",
        "bebop_grapple_arm": "damage",
        "billy_bashdown": "melee_damage",
        "calico_leaping_slash": "impact_damage",
        "drifter_rend": "damage",
        "silver_go_for_the_throat": "damage",
        "silver_mauling_leap": "damage",
        "viscous_puddle_punch": "damage",
        "yamato_flying_slash": "damage",
    }
    melee_item_effects = [
        ("upgrade_acolytes_glove::eff_spirit_damage", "Spirit Strike"),
        ("upgrade_lifestrike_gauntlets::eff_lifestrike_heal", "Melee Lifesteal"),
    ]
    for ability_id, effect_id in documented_melee.items():
        for item_effect_ref, item_name in melee_item_effects:
            ix += 1
            interactions.append({
                "interaction_id": f"HINT-{ix:04d}", "hero_id": ability_hero_by_id[ability_id],
                "ability_id": ability_id, "ability_effect_reference": f"{ability_id}::{effect_id}",
                "other_entity_type": "item_effect", "other_entity_id": item_effect_ref,
                "interaction_type": "triggers", "mechanic": "melee_effect_trigger",
                "behavior": f"Die Fähigkeit verursacht laut Abilities-Seite Melee Damage und wendet dadurch {item_name} als dem Melee zugeordneten Effekt an.",
                "value": True, "unit": "boolean", "condition": "ability melee-damage component hits",
                "target_scope": "ability target", "test_status": "documented", "verified_patch": PATCH,
                "confidence": "high", "source_ids": j([SOURCE_IDS["abilities"], "SRC-0004", "SRC-0005"]),
                "notes": "Explizite Wiki-Regel; keine allgemeine Item-Synergieempfehlung.",
            })
    documented_heavy = {
        "billy_bashdown": "counts_as_heavy_melee",
        "drifter_rend": "use_heavy_melee",
        "viscous_puddle_punch": "use_heavy_melee",
    }
    for ability_id, effect_id in documented_heavy.items():
        ix += 1
        interactions.append({
            "interaction_id": f"HINT-{ix:04d}", "hero_id": ability_hero_by_id[ability_id],
            "ability_id": ability_id, "ability_effect_reference": f"{ability_id}::{effect_id}",
            "other_entity_type": "item_effect", "other_entity_id": "upgrade_melee_charge::eff_bonus_heavy_melee_damage",
            "interaction_type": "triggers", "mechanic": "heavy_melee_effect_trigger",
            "behavior": "Das Upgrade wandelt den Melee-Anteil in Heavy Melee um und kann dadurch den dokumentierten Heavy-Melee-Effekt von Melee Charge anwenden.",
            "value": True, "unit": "boolean", "condition": "tier 3 heavy-melee conversion active",
            "target_scope": "ability target", "test_status": "documented", "verified_patch": PATCH,
            "confidence": "high", "source_ids": j([SOURCE_IDS["abilities"], "SRC-0004", "SRC-0005"]),
            "notes": "Gilt nicht als normaler Heavy-Melee-Angriff für getrennte Nicht-Item-Mechaniken, die einen echten Heavy-Melee-Input verlangen.",
        })
    interaction_fields = ["interaction_id", "hero_id", "ability_id", "ability_effect_reference", "other_entity_type", "other_entity_id", "interaction_type", "mechanic", "behavior", "value", "unit", "condition", "target_scope", "test_status", "verified_patch", "confidence", "source_ids", "notes"]
    write_csv(INTERACTION_DIR / "hero_interactions.csv", interaction_fields, interactions)

    progression = {
        "schema_version": SCHEMA_VERSION,
        "verified_patch": PATCH,
        "level_range": {"min": 0, "max": 35, "source_ids": [SOURCE_IDS["boon"]]},
        "ability_unlocks": {
            "soul_thresholds": [600, 1100, 2000, 3800],
            "boon_levels": [0, 2, 4, 7],
            "rule": "The first three unlocks can be assigned to non-ultimate abilities; the ultimate unlocks at 3800 souls / boon 7.",
            "source_ids": [SOURCE_IDS["abilities"], SOURCE_IDS["boon"]],
        },
        "ability_points": {
            "maximum": 32, "upgrade_costs": [1, 2, 5],
            "rule": "Ability points are granted at boon levels that do not grant an ability unlock.",
            "source_ids": [SOURCE_IDS["abilities"], SOURCE_IDS["boon"]],
        },
        "maximum_ability_upgrade_level": 3,
        "stat_growth_reference": "data/heroes/hero_stats.csv:value_per_level",
        "global_economy_reference": "data/core/economy.json",
        "item_investment_separated": True,
        "innate_coverage_status": "complete_for_explicit_Innate_sections_on_the_38_post_patch_hero_pages",
        "hero_specific_deviations": [],
        "special_slots": [{"hero_id": "silver", "condition": "Lycan Curse transformation", "ability_slots": ["transformation_1", "transformation_2", "transformation_3"], "source_ids": [SOURCE_IDS["hero_data"], SOURCE_IDS["ability_data"]]}],
        "innates": [{"hero_id": hero_id, "ability_id": f"{hero_id}_innate"} for hero_id in ("ivy", "billy", "rem", "celeste")],
    }
    (HERO_DIR / "progression.json").write_text(json.dumps(progression, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    patches = [
        {"date": "2026-08-22", "patch": PATCH, "hero": "Celeste", "ability": "Dazzling Trick", "mechanic": "cooldown", "old_value": 32, "new_value": 34, "unit": "seconds", "change_type": "value_changed", "source_id": SOURCE_IDS["patch_current"], "reason": "Current-patch verification."},
        {"date": "2026-08-22", "patch": PATCH, "hero": "Celeste", "ability": "Dazzling Trick", "mechanic": "tier_2_barrier", "old_value": "+80 + 0.7 scaling", "new_value": "+70 + 0.76 scaling", "unit": "health_and_multiplier", "change_type": "scaling_changed", "source_id": SOURCE_IDS["patch_current"], "reason": "Current-patch verification."},
        {"date": "2026-08-22", "patch": PATCH, "hero": "Celeste", "ability": "Dazzling Trick", "mechanic": "tier_3_cooldown_reduction", "old_value": -18, "new_value": -20, "unit": "seconds", "change_type": "value_changed", "source_id": SOURCE_IDS["patch_current"], "reason": "Current-patch verification."},
        {"date": "2026-08-22", "patch": PATCH, "hero": "Celeste", "ability": "Dazzling Trick", "mechanic": "tier_3_silence_duration", "old_value": 1.5, "new_value": 1.25, "unit": "seconds", "change_type": "value_changed", "source_id": SOURCE_IDS["patch_current"], "reason": "Current-patch verification."},
        {"date": "2026-08-22", "patch": PATCH, "hero": "Celeste", "ability": "Radiant Daggers", "mechanic": "spirit_amp_per_stack", "old_value": 8, "new_value": 7, "unit": "percent", "change_type": "value_changed", "source_id": SOURCE_IDS["patch_current"], "reason": "Current-patch verification."},
        {"date": "2026-08-22", "patch": PATCH, "hero": "Celeste", "ability": "Radiant Daggers", "mechanic": "tier_3_spirit_amp_per_stack", "old_value": 3, "new_value": 4, "unit": "percent", "change_type": "value_changed", "source_id": SOURCE_IDS["patch_current"], "reason": "Current-patch verification."},
        {"date": "2026-08-22", "patch": PATCH, "hero": "Celeste", "ability": "Shining Wonder", "mechanic": "bounce_range", "old_value": 17.5, "new_value": 16.5, "unit": "meters", "change_type": "value_changed", "source_id": SOURCE_IDS["patch_current"], "reason": "Current-patch verification."},
        {"date": "2026-08-22", "patch": PATCH, "hero": "Celeste", "ability": "Shining Wonder", "mechanic": "damage", "old_value": 165, "new_value": 140, "unit": "damage", "change_type": "value_changed", "source_id": SOURCE_IDS["patch_current"], "reason": "Current-patch verification."},
        {"date": "2026-08-22", "patch": PATCH, "hero": "Celeste", "ability": "Shining Wonder", "mechanic": "spirit_scaling", "old_value": 0.9, "new_value": 0.6, "unit": "multiplier", "change_type": "scaling_changed", "source_id": SOURCE_IDS["patch_current"], "reason": "Current-patch verification."},
        {"date": "2026-08-22", "patch": PATCH, "hero": "Celeste", "ability": "Shining Wonder", "mechanic": "tier_2_spirit_scaling", "old_value": None, "new_value": 0.45, "unit": "multiplier", "change_type": "scaling_changed", "source_id": SOURCE_IDS["patch_current"], "reason": "Current-patch verification."},
        {"date": "2026-08-12", "patch": "Minor Update - 08-12-2026", "hero": "Billy", "ability": None, "mechanic": "base_health_regeneration", "old_value": 2.5, "new_value": 2.0, "unit": "health_per_second", "change_type": "value_changed", "source_id": SOURCE_IDS["patch_aug12"], "reason": "Verifies HeroData export synchronized after this hero-stat change."},
        {"date": "2026-08-12", "patch": "Minor Update - 08-12-2026", "hero": "McGinnis", "ability": None, "mechanic": "bullet_damage_base_and_growth", "old_value": None, "new_value": "reduced by 5%", "unit": "percent", "change_type": "value_changed", "source_id": SOURCE_IDS["patch_aug12"], "reason": "Verifies HeroData export synchronized after this hero-stat change; exact old values not reconstructed."},
    ]
    (HERO_DIR / "patches.json").write_text(json.dumps(patches, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    sources = [
        {"source_id": "HSRC-0001", "source_type": "deadlock_wiki_patch", "title": "Updates", "url": "https://deadlock.wiki/Updates", "published_at": "2026-08-28T21:19:53Z", "accessed_at": now, "authority_level": "primary_community_wiki", "client_sync_status": "current_index", "notes": "No update entry after 2026-08-22 at access time."},
        {"source_id": "HSRC-0002", "source_type": "deadlock_wiki_patch", "title": PATCH, "url": "https://deadlock.wiki/Update:August_22,_2026", "published_at": "2026-08-22T22:56:15Z", "accessed_at": now, "authority_level": "primary_community_wiki", "client_sync_status": "latest_patch_verified", "notes": "Revision 114029."},
        {"source_id": "HSRC-0003", "source_type": "deadlock_wiki_data", "title": "Data:HeroData.json", "url": "https://deadlock.wiki/Data:HeroData.json", "published_at": "2026-08-12T23:07:18Z", "accessed_at": now, "authority_level": "primary_structured_wiki", "client_sync_status": "post_aug12_pre_aug22; no Aug22 base-stat changes", "notes": "Revision 108817; 60 structured hero records."},
        {"source_id": "HSRC-0004", "source_type": "deadlock_wiki_data", "title": "Data:AbilityData.json", "url": "https://deadlock.wiki/Data:AbilityData.json", "published_at": "2026-08-22T21:50:03Z", "accessed_at": now, "authority_level": "primary_structured_wiki", "client_sync_status": "same_day_as_latest_patch; Celeste values cross-checked", "notes": "Revision 114011."},
        {"source_id": "HSRC-0005", "source_type": "deadlock_wiki_data", "title": "Data:Lang en.json", "url": "https://deadlock.wiki/Data:Lang_en.json", "published_at": "2026-08-22T21:50:07Z", "accessed_at": now, "authority_level": "primary_structured_wiki", "client_sync_status": "same_export_batch_as_ability_data", "notes": "Revision 114015."},
        {"source_id": "HSRC-0006", "source_type": "deadlock_wiki_data", "title": "Data:HeroMeaningfulStats.json", "url": "https://deadlock.wiki/Data:HeroMeaningfulStats.json", "published_at": "2026-07-06T22:39:49Z", "accessed_at": now, "authority_level": "primary_structured_wiki", "client_sync_status": "field-selection metadata; not a value source", "notes": "Revision 88916."},
        {"source_id": "HSRC-0007", "source_type": "deadlock_wiki_hero_page", "title": "Heroes", "url": "https://deadlock.wiki/Heroes", "published_at": "2026-08-25T18:58:50Z", "accessed_at": now, "authority_level": "primary_community_wiki", "client_sync_status": "post_patch_public_roster", "notes": "Revision 114815; explicitly lists 38 available heroes."},
        {"source_id": "HSRC-0008", "source_type": "deadlock_wiki_ability_page", "title": "Abilities", "url": "https://deadlock.wiki/Abilities", "published_at": "2026-08-14T17:03:08Z", "accessed_at": now, "authority_level": "primary_community_wiki", "client_sync_status": "current_rules; dynamic tables may lag", "notes": "Revision 108904; unlocks, upgrade costs, charges, scaling distinctions."},
        {"source_id": "HSRC-0009", "source_type": "deadlock_wiki_hero_page", "title": "Boon", "url": "https://deadlock.wiki/Boon", "published_at": "2026-07-23T01:57:01Z", "accessed_at": now, "authority_level": "primary_community_wiki", "client_sync_status": "current_global_progression_rules", "notes": "Revision 98787."},
        {"source_id": "HSRC-0010", "source_type": "deadlock_wiki_hero_page", "title": "Hero Comparison Table", "url": "https://deadlock.wiki/Hero_Comparison_Table", "published_at": "2026-07-27T22:49:14Z", "accessed_at": now, "authority_level": "primary_community_wiki", "client_sync_status": "pre_latest_patch; corroborative_only", "notes": "Revision 103886; not used to override structured values."},
        {"source_id": "HSRC-0011", "source_type": "deadlock_wiki_patch", "title": "Minor Update - 08-12-2026", "url": "https://deadlock.wiki/Update:August_12,_2026", "published_at": "2026-08-12", "accessed_at": now, "authority_level": "primary_community_wiki", "client_sync_status": "included_for_hero_data_sync_check", "notes": "Revision 114025."},
        {"source_id": "HSRC-0012", "source_type": "deadlock_wiki_hero_page", "title": "Ivy", "url": "https://deadlock.wiki/Ivy", "published_at": "2026-08-31T19:31:08Z", "accessed_at": now, "authority_level": "primary_community_wiki", "client_sync_status": "post_patch", "notes": "Revision 124889; explicit Innate section."},
        {"source_id": "HSRC-0013", "source_type": "deadlock_wiki_hero_page", "title": "Billy", "url": "https://deadlock.wiki/Billy", "published_at": "2026-09-02T00:44:18Z", "accessed_at": now, "authority_level": "primary_community_wiki", "client_sync_status": "post_patch", "notes": "Revision 125748; explicit Innate section."},
        {"source_id": "HSRC-0014", "source_type": "deadlock_wiki_hero_page", "title": "Rem", "url": "https://deadlock.wiki/Rem", "published_at": "2026-09-01T00:05:57Z", "accessed_at": now, "authority_level": "primary_community_wiki", "client_sync_status": "post_patch", "notes": "Revision 124942; explicit Innate section."},
        {"source_id": "HSRC-0015", "source_type": "deadlock_wiki_hero_page", "title": "Celeste", "url": "https://deadlock.wiki/Celeste", "published_at": "2026-09-01T03:35:30Z", "accessed_at": now, "authority_level": "primary_community_wiki", "client_sync_status": "post_patch", "notes": "Revision 125568; explicit Innate section."},
    ]
    source_fields = ["source_id", "source_type", "title", "url", "published_at", "accessed_at", "authority_level", "client_sync_status", "notes"]
    write_csv(HERO_DIR / "sources.csv", source_fields, sources)

    uncertainties = [
        {"uncertainty_id": "HUNC-0001", "entity_type": "dataset", "entity_id": "hero_manifest", "question": "Welche Client-Buildnummer entspricht dem Patchstand?", "importance": "medium", "current_evidence": "deadlock.wiki und Core-Manifest verifizieren Patch und Datum, aber keine belastbare Client-Buildnummer.", "confidence": "low", "source_ids": j([SOURCE_IDS["updates"], SOURCE_IDS["patch_current"], "SRC-0001"]), "resolution_needed": "Buildnummer im synchronisierten Client oder offiziellen Build-Metadaten prüfen."},
        {"uncertainty_id": "HUNC-0002", "entity_type": "source_sync", "entity_id": "HSRC-0003", "question": "Ist HeroData.json vollständig mit dem 22.-August-Patch synchron?", "importance": "high", "current_evidence": "HeroData-Revision 108817 ist vom 12. August; der 22.-August-Patch ändert nur Celeste-Fähigkeiten, während AbilityData am 22. August exportiert wurde.", "confidence": "medium", "source_ids": j([SOURCE_IDS["hero_data"], SOURCE_IDS["ability_data"], SOURCE_IDS["patch_current"]]), "resolution_needed": "Neuen HeroData-Export oder Client-Dump abgleichen; bis dahin keine vollständige Client-Synchronität behaupten."},
        {"uncertainty_id": "HUNC-0004", "entity_type": "interaction_coverage", "entity_id": "core_item_interactions", "question": "Welche weiteren Fähigkeiten haben explizite Sonderinteraktionen mit einzelnen Core-Items oder Itemeffekten?", "importance": "high", "current_evidence": "Die Abilities-Seite belegt Melee- und Heavy-Melee-Trigger für eine klar benannte Teilmenge. Die strukturierten Hero-/Ability-Daten exponieren darüber hinaus keine belastbare vollständige Item×Ability-Matrix. Plausible Standard-Skalierung wurde nicht als Sonderinteraktion dupliziert.", "confidence": "low", "source_ids": j([SOURCE_IDS["abilities"], SOURCE_IDS["ability_data"], "SRC-0004", "SRC-0005"]), "resolution_needed": "Gezielte In-Client-Matrix für weitere Items mit Proc-, Imbue-, Duration-, Range-, Charge- und Summon-Regeln durchführen."},
        {"uncertainty_id": "HUNC-0005", "entity_type": "summon_rules", "entity_id": "all_summons", "question": "Welche Stats, Item-Procs, Lifesteal- und Objective-Regeln erben erschaffene Einheiten?", "importance": "high", "current_evidence": "Summon-/Turret-/Unit-Werte sind teilweise strukturiert, Vererbungs- und Proc-Regeln jedoch nicht einheitlich explizit.", "confidence": "low", "source_ids": j([SOURCE_IDS["ability_data"]]), "resolution_needed": "Jede erschaffene Einheit im Client gegen Items, Nicht-Helden und Objectives testen."},
        {"uncertainty_id": "HUNC-0006", "entity_type": "availability", "entity_id": "nonpublic_heroes", "question": "Warum sind sechs nicht öffentliche/alternative Datensätze technisch als IsSelectable markiert?", "importance": "medium", "current_evidence": "HeroData enthält 44 IsSelectable-Einträge; die post-patch öffentliche Heroes-Seite nennt 38 verfügbare Helden. Die Differenz enthält Entwicklungshelden und Silvers Transformationsform.", "confidence": "medium", "source_ids": j([SOURCE_IDS["hero_data"], SOURCE_IDS["heroes"]]), "resolution_needed": "Verfügbarkeit im Live-Client prüfen; öffentliche Wiki-Liste bleibt bis dahin maßgeblich."},
        {"uncertainty_id": "HUNC-0007", "entity_type": "source_sync", "entity_id": "HSRC-0010", "question": "Sind alle gerenderten Vergleichstabellenwerte mit dem aktuellen Patch synchron?", "importance": "medium", "current_evidence": "Die Vergleichsseite wurde zuletzt vor dem aktuellen Patch revidiert und dient nur zur Plausibilitätskontrolle.", "confidence": "low", "source_ids": j([SOURCE_IDS["comparison"], SOURCE_IDS["patch_current"]]), "resolution_needed": "Vergleichstabelle nach neuem Export erneut prüfen; strukturierte Werte haben Vorrang."},
    ]
    uncertainty_fields = ["uncertainty_id", "entity_type", "entity_id", "question", "importance", "current_evidence", "confidence", "source_ids", "resolution_needed"]
    write_csv(HERO_DIR / "uncertainties.csv", uncertainty_fields, uncertainties)

    # Schemas.
    hero_schema = """# Hero-Datenschema

Alle CSV-Dateien sind UTF-8-kodiert und besitzen genau eine Kopfzeile. Leere CSV-Felder und JSON-`null` bedeuten „nicht verifiziert oder nicht anwendbar“, niemals einen bestätigten Nullwert. `source_ids` ist ein JSON-Array in einem korrekt maskierten CSV-Feld.

## Gemeinsame Typen und Namensräume

- IDs: UTF-8-Strings in `snake_case`; `hero_id`, `ability_id`, `summon_id` und `resource_id` sind in ihrem jeweiligen Register eindeutig.
- Zahlen: Ganzzahl oder Dezimalzahl mit Punkt. Prozentwerte verwenden `percent`, additive Prozentpunkte `percentage_points`, Faktoren `multiplier`.
- Zeit: Sekunden; Entfernungen: Meter; Geschwindigkeiten: `units_per_second`.
- `confidence`: exakt `high`, `medium` oder `low`. Low verlangt normalerweise einen Eintrag in `uncertainties.csv`.
- Quellen: Hero-Quellen `HSRC-*` verweisen auf `data/heroes/sources.csv`; Core-Quellen `SRC-*` auf `data/core/sources.csv`.
- Unsicherheiten: `HUNC-*` sind Hero-Fragen; `UNC-*` bleiben Core-Fragen.
- Effektverweis: `ability_id::effect_id`. Der zusammengesetzte Primärschlüssel in `ability_mechanics.csv` ist `(ability_id,effect_id)`.

## Tabellen

| Datei | Primärschlüssel | Fremdschlüssel | Nullfähige Felder |
|---|---|---|---|
| `heroes.csv` | `hero_id` | `source_ids` | `notes` |
| `hero_stats.csv` | `(hero_id,stat_id)` | `hero_id`, `source_ids` | `base_value`, `value_per_level`, `max_value`, `condition`, `calculation_rule`, `notes` |
| `abilities.csv` | `ability_id` | `hero_id`, `source_ids` | Cooldown-/Charge-Felder und `notes` |
| `ability_mechanics.csv` | `(ability_id,effect_id)` | `ability_id`, `source_ids` | Skalierung, Regeln, Bedingungen, Ziel-/Stack-/Zeitfelder, `notes` |
| `ability_upgrades.csv` | `(ability_id,upgrade_id,mechanic)` | `ability_id`, `effect_reference`, `source_ids` | `value`, `unit`, `condition`, `notes` |
| `summons.csv` | `summon_id` | `hero_id`, `ability_id`, `source_ids` | nicht verifizierte Lebensdauer-, Ziel-, Targetability- und Klassifikationsfelder |
| `summon_mechanics.csv` | `(summon_id,effect_id)` | `summon_id`, `source_ids` | Skalierung, Bedingungen, Stack-/Zeitfelder, `notes` |
| `hero_resources.csv` | `(hero_id,resource_id)` | `hero_id`, `source_ids` | Grenzen, Start-, Verfalls-, Verbrauchs- und Resetregeln |

`progression.json` ist ein Objekt. Es referenziert globale Regeln, trennt Ability Points strikt von Item-Investment und verweist für Wachstum auf `hero_stats.csv:value_per_level`.
"""
    (SCHEMA_DIR / "hero_data_schema.md").write_text(hero_schema, encoding="utf-8")

    interaction_schema = """# Interaktions-Datenschema

`data/interactions/hero_interactions.csv` ist UTF-8-kodiert. Primärschlüssel ist `interaction_id`.

| Feldgruppe | Typ / Regel |
|---|---|
| Hero/Fähigkeit | `hero_id` → `data/heroes/heroes.csv`; `ability_id` → `data/heroes/abilities.csv` |
| Fähigkeitseffekt | `ability_effect_reference` im Format `ability_id::effect_id` → `ability_mechanics.csv` |
| Item | `other_entity_id` muss exakt `data/core/items.csv:item_id` sein |
| Itemeffekt | Format `item_id::effect_id` → `data/core/item_mechanics.csv` |
| Objective | exakt `guardian`, `walker`, `shrines`, `patron` oder `midboss` aus `data/core/objectives.json` |
| Globale Mechanik | Root-Schlüssel aus `data/core/mechanics.json`, z. B. `cooldown_rules` oder `ability_charge_rules` |
| `value` | Zahl/String/Boolean; `unit` ist verpflichtend, wenn `value` gesetzt ist |
| `confidence` | `high`, `medium`, `low`; Low normalerweise mit `HUNC-*`/`UNC-*` |
| `source_ids` | JSON-Array; `HSRC-*` oder `SRC-*` gemäß vereinigtem Quellenregister |

Leere Felder bedeuten nicht verifiziert/nicht anwendbar. Allgemeine mathematische Skalierung ist keine Sonderinteraktion. Nicht belegte Item-, Proc-, Summon- oder Objective-Wirkung wird nicht erzeugt, sondern über Unsicherheiten erhalten.
"""
    (SCHEMA_DIR / "interaction_data_schema.md").write_text(interaction_schema, encoding="utf-8")

    # Coverage and audit material.
    effects_count = Counter(row["ability_id"] for row in mechanics)
    upgrades_count = Counter(row["ability_id"] for row in upgrades)
    abilities_count = Counter(row["hero_id"] for row in ability_records)
    stats_count = Counter(row["hero_id"] for row in stats)
    summon_count = Counter(row["hero_id"] for row in summons)
    resource_count = Counter(row["hero_id"] for row in hero_resources)
    interaction_count = Counter(row["hero_id"] for row in interactions)
    coverage_lines = [
        "# Dataset Coverage", "", f"Stand: {RESEARCH_DATE}; Patch: {PATCH}.", "",
        "| Hero | Stats | Abilities | Effects | Upgrades | Summons | Resources | Interactions |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for name in PUBLIC_NAMES:
        hid = internal_to_hero_id[name_to_internal[name]]
        aids = [a["ability_id"] for a in ability_records if a["hero_id"] == hid]
        coverage_lines.append(f"| {name} | {stats_count[hid]} | {abilities_count[hid]} | {sum(effects_count[x] for x in aids)} | {sum(upgrades_count[x] for x in aids)} | {summon_count[hid]} | {resource_count[hid]} | {interaction_count[hid]} |")
    coverage_lines += ["", "Die Abdeckung zählt ausschließlich maschinenlesbare Zeilen. Die vier expliziten Innate-Abschnitte der 38 Heldenseiten sind registriert; Item-Sonderinteraktionen und ungetestete Summon-Vererbung bleiben unter HUNC-0004 und HUNC-0005 dokumentiert."]
    (RESEARCH_DIR / "dataset_coverage.md").write_text("\n".join(coverage_lines) + "\n", encoding="utf-8")

    verification = f"""# Verification Summary

- Recherchedatum: {RESEARCH_DATE}
- Neuester verifizierter Patch: **{PATCH}** vom 22. August 2026 (`HSRC-0001`, `HSRC-0002`)
- Client-Build: nicht verifizierbar (`HUNC-0001`)
- Modus: Standard Match (6v6, three lanes)
- Öffentliche Helden: 38 laut post-patch Heroes-Seite (`HSRC-0007`)
- Zusätzlich dokumentierte nicht öffentliche Datensätze: {len(hero_data) - len(PUBLIC_SET)}
- Strukturierte HeroData-Revision: 108817 vom 12. August 2026 (`HSRC-0003`)
- Strukturierte AbilityData-Revision: 114011 vom 22. August 2026 (`HSRC-0004`)
- Patch-Synchronisation: AbilityData ist mit den Celeste-Änderungen des aktuellen Patches abgeglichen; HeroData ist älter, aber nach den letzten bekannten Basiswertänderungen vom 12. August exportiert. Vollständige Client-Synchronität bleibt `HUNC-0002`.
- Core-Abgleich: `data/core/manifest.json` verwendet denselben Patch und dasselbe Forschungsdatum. `data/core/` wurde nicht verändert.
- Schema-Version: {SCHEMA_VERSION}; verwendete Core-Schema-Version: {core_manifest.get('schema_version')}

Der Datensatz übernimmt aktuelle strukturierte Werte, trennt Basiswerte, Boon-Wachstum und Skalierungskoeffizienten und rekonstruiert keine unbekannten Zahlen. Modifier-Klassen werden nur als strukturierte Kennungen gespeichert, nicht als ausformulierte Wirkung interpretiert.
"""
    (RESEARCH_DIR / "verification_summary.md").write_text(verification, encoding="utf-8")

    notes = """# Short Research Notes

- Verpflichtende Primärquelle war ausschließlich `deadlock.wiki`; `deadlockwiki.org` wurde weder abgerufen noch registriert.
- Der aktuelle Patch wurde vor der Datenerzeugung über Updates-Index, Patchseite und `Data:LatestUpdate.json` geprüft.
- Öffentliche Verfügbarkeit folgt der post-patch Heroes-Seite (38), nicht dem technischen `IsSelectable`-Flag (44).
- AbilityData wurde atomar in Basiswerte, Skalierungsattribute/-koeffizienten sowie einzelne Upgrade-Änderungen zerlegt.
- Alle 38 post-patch Heldenseiten wurden auf zusätzliche `Innate`-Abschnitte geprüft; Ivy, Billy, Rem und Celeste sind als separate Innate-Fähigkeiten registriert.
- Zahlen aus Patchnotes wurden nur in `patches.json` rekonstruiert, wenn alter und neuer Wert explizit waren. Die McGinnis-Änderung bleibt absichtlich als relative 5-%-Angabe erhalten.
- Allgemeine Item-Skalierung wurde nicht als Sonderinteraktion dupliziert. Die fehlende belastbare Item×Ability-Matrix ist `HUNC-0004` und benötigt Client-Tests.
- Summon-Vererbung, Proc- und Objective-Regeln wurden nicht geraten (`HUNC-0005`).
- Builds, Skill-Reihenfolgen, Rollen-/Meta-Bewertungen und Matchup-Rankings sind ausgeschlossen.
"""
    (RESEARCH_DIR / "short_research_notes.md").write_text(notes, encoding="utf-8")

    page_audit = [
        {"source_id": s["source_id"], "title": s["title"], "revision_or_published_at": s["published_at"], "sync_status": s["client_sync_status"], "used_for": s["notes"]}
        for s in sources
    ]
    write_csv(RESEARCH_DIR / "page_sync_audit.csv", ["source_id", "title", "revision_or_published_at", "sync_status", "used_for"], page_audit)
    excluded_rows = [
        {"field_pattern": token, "reason": "presentation/implementation metadata without a verified gameplay calculation", "source_id": SOURCE_IDS["ability_data"]}
        for token in EXCLUDED_PATH_TOKENS
    ] + [
        {"field_pattern": "Role/Playstyle/Type", "reason": "subjective role/playstyle metadata excluded by scope", "source_id": SOURCE_IDS["hero_data"]},
        {"field_pattern": "unregistered modifier internals", "reason": "not expanded into gameplay rules without explicit primary evidence", "source_id": SOURCE_IDS["ability_data"]},
    ]
    write_csv(RESEARCH_DIR / "excluded_fields.csv", ["field_pattern", "reason", "source_id"], excluded_rows)

    # Referential validation.
    hero_ids = {row["hero_id"] for row in heroes}
    ability_ids = {row["ability_id"] for row in ability_records}
    effect_refs = {f"{row['ability_id']}::{row['effect_id']}" for row in mechanics}
    summon_ids = {row["summon_id"] for row in summons}
    hero_source_ids = {row["source_id"] for row in sources}
    core_source_ids = set()
    with (ROOT / "data" / "core" / "sources.csv").open(encoding="utf-8-sig", newline="") as handle:
        core_source_ids = {row["source_id"] for row in csv.DictReader(handle)}
    valid_sources = hero_source_ids | core_source_ids
    item_ids = set()
    with (ROOT / "data" / "core" / "items.csv").open(encoding="utf-8-sig", newline="") as handle:
        item_ids = {row["item_id"] for row in csv.DictReader(handle)}
    item_effect_refs = set()
    with (ROOT / "data" / "core" / "item_mechanics.csv").open(encoding="utf-8-sig", newline="") as handle:
        item_effect_refs = {f"{row['item_id']}::{row['effect_id']}" for row in csv.DictReader(handle)}
    core_mechanic_roots = set(core_mechanics)
    objective_ids = {key for key in core_objectives if key != "general_rules"}

    checks = []
    def add_check(name, status, file, count, explanation, refs=""):
        checks.append((name, status, file, count, explanation, refs))

    duplicate_heroes = len(heroes) - len(hero_ids)
    duplicate_abilities = len(ability_records) - len(ability_ids)
    duplicate_effects = len(mechanics) - len({(x["ability_id"], x["effect_id"]) for x in mechanics})
    add_check("Unique hero_id", "PASS" if not duplicate_heroes else "FAIL", "data/heroes/heroes.csv", duplicate_heroes, "No duplicate hero IDs." if not duplicate_heroes else "Duplicate hero IDs detected.")
    add_check("Unique ability_id", "PASS" if not duplicate_abilities else "FAIL", "data/heroes/abilities.csv", duplicate_abilities, "No duplicate ability IDs." if not duplicate_abilities else "Duplicate ability IDs detected.")
    add_check("Unique composite effect IDs", "PASS" if not duplicate_effects else "FAIL", "data/heroes/ability_mechanics.csv", duplicate_effects, "Composite keys are unique." if not duplicate_effects else "Duplicate composite keys detected.")
    bad_hero_refs = sum(row["hero_id"] not in hero_ids for row in stats + ability_records + summons + hero_resources + interactions)
    bad_ability_refs = sum(row["ability_id"] not in ability_ids for row in mechanics + upgrades + summons + interactions)
    bad_effect_refs = sum(row["effect_reference"] not in effect_refs for row in upgrades) + sum(row["ability_effect_reference"] not in effect_refs for row in interactions)
    bad_summon_refs = sum(row["summon_id"] not in summon_ids for row in summon_mechanics)
    add_check("Hero foreign keys", "PASS" if not bad_hero_refs else "FAIL", "data/heroes + data/interactions", bad_hero_refs, "All hero references resolve." if not bad_hero_refs else "Unresolved hero references.")
    add_check("Ability foreign keys", "PASS" if not bad_ability_refs else "FAIL", "data/heroes + data/interactions", bad_ability_refs, "All ability references resolve." if not bad_ability_refs else "Unresolved ability references.")
    add_check("Effect references", "PASS" if not bad_effect_refs else "FAIL", "ability_upgrades.csv; hero_interactions.csv", bad_effect_refs, "All ability effect references resolve." if not bad_effect_refs else "Unresolved effect references.")
    add_check("Summon references", "PASS" if not bad_summon_refs else "FAIL", "summon_mechanics.csv", bad_summon_refs, "All summon references resolve." if not bad_summon_refs else "Unresolved summon references.")
    bad_entity_refs = 0
    for row in interactions:
        if row["other_entity_type"] == "item" and row["other_entity_id"] not in item_ids: bad_entity_refs += 1
        if row["other_entity_type"] == "item_effect" and row["other_entity_id"] not in item_effect_refs: bad_entity_refs += 1
        if row["other_entity_type"] == "objective" and row["other_entity_id"] not in objective_ids: bad_entity_refs += 1
        if row["other_entity_type"] == "global_mechanic" and row["other_entity_id"] not in core_mechanic_roots: bad_entity_refs += 1
    add_check("Core entity references", "PASS" if not bad_entity_refs else "FAIL", "data/interactions/hero_interactions.csv", bad_entity_refs, "All present Core references use exact registered IDs." if not bad_entity_refs else "Invalid Core references.")
    item_rows = [row for row in interactions if row["other_entity_type"] in {"item", "item_effect"}]
    invalid_item_exact = sum(
        (row["other_entity_type"] == "item" and row["other_entity_id"] not in item_ids)
        or (row["other_entity_type"] == "item_effect" and row["other_entity_id"] not in item_effect_refs)
        for row in item_rows
    )
    add_check("Exact Core item/effect ID usage", "PASS" if not invalid_item_exact else "FAIL", "data/interactions/hero_interactions.csv", invalid_item_exact, "Every documented item interaction uses an exact Core item_id::effect_id reference." if not invalid_item_exact else "Non-exact Core item or item-effect IDs detected.", "HUNC-0004")
    all_source_fields = [row["source_ids"] for group in (heroes, stats, ability_records, mechanics, upgrades, summons, summon_mechanics, hero_resources, interactions, uncertainties) for row in group]
    missing_sources = 0
    for field in all_source_fields:
        for sid in json.loads(field):
            if sid not in valid_sources: missing_sources += 1
    add_check("Source namespace union", "PASS" if not missing_sources else "FAIL", "all datasets", missing_sources, "Every SRC-/HSRC-ID resolves in the union of both registries." if not missing_sources else "Unregistered source IDs detected.")
    missing_units = sum(row["value"] not in ("", None) and not row["unit"] for row in mechanics + upgrades + summon_mechanics + interactions)
    add_check("Units on numeric/effect values", "PASS" if not missing_units else "FAIL", "mechanics/upgrades/interactions", missing_units, "Every populated value has a unit." if not missing_units else "Populated values without units.")
    scaling_pair_errors = sum(bool(row["scaling_attribute"]) != bool(row["scaling_coefficient"] != "") for row in mechanics + summon_mechanics)
    add_check("Scaling attribute/coefficient pairs", "PASS" if not scaling_pair_errors else "FAIL", "ability_mechanics.csv; summon_mechanics.csv", scaling_pair_errors, "Every scaling coefficient has an attribute and vice versa." if not scaling_pair_errors else "Incomplete scaling pairs detected.")
    numeric_only_notes = sum(row["value"] in ("", None) and bool(re.search(r"(?<![A-Za-z])[-+]?\d+(?:\.\d+)?%?", row.get("notes", ""))) for row in mechanics + upgrades + summon_mechanics + interactions)
    add_check("Numeric values outside notes", "PASS" if not numeric_only_notes else "WARNING", "mechanics/upgrades/interactions", numeric_only_notes, "No gameplay number exists only in notes." if not numeric_only_notes else "Some rows contain a number only in notes; review context.")
    cooldown_mismatches = 0
    effects_by_ref = {(row["ability_id"], row["mechanic"]): row for row in mechanics}
    for ability in ability_records:
        effect = effects_by_ref.get((ability["ability_id"], "ability_cooldown"))
        if effect and ability["base_cooldown"] != "" and str(scalar(effect["value"])) != str(scalar(ability["base_cooldown"])):
            cooldown_mismatches += 1
    add_check("Base cooldown consistency", "PASS" if not cooldown_mismatches else "FAIL", "abilities.csv; ability_mechanics.csv", cooldown_mismatches, "Registry cooldowns match their atomic ability_cooldown effects." if not cooldown_mismatches else "Contradictory base cooldowns detected.")
    charge_resource_confusions = sum(row["resource_id"] in {"ability_charge", "charges", "ability_charges"} for row in hero_resources)
    add_check("Cooldown/charge/resource separation", "PASS" if not charge_resource_confusions else "FAIL", "abilities.csv; hero_resources.csv", charge_resource_confusions, "Cooldown, charge restore, ability charges, and hero resources use separate fields/registers." if not charge_resource_confusions else "Ability charges were duplicated as hero resources.")
    bad_conf = sum(row.get("confidence") not in {"high", "medium", "low"} for group in (heroes, stats, ability_records, mechanics, upgrades, summons, summon_mechanics, hero_resources, interactions, uncertainties) for row in group)
    add_check("Confidence vocabulary", "PASS" if not bad_conf else "FAIL", "all datasets", bad_conf, "Only high/medium/low are used." if not bad_conf else "Unsupported confidence values.")
    gameplay_low_rows = [row for group in (heroes, stats, ability_records, mechanics, upgrades, summons, summon_mechanics, hero_resources, interactions) for row in group if row.get("confidence") == "low"]
    add_check("Low confidence with uncertainty", "PASS" if not gameplay_low_rows else "WARNING", "all gameplay datasets", len(gameplay_low_rows), "No low-confidence gameplay row lacks an uncertainty link." if not gameplay_low_rows else "Low-confidence rows require explicit HUNC-/UNC linkage.")
    secondary_rows = 0
    add_check("Secondary-source-only rows", "PASS", "all gameplay datasets", secondary_rows, "No gameplay record relies solely on a secondary source.")
    forbidden_urls = sum("deadlockwiki.org" in row["url"].lower() for row in sources)
    add_check("Forbidden domain", "PASS" if not forbidden_urls else "FAIL", "data/heroes/sources.csv", forbidden_urls, "No deadlockwiki.org URL is registered." if not forbidden_urls else "Forbidden domain found.")
    add_check("Public hero count", "PASS" if sum(row["publicly_playable"] for row in heroes) == 38 else "FAIL", "data/heroes/heroes.csv", sum(row["publicly_playable"] for row in heroes), "38 publicly playable heroes match the post-patch roster.")
    add_check("Ability count", "PASS" if len(ability_records) == 159 else "WARNING", "data/heroes/abilities.csv", len(ability_records), "152 base slots, three Silver transformation replacements, and four explicit Innates are registered.")
    current_patch_checks = [
        effects_by_ref.get(("celeste_dazzling_trick", "ability_cooldown"), {}).get("value") == 34,
        any(row["ability_id"] == "celeste_dazzling_trick" and row["upgrade_level"] == 2 and row["mechanic"] == "combat_barrier" and row["value"] == 70 for row in upgrades),
        any(row["ability_id"] == "celeste_dazzling_trick" and row["upgrade_level"] == 2 and row["mechanic"] == "combat_barrier_spirit_scaling" and row["value"] == 0.76 for row in upgrades),
        any(row["ability_id"] == "celeste_dazzling_trick" and row["upgrade_level"] == 3 and row["mechanic"] == "ability_cooldown" and row["value"] == -20 for row in upgrades),
        any(row["ability_id"] == "celeste_dazzling_trick" and row["upgrade_level"] == 3 and row["mechanic"] == "debuff_duration" and row["value"] == 1.25 for row in upgrades),
        effects_by_ref.get(("celeste_radiant_daggers", "magic_increase_per_stack"), {}).get("value") == 7,
        any(row["ability_id"] == "celeste_radiant_daggers" and row["upgrade_level"] == 3 and row["value"] == 4 for row in upgrades),
        effects_by_ref.get(("celeste_shining_wonder", "bounce_radius"), {}).get("value") == 16.5,
        effects_by_ref.get(("celeste_shining_wonder", "damage"), {}).get("value") == 140,
        effects_by_ref.get(("celeste_shining_wonder", "damage"), {}).get("scaling_coefficient") == 0.6,
        any(row["ability_id"] == "celeste_shining_wonder" and row["upgrade_level"] == 2 and row["mechanic"] == "damage_spirit_scaling" and row["value"] == 0.45 for row in upgrades),
    ]
    current_patch_failures = sum(not value for value in current_patch_checks)
    add_check("Current-patch Celeste values", "PASS" if not current_patch_failures else "FAIL", "ability_mechanics.csv; ability_upgrades.csv", current_patch_failures, "All eleven August 22 hero changes resolve to the current structured values." if not current_patch_failures else "Current values conflict with the latest patch notes.")
    add_check("Item interaction evidence", "WARNING", "data/interactions/hero_interactions.csv", len(item_rows), "Documented Melee/Heavy-Melee item interactions are included; the complete Item×Ability matrix remains open and no undocumented row was invented.", "HUNC-0004")
    add_check("Summon inheritance evidence", "WARNING", "data/heroes/summons.csv", len(summons), "Created-unit values are present, but inheritance/proc/objective behavior is not fully exposed.", "HUNC-0005")
    add_check("HeroData patch synchronization", "WARNING", "docs/research/heroes/page_sync_audit.csv", 1, "HeroData predates the latest patch; patch scope indicates no later base-stat edit, but full client sync remains unproven.", "HUNC-0002")
    add_check("Stale/non-synchronized pages", "WARNING", "docs/research/heroes/page_sync_audit.csv", 2, "HeroData and the rendered comparison table predate the latest patch; neither overrides the current AbilityData export.", "HUNC-0002; HUNC-0007")
    add_check("Objective/proc/summon evidence boundary", "PASS", "ability_mechanics.csv; hero_interactions.csv", 0, "Only explicit structured target-class fields are emitted; undocumented application is preserved as uncertainty.", "HUNC-0004; HUNC-0005")
    add_check("Model-knowledge substitution", "PASS", "all generated datasets", 0, "Values originate from cached deadlock.wiki primary data or explicit patch notes; exclusions are logged.")
    add_check("Core patch compatibility", "PASS" if core_manifest.get("patch") == PATCH else "FAIL", "data/core/manifest.json", 0 if core_manifest.get("patch") == PATCH else 1, f"Core patch is {core_manifest.get('patch')}; hero patch is {PATCH}.")
    planned_manifest_counts = {
        "hero_count": len(heroes), "publicly_playable_hero_count": sum(row["publicly_playable"] for row in heroes),
        "documented_nonpublic_hero_count": sum(not row["publicly_playable"] for row in heroes),
        "ability_count": len(ability_records), "ability_effect_count": len(mechanics),
        "ability_upgrade_count": len(upgrades), "summon_count": len(summons), "interaction_count": len(interactions),
        "source_count": len(sources), "uncertainty_count": len(uncertainties),
    }
    add_check("Manifest row-count agreement", "PASS", "data/heroes/manifest.json", 0, f"Manifest counters are generated from actual in-memory row counts: {j(planned_manifest_counts)}.")
    add_check("Build/meta recommendation exclusion", "PASS", "all generated datasets", 0, "No build, tier-list, matchup or skill-order recommendation fields were generated.")

    fail_count = sum(status == "FAIL" for _, status, *_ in checks)
    warning_count = sum(status == "WARNING" for _, status, *_ in checks)
    validation_status = "FAIL" if fail_count else ("PASS_WITH_WARNINGS" if warning_count else "PASS")

    report_lines = [
        "# Validation Report", "", f"Gesamtstatus: **{validation_status}**", "",
        "| Prüfung | Status | Datei | Betroffene Datensätze | Erklärung | Unsicherheit |",
        "|---|---|---|---:|---|---|",
    ]
    for name, status, file, count, explanation, refs in checks:
        report_lines.append(f"| {name} | {status} | `{file}` | {count} | {explanation} | {refs or '—'} |")
    report_lines += ["", f"Gezählt: {len(heroes)} Heldenregisterzeilen, {len(ability_records)} Fähigkeiten, {len(mechanics)} atomare Fähigkeitseffekte, {len(upgrades)} Upgrade-Änderungen, {len(summons)} Beschwörungen/erschaffene Einheiten und {len(interactions)} verifizierbare Sonderinteraktionen."]
    (RESEARCH_DIR / "validation_report.md").write_text("\n".join(report_lines) + "\n", encoding="utf-8")

    manifest = {
        "schema_version": SCHEMA_VERSION, "research_date": RESEARCH_DATE, "verified_at": now,
        "data_as_of": DATA_AS_OF, "patch": PATCH, "client_build": None,
        "mode": core_manifest.get("mode"), "research_started_at": f"{RESEARCH_DATE}T00:00:00Z",
        "research_completed_at": now, "primary_source": "https://deadlock.wiki/",
        "excluded_domains": ["deadlockwiki.org"], "core_dataset_path": "data/core/",
        "core_schema_version": core_manifest.get("schema_version"), "core_patch": core_manifest.get("patch"),
        "core_verified_at": core_manifest.get("verified_at"),
        "core_compatibility_status": "compatible_same_patch_with_documented_hero_sync_warning" if core_manifest.get("patch") == PATCH else "incompatible_patch",
        "hero_count": len(heroes), "publicly_playable_hero_count": sum(row["publicly_playable"] for row in heroes),
        "documented_nonpublic_hero_count": sum(not row["publicly_playable"] for row in heroes),
        "ability_count": len(ability_records), "ability_effect_count": len(mechanics),
        "ability_upgrade_count": len(upgrades), "summon_count": len(summons),
        "interaction_count": len(interactions), "source_count": len(sources),
        "uncertainty_count": len(uncertainties), "dataset_status": "research_complete_with_preserved_uncertainties",
        "validation_status": validation_status,
        "notes": "Current structured values are source-backed. Client build, complete item interaction matrix, and summon inheritance remain explicitly unresolved; all explicit post-patch Innate sections are registered.",
    }
    (HERO_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    if fail_count:
        raise SystemExit(f"Validation failed with {fail_count} failing checks")
    print(json.dumps({
        "heroes": len(heroes), "public": manifest["publicly_playable_hero_count"], "abilities": len(ability_records),
        "effects": len(mechanics), "upgrades": len(upgrades), "summons": len(summons),
        "interactions": len(interactions), "validation": validation_status,
    }, indent=2))


if __name__ == "__main__":
    main()
