import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts import update_rosters as roster


def response(classes, timestamp="2026-11-22T19:06:53-0500"):
    return {"data": {"classes": classes}, "meta": {"rosterDttm": timestamp}}


def offering(subject="CS", course_id=358592):
    return {"subject": subject, "catalogNbr": "3780", "strm": 2951, "crseId": course_id, "crseOfferNbr": 1,
            "enrollGroups": []}


class RosterTests(unittest.TestCase):
    def test_current_and_legacy_fields(self):
        raw = offering()
        raw.update(catalogPrereq="CS 2110.", catalogCoreq="MATH 2940.",
                   crseAttrs=[{"crseAttr": "0012", "crseAttrValue": "SDS-AS"},
                              {"crseAttr": "0001", "crseAttrValue": "CU-CEL"}])
        raw["enrollGroups"] = [{"simpleCombinations": [{"subject": "CS", "catalogNbr": "5780", "type": "B"}],
                                "classSections": [{"meetings": [{"pattern": "SSu"}, {"pattern": "Su"}, {}]}]}]
        normalized = roster.course(raw)
        self.assertEqual(normalized["prerequisites"], "CS 2110.")
        self.assertEqual(normalized["corequisites"], "MATH 2940.")
        self.assertEqual(normalized["distributions"], ["SDS-AS"])
        self.assertEqual(normalized["attributes"], ["SDS-AS", "CU-CEL"])
        group = normalized["enroll_groups"][0]
        self.assertEqual(group["combinations"], [{"code": "CS 5780", "type": "B"}])
        self.assertEqual([m["days"] for m in group["sections"][0]["meetings"]], [["Sat", "Sun"], ["Sun"], []])

        legacy = roster.course({**offering(), "catalogPrereqCoreq": "CS 2110 or equivalent.", "catalogDistr": "SDS-AS"})
        self.assertEqual(legacy["prerequisites_and_corequisites"], legacy["prerequisites"])
        self.assertIsNone(legacy["corequisites"])
        self.assertEqual(legacy["distributions"], ["SDS-AS"])

    def test_incomplete_or_mixed_pull_keeps_last_snapshot(self):
        subjects = {"data": {"subjects": [{"value": "CS"}, {"value": "MATH"}]}}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            existing = output / "SP27.json"
            existing.write_text('{"published":true}')
            failures = [RuntimeError("MATH: HTTP 404"), response([offering("MATH", 2)], "changed")]
            for failure in failures:
                with self.subTest(failure=failure), patch.object(roster, "get", side_effect=[subjects, response([offering()]), failure]):
                    with self.assertRaises((RuntimeError, ValueError)):
                        roster.pull("SP27", "2951", output)
                    self.assertEqual(existing.read_text(), '{"published":true}')

    def test_successful_empty_subject_is_counted(self):
        subjects = {"data": {"subjects": [{"value": "CS"}, {"value": "MATH"}]}}
        with tempfile.TemporaryDirectory() as directory, patch.object(roster, "get", side_effect=[subjects, response([offering()]), response([])]):
            output = Path(directory)
            self.assertEqual(roster.pull("SP27", "2951", output), (1, 2))
            roster.write_index(output, {"SP27": "2951"})
            snapshot = json.loads((output / "SP27.json").read_text())
            index = json.loads((output / "index.json").read_text())
            self.assertEqual(index["terms"]["SP27"]["roster_timestamp"], snapshot["roster_timestamp"])
            self.assertEqual(index["terms"]["SP27"]["pulled_at"], snapshot["pulled_at"])
