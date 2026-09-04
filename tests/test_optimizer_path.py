from __future__ import annotations

import unittest
from pathlib import Path

from engine import DataRepository, PurchaseAction, PurchasePathValidator


ROOT = Path(__file__).resolve().parents[1]


class PurchasePathTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.validator = PurchasePathValidator(DataRepository.from_project(ROOT))

    def test_component_upgrade_uses_discount_and_replaces_slot(self) -> None:
        path = self.validator.evaluate(
            [
                PurchaseAction("upgrade_close_range"),
                PurchaseAction("upgrade_clip_size"),
                PurchaseAction(
                    "upgrade_close_quarter_combat",
                    component_id="upgrade_close_range",
                ),
                PurchaseAction("upgrade_titan_round", component_id="upgrade_clip_size"),
            ]
        )
        self.assertEqual(path.total_spent, 4800)
        self.assertEqual(path.final_items, ("upgrade_close_quarter_combat", "upgrade_titan_round"))
        self.assertEqual(path.snapshots[-1].normal_slots_used, 2)
        self.assertEqual(path.snapshots[-1].investments["Weapon"], 4800)
        self.assertIn(4800, path.snapshots[-1].thresholds_crossed["Weapon"])
        self.assertEqual(path.snapshots[-1].investment_bonuses["Weapon"], 46)
        self.assertEqual(path.snapshots[-1].threshold_bonus_increments["Weapon"], 28)

    def test_tenth_purchase_requires_a_walker_slot(self) -> None:
        ids = [
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
        actions = [PurchaseAction(item_id) for item_id in ids]
        with self.assertRaisesRegex(ValueError, "10 Slots"):
            self.validator.evaluate(actions)
        actions[-1] = PurchaseAction(ids[-1], walker_slots=1)
        path = self.validator.evaluate(actions)
        self.assertEqual(path.snapshots[-1].normal_slots_used, 10)

    def test_invalid_upgrade_edge_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "Keine Upgrade-Kante"):
            self.validator.evaluate(
                [
                    PurchaseAction("upgrade_close_range"),
                    PurchaseAction("upgrade_titan_round", component_id="upgrade_close_range"),
                ]
            )

    def test_walker_slot_unlocks_must_be_monotonic(self) -> None:
        with self.assertRaisesRegex(ValueError, "nicht wieder gesperrt"):
            self.validator.evaluate(
                [
                    PurchaseAction("upgrade_close_range", walker_slots=1),
                    PurchaseAction("upgrade_clip_size", walker_slots=0),
                ]
            )


if __name__ == "__main__":
    unittest.main()
