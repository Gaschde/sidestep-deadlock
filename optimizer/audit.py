from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

from .data_loader import DataRepository


def _snake_case(name: str) -> str:
    first = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
    return re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", first).lower()


@dataclass(frozen=True)
class ConditionAuditFlag:
    effect_ref: str
    api_flags: tuple[str, ...]
    message: str


class ConditionAuditor:
    """Read-only comparison with the archived API snapshot.

    The snapshot is audit evidence, never a replacement for canonical values.
    """

    def __init__(self, repository: DataRepository):
        self.repo = repository
        self.properties = self._load_properties(repository.root)

    @staticmethod
    def _load_properties(root: Path) -> dict[str, dict[str, dict]]:
        manifest_path = root / "data/api/manifest.json"
        if not manifest_path.exists():
            return {}
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        version = manifest.get("latest_client_version")
        raw_path = root / "data" / "api" / "versions" / str(version) / "raw" / "items.json"
        if not raw_path.exists():
            return {}
        raw_items = json.loads(raw_path.read_text(encoding="utf-8-sig"))
        result: dict[str, dict[str, dict]] = {}
        for item in raw_items:
            class_name = item.get("class_name")
            properties = item.get("properties") or {}
            if not class_name:
                continue
            result[class_name] = {_snake_case(name): value for name, value in properties.items()}
        return result

    def inspect(self, item_ids: tuple[str, ...]) -> list[ConditionAuditFlag]:
        flags: list[ConditionAuditFlag] = []
        for item_id in item_ids:
            raw_properties = self.properties.get(item_id, {})
            for effect in self.repo.effects.get(item_id, []):
                if not effect.is_unconditional:
                    continue
                raw = raw_properties.get(effect.effect_id.removeprefix("eff_"), {})
                usage_flags = tuple(raw.get("usage_flags") or ())
                conditional = raw.get("conditional")
                if "ConditionallyApplied" in usage_flags or "IntrinsicallyProvidedInAbility" in usage_flags or conditional:
                    detail = ", ".join(usage_flags) or str(conditional)
                    flags.append(
                        ConditionAuditFlag(
                            effect_ref=effect.ref,
                            api_flags=usage_flags,
                            message=(
                                f"Audit-Hinweis für {effect.ref}: kanonisch permanent, "
                                f"archivierter API-Rohflag deutet auf Bedingung ({detail})."
                            ),
                        )
                    )
        return flags
