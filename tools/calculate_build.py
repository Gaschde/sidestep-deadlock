from __future__ import annotations

import argparse
import json
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from engine import (  # noqa: E402
    BuildCalculator,
    BuildRequest,
    DataRepository,
    EffectSelection,
    TargetProfile,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Berechnet einen vorgegebenen Deadlock-Build.")
    parser.add_argument("hero_id")
    parser.add_argument("--boon", type=int, required=True)
    parser.add_argument("--item", action="append", default=[])
    parser.add_argument("--walker-slots", type=int, default=0)
    parser.add_argument("--activate", action="append", default=[])
    parser.add_argument("--deactivate", action="append", default=[])
    parser.add_argument("--ability-level", action="append", default=[], metavar="ABILITY_ID=LEVEL")
    parser.add_argument("--target-bullet-resist", type=Decimal, default=Decimal("0"))
    parser.add_argument("--target-spirit-resist", type=Decimal, default=Decimal("0"))
    args = parser.parse_args()
    ability_levels = {}
    for entry in args.ability_level:
        ability_id, level = entry.rsplit("=", 1)
        ability_levels[ability_id] = int(level)
    request = BuildRequest(
        hero_id=args.hero_id,
        boon_level=args.boon,
        item_ids=tuple(args.item),
        walker_slots=args.walker_slots,
        ability_levels=ability_levels,
        effects=EffectSelection(frozenset(args.activate), frozenset(args.deactivate)),
        target_profile=TargetProfile(
            bullet_resist_percent=args.target_bullet_resist,
            spirit_resist_percent=args.target_spirit_resist,
        ),
    )
    result = BuildCalculator(DataRepository.from_project(ROOT)).calculate(request)
    print(json.dumps(result.as_dict(), ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
