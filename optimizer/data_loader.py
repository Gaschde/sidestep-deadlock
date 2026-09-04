from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from pathlib import Path

from .models import Effect, HeroStat, Item


@dataclass
class DataRepository:
    root: Path

    def __post_init__(self) -> None:
        self.root = Path(self.root)
        self.core_manifest = self._json("data/core/manifest.json")
        self.hero_manifest = self._json("data/heroes/manifest.json")
        self.economy = self._json("data/core/economy.json")
        self.slots = self._json("data/core/slots.json")
        self.progression = self._json("data/heroes/progression.json")
        self.items = {
            row["item_id"]: Item(
                item_id=row["item_id"],
                name=row["name"],
                category=row["category"],
                tier=int(row["tier"]),
                total_cost=int(row["total_cost"]),
                public=row["is_public_shop_item"].lower() == "true",
                active_type=row["active_type"],
            )
            for row in self._csv("data/core/items.csv")
        }
        self.effects: dict[str, list[Effect]] = {}
        for row in self._csv("data/core/item_mechanics.csv"):
            effect = Effect(
                item_id=row["item_id"],
                effect_id=row["effect_id"],
                mechanic=row["mechanic"],
                value=row["value"],
                unit=row["unit"],
                condition=row["condition"],
                trigger=row["trigger"],
                target_scope=row["target_scope"],
                stacking=row["stacking"],
                max_stacks=row["max_stacks"],
                duration=row["duration"],
                cooldown=row["cooldown"],
                confidence=row["confidence"],
            )
            self.effects.setdefault(effect.item_id, []).append(effect)
        self.hero_stats: dict[str, list[HeroStat]] = {}
        for row in self._csv("data/heroes/hero_stats.csv"):
            stat = HeroStat(
                hero_id=row["hero_id"],
                stat_id=row["stat_id"],
                mechanic=row["mechanic"],
                base_value=row["base_value"],
                value_per_level=row["value_per_level"],
                unit=row["unit"],
                calculation_rule=row["calculation_rule"],
                confidence=row["confidence"],
            )
            self.hero_stats.setdefault(stat.hero_id, []).append(stat)
        self.heroes = {row["hero_id"]: row for row in self._csv("data/heroes/heroes.csv")}
        self.abilities = {row["ability_id"]: row for row in self._csv("data/heroes/abilities.csv")}
        self.ability_effects = self._csv("data/heroes/ability_mechanics.csv")
        self.ability_upgrades = self._csv("data/heroes/ability_upgrades.csv")
        self.upgrade_edges = self._csv("data/core/item_upgrades.csv")
        self._validate_compatibility()
        self._validate_declared_counts()

    @classmethod
    def from_project(cls, root: str | Path | None = None) -> "DataRepository":
        return cls(Path(root) if root else Path(__file__).resolve().parents[1])

    def _json(self, relative: str):
        return json.loads((self.root / relative).read_text(encoding="utf-8-sig"))

    def _csv(self, relative: str) -> list[dict[str, str]]:
        with (self.root / relative).open(encoding="utf-8-sig", newline="") as handle:
            return list(csv.DictReader(handle))

    def _validate_compatibility(self) -> None:
        if self.core_manifest.get("patch") != self.hero_manifest.get("patch"):
            raise ValueError("Core- und Heldendaten verwenden unterschiedliche Patches")
        if self.core_manifest.get("mode") != self.hero_manifest.get("mode"):
            raise ValueError("Core- und Heldendaten verwenden unterschiedliche Modi")
        core_schema = self.core_manifest.get("schema_version")
        hero_schema = self.hero_manifest.get("schema_version")
        linked_core_schema = self.hero_manifest.get("core_schema_version")
        if not core_schema or not hero_schema:
            raise ValueError("Core- oder Heldenmanifest enthält keine Schema-Version")
        if core_schema != hero_schema or linked_core_schema != core_schema:
            raise ValueError("Core- und Heldendaten verwenden inkompatible Schema-Versionen")
        if self.hero_manifest.get("core_patch") != self.core_manifest.get("patch"):
            raise ValueError("Heldenmanifest verweist auf einen anderen Core-Patch")
        compatibility = self.hero_manifest.get("core_compatibility_status", "")
        if not compatibility.startswith("compatible"):
            raise ValueError("Heldenmanifest bestätigt keine Core-Kompatibilität")

    def _validate_declared_counts(self) -> None:
        checks = {
            "Items": (len(self.items), self.core_manifest.get("item_count")),
            "Itemeffekte": (
                sum(len(effects) for effects in self.effects.values()),
                self.core_manifest.get("item_mechanics_count"),
            ),
            "Upgrade-Kanten": (
                len(self.upgrade_edges),
                self.core_manifest.get("upgrade_edge_count"),
            ),
            "Helden": (len(self.heroes), self.hero_manifest.get("hero_count")),
            "Fähigkeiten": (len(self.abilities), self.hero_manifest.get("ability_count")),
            "Fähigkeitseffekte": (
                len(self.ability_effects),
                self.hero_manifest.get("ability_effect_count"),
            ),
            "Fähigkeitsupgrades": (
                len(self.ability_upgrades),
                self.hero_manifest.get("ability_upgrade_count"),
            ),
        }
        mismatches = [
            f"{label}: geladen={actual}, Manifest={declared}"
            for label, (actual, declared) in checks.items()
            if declared is None or actual != int(declared)
        ]
        if mismatches:
            raise ValueError("Manifest-Zähler stimmen nicht: " + "; ".join(mismatches))
