from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any


@dataclass(frozen=True)
class Item:
    item_id: str
    name: str
    category: str
    tier: int
    total_cost: int
    public: bool
    active_type: str


@dataclass(frozen=True)
class Effect:
    item_id: str
    effect_id: str
    mechanic: str
    value: str
    unit: str
    condition: str
    trigger: str
    target_scope: str
    stacking: str
    max_stacks: str
    duration: str
    cooldown: str
    confidence: str

    @property
    def ref(self) -> str:
        return f"{self.item_id}::{self.effect_id}"

    @property
    def number(self) -> Decimal | None:
        try:
            return Decimal(self.value)
        except (ValueError, ArithmeticError):
            return None

    @property
    def is_unconditional(self) -> bool:
        return self.trigger == "equipped" and self.condition.startswith("Immer,")


@dataclass(frozen=True)
class HeroStat:
    hero_id: str
    stat_id: str
    mechanic: str
    base_value: str
    value_per_level: str
    unit: str
    calculation_rule: str
    confidence: str

    def at_boon(self, boon: int) -> Decimal | str | None:
        if not self.base_value and not self.value_per_level:
            return None
        try:
            base = Decimal(self.base_value or "0")
            growth = Decimal(self.value_per_level or "0")
            return base + growth * boon
        except (ValueError, ArithmeticError):
            return self.base_value or None


@dataclass(frozen=True)
class EffectSelection:
    """Explicit scenario state for effects whose activation is conditional or disputed."""

    active: frozenset[str] = frozenset()
    inactive: frozenset[str] = frozenset()


@dataclass(frozen=True)
class TargetProfile:
    """Verified or explicitly assumed defenses used for damage comparisons."""

    bullet_resist_percent: Decimal = Decimal(0)
    spirit_resist_percent: Decimal = Decimal(0)


@dataclass(frozen=True)
class BuildRequest:
    hero_id: str
    boon_level: int
    item_ids: tuple[str, ...]
    walker_slots: int = 0
    ability_levels: dict[str, int] = field(default_factory=dict)
    effects: EffectSelection = EffectSelection()
    target_profile: TargetProfile = TargetProfile()


@dataclass
class CalculationResult:
    hero_id: str
    boon_level: int
    item_ids: tuple[str, ...]
    patch: str
    mode: str
    validation_status: str
    total_cost: int
    investments: dict[str, int]
    investment_bonuses: dict[str, Decimal]
    stats: dict[str, Decimal | str | int]
    abilities: dict[str, dict[str, Decimal | str | int | None]]
    target_profile: dict[str, Decimal]
    included_effects: list[str]
    excluded_conditional_effects: list[str]
    unresolved_downsides: list[str]
    unhandled_effects: list[str]
    audit_flags: list[str]
    warnings: list[str]

    def as_dict(self) -> dict[str, Any]:
        def serialise(value: Any) -> Any:
            if isinstance(value, Decimal):
                return float(value)
            if isinstance(value, dict):
                return {key: serialise(item) for key, item in value.items()}
            if isinstance(value, (list, tuple)):
                return [serialise(item) for item in value]
            return value

        return serialise(self.__dict__)
