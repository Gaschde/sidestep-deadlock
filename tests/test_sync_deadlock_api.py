from __future__ import annotations

import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
import sync_deadlock_api as importer  # noqa: E402


FIXTURES = ROOT / "tests" / "fixtures" / "deadlock_api"


class ImporterTests(unittest.TestCase):
    def test_latest_version_is_selected_from_fixture(self) -> None:
        client = importer.FixtureClient(FIXTURES)
        version, response = importer.discover_latest_client_version(client)
        self.assertEqual(version, 200)
        self.assertEqual(response.payload, [100, 200])

    def test_validation_rejects_duplicate_api_ids(self) -> None:
        client = importer.FixtureClient(FIXTURES)
        raw = {"items": client.get("/v1/assets/items", {"client_version": 200}), "heroes": client.get("/v1/assets/heroes", {"client_version": 200})}
        raw = {**raw, **{name: client.get(path, {"client_version": 200}) for name, path in importer.ENDPOINTS.items() if name not in raw}}
        payload = json.loads(raw["items"].body)
        payload.append(dict(payload[0]))
        raw["items"] = importer.ApiResponse(importer.json_bytes(payload), payload, "fixture://items", "now")
        result = importer.validate_bundle(raw, 200)
        self.assertEqual(result["status"], "FAIL")
        self.assertTrue(any("doppelte" in message for message in result["errors"]))

    def test_fixture_dry_run_does_not_write(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            args = Namespace(
                base_url=importer.DEFAULT_BASE_URL,
                client_version=None,
                output_dir=temporary,
                fixture_dir=str(FIXTURES),
                dry_run=True,
                request_delay=0,
                retries=0,
                api_key_env="DEADLOCK_API_KEY",
                apply_approved=None,
            )
            result = importer.run_import(args)
            self.assertEqual(result["client_version"], 200)
            self.assertTrue(result["dry_run"])
            self.assertFalse(list(Path(temporary).rglob("*")))

    def test_fixture_sync_archives_raw_and_keeps_canonical_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            args = Namespace(
                base_url=importer.DEFAULT_BASE_URL,
                client_version=200,
                output_dir=temporary,
                fixture_dir=str(FIXTURES),
                dry_run=False,
                request_delay=0,
                retries=0,
                api_key_env="DEADLOCK_API_KEY",
                apply_approved=None,
            )
            before = (ROOT / "data" / "core" / "items.csv").read_bytes()
            result = importer.run_import(args)
            self.assertEqual(result["validation"]["status"], "PASS")
            raw_items = Path(temporary) / "versions" / "200" / "raw" / "items.json"
            self.assertTrue(raw_items.exists())
            self.assertEqual(raw_items.read_bytes(), (FIXTURES / "items.json").read_bytes())
            self.assertTrue((Path(temporary) / "versions" / "200" / "runs").exists())
            self.assertEqual(before, (ROOT / "data" / "core" / "items.csv").read_bytes())
            index = json.loads((Path(temporary) / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(index["latest_client_version"], 200)

            run_dir = next((Path(temporary) / "versions" / "200" / "runs").iterdir())
            observations = json.loads((run_dir / "schema_observations.json").read_text(encoding="utf-8"))
            self.assertIn("properties.UnknownFutureField", observations["items"]["observed_field_paths"])

    def test_changed_same_version_is_archived_as_revision(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            version_dir = Path(temporary) / "versions" / "200"
            target = version_dir / "raw" / "items.json"
            importer.atomic_write(target, b"{\"old\":true}\n")
            client = importer.FixtureClient(FIXTURES)
            response = client.get("/v1/assets/items", {"client_version": 200})
            archived = importer.archive_response(version_dir, "items", response)
            self.assertIn("revisions", archived["file"])
            self.assertEqual(target.read_bytes(), b"{\"old\":true}\n")


if __name__ == "__main__":
    unittest.main()
