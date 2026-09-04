from __future__ import annotations

from collections import defaultdict
from decimal import Decimal, ROUND_CEILING

from .data_loader import DataRepository
from .audit import ConditionAuditor
from .models import BuildRequest, CalculationResult, Effect, TargetProfile


D = Decimal

CALCULATED_ITEM_MECHANICS = {
    "bonus_health",
    "max_health_loss_percent",
    "bonus_health_regen",
    "out_of_combat_health_regen",
    "tech_power",
    "spirit_power",
    "bonus_spirit",
    "base_attack_damage_percent",
    "weapon_damage_percent",
    "close_range_bonus_weapon_power",
    "bonus_fire_rate",
    "activated_fire_rate",
    "fervor_fire_rate",
    "bonus_clip_size_percent",
    "bonus_clip_size",
    "bullet_resist",
    "tech_resist",
    "spirit_resist",
    "melee_resist_percent",
    "status_resistance_percent",
    "fervor_status_resistance_percent",
    "slow_resistance_percent",
    "bullet_lifesteal_percent",
    "ability_lifesteal_percent_hero",
    "bonus_spirit_lifesteal",
    "bonus_move_speed",
    "bonus_sprint_speed",
    "stamina",
    "cooldown_reduction",
    "bonus_ability_duration_percent",
    "tech_range_multiplier",
    "tech_radius_multiplier",
    "bonus_bullet_speed_percent",
    "bonus_attack_range_percent",
    "bonus_melee_damage_percent",
    "bonus_heavy_melee_damage",
    "stamina_cooldown_reduction",
    "bonus_ability_charges",
    "ground_dash_reduction_percent",
    "item_cooldown_reduction",
    "bullet_resist_reduction",
    "magic_resist_reduction",
    "bullets_bonus_magic_damage",
    "bullets_bonus_magic_damage_scaling",
    "reload_speed_multipler",
}

# These canonical mechanic names describe a cost paid by the owner. If such an
# effect is excluded from the current condition scenario, a search must not act
# as if the upside were free. This classifies semantics, never invents a value.
SELF_DOWNSIDE_MECHANICS = {
    "max_health_loss_percent",
    "active_move_speed_penalty",
    "health_drained_per_second",
}


def _is_unresolved_self_downside(effect: Effect) -> bool:
    if effect.number is None:
        return False
    if effect.mechanic in SELF_DOWNSIDE_MECHANICS:
        return True
    if effect.mechanic == "outgoing_damage_penalty_percent":
        condition = effect.condition.lower()
        return effect.target_scope.startswith("Self") or "your own" in condition
    return False


def _multiplicative(values: list[Decimal]) -> Decimal:
    remaining = D(1)
    for value in values:
        remaining *= D(1) - value / D(100)
    return (D(1) - remaining) * D(100)


class BuildCalculator:
    def __init__(self, repository: DataRepository):
        self.repo = repository
        self.condition_auditor = ConditionAuditor(repository)

    def calculate(self, request: BuildRequest) -> CalculationResult:
        warnings = self._validate(request)
        items = [self.repo.items[item_id] for item_id in request.item_ids]
        investments = {category: 0 for category in ("Weapon", "Vitality", "Spirit")}
        for item in items:
            investments[item.category] += item.total_cost
        investment_bonuses = {
            category: self._investment_bonus(category, amount)
            for category, amount in investments.items()
        }

        included, excluded = self._select_effects(request)
        sums: dict[str, Decimal] = defaultdict(Decimal)
        groups: dict[str, list[Decimal]] = defaultdict(list)
        for effect in included:
            value = effect.number
            if value is None:
                continue
            sums[effect.mechanic] += value
            groups[effect.mechanic].append(value)

        hero = self._hero_values(request.hero_id, request.boon_level)
        stats = self._calculate_stats(
            hero, sums, groups, investment_bonuses, request.target_profile
        )
        abilities = self._calculate_abilities(request, stats)
        audit_flags = self.condition_auditor.inspect(request.item_ids)
        unresolved_downsides = [
            effect.ref
            for effect in excluded
            if _is_unresolved_self_downside(effect)
        ]
        unhandled = [
            effect.ref
            for effect in included
            if effect.number is not None and effect.mechanic not in CALCULATED_ITEM_MECHANICS
        ]

        if excluded:
            warnings.append(
                f"{len(excluded)} bedingte Effekte sind im Grundzustand nicht eingerechnet."
            )
        if unhandled:
            warnings.append(
                f"{len(unhandled)} permanente numerische Effekte werden von dieser Calculator-Version noch nicht verrechnet."
            )
        if unresolved_downsides:
            warnings.append(
                f"{len(unresolved_downsides)} möglicher Item-Nachteil ist im gewählten Szenario nicht eingerechnet."
            )
        warnings.extend(flag.message for flag in audit_flags)
        effect_by_ref = {
            effect.ref: effect
            for item_id in request.item_ids
            for effect in self.repo.effects.get(item_id, [])
        }
        for ref in request.effects.inactive:
            effect = effect_by_ref.get(ref)
            if effect and effect.is_unconditional:
                warnings.append(
                    f"Szenario deaktiviert {ref}, obwohl die kanonische Zeile den Effekt als permanent markiert."
                )
        for ref in request.effects.active:
            effect = effect_by_ref.get(ref)
            if effect and not effect.is_unconditional:
                warnings.append(f"Szenario aktiviert den bedingten Effekt {ref}.")
        for effect in included:
            if effect.confidence != "high":
                warnings.append(f"{effect.ref} hat Konfidenz {effect.confidence}.")

        return CalculationResult(
            hero_id=request.hero_id,
            boon_level=request.boon_level,
            item_ids=request.item_ids,
            patch=self.repo.core_manifest["patch"],
            mode=self.repo.core_manifest["mode"],
            validation_status="PASS_WITH_WARNINGS" if warnings else "PASS",
            total_cost=sum(item.total_cost for item in items),
            investments=investments,
            investment_bonuses=investment_bonuses,
            stats=stats,
            abilities=abilities,
            target_profile={
                "bullet_resist_percent": request.target_profile.bullet_resist_percent,
                "spirit_resist_percent": request.target_profile.spirit_resist_percent,
            },
            included_effects=[effect.ref for effect in included],
            excluded_conditional_effects=[effect.ref for effect in excluded],
            unresolved_downsides=unresolved_downsides,
            unhandled_effects=unhandled,
            audit_flags=[flag.effect_ref for flag in audit_flags],
            warnings=sorted(set(warnings)),
        )

    def _validate(self, request: BuildRequest) -> list[str]:
        if request.hero_id not in self.repo.heroes:
            raise ValueError(f"Unbekannter Held: {request.hero_id}")
        level_range = self.repo.progression["level_range"]
        if not level_range["min"] <= request.boon_level <= level_range["max"]:
            raise ValueError("Boon-Level liegt außerhalb des verifizierten Bereichs")
        if len(set(request.item_ids)) != len(request.item_ids):
            raise ValueError("Ein Build darf dasselbe Item nicht doppelt enthalten")
        if not 0 <= request.walker_slots <= 3:
            raise ValueError("walker_slots muss zwischen 0 und 3 liegen")
        unknown = [item_id for item_id in request.item_ids if item_id not in self.repo.items]
        if unknown:
            raise ValueError(f"Unbekannte Item-IDs: {', '.join(unknown)}")
        if any(not self.repo.items[item_id].public for item_id in request.item_ids):
            raise ValueError("Der Build enthält ein nicht öffentliches Shop-Item")
        owned = set(request.item_ids)
        conflicts = [
            (edge["from_item_id"], edge["to_item_id"])
            for edge in self.repo.upgrade_edges
            if edge["from_item_id"] in owned and edge["to_item_id"] in owned
        ]
        if conflicts:
            pair = " -> ".join(conflicts[0])
            raise ValueError(f"Komponente und Upgrade dürfen nicht gleichzeitig belegt sein: {pair}")
        capacity = self.repo.slots["starting_slots"]["universal"] + min(request.walker_slots, 3)
        if len(request.item_ids) > capacity:
            raise ValueError(f"Build benötigt {len(request.item_ids)} Slots, verfügbar sind {capacity}")
        active_count = sum(bool(self.repo.items[item_id].active_type) for item_id in request.item_ids)
        if active_count > self.repo.slots["active_item_limit"]:
            raise ValueError("Active-Item-Limit überschritten")
        warnings: list[str] = []
        owned_effect_refs = {
            effect.ref
            for item_id in request.item_ids
            for effect in self.repo.effects.get(item_id, [])
        }
        selected_refs = request.effects.active | request.effects.inactive
        unknown_refs = selected_refs - owned_effect_refs
        if unknown_refs:
            raise ValueError(
                "Effektszenario verweist nicht auf einen Effekt der besessenen Items: "
                + ", ".join(sorted(unknown_refs))
            )
        overlap = request.effects.active & request.effects.inactive
        if overlap:
            raise ValueError(
                "Effekt kann nicht zugleich aktiv und inaktiv sein: " + ", ".join(sorted(overlap))
            )
        hero_ability_ids = {
            ability_id
            for ability_id, row in self.repo.abilities.items()
            if row["hero_id"] == request.hero_id
        }
        foreign_abilities = set(request.ability_levels) - hero_ability_ids
        if foreign_abilities:
            raise ValueError(
                "Fähigkeit gehört nicht zum gewählten Helden: "
                + ", ".join(sorted(foreign_abilities))
            )
        max_level = int(self.repo.progression["maximum_ability_upgrade_level"])
        if any(level < 0 or level > max_level for level in request.ability_levels.values()):
            raise ValueError(f"Fähigkeitslevel muss zwischen 0 und {max_level} liegen")
        purchased_upgrades = {
            row["upgrade_id"]: int(row["ability_point_cost"])
            for row in self.repo.ability_upgrades
            if row["ability_id"] in hero_ability_ids
            and int(row["upgrade_level"]) <= request.ability_levels.get(row["ability_id"], 0)
        }
        if sum(purchased_upgrades.values()) > int(self.repo.progression["ability_points"]["maximum"]):
            raise ValueError("Maximale Zahl der Fähigkeitspunkte überschritten")
        return warnings

    def _investment_bonus(self, category: str, amount: int) -> Decimal:
        key = {"Weapon": "weapon", "Vitality": "vitality", "Spirit": "spirit"}[category]
        capped = min(amount, int(self.repo.economy["investments"]["maximum_counted_investment"]))
        result = D(0)
        for threshold in self.repo.economy["investment_thresholds"]:
            if capped >= int(threshold["category_investment"]):
                result = D(str(threshold["bonuses"][key]["cumulative_bonus"]))
        return result

    def _select_effects(self, request: BuildRequest) -> tuple[list[Effect], list[Effect]]:
        included: list[Effect] = []
        excluded: list[Effect] = []
        for item_id in request.item_ids:
            for effect in self.repo.effects.get(item_id, []):
                if effect.ref in request.effects.inactive:
                    excluded.append(effect)
                elif effect.is_unconditional or effect.ref in request.effects.active:
                    included.append(effect)
                else:
                    excluded.append(effect)
        return included, excluded

    def _hero_values(self, hero_id: str, boon: int) -> dict[str, Decimal | str]:
        values: dict[str, Decimal | str] = {}
        for stat in self.repo.hero_stats[hero_id]:
            value = stat.at_boon(boon)
            if value is not None:
                values[stat.mechanic] = value
        return values

    @staticmethod
    def _number(values: dict[str, Decimal | str], key: str) -> Decimal:
        value = values.get(key, D(0))
        return value if isinstance(value, Decimal) else D(0)

    def _calculate_stats(
        self,
        hero: dict[str, Decimal | str],
        sums: dict[str, Decimal],
        groups: dict[str, list[Decimal]],
        bonuses: dict[str, Decimal],
        target_profile: TargetProfile,
    ) -> dict[str, Decimal | str | int]:
        base_health = self._number(hero, "max_health")
        max_health = base_health * (D(1) + bonuses["Vitality"] / D(100)) + sums["bonus_health"]
        max_health *= D(1) + sums["max_health_loss_percent"] / D(100)

        spirit_power = self._number(hero, "tech_power") + bonuses["Spirit"]
        spirit_power += sums["tech_power"] + sums["spirit_power"] + sums["bonus_spirit"]

        weapon_percent = bonuses["Weapon"] + sums["base_attack_damage_percent"]
        weapon_percent += sums["weapon_damage_percent"] + sums["close_range_bonus_weapon_power"]
        bullet_damage = self._number(hero, "bullet_damage") * (D(1) + weapon_percent / D(100))

        fire_rate_percent = sums["bonus_fire_rate"] + sums["activated_fire_rate"] + sums["fervor_fire_rate"]
        fire_rate_percent += spirit_power * self._number(hero, "fire_rate_spirit_scaling")
        bullets_per_second = self._number(hero, "rounds_per_second") * (D(1) + fire_rate_percent / D(100))

        clip_percent = sums["bonus_clip_size_percent"]
        ammo = ((self._number(hero, "clip_size") + sums["bonus_clip_size"]) * (D(1) + clip_percent / D(100)))
        ammo = ammo.to_integral_value(rounding=ROUND_CEILING)

        innate_bullet_resist = self._number(hero, "bullet_resist")
        innate_bullet_resist += spirit_power * self._number(
            hero, "bullet_resist_spirit_scaling"
        )
        innate_spirit_resist = self._number(hero, "tech_resist")
        innate_spirit_resist += spirit_power * self._number(
            hero, "tech_resist_spirit_scaling"
        )
        bullet_resist = _multiplicative(
            [innate_bullet_resist] + groups["bullet_resist"]
        )
        spirit_resist = _multiplicative(
            [innate_spirit_resist] + groups["tech_resist"] + groups["spirit_resist"]
        )
        melee_only_resist = _multiplicative(
            [self._number(hero, "melee_resist")] + groups["melee_resist_percent"]
        )
        # Melee damage is reduced by Bullet Resist and then by the additional
        # melee-only resistance (RES-001). The combined value matches the
        # effective Melee Resist displayed by the game stats panel.
        melee_resist = _multiplicative([bullet_resist, melee_only_resist])
        status_resist = _multiplicative(
            [self._number(hero, "debuff_resist")]
            + groups["status_resistance_percent"]
            + groups["fervor_status_resistance_percent"]
        )
        bullet_lifesteal = _multiplicative(groups["bullet_lifesteal_percent"])
        spirit_lifesteal = _multiplicative(groups["ability_lifesteal_percent_hero"] + groups["bonus_spirit_lifesteal"])

        melee_multiplier = D(1) + weapon_percent / D(200)
        melee_multiplier *= D(1) + sums["bonus_melee_damage_percent"] / D(100)
        light_melee = self._number(hero, "light_melee_damage") * melee_multiplier
        heavy_melee = self._number(hero, "heavy_melee_damage") * melee_multiplier
        heavy_melee *= D(1) + sums["bonus_heavy_melee_damage"] / D(100)
        move_speed = self._number(hero, "max_move_speed") + sums["bonus_move_speed"]
        sprint_bonus = self._number(hero, "sprint_speed") + sums["bonus_sprint_speed"]
        dps = bullet_damage * bullets_per_second * max(self._number(hero, "bullets_per_shot"), D(1))
        reload_time = self._number(hero, "reload_time") * (
            D(1) + sums["reload_speed_multipler"] / D(100)
        )
        magazine_duration = ammo / bullets_per_second if bullets_per_second > 0 else D(0)
        sustained_dps = (
            dps * magazine_duration / (magazine_duration + reload_time)
            if magazine_duration + reload_time > 0
            else D(0)
        )
        bullet_shred = _multiplicative([abs(value) for value in groups["bullet_resist_reduction"]])
        spirit_shred = _multiplicative([abs(value) for value in groups["magic_resist_reduction"]])
        final_target_bullet_resist = target_profile.bullet_resist_percent - bullet_shred
        final_target_spirit_resist = target_profile.spirit_resist_percent - spirit_shred
        bullet_damage_multiplier = D(1) - final_target_bullet_resist / D(100)
        spirit_damage_multiplier = D(1) - final_target_spirit_resist / D(100)
        bullets_per_shot = max(self._number(hero, "bullets_per_shot"), D(1))
        bonus_spirit_per_bullet = sums["bullets_bonus_magic_damage"]
        bonus_spirit_per_bullet += sums["bullets_bonus_magic_damage_scaling"] * spirit_power
        spirit_bullet_dps = bonus_spirit_per_bullet * bullets_per_second * bullets_per_shot
        effective_bullet_dps = dps * bullet_damage_multiplier
        effective_spirit_bullet_dps = spirit_bullet_dps * spirit_damage_multiplier
        effective_total_dps = effective_bullet_dps + effective_spirit_bullet_dps
        magazine_uptime = (
            magazine_duration / (magazine_duration + reload_time)
            if magazine_duration + reload_time > 0
            else D(0)
        )
        effective_sustained_dps = effective_total_dps * magazine_uptime
        attack_range_multiplier = D(1) + sums["bonus_attack_range_percent"] / D(100)
        bullet_speed = self._number(hero, "bullet_speed") * (
            D(1) + sums["bonus_bullet_speed_percent"] / D(100)
        )
        stamina_cooldown = self._number(hero, "stamina_cooldown") * (
            D(1) - sums["stamina_cooldown_reduction"] / D(100)
        )

        return {
            "base_max_health": base_health,
            "max_health": max_health,
            "health_regen": self._number(hero, "base_health_regen") + sums["bonus_health_regen"],
            "out_of_combat_health_regen": sums["out_of_combat_health_regen"],
            "weapon_damage_percent": weapon_percent,
            "bullet_damage": bullet_damage,
            "fire_rate_percent": fire_rate_percent,
            "bullets_per_second": bullets_per_second,
            "dps": dps,
            "magazine_duration": magazine_duration,
            "sustained_dps": sustained_dps,
            "target_bullet_resist_reduction_percent": bullet_shred,
            "target_spirit_resist_reduction_percent": spirit_shred,
            "final_target_bullet_resist_percent": final_target_bullet_resist,
            "final_target_spirit_resist_percent": final_target_spirit_resist,
            "bonus_spirit_damage_per_bullet": bonus_spirit_per_bullet,
            "spirit_bullet_dps": spirit_bullet_dps,
            "effective_bullet_dps": effective_bullet_dps,
            "effective_spirit_bullet_dps": effective_spirit_bullet_dps,
            "effective_total_dps": effective_total_dps,
            "effective_sustained_dps": effective_sustained_dps,
            "ammo": int(ammo),
            "clip_size_increase_percent": clip_percent,
            "reload_time": reload_time,
            "bullet_speed": bullet_speed,
            "falloff_start_range": self._number(hero, "falloff_start_range") * attack_range_multiplier,
            "falloff_end_range": self._number(hero, "falloff_end_range") * attack_range_multiplier,
            "light_melee_damage": light_melee,
            "heavy_melee_damage": heavy_melee,
            "bullet_resist_percent": bullet_resist,
            "spirit_resist_percent": spirit_resist,
            "melee_resist_percent": melee_resist,
            "melee_only_resist_percent": melee_only_resist,
            "status_resist_percent": status_resist,
            "slow_resist_percent": sums["slow_resistance_percent"],
            "bullet_lifesteal_percent": bullet_lifesteal,
            "spirit_lifesteal_percent": spirit_lifesteal,
            "move_speed": move_speed,
            "sprint_speed_bonus": sprint_bonus,
            "stamina": self._number(hero, "stamina") + sums["stamina"],
            "stamina_cooldown": stamina_cooldown,
            "ground_dash_modifier_percent": sums["ground_dash_reduction_percent"],
            "ability_cooldown_reduction_percent": _multiplicative(groups["cooldown_reduction"]),
            "item_cooldown_reduction_percent": sums["item_cooldown_reduction"],
            "ability_duration_percent": sums["bonus_ability_duration_percent"],
            "ability_range_percent": sums["tech_range_multiplier"],
            "ability_radius_percent": sums["tech_radius_multiplier"],
            "max_ability_charges_increase": sums["bonus_ability_charges"],
            "spirit_power": spirit_power,
            "boon_power_increases": self._number(hero, "power_increases"),
        }

    def _calculate_abilities(
        self, request: BuildRequest, stats: dict[str, Decimal | str | int]
    ) -> dict[str, dict[str, Decimal | str | int | None]]:
        spirit = D(str(stats["spirit_power"]))
        cdr = D(str(stats["ability_cooldown_reduction_percent"]))
        duration_bonus = D(str(stats["ability_duration_percent"]))
        range_bonus = D(str(stats["ability_range_percent"]))
        radius_bonus = D(str(stats["ability_radius_percent"]))
        charge_bonus = D(str(stats["max_ability_charges_increase"]))
        ability_ids = [
            ability_id
            for ability_id, row in self.repo.abilities.items()
            if row["hero_id"] == request.hero_id
        ]
        result: dict[str, dict[str, Decimal | str | int | None]] = {}
        for ability_id in ability_ids:
            level = request.ability_levels.get(ability_id, 0)
            effects = [row for row in self.repo.ability_effects if row["ability_id"] == ability_id]
            values: dict[str, Decimal | str] = {}
            scalings: dict[str, Decimal] = {}
            duration_mechanics: set[str] = set()
            range_mechanics: set[str] = set()
            radius_mechanics: set[str] = set()
            for row in effects:
                try:
                    values[row["mechanic"]] = D(row["value"])
                except (ValueError, ArithmeticError):
                    if row["value"]:
                        values[row["mechanic"]] = row["value"]
                if row["scaling_attribute"] == "spirit" and row["scaling_coefficient"]:
                    scalings[row["mechanic"]] = D(row["scaling_coefficient"])
                if row["scaling_attribute"] == "range":
                    range_mechanics.add(row["mechanic"])
                if row["scaling_attribute"] == "radius":
                    radius_mechanics.add(row["mechanic"])
                if row["duration"]:
                    duration_mechanics.add(row["mechanic"])
            upgrades = [
                row
                for row in self.repo.ability_upgrades
                if row["ability_id"] == ability_id and int(row["upgrade_level"]) <= level
            ]
            for row in upgrades:
                mechanic = row["mechanic"]
                try:
                    value = D(row["value"])
                except (ValueError, ArithmeticError):
                    continue
                if row["operation"] == "modify_scaling":
                    scalings[mechanic.removesuffix("_spirit_scaling")] = value
                elif row["operation"] in {"add", "subtract", "reduce_cooldown"}:
                    current = values.get(mechanic, D(0))
                    if isinstance(current, Decimal):
                        values[mechanic] = current + value
                elif row["operation"] == "unlock":
                    values[mechanic] = value
            for mechanic, coefficient in scalings.items():
                current = values.get(mechanic, D(0))
                if isinstance(current, Decimal):
                    values[mechanic] = current + coefficient * spirit
            if "ability_cooldown" in values and isinstance(values["ability_cooldown"], Decimal):
                values["ability_cooldown"] *= D(1) - cdr / D(100)
            for mechanic in duration_mechanics:
                if mechanic in values and isinstance(values[mechanic], Decimal):
                    values[mechanic] *= D(1) + duration_bonus / D(100)
            for mechanic in range_mechanics:
                if mechanic in values and isinstance(values[mechanic], Decimal):
                    values[mechanic] *= D(1) + range_bonus / D(100)
            for mechanic in radius_mechanics:
                if mechanic in values and isinstance(values[mechanic], Decimal):
                    values[mechanic] *= D(1) + radius_bonus / D(100)
            if "ability_charges" in values and isinstance(values["ability_charges"], Decimal):
                values["ability_charges_before_items"] = values["ability_charges"]
                values["ability_charges"] += charge_bonus
            values["upgrade_level"] = level
            result[ability_id] = values
        return result
