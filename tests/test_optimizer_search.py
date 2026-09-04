from __future__ import annotations

import unittest
from decimal import Decimal
from pathlib import Path

from engine import BuildCalculator, BuildRequest, DataRepository, EffectSelection
from engine.search import BuildSearch, ScoreProfile, SearchConstraints, SURVIVABILITY


ROOT = Path(__file__).resolve().parents[1]


class SearchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.search = BuildSearch(BuildCalculator(DataRepository.from_project(ROOT)))

    def test_candidate_pool_search_is_deterministic_and_budget_legal(self) -> None:
        candidates = [
            "upgrade_close_range",
            "upgrade_clip_size",
            "upgrade_rapid_rounds",
            "upgrade_health",
            "upgrade_sprint_booster",
        ]
        first = self.search.rank_pool("warden", 10, candidates, 3, 2400, limit=5)
        second = self.search.rank_pool("warden", 10, list(reversed(candidates)), 3, 2400, limit=5)
        self.assertEqual([entry.result.item_ids for entry in first], [entry.result.item_ids for entry in second])
        self.assertTrue(first)
        self.assertTrue(all(entry.result.total_cost <= 2400 for entry in first))

    def test_beam_search_reports_best_evaluated_scope(self) -> None:
        candidates = [
            "upgrade_close_range",
            "upgrade_clip_size",
            "upgrade_rapid_rounds",
            "upgrade_health",
            "upgrade_sprint_booster",
            "upgrade_improved_stamina",
        ]
        report = self.search.beam_search(
            "warden",
            10,
            budget=2400,
            item_count=3,
            candidate_item_ids=candidates,
            beam_width=4,
            limit=2,
        )
        self.assertEqual(report.result_label, "best_evaluated")
        self.assertEqual(report.candidate_count, len(candidates))
        self.assertGreater(report.evaluated_states, 0)
        self.assertGreater(report.path_evaluated_finalists, 0)
        self.assertEqual(len(report.results), 2)
        self.assertTrue(report.pareto_results)
        self.assertTrue(all(entry.result.total_cost <= 2400 for entry in report.results))

    def test_beam_search_keeps_budget_feasible_partial_builds(self) -> None:
        candidates = [
            "upgrade_close_range",
            "upgrade_clip_size",
            "upgrade_rapid_rounds",
            "upgrade_health",
            "upgrade_sprint_booster",
            "upgrade_improved_stamina",
            "upgrade_improved_spirit",
            "upgrade_magic_reach",
            "upgrade_magic_tempo",
            "upgrade_glass_cannon",
        ]
        report = self.search.beam_search(
            "warden",
            15,
            budget=4800,
            item_count=6,
            candidate_item_ids=candidates,
            beam_width=3,
            limit=2,
        )
        self.assertTrue(report.results)
        self.assertTrue(all(entry.result.total_cost <= 4800 for entry in report.results))

    def test_search_conservatively_deactivates_api_condition_mismatches(self) -> None:
        ranked = self.search.rank_pool(
            "warden",
            10,
            ["upgrade_active_reload"],
            item_count=1,
            budget=1600,
        )
        result = ranked[0].result
        self.assertEqual(result.stats["bullet_lifesteal_percent"], 0)
        self.assertIn("upgrade_active_reload::eff_bonus_fire_rate", result.audit_flags)

    def test_search_rejects_unresolved_owner_downside_by_default(self) -> None:
        ranked = self.search.rank_pool(
            "warden",
            35,
            ["upgrade_glass_cannon"],
            item_count=1,
            budget=6400,
        )
        self.assertEqual(ranked, [])
        theoretical = self.search.rank_pool(
            "warden",
            35,
            ["upgrade_glass_cannon"],
            item_count=1,
            budget=6400,
            constraints=SearchConstraints(reject_unresolved_downsides=False),
        )
        self.assertIn(
            "upgrade_glass_cannon::eff_max_health_loss_percent",
            theoretical[0].result.unresolved_downsides,
        )

    def test_ranked_build_contains_legal_upgrade_path_and_checkpoints(self) -> None:
        ranked = self.search.rank_pool(
            "warden",
            10,
            ["upgrade_close_quarter_combat", "upgrade_titan_round"],
            item_count=2,
            budget=4800,
            budget_checkpoints=(1600, 3200, 4800),
        )
        path = ranked[0].path_evaluation
        self.assertIsNotNone(path)
        assert path is not None
        self.assertEqual(path.path.total_spent, 4800)
        self.assertEqual(set(path.path.final_items), set(ranked[0].result.item_ids))
        self.assertEqual([point.budget for point in path.checkpoints], [1600, 3200, 4800])
        self.assertTrue(any(action.component_id for action in path.actions))
        self.assertTrue(any("UNC-0004" in warning for warning in path.warnings))
        self.assertEqual(ranked[0].validation_status, "PASS_WITH_WARNINGS")
        self.assertEqual(len(ranked[0].marginals), 2)
        self.assertTrue(
            all(
                marginal.component_gains.keys() == ranked[0].components.keys()
                for marginal in ranked[0].marginals
            )
        )

    def test_explicit_minimum_stats_are_hard_constraints(self) -> None:
        ranked = self.search.rank_pool(
            "warden",
            10,
            ["upgrade_close_range", "upgrade_health"],
            item_count=1,
            budget=800,
            constraints=SearchConstraints(
                minimum_stats=(("max_health", self.search.calculator.calculate(
                    BuildRequest("warden", 10, ())
                ).stats["max_health"] + 1),)
            ),
        )
        self.assertEqual([entry.result.item_ids for entry in ranked], [("upgrade_health",)])

    def test_search_scenario_can_activate_a_specific_proc(self) -> None:
        item = "upgrade_fervor"
        base = self.search.rank_pool("warden", 35, [item], 1, 6400)[0]
        proc = self.search.rank_pool(
            "warden",
            35,
            [item],
            1,
            6400,
            effects=EffectSelection(
                active=frozenset({f"{item}::eff_fervor_fire_rate"})
            ),
        )[0]
        self.assertGreater(proc.result.stats["fire_rate_percent"], base.result.stats["fire_rate_percent"])
        self.assertGreater(proc.score, base.score)

    def test_bullet_ehp_is_normalized_against_hero_baseline(self) -> None:
        baseline = self.search.calculator.calculate(BuildRequest("bebop", 35, ()))
        components = self.search._components(baseline, baseline)
        self.assertEqual(components["health_ratio"], 1)
        self.assertEqual(components["bullet_ehp_ratio"], 1)
        self.assertEqual(
            self.search._end_score(baseline, components, SURVIVABILITY), Decimal("1")
        )

    def test_invalid_search_scope_is_rejected_early(self) -> None:
        with self.assertRaisesRegex(ValueError, "item_count"):
            self.search.beam_search("warden", 10, budget=800, item_count=0)
        with self.assertRaisesRegex(ValueError, "Unbekannte Kandidaten"):
            self.search.rank_pool("warden", 10, ["not_an_item"], 1, 800)
        with self.assertRaisesRegex(ValueError, "Unbekannte Mindestwert-Stats"):
            self.search.rank_pool(
                "warden",
                10,
                ["upgrade_health"],
                1,
                800,
                constraints=SearchConstraints(
                    minimum_stats=(("typo_health", Decimal("1")),)
                ),
            )
        with self.assertRaisesRegex(ValueError, "exakt 1"):
            ScoreProfile("bad", {"dps": Decimal("0.5")})

    def test_survivability_profile_prefers_defense_in_small_pool(self) -> None:
        ranked = self.search.rank_pool(
            "warden",
            10,
            ["upgrade_health", "upgrade_rapid_rounds"],
            item_count=1,
            budget=800,
            profile=SURVIVABILITY,
        )
        self.assertEqual(ranked[0].result.item_ids, ("upgrade_health",))
        self.assertEqual(ranked[0].profile.name, "survivability_v1")

    def test_generated_path_unlocks_walker_slot_only_when_needed(self) -> None:
        candidates = [
            "upgrade_close_range",
            "upgrade_clip_size",
            "upgrade_rapid_rounds",
            "upgrade_headshot_booster",
            "upgrade_health",
            "upgrade_sprint_booster",
            "upgrade_improved_stamina",
            "upgrade_improved_spirit",
            "upgrade_magic_reach",
            "upgrade_magic_tempo",
        ]
        ranked = self.search.rank_pool(
            "warden", 10, candidates, item_count=10, budget=16000, walker_slots=1
        )
        snapshots = ranked[0].path_evaluation.path.snapshots
        self.assertEqual(snapshots[0].walker_slots_available, 0)
        self.assertEqual(snapshots[-1].walker_slots_available, 1)
        self.assertTrue(
            all(
                snapshot.normal_slots_used <= 9
                for snapshot in snapshots
                if snapshot.walker_slots_available == 0
            )
        )

    def test_beam_prioritizes_hard_constraint_progress(self) -> None:
        baseline = self.search.calculator.calculate(BuildRequest("warden", 10, ()))
        report = self.search.beam_search(
            "warden",
            10,
            budget=1600,
            item_count=2,
            candidate_item_ids=[
                "upgrade_health",
                "upgrade_rapid_rounds",
                "upgrade_clip_size",
            ],
            beam_width=1,
            limit=1,
            constraints=SearchConstraints(
                minimum_stats=(("max_health", baseline.stats["max_health"] + 1),)
            ),
        )
        self.assertTrue(report.results)
        self.assertIn("upgrade_health", report.results[0].result.item_ids)


if __name__ == "__main__":
    unittest.main()
