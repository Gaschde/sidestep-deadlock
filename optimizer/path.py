from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from .calculator import BuildCalculator
from .data_loader import DataRepository
from .models import BuildRequest


@dataclass(frozen=True)
class PurchaseAction:
    item_id: str
    component_id: str | None = None
    walker_slots: int = 0


@dataclass(frozen=True)
class PurchaseSnapshot:
    step: int
    item_id: str
    item_name: str
    purchase_type: str
    component_used: str | None
    replaces_item_id: str | None
    cash_cost: int
    total_spent: int
    owned_items: tuple[str, ...]
    investments: dict[str, int]
    investment_bonuses: dict[str, Decimal]
    threshold_bonus_increments: dict[str, Decimal]
    thresholds_crossed: dict[str, tuple[int, ...]]
    normal_slots_used: int
    active_slots_used: int
    walker_slots_available: int


@dataclass(frozen=True)
class PurchasePath:
    snapshots: tuple[PurchaseSnapshot, ...]

    @property
    def final_items(self) -> tuple[str, ...]:
        return self.snapshots[-1].owned_items if self.snapshots else ()

    @property
    def total_spent(self) -> int:
        return self.snapshots[-1].total_spent if self.snapshots else 0


class PurchasePathValidator:
    def __init__(self, repository: DataRepository):
        self.repo = repository
        self.calculator = BuildCalculator(repository)
        self.edges = {
            (row["from_item_id"], row["to_item_id"]): row
            for row in repository.upgrade_edges
        }

    def evaluate(self, actions: list[PurchaseAction], hero_id: str = "warden") -> PurchasePath:
        owned: list[str] = []
        spent = 0
        unlocked_walker_slots = 0
        previous_investments = {category: 0 for category in ("Weapon", "Vitality", "Spirit")}
        snapshots: list[PurchaseSnapshot] = []
        for index, action in enumerate(actions, start=1):
            if action.walker_slots < unlocked_walker_slots:
                raise ValueError(
                    f"Walker-Slots dürfen in Schritt {index} nicht wieder gesperrt werden"
                )
            unlocked_walker_slots = action.walker_slots
            if action.item_id not in self.repo.items:
                raise ValueError(f"Unbekanntes Item in Schritt {index}: {action.item_id}")
            item = self.repo.items[action.item_id]
            if not item.public:
                raise ValueError(f"Nicht öffentliches Item in Schritt {index}: {action.item_id}")
            if action.item_id in owned:
                raise ValueError(f"Item in Schritt {index} bereits vorhanden: {action.item_id}")

            cash_cost = item.total_cost
            if action.component_id:
                if action.component_id not in owned:
                    raise ValueError(
                        f"Komponente in Schritt {index} nicht vorhanden: {action.component_id}"
                    )
                edge = self.edges.get((action.component_id, action.item_id))
                if edge is None:
                    raise ValueError(
                        f"Keine Upgrade-Kante: {action.component_id} -> {action.item_id}"
                    )
                if not edge["additional_cost"]:
                    raise ValueError("Upgrade-Kante besitzt keine verifizierten Zusatzkosten")
                cash_cost = int(edge["additional_cost"])
                owned.remove(action.component_id)
            owned.append(action.item_id)
            owned.sort()
            spent += cash_cost

            # Reuse the central legality checks so path and final calculation
            # cannot silently diverge on slot or Active-Item rules.
            self.calculator._validate(  # noqa: SLF001 - deliberate shared invariant
                BuildRequest(hero_id, 0, tuple(owned), walker_slots=action.walker_slots)
            )
            investments = {category: 0 for category in previous_investments}
            for owned_id in owned:
                investments[self.repo.items[owned_id].category] += self.repo.items[owned_id].total_cost
            crossed = {
                category: tuple(
                    int(threshold["category_investment"])
                    for threshold in self.repo.economy["investment_thresholds"]
                    if previous_investments[category]
                    < int(threshold["category_investment"])
                    <= investments[category]
                )
                for category in investments
            }
            investment_bonuses = {
                category: self.calculator._investment_bonus(category, amount)  # noqa: SLF001
                for category, amount in investments.items()
            }
            previous_bonuses = {
                category: self.calculator._investment_bonus(category, amount)  # noqa: SLF001
                for category, amount in previous_investments.items()
            }
            bonus_increments = {
                category: investment_bonuses[category] - previous_bonuses[category]
                for category in investments
            }
            active_count = sum(bool(self.repo.items[item_id].active_type) for item_id in owned)
            snapshots.append(
                PurchaseSnapshot(
                    step=index,
                    item_id=action.item_id,
                    item_name=item.name,
                    purchase_type="upgrade" if action.component_id else "direct",
                    component_used=action.component_id,
                    replaces_item_id=action.component_id,
                    cash_cost=cash_cost,
                    total_spent=spent,
                    owned_items=tuple(owned),
                    investments=dict(investments),
                    investment_bonuses=investment_bonuses,
                    threshold_bonus_increments=bonus_increments,
                    thresholds_crossed=crossed,
                    normal_slots_used=len(owned),
                    active_slots_used=active_count,
                    walker_slots_available=action.walker_slots,
                )
            )
            previous_investments = investments
        return PurchasePath(tuple(snapshots))
