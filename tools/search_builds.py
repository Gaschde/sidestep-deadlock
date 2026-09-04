from __future__ import annotations

import argparse
import json
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from optimizer import BuildCalculator, DataRepository, EffectSelection, TargetProfile  # noqa: E402
from optimizer.search import BuildSearch, SCORE_PROFILES, SearchConstraints  # noqa: E402


def parse_minimum_stat(value: str) -> tuple[str, Decimal]:
    try:
        name, raw = value.split("=", 1)
        return name, Decimal(raw)
    except (ValueError, ArithmeticError) as exc:
        raise argparse.ArgumentTypeError("Erwartet STAT=ZAHL") from exc


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Durchsucht einen öffentlichen oder ausdrücklich begrenzten Itempool."
    )
    parser.add_argument("hero_id")
    parser.add_argument("--boon", type=int, required=True)
    parser.add_argument("--budget", type=int, required=True)
    parser.add_argument("--items", type=int, required=True, dest="item_count")
    parser.add_argument("--walker-slots", type=int, default=0)
    parser.add_argument("--candidate", action="append", default=None)
    parser.add_argument("--beam-width", type=int, default=250)
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument(
        "--profile",
        choices=sorted(SCORE_PROFILES),
        default="gun_carry_v2",
    )
    parser.add_argument("--checkpoint", type=int, action="append", default=None)
    parser.add_argument("--activate", action="append", default=[])
    parser.add_argument("--deactivate", action="append", default=[])
    parser.add_argument("--minimum-stat", type=parse_minimum_stat, action="append", default=[])
    parser.add_argument("--minimum-budget-utilization", type=Decimal, default=Decimal("0"))
    parser.add_argument("--allow-unresolved-downsides", action="store_true")
    parser.add_argument("--target-bullet-resist", type=Decimal, default=Decimal("0"))
    parser.add_argument("--target-spirit-resist", type=Decimal, default=Decimal("0"))
    args = parser.parse_args()
    constraints = SearchConstraints(
        minimum_stats=tuple(args.minimum_stat),
        minimum_budget_utilization=args.minimum_budget_utilization,
        reject_unresolved_downsides=not args.allow_unresolved_downsides,
    )
    report = BuildSearch(BuildCalculator(DataRepository.from_project(ROOT))).beam_search(
        hero_id=args.hero_id,
        boon_level=args.boon,
        budget=args.budget,
        item_count=args.item_count,
        walker_slots=args.walker_slots,
        candidate_item_ids=args.candidate,
        beam_width=args.beam_width,
        limit=args.limit,
        profile=SCORE_PROFILES[args.profile],
        constraints=constraints,
        budget_checkpoints=tuple(args.checkpoint) if args.checkpoint else None,
        effects=EffectSelection(
            active=frozenset(args.activate),
            inactive=frozenset(args.deactivate),
        ),
        target_profile=TargetProfile(
            bullet_resist_percent=args.target_bullet_resist,
            spirit_resist_percent=args.target_spirit_resist,
        ),
    )
    payload = {
        "result_label": report.result_label,
        "method": report.method,
        "target_profile": {
            "bullet_resist_percent": float(args.target_bullet_resist),
            "spirit_resist_percent": float(args.target_spirit_resist),
        },
        "evaluated_states": report.evaluated_states,
        "candidate_count": report.candidate_count,
        "path_evaluated_finalists": report.path_evaluated_finalists,
        "score_profile": {
            "name": report.profile.name,
            "weights": {key: float(value) for key, value in report.profile.weights.items()},
            "path_weight": float(report.profile.path_weight),
            "warning_penalty": float(report.profile.warning_penalty),
        },
        "constraints": {
            "minimum_stats": {key: float(value) for key, value in report.constraints.minimum_stats},
            "minimum_budget_utilization": float(report.constraints.minimum_budget_utilization),
            "reject_unresolved_downsides": report.constraints.reject_unresolved_downsides,
        },
        "results": [
            {
                "score": float(entry.score),
                "validation_status": entry.validation_status,
                "end_score": float(entry.end_score),
                "path_average_score": float(entry.path_evaluation.average_score),
                "path_warnings": list(entry.path_evaluation.warnings),
                "score_components": {key: float(value) for key, value in entry.components.items()},
                "total_cost": entry.result.total_cost,
                "item_ids": list(entry.result.item_ids),
                "stats": entry.result.as_dict()["stats"],
                "audit_flags": entry.result.audit_flags,
                "unhandled_effects": entry.result.unhandled_effects,
                "unresolved_downsides": entry.result.unresolved_downsides,
                "warnings": entry.result.warnings,
                "purchase_path": [
                    {
                        "step": snapshot.step,
                        "item_id": snapshot.item_id,
                        "item_name": snapshot.item_name,
                        "purchase_type": snapshot.purchase_type,
                        "component_used": snapshot.component_used,
                        "replaces_item_id": snapshot.replaces_item_id,
                        "cash_cost": snapshot.cash_cost,
                        "total_spent": snapshot.total_spent,
                        "owned_items": list(snapshot.owned_items),
                        "investments": snapshot.investments,
                        "investment_bonuses": {
                            key: float(value)
                            for key, value in snapshot.investment_bonuses.items()
                        },
                        "threshold_bonus_increments": {
                            key: float(value)
                            for key, value in snapshot.threshold_bonus_increments.items()
                        },
                        "thresholds_crossed": snapshot.thresholds_crossed,
                        "normal_slots_used": snapshot.normal_slots_used,
                        "active_slots_used": snapshot.active_slots_used,
                        "walker_slots_available": snapshot.walker_slots_available,
                    }
                    for snapshot in entry.path_evaluation.path.snapshots
                ],
                "path_checkpoints": [
                    {
                        "budget": checkpoint.budget,
                        "spent": checkpoint.spent,
                        "score": float(checkpoint.score),
                        "item_ids": list(checkpoint.item_ids),
                    }
                    for checkpoint in entry.path_evaluation.checkpoints
                ],
                "marginal_item_value": [
                    {
                        "item_id": marginal.item_id,
                        "total_cost": marginal.total_cost,
                        "build_end_score": float(marginal.build_end_score),
                        "without_item_end_score": float(marginal.without_item_end_score),
                        "score_gain": float(marginal.score_gain),
                        "score_gain_per_1000_souls": float(
                            marginal.score_gain_per_1000_souls
                        ),
                        "component_gains": {
                            key: float(value)
                            for key, value in marginal.component_gains.items()
                        },
                    }
                    for marginal in entry.marginals
                ],
            }
            for entry in report.results
        ],
        "pareto_results": [
            {
                "score": float(entry.score),
                "total_cost": entry.result.total_cost,
                "item_ids": list(entry.result.item_ids),
                "score_components": {
                    key: float(value) for key, value in entry.components.items()
                },
            }
            for entry in report.pareto_results
        ],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
