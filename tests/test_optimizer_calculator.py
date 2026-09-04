from __future__ import annotations

import unittest
from decimal import Decimal
from pathlib import Path

from optimizer import BuildCalculator, BuildRequest, DataRepository, EffectSelection, TargetProfile


ROOT = Path(__file__).resolve().parents[1]

SCREENSHOT_ITEMS = (
    "upgrade_close_quarter_combat",
    "upgrade_titan_round",
    "upgrade_active_reload",
    "upgrade_hollow_point_rounds",
    "upgrade_critshot",
    "upgrade_fervor",
    "upgrade_regenerating_bullet_shield",
    "upgrade_cardio_calibrator",
    "upgrade_bullet_resist_shredder",
    "upgrade_bullet_armor_reduction_aura",
    "upgrade_debuff_reducer",
    "upgrade_tech_overflow",
)


class CalculatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.repo = DataRepository.from_project(ROOT)
        cls.calculator = BuildCalculator(cls.repo)

    def test_manifest_patch_and_mode_are_compatible(self) -> None:
        self.assertEqual(self.repo.core_manifest["patch"], self.repo.hero_manifest["patch"])
        self.assertEqual(self.repo.core_manifest["mode"], self.repo.hero_manifest["mode"])
        self.assertEqual(
            self.repo.core_manifest["schema_version"],
            self.repo.hero_manifest["core_schema_version"],
        )
        self.assertTrue(
            self.repo.hero_manifest["core_compatibility_status"].startswith("compatible")
        )

    def test_validation_status_reflects_visible_warnings(self) -> None:
        clean = self.calculator.calculate(BuildRequest("warden", 10, ("upgrade_health",)))
        warned = self.calculator.calculate(
            BuildRequest("warden", 10, ("upgrade_close_quarter_combat",))
        )
        self.assertEqual(clean.validation_status, "PASS")
        self.assertEqual(warned.validation_status, "PASS_WITH_WARNINGS")

    def test_slot_limit_requires_three_walkers_for_twelve_items(self) -> None:
        with self.assertRaisesRegex(ValueError, "12 Slots"):
            self.calculator.calculate(
                BuildRequest("warden", 35, SCREENSHOT_ITEMS, walker_slots=0)
            )

    def test_warden_screenshot_static_stats(self) -> None:
        # The reference panel excludes known proc/health-threshold effects. These
        # overrides are explicit because the canonical CSV currently labels some
        # of them as always equipped even though their tooltip says otherwise.
        inactive = frozenset(
            {
                "upgrade_active_reload::eff_bonus_move_speed",
                "upgrade_active_reload::eff_bullet_lifesteal_percent",
                "upgrade_fervor::eff_bullet_lifesteal_percent",
                "upgrade_hollow_point_rounds::eff_base_attack_damage_percent",
                "upgrade_regenerating_bullet_shield::eff_base_attack_damage_percent",
                # The supplied stats-panel reference reports the charged Spirit
                # bonus, but omits these two Overflow values. Keep that observed
                # UI state explicit instead of baking it into global rules.
                "upgrade_tech_overflow::eff_tech_power",
                "upgrade_tech_overflow::eff_bonus_fire_rate",
            }
        )
        result = self.calculator.calculate(
            BuildRequest(
                "warden",
                35,
                SCREENSHOT_ITEMS,
                walker_slots=3,
                effects=EffectSelection(inactive=inactive),
            )
        )
        self.assertEqual(result.stats["max_health"], Decimal("4648.90"))
        self.assertEqual(result.stats["ammo"], 43)
        self.assertEqual(result.stats["weapon_damage_percent"], Decimal("138"))
        self.assertEqual(result.stats["out_of_combat_health_regen"], Decimal("9.5"))
        self.assertEqual(result.stats["move_speed"], Decimal("8.3"))
        self.assertEqual(result.stats["bullet_resist_percent"], Decimal("25.3800"))
        self.assertEqual(result.stats["melee_resist_percent"], Decimal("47.766000"))
        self.assertEqual(result.stats["reload_time"], Decimal("2.914"))
        self.assertEqual(result.stats["spirit_power"], Decimal("89.5"))
        self.assertEqual(result.stats["fire_rate_percent"], Decimal("69.375"))
        self.assertAlmostEqual(float(result.stats["bullets_per_second"]), 6.45, places=2)
        self.assertAlmostEqual(float(result.stats["dps"]), 417, delta=1)
        self.assertAlmostEqual(float(result.abilities["warden_alchemical_flask"]["damage"]), 116, delta=1)
        self.assertAlmostEqual(float(result.abilities["warden_willpower"]["combat_barrier"]), 197, delta=1)
        self.assertAlmostEqual(float(result.abilities["warden_binding_word"]["damage"]), 328, delta=1)
        self.assertAlmostEqual(float(result.abilities["warden_last_stand"]["pulse_dps"]), 186, delta=1)

    def test_conditional_effect_requires_explicit_activation(self) -> None:
        item = "upgrade_close_quarter_combat"
        base = self.calculator.calculate(BuildRequest("warden", 35, (item,)))
        active = self.calculator.calculate(
            BuildRequest(
                "warden",
                35,
                (item,),
                effects=EffectSelection(
                    active=frozenset({f"{item}::eff_close_range_bonus_weapon_power"})
                ),
            )
        )
        self.assertEqual(active.stats["weapon_damage_percent"] - base.stats["weapon_damage_percent"], Decimal("50"))

    def test_unresolved_downside_is_visible_and_applies_when_activated(self) -> None:
        item = "upgrade_glass_cannon"
        base = self.calculator.calculate(BuildRequest("warden", 35, (item,)))
        downside_ref = f"{item}::eff_max_health_loss_percent"
        self.assertIn(downside_ref, base.unresolved_downsides)
        active = self.calculator.calculate(
            BuildRequest(
                "warden",
                35,
                (item,),
                effects=EffectSelection(active=frozenset({downside_ref})),
            )
        )
        self.assertEqual(active.stats["max_health"], base.stats["max_health"] * Decimal("0.87"))
        self.assertNotIn(downside_ref, active.unresolved_downsides)

    def test_self_downside_detection_does_not_confuse_enemy_penalties(self) -> None:
        inhibitor = self.calculator.calculate(
            BuildRequest("warden", 10, ("upgrade_inhibitor",))
        )
        blood_tribute = self.calculator.calculate(
            BuildRequest("warden", 10, ("upgrade_blood_tribute",))
        )
        glitch = self.calculator.calculate(
            BuildRequest("warden", 10, ("upgrade_glitch",))
        )
        self.assertNotIn(
            "upgrade_inhibitor::eff_outgoing_damage_penalty_percent",
            inhibitor.unresolved_downsides,
        )
        self.assertIn(
            "upgrade_blood_tribute::eff_health_drained_per_second",
            blood_tribute.unresolved_downsides,
        )
        self.assertIn(
            "upgrade_glitch::eff_outgoing_damage_penalty_percent",
            glitch.unresolved_downsides,
        )

    def test_target_resistance_and_activated_shred_are_kept_separate(self) -> None:
        target = TargetProfile(bullet_resist_percent=Decimal("30"))
        baseline = self.calculator.calculate(
            BuildRequest("warden", 35, (), target_profile=target)
        )
        self.assertEqual(
            baseline.stats["effective_bullet_dps"],
            baseline.stats["dps"] * Decimal("0.70"),
        )
        item = "upgrade_banshee_slugs"
        active = self.calculator.calculate(
            BuildRequest(
                "warden",
                35,
                (item,),
                effects=EffectSelection(
                    active=frozenset({f"{item}::eff_bullet_resist_reduction"})
                ),
                target_profile=target,
            )
        )
        self.assertEqual(active.stats["target_bullet_resist_reduction_percent"], Decimal("16"))
        self.assertEqual(active.stats["final_target_bullet_resist_percent"], Decimal("14"))

    def test_activated_mercurial_magic_bullets_respect_spirit_resist(self) -> None:
        item = "upgrade_ethereal_bullets"
        refs = {
            f"{item}::eff_bullets_bonus_magic_damage",
            f"{item}::eff_bullets_bonus_magic_damage_scaling",
        }
        result = self.calculator.calculate(
            BuildRequest(
                "warden",
                35,
                (item,),
                effects=EffectSelection(active=frozenset(refs)),
                target_profile=TargetProfile(spirit_resist_percent=Decimal("20")),
            )
        )
        self.assertGreater(result.stats["bonus_spirit_damage_per_bullet"], Decimal("25"))
        self.assertEqual(
            result.stats["effective_spirit_bullet_dps"],
            result.stats["spirit_bullet_dps"] * Decimal("0.80"),
        )

    def test_activated_spellslinger_reload_modifier_affects_sustained_dps(self) -> None:
        item = "upgrade_enchanted_holsters"
        base = self.calculator.calculate(BuildRequest("warden", 35, (item,)))
        active = self.calculator.calculate(
            BuildRequest(
                "warden",
                35,
                (item,),
                effects=EffectSelection(
                    active=frozenset({f"{item}::eff_reload_speed_multipler"})
                ),
            )
        )
        self.assertEqual(active.stats["reload_time"], base.stats["reload_time"] * Decimal("0.90"))
        self.assertGreater(active.stats["sustained_dps"], base.stats["sustained_dps"])

    def test_item_range_radius_and_charges_apply_to_eligible_abilities(self) -> None:
        base_warden = self.calculator.calculate(BuildRequest("warden", 10, ()))
        ranged_warden = self.calculator.calculate(
            BuildRequest("warden", 10, ("upgrade_magic_reach",))
        )
        self.assertEqual(
            ranged_warden.abilities["warden_binding_word"]["ability_cast_range"],
            base_warden.abilities["warden_binding_word"]["ability_cast_range"]
            * Decimal("1.20"),
        )
        self.assertEqual(
            ranged_warden.abilities["warden_alchemical_flask"]["radius"],
            base_warden.abilities["warden_alchemical_flask"]["radius"]
            * Decimal("1.20"),
        )
        charged = self.calculator.calculate(
            BuildRequest("grey_talon", 10, ("upgrade_extra_charge",))
        )
        ability = charged.abilities["grey_talon_charged_shot"]
        self.assertEqual(ability["ability_charges_before_items"], Decimal("1"))
        self.assertEqual(ability["ability_charges"], Decimal("2"))

    def test_component_and_upgrade_cannot_occupy_two_slots(self) -> None:
        with self.assertRaisesRegex(ValueError, "Komponente und Upgrade"):
            self.calculator.calculate(
                BuildRequest(
                    "warden",
                    10,
                    ("upgrade_close_range", "upgrade_close_quarter_combat"),
                )
            )

    def test_all_public_heroes_calculate_at_max_boon(self) -> None:
        public_heroes = [
            hero_id
            for hero_id, row in self.repo.heroes.items()
            if row["publicly_playable"] == "true"
        ]
        self.assertEqual(len(public_heroes), 38)
        for hero_id in public_heroes:
            with self.subTest(hero_id=hero_id):
                result = self.calculator.calculate(BuildRequest(hero_id, 35, ()))
                self.assertGreater(result.stats["max_health"], 0)
                self.assertGreater(result.stats["bullet_damage"], 0)

    def test_innate_and_level_scaled_hero_resists_are_included(self) -> None:
        bebop = self.calculator.calculate(BuildRequest("bebop", 35, ()))
        lash = self.calculator.calculate(BuildRequest("lash", 35, ()))
        pocket = self.calculator.calculate(BuildRequest("pocket", 35, ()))
        self.assertEqual(bebop.stats["bullet_resist_percent"], Decimal("10.5"))
        self.assertEqual(lash.stats["spirit_resist_percent"], Decimal("10"))
        self.assertEqual(pocket.stats["spirit_resist_percent"], Decimal("-15"))

    def test_maxed_warden_ability_upgrades_are_applied(self) -> None:
        levels = {
            ability_id: 3
            for ability_id, row in self.repo.abilities.items()
            if row["hero_id"] == "warden"
        }
        result = self.calculator.calculate(
            BuildRequest("warden", 35, (), ability_levels=levels)
        )
        self.assertEqual(result.abilities["warden_alchemical_flask"]["ability_cooldown"], Decimal("5"))
        self.assertEqual(result.abilities["warden_willpower"]["ability_cooldown"], Decimal("16"))
        self.assertEqual(result.abilities["warden_binding_word"]["ability_cooldown"], Decimal("20"))
        self.assertEqual(result.abilities["warden_last_stand"]["ability_cooldown"], Decimal("150"))
        self.assertEqual(result.abilities["warden_last_stand"]["bullet_resist"], Decimal("80"))

    def test_invalid_effect_and_ability_scenarios_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "besessenen Items"):
            self.calculator.calculate(
                BuildRequest(
                    "warden",
                    10,
                    (),
                    effects=EffectSelection(active=frozenset({"missing::effect"})),
                )
            )
        with self.assertRaisesRegex(ValueError, "gewählten Helden"):
            self.calculator.calculate(
                BuildRequest("warden", 10, (), ability_levels={"abrams_siphon_life": 1})
            )
        with self.assertRaisesRegex(ValueError, "zwischen 0 und 3"):
            self.calculator.calculate(
                BuildRequest("warden", 10, (), ability_levels={"warden_binding_word": 4})
            )

    def test_unhandled_permanent_effects_are_reported(self) -> None:
        result = self.calculator.calculate(
            BuildRequest("warden", 10, ("upgrade_magic_carpet",))
        )
        self.assertTrue(result.unhandled_effects)
        self.assertTrue(any("noch nicht verrechnet" in warning for warning in result.warnings))

    def test_bullet_speed_and_stamina_recovery_modifiers_are_applied(self) -> None:
        fast_bullets = self.calculator.calculate(
            BuildRequest("warden", 10, ("upgrade_high_velocity_mag",))
        )
        self.assertEqual(fast_bullets.stats["bullet_speed"], Decimal("464.0"))
        stamina = self.calculator.calculate(
            BuildRequest("warden", 10, ("upgrade_improved_stamina",))
        )
        self.assertEqual(stamina.stats["stamina"], Decimal("4"))
        self.assertAlmostEqual(float(stamina.stats["stamina_cooldown"]), 3.96, places=2)

    def test_api_condition_hints_are_warnings_not_silent_overrides(self) -> None:
        result = self.calculator.calculate(
            BuildRequest("warden", 10, ("upgrade_active_reload",))
        )
        ref = "upgrade_active_reload::eff_bonus_fire_rate"
        self.assertIn(ref, result.included_effects)
        self.assertIn(ref, result.audit_flags)
        self.assertTrue(any("Audit-Hinweis" in warning for warning in result.warnings))


if __name__ == "__main__":
    unittest.main()
