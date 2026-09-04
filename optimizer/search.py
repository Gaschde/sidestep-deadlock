from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from itertools import combinations

from .calculator import BuildCalculator
from .models import BuildRequest, CalculationResult, EffectSelection, TargetProfile
from .path import PurchaseAction, PurchasePath, PurchasePathValidator


@dataclass(frozen=True)
class ScoreProfile:
    name: str
    weights: dict[str, Decimal]
    path_weight: Decimal = Decimal("0.25")
    warning_penalty: Decimal = Decimal("0.01")

    def __post_init__(self) -> None:
        if not self.weights or any(value < 0 for value in self.weights.values()):
            raise ValueError("Score-Gewichte müssen vorhanden und nicht negativ sein")
        if sum(self.weights.values(), Decimal(0)) != Decimal(1):
            raise ValueError("Score-Gewichte müssen zusammen exakt 1 ergeben")
        if not Decimal(0) <= self.path_weight <= Decimal(1):
            raise ValueError("path_weight muss zwischen 0 und 1 liegen")
        if self.warning_penalty < 0:
            raise ValueError("warning_penalty darf nicht negativ sein")


GUN_CARRY = ScoreProfile(
    name="gun_carry_v2",
    weights={
        "target_dps_ratio": Decimal("0.30"),
        "target_sustained_dps_ratio": Decimal("0.25"),
        "health_ratio": Decimal("0.20"),
        "bullet_ehp_ratio": Decimal("0.10"),
        "move_ratio": Decimal("0.10"),
        "sustain": Decimal("0.05"),
    },
)

SURVIVABILITY = ScoreProfile(
    name="survivability_v1",
    weights={
        "health_ratio": Decimal("0.20"),
        "bullet_ehp_ratio": Decimal("0.25"),
        "spirit_ehp_ratio": Decimal("0.25"),
        "melee_ehp_ratio": Decimal("0.10"),
        "move_ratio": Decimal("0.10"),
        "regen_ratio": Decimal("0.05"),
        "combined_lifesteal": Decimal("0.05"),
    },
)

SCORE_PROFILES = {
    GUN_CARRY.name: GUN_CARRY,
    SURVIVABILITY.name: SURVIVABILITY,
}


@dataclass(frozen=True)
class SearchConstraints:
    """Hard requirements are explicit instead of being hidden in the score."""

    minimum_stats: tuple[tuple[str, Decimal], ...] = ()
    minimum_budget_utilization: Decimal = Decimal("0")
    reject_unresolved_downsides: bool = True


@dataclass(frozen=True)
class PathCheckpoint:
    budget: int
    spent: int
    score: Decimal
    item_ids: tuple[str, ...]


@dataclass(frozen=True)
class PathEvaluation:
    actions: tuple[PurchaseAction, ...]
    path: PurchasePath
    checkpoints: tuple[PathCheckpoint, ...]
    average_score: Decimal
    warnings: tuple[str, ...] = ()


@dataclass(frozen=True)
class MarginalContribution:
    item_id: str
    total_cost: int
    build_end_score: Decimal
    without_item_end_score: Decimal
    score_gain: Decimal
    score_gain_per_1000_souls: Decimal
    component_gains: dict[str, Decimal]


@dataclass
class RankedBuild:
    result: CalculationResult
    score: Decimal
    components: dict[str, Decimal]
    profile: ScoreProfile
    end_score: Decimal = Decimal(0)
    path_evaluation: PathEvaluation | None = None
    marginals: tuple[MarginalContribution, ...] = ()

    @property
    def validation_status(self) -> str:
        if self.result.validation_status != "PASS":
            return self.result.validation_status
        if self.path_evaluation and self.path_evaluation.warnings:
            return "PASS_WITH_WARNINGS"
        return "PASS"


@dataclass
class SearchReport:
    result_label: str
    method: str
    evaluated_states: int
    candidate_count: int
    path_evaluated_finalists: int
    profile: ScoreProfile
    constraints: SearchConstraints
    results: list[RankedBuild]
    pareto_results: list[RankedBuild]


class BuildSearch:
    """Deterministic candidate-pool search; it never claims global optimality."""

    def __init__(self, calculator: BuildCalculator):
        self.calculator = calculator
        self.path_validator = PurchasePathValidator(calculator.repo)
        self._calculation_cache: dict[tuple, CalculationResult] = {}

    def _calculate(self, request: BuildRequest) -> CalculationResult:
        key = (
            request.hero_id,
            request.boon_level,
            request.item_ids,
            request.walker_slots,
            tuple(sorted(request.ability_levels.items())),
            tuple(sorted(request.effects.active)),
            tuple(sorted(request.effects.inactive)),
            str(request.target_profile.bullet_resist_percent),
            str(request.target_profile.spirit_resist_percent),
        )
        if key not in self._calculation_cache:
            self._calculation_cache[key] = self.calculator.calculate(request)
        return self._calculation_cache[key]

    def _request(
        self,
        hero_id: str,
        boon_level: int,
        item_ids: tuple[str, ...],
        walker_slots: int,
        conservative_conditions: bool,
        effects: EffectSelection = EffectSelection(),
        target_profile: TargetProfile = TargetProfile(),
    ) -> BuildRequest:
        owned_refs = {
            effect.ref
            for item_id in item_ids
            for effect in self.calculator.repo.effects.get(item_id, [])
        }
        active = effects.active & owned_refs
        inactive = effects.inactive & owned_refs
        if conservative_conditions:
            audit_inactive = frozenset(
                flag.effect_ref
                for flag in self.calculator.condition_auditor.inspect(item_ids)
            )
            inactive = inactive | (audit_inactive - active)
        return BuildRequest(
            hero_id,
            boon_level,
            item_ids,
            walker_slots=walker_slots,
            effects=EffectSelection(active=active, inactive=inactive),
            target_profile=target_profile,
        )

    def rank_pool(
        self,
        hero_id: str,
        boon_level: int,
        candidate_item_ids: list[str],
        item_count: int,
        budget: int,
        walker_slots: int = 0,
        limit: int = 10,
        profile: ScoreProfile = GUN_CARRY,
        conservative_conditions: bool = True,
        constraints: SearchConstraints = SearchConstraints(),
        budget_checkpoints: tuple[int, ...] | None = None,
        effects: EffectSelection = EffectSelection(),
        target_profile: TargetProfile = TargetProfile(),
    ) -> list[RankedBuild]:
        self._validate_search_inputs(item_count, budget, walker_slots, constraints)
        candidates = sorted(set(candidate_item_ids))
        self._validate_candidates(candidates)
        baseline = self._calculate(
            BuildRequest(
                hero_id=hero_id,
                boon_level=boon_level,
                item_ids=(),
                target_profile=target_profile,
            )
        )
        self._validate_minimum_stat_names(baseline, constraints)
        ranked: list[RankedBuild] = []
        for item_ids in combinations(candidates, item_count):
            if sum(self.calculator.repo.items[item_id].total_cost for item_id in item_ids) > budget:
                continue
            try:
                result = self._calculate(
                    self._request(
                        hero_id,
                        boon_level,
                        item_ids,
                        walker_slots,
                        conservative_conditions,
                        effects,
                        target_profile,
                    )
                )
            except ValueError:
                continue
            if not self._passes_constraints(result, budget, constraints):
                continue
            ranked.append(
                self._rank_with_path(
                    result,
                    baseline,
                    hero_id,
                    boon_level,
                    walker_slots,
                    budget,
                    profile,
                    conservative_conditions,
                    budget_checkpoints,
                    effects,
                    target_profile,
                )
            )
        ranked.sort(key=lambda entry: (-entry.score, entry.result.total_cost, entry.result.item_ids))
        selected = ranked[:limit]
        for entry in selected:
            self._attach_marginals(
                entry,
                baseline,
                hero_id,
                boon_level,
                walker_slots,
                profile,
                conservative_conditions,
                effects,
                target_profile,
            )
        return selected

    def beam_search(
        self,
        hero_id: str,
        boon_level: int,
        budget: int,
        item_count: int,
        walker_slots: int = 0,
        candidate_item_ids: list[str] | None = None,
        beam_width: int = 250,
        limit: int = 10,
        profile: ScoreProfile = GUN_CARRY,
        conservative_conditions: bool = True,
        constraints: SearchConstraints = SearchConstraints(),
        budget_checkpoints: tuple[int, ...] | None = None,
        effects: EffectSelection = EffectSelection(),
        target_profile: TargetProfile = TargetProfile(),
    ) -> SearchReport:
        """Search a broad pool reproducibly without claiming exhaustive optimality.

        At every depth only the strongest ``beam_width`` partial builds survive.
        This deliberately trades completeness for bounded runtime, and the report
        exposes that fact to callers.
        """
        self._validate_search_inputs(item_count, budget, walker_slots, constraints)
        capacity = self.calculator.repo.slots["starting_slots"]["universal"] + min(walker_slots, 3)
        if item_count > capacity:
            raise ValueError(f"{item_count} Items benötigen mehr als {capacity} verfügbare Slots")
        if beam_width < 1 or limit < 1:
            raise ValueError("beam_width und limit müssen positiv sein")
        if candidate_item_ids is None:
            candidates = sorted(
                item_id for item_id, item in self.calculator.repo.items.items() if item.public
            )
        else:
            candidates = sorted(set(candidate_item_ids))
        self._validate_candidates(candidates)

        baseline = self._calculate(
            BuildRequest(hero_id, boon_level, (), target_profile=target_profile)
        )
        self._validate_minimum_stat_names(baseline, constraints)
        frontier: list[tuple[str, ...]] = [()]
        evaluated = 0
        final_ranked: list[RankedBuild] = []
        pareto_ranked: list[RankedBuild] = []
        path_evaluated_finalists = 0
        for depth in range(1, item_count + 1):
            expanded: dict[tuple[str, ...], RankedBuild] = {}
            for partial in frontier:
                last = partial[-1] if partial else ""
                for item_id in candidates:
                    if item_id <= last or item_id in partial:
                        continue
                    item_ids = partial + (item_id,)
                    cost = sum(
                        self.calculator.repo.items[current].total_cost for current in item_ids
                    )
                    if cost > budget:
                        continue
                    remaining_count = item_count - depth
                    if remaining_count:
                        later_costs = sorted(
                            self.calculator.repo.items[later].total_cost
                            for later in candidates
                            if later > item_id and later not in item_ids
                        )
                        if len(later_costs) < remaining_count:
                            continue
                        if cost + sum(later_costs[:remaining_count]) > budget:
                            continue
                        minimum_spend = Decimal(budget) * constraints.minimum_budget_utilization
                        if Decimal(cost + sum(later_costs[-remaining_count:])) < minimum_spend:
                            continue
                    try:
                        result = self._calculate(
                            self._request(
                                hero_id,
                                boon_level,
                                item_ids,
                                walker_slots,
                                conservative_conditions,
                                effects,
                                target_profile,
                            )
                        )
                    except ValueError:
                        continue
                    if constraints.reject_unresolved_downsides and result.unresolved_downsides:
                        continue
                    evaluated += 1
                    components = self._components(result, baseline)
                    score = self._end_score(result, components, profile)
                    expanded[item_ids] = RankedBuild(
                        result, score, components, profile, end_score=score
                    )
            ordered = sorted(
                expanded.values(),
                key=lambda entry: (
                    -self._constraint_progress(entry.result, budget, constraints),
                    -entry.score,
                    entry.result.total_cost,
                    entry.result.item_ids,
                ),
            )
            if depth == item_count:
                eligible = [
                    entry
                    for entry in ordered
                    if self._passes_constraints(entry.result, budget, constraints)
                ]
                # Path evaluation is more expensive than end-state scoring. Re-rank
                # a disclosed deterministic finalist set rather than hiding the cut.
                finalist_count = max(limit * 20, beam_width)
                path_ranked = [
                    self._rank_with_path(
                        entry.result,
                        baseline,
                        hero_id,
                        boon_level,
                        walker_slots,
                        budget,
                        profile,
                        conservative_conditions,
                        budget_checkpoints,
                        effects,
                        target_profile,
                    )
                    for entry in eligible[:finalist_count]
                ]
                path_evaluated_finalists = len(path_ranked)
                path_ranked.sort(
                    key=lambda entry: (
                        -entry.score,
                        entry.result.total_cost,
                        entry.result.item_ids,
                    )
                )
                final_ranked = path_ranked[:limit]
                pareto_ranked = self._pareto_front(path_ranked)[:limit]
                for entry in final_ranked:
                    self._attach_marginals(
                        entry,
                        baseline,
                        hero_id,
                        boon_level,
                        walker_slots,
                        profile,
                        conservative_conditions,
                        effects,
                        target_profile,
                    )
                break
            frontier = [entry.result.item_ids for entry in ordered[:beam_width]]
            if not frontier:
                break
        return SearchReport(
            result_label="best_evaluated",
            method=(
                f"deterministic_beam_search(width={beam_width},"
                f"conservative_conditions={str(conservative_conditions).lower()},"
                f"path_reranking=true)"
            ),
            evaluated_states=evaluated,
            candidate_count=len(candidates),
            path_evaluated_finalists=path_evaluated_finalists,
            profile=profile,
            constraints=constraints,
            results=final_ranked,
            pareto_results=pareto_ranked,
        )

    def _validate_search_inputs(
        self,
        item_count: int,
        budget: int,
        walker_slots: int,
        constraints: SearchConstraints,
    ) -> None:
        if item_count < 1:
            raise ValueError("item_count muss positiv sein")
        if budget < 0:
            raise ValueError("budget darf nicht negativ sein")
        if not 0 <= walker_slots <= 3:
            raise ValueError("walker_slots muss zwischen 0 und 3 liegen")
        capacity = self.calculator.repo.slots["starting_slots"]["universal"] + walker_slots
        if item_count > capacity:
            raise ValueError(f"{item_count} Items benötigen mehr als {capacity} verfügbare Slots")
        if not Decimal(0) <= constraints.minimum_budget_utilization <= Decimal(1):
            raise ValueError("minimum_budget_utilization muss zwischen 0 und 1 liegen")

    def _validate_candidates(self, candidates: list[str]) -> None:
        unknown = [item_id for item_id in candidates if item_id not in self.calculator.repo.items]
        if unknown:
            raise ValueError(f"Unbekannte Kandidaten: {', '.join(unknown)}")
        private = [
            item_id for item_id in candidates if not self.calculator.repo.items[item_id].public
        ]
        if private:
            raise ValueError(f"Nicht öffentliche Kandidaten: {', '.join(private)}")

    @staticmethod
    def _validate_minimum_stat_names(
        baseline: CalculationResult, constraints: SearchConstraints
    ) -> None:
        unknown = [name for name, _ in constraints.minimum_stats if name not in baseline.stats]
        if unknown:
            raise ValueError(f"Unbekannte Mindestwert-Stats: {', '.join(sorted(unknown))}")

    @staticmethod
    def _components(result: CalculationResult, baseline: CalculationResult) -> dict[str, Decimal]:
        def ratio(key: str) -> Decimal:
            return Decimal(str(result.stats[key])) / Decimal(str(baseline.stats[key]))

        resist = Decimal(str(result.stats["bullet_resist_percent"])) / Decimal(100)
        baseline_resist = Decimal(str(baseline.stats["bullet_resist_percent"])) / Decimal(100)
        result_ehp = Decimal(str(result.stats["max_health"])) / (Decimal(1) - resist)
        baseline_ehp = Decimal(str(baseline.stats["max_health"])) / (
            Decimal(1) - baseline_resist
        )
        bullet_ehp = result_ehp / baseline_ehp
        spirit_resist = Decimal(str(result.stats["spirit_resist_percent"])) / Decimal(100)
        baseline_spirit_resist = Decimal(
            str(baseline.stats["spirit_resist_percent"])
        ) / Decimal(100)
        spirit_ehp = (
            Decimal(str(result.stats["max_health"])) / (Decimal(1) - spirit_resist)
        ) / (
            Decimal(str(baseline.stats["max_health"]))
            / (Decimal(1) - baseline_spirit_resist)
        )
        melee_resist = Decimal(str(result.stats["melee_resist_percent"])) / Decimal(100)
        baseline_melee_resist = Decimal(
            str(baseline.stats["melee_resist_percent"])
        ) / Decimal(100)
        melee_ehp = (
            Decimal(str(result.stats["max_health"])) / (Decimal(1) - melee_resist)
        ) / (
            Decimal(str(baseline.stats["max_health"]))
            / (Decimal(1) - baseline_melee_resist)
        )
        bullet_lifesteal = Decimal(str(result.stats["bullet_lifesteal_percent"])) / Decimal(100)
        spirit_lifesteal = Decimal(str(result.stats["spirit_lifesteal_percent"])) / Decimal(100)
        return {
            "target_dps_ratio": ratio("effective_total_dps"),
            "target_sustained_dps_ratio": ratio("effective_sustained_dps"),
            "health_ratio": ratio("max_health"),
            "bullet_ehp_ratio": bullet_ehp,
            "spirit_ehp_ratio": spirit_ehp,
            "melee_ehp_ratio": melee_ehp,
            "move_ratio": ratio("move_speed"),
            "regen_ratio": ratio("health_regen"),
            "sustain": Decimal(1) + bullet_lifesteal,
            "combined_lifesteal": Decimal(1) + bullet_lifesteal + spirit_lifesteal,
        }

    @staticmethod
    def _end_score(
        result: CalculationResult,
        components: dict[str, Decimal],
        profile: ScoreProfile,
    ) -> Decimal:
        score = sum(
            weight * components[key]
            for key, weight in profile.weights.items()
        )
        uncertain_count = len(result.unhandled_effects) + len(result.audit_flags)
        return score - profile.warning_penalty * uncertain_count

    @staticmethod
    def _passes_constraints(
        result: CalculationResult,
        budget: int,
        constraints: SearchConstraints,
    ) -> bool:
        if constraints.reject_unresolved_downsides and result.unresolved_downsides:
            return False
        if budget and Decimal(result.total_cost) / Decimal(budget) < constraints.minimum_budget_utilization:
            return False
        for stat, minimum in constraints.minimum_stats:
            value = result.stats.get(stat)
            if value is None or Decimal(str(value)) < minimum:
                return False
        return True

    @staticmethod
    def _constraint_progress(
        result: CalculationResult,
        budget: int,
        constraints: SearchConstraints,
    ) -> Decimal:
        progress: list[Decimal] = []
        if constraints.minimum_budget_utilization > 0 and budget:
            required = Decimal(budget) * constraints.minimum_budget_utilization
            progress.append(min(Decimal(1), Decimal(result.total_cost) / required))
        for stat, minimum in constraints.minimum_stats:
            if minimum <= 0:
                progress.append(Decimal(1))
                continue
            value = result.stats.get(stat)
            if value is None:
                progress.append(Decimal(0))
            else:
                progress.append(min(Decimal(1), Decimal(str(value)) / minimum))
        return min(progress) if progress else Decimal(1)

    def _rank_with_path(
        self,
        result: CalculationResult,
        baseline: CalculationResult,
        hero_id: str,
        boon_level: int,
        walker_slots: int,
        budget: int,
        profile: ScoreProfile,
        conservative_conditions: bool,
        budget_checkpoints: tuple[int, ...] | None,
        effects: EffectSelection,
        target_profile: TargetProfile,
    ) -> RankedBuild:
        components = self._components(result, baseline)
        end_score = self._end_score(result, components, profile)
        path_evaluation = self._plan_path(
            result.item_ids,
            baseline,
            hero_id,
            boon_level,
            walker_slots,
            budget,
            profile,
            conservative_conditions,
            budget_checkpoints,
            effects,
            target_profile,
        )
        score = (
            (Decimal(1) - profile.path_weight) * end_score
            + profile.path_weight * path_evaluation.average_score
        )
        return RankedBuild(
            result=result,
            score=score,
            components=components,
            profile=profile,
            end_score=end_score,
            path_evaluation=path_evaluation,
        )

    def _plan_path(
        self,
        final_item_ids: tuple[str, ...],
        baseline: CalculationResult,
        hero_id: str,
        boon_level: int,
        walker_slots: int,
        budget: int,
        profile: ScoreProfile,
        conservative_conditions: bool,
        budget_checkpoints: tuple[int, ...] | None,
        effects: EffectSelection,
        target_profile: TargetProfile,
    ) -> PathEvaluation:
        final_set = set(final_item_ids)
        component_for: dict[str, str] = {}
        claimed_components: set[str] = set()
        edges_by_target: dict[str, list[str]] = {}
        for edge in self.calculator.repo.upgrade_edges:
            edges_by_target.setdefault(edge["to_item_id"], []).append(edge["from_item_id"])

        # Pick at most one component for each final item. Components are ranked by
        # their actually calculated early strength per soul and cannot be reused.
        for target in sorted(final_item_ids):
            candidates = [
                component
                for component in edges_by_target.get(target, [])
                if component not in final_set
                and component not in claimed_components
                and component in self.calculator.repo.items
                and self.calculator.repo.items[component].public
            ]
            scored: list[tuple[Decimal, str]] = []
            for component in candidates:
                try:
                    component_result = self._calculate(
                        self._request(
                            hero_id,
                            boon_level,
                            (component,),
                            walker_slots,
                            conservative_conditions,
                            effects,
                            target_profile,
                        )
                    )
                except ValueError:
                    continue
                if component_result.unresolved_downsides:
                    continue
                component_score = self._end_score(
                    component_result,
                    self._components(component_result, baseline),
                    profile,
                )
                cost_units = Decimal(self.calculator.repo.items[component].total_cost) / Decimal(800)
                scored.append((component_score / cost_units, component))
            if scored:
                selected = sorted(scored, key=lambda pair: (-pair[0], pair[1]))[0][1]
                component_for[target] = selected
                claimed_components.add(selected)

        owned: tuple[str, ...] = ()
        actions: list[PurchaseAction] = []
        unlocked_walker_slots = 0
        current_score = self._end_score(
            baseline, self._components(baseline, baseline), profile
        )
        while set(owned) != final_set:
            options: list[tuple[Decimal, Decimal, str, PurchaseAction, tuple[str, ...]]] = []
            owned_set = set(owned)
            for target in sorted(final_set - owned_set):
                component = component_for.get(target)
                candidate_steps: list[tuple[str, PurchaseAction, tuple[str, ...], int]] = []
                if component and component not in owned_set:
                    candidate_steps.append(
                        (
                            component,
                            PurchaseAction(component, walker_slots=walker_slots),
                            tuple(sorted((*owned, component))),
                            self.calculator.repo.items[component].total_cost,
                        )
                    )
                    # A component can be temporarily illegal (for example because
                    # of the Active limit). Direct purchase remains a legal path.
                    candidate_steps.append(
                        (
                            target,
                            PurchaseAction(target, walker_slots=walker_slots),
                            tuple(sorted((*owned, target))),
                            self.calculator.repo.items[target].total_cost,
                        )
                    )
                elif component:
                    edge = self.path_validator.edges[(component, target)]
                    candidate_steps.append(
                        (
                            target,
                            PurchaseAction(
                                target,
                                component_id=component,
                                walker_slots=walker_slots,
                            ),
                            tuple(sorted((owned_set - {component}) | {target})),
                            int(edge["additional_cost"]),
                        )
                    )
                else:
                    candidate_steps.append(
                        (
                            target,
                            PurchaseAction(target, walker_slots=walker_slots),
                            tuple(sorted((*owned, target))),
                            self.calculator.repo.items[target].total_cost,
                        )
                    )
                for item_id, action, next_owned, cash_cost in candidate_steps:
                    required_walker_slots = max(0, len(next_owned) - 9)
                    next_walker_slots = max(unlocked_walker_slots, required_walker_slots)
                    if next_walker_slots > walker_slots:
                        continue
                    action = PurchaseAction(
                        action.item_id,
                        component_id=action.component_id,
                        walker_slots=next_walker_slots,
                    )
                    try:
                        next_result = self._calculate(
                            self._request(
                                hero_id,
                                boon_level,
                                next_owned,
                                next_walker_slots,
                                conservative_conditions,
                                effects,
                                target_profile,
                            )
                        )
                    except ValueError:
                        continue
                    next_components = self._components(next_result, baseline)
                    next_score = self._end_score(next_result, next_components, profile)
                    cost_units = Decimal(cash_cost) / Decimal(800)
                    efficiency = (next_score - current_score) / cost_units
                    options.append((efficiency, next_score, item_id, action, next_owned))
            if not options:
                raise ValueError("Für den legalen Endbuild konnte kein legaler Kaufpfad erzeugt werden")
            efficiency, next_score, _, action, next_owned = sorted(
                options, key=lambda row: (-row[0], -row[1], row[2])
            )[0]
            del efficiency
            actions.append(action)
            owned = next_owned
            current_score = next_score
            unlocked_walker_slots = action.walker_slots

        path = self.path_validator.evaluate(actions, hero_id=hero_id)
        checkpoints = self._path_checkpoints(
            path,
            baseline,
            hero_id,
            boon_level,
            walker_slots,
            budget,
            profile,
            conservative_conditions,
            budget_checkpoints,
            effects,
            target_profile,
        )
        average = (
            sum((checkpoint.score for checkpoint in checkpoints), Decimal(0))
            / Decimal(len(checkpoints))
            if checkpoints
            else current_score
        )
        path_warnings: list[str] = []
        upgraded_targets = [action.item_id for action in actions if action.component_id]
        if upgraded_targets:
            path_warnings.append(
                "UNC-0004: Ein möglicher temporärer Zusatzslot während eines Upgrades ist nicht verifiziert."
            )
        incoming_counts: dict[str, int] = {}
        for _, target in self.path_validator.edges:
            incoming_counts[target] = incoming_counts.get(target, 0) + 1
        if any(incoming_counts.get(target, 0) > 1 for target in upgraded_targets):
            path_warnings.append(
                "UNC-0013: Bei Zielen mit mehreren möglichen Komponenten ist nur der verwendete Einzelrabatt verifiziert."
            )
        return PathEvaluation(
            tuple(actions), path, checkpoints, average, tuple(path_warnings)
        )

    def _path_checkpoints(
        self,
        path: PurchasePath,
        baseline: CalculationResult,
        hero_id: str,
        boon_level: int,
        walker_slots: int,
        budget: int,
        profile: ScoreProfile,
        conservative_conditions: bool,
        requested: tuple[int, ...] | None,
        effects: EffectSelection,
        target_profile: TargetProfile,
    ) -> tuple[PathCheckpoint, ...]:
        if requested is None:
            defaults = [4800, 11200, 22400, 28800, budget]
            limits = tuple(sorted(set(value for value in defaults if 0 < value <= budget)))
        else:
            limits = tuple(sorted(set(value for value in requested if 0 < value <= budget)))
        result: list[PathCheckpoint] = []
        for limit in limits:
            eligible = [snapshot for snapshot in path.snapshots if snapshot.total_spent <= limit]
            if eligible:
                snapshot = eligible[-1]
                item_ids = snapshot.owned_items
                spent = snapshot.total_spent
                calculation = self._calculate(
                    self._request(
                        hero_id,
                        boon_level,
                        item_ids,
                        walker_slots,
                        conservative_conditions,
                        effects,
                        target_profile,
                    )
                )
            else:
                item_ids = ()
                spent = 0
                calculation = baseline
            components = self._components(calculation, baseline)
            score = self._end_score(calculation, components, profile)
            result.append(PathCheckpoint(limit, spent, score, item_ids))
        return tuple(result)

    @staticmethod
    def _pareto_front(entries: list[RankedBuild]) -> list[RankedBuild]:
        """Return builds not dominated across the disclosed score components."""

        front: list[RankedBuild] = []
        for candidate in entries:
            dominated = False
            for other in entries:
                if other is candidate:
                    continue
                keys = candidate.profile.weights.keys()
                no_worse = all(other.components[key] >= candidate.components[key] for key in keys)
                strictly_better = any(
                    other.components[key] > candidate.components[key] for key in keys
                )
                if no_worse and strictly_better:
                    dominated = True
                    break
            if not dominated:
                front.append(candidate)
        front.sort(key=lambda entry: (-entry.score, entry.result.total_cost, entry.result.item_ids))
        return front

    def _attach_marginals(
        self,
        entry: RankedBuild,
        baseline: CalculationResult,
        hero_id: str,
        boon_level: int,
        walker_slots: int,
        profile: ScoreProfile,
        conservative_conditions: bool,
        effects: EffectSelection,
        target_profile: TargetProfile,
    ) -> None:
        contributions: list[MarginalContribution] = []
        for item_id in entry.result.item_ids:
            remaining = tuple(current for current in entry.result.item_ids if current != item_id)
            without = self._calculate(
                self._request(
                    hero_id,
                    boon_level,
                    remaining,
                    walker_slots,
                    conservative_conditions,
                    effects,
                    target_profile,
                )
            )
            without_components = self._components(without, baseline)
            without_score = self._end_score(without, without_components, profile)
            gain = entry.end_score - without_score
            cost = self.calculator.repo.items[item_id].total_cost
            component_gains = {
                key: entry.components[key] - without_components[key]
                for key in entry.components
            }
            contributions.append(
                MarginalContribution(
                    item_id=item_id,
                    total_cost=cost,
                    build_end_score=entry.end_score,
                    without_item_end_score=without_score,
                    score_gain=gain,
                    score_gain_per_1000_souls=gain / (Decimal(cost) / Decimal(1000)),
                    component_gains=component_gains,
                )
            )
        contributions.sort(
            key=lambda value: (-value.score_gain, value.total_cost, value.item_id)
        )
        entry.marginals = tuple(contributions)
