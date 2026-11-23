import json
from pathlib import Path
import tempfile
import unittest

from scripts.catalog_index import merge_rosters, retain_previous_courses


class CatalogIndexTests(unittest.TestCase):
    def test_versions_do_not_mix_ids_or_use_stale_distribution_codes(self):
        rows = [["CS", "1000", "Seed title", 3, 3, 0, "SMR-AS", "F", "FA25", "UG", "SMR-AS"]]
        ids = [100]
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            for term, course_id in (("FA26", 100), ("SP27", 200)):
                roster = {"term": term, "classes": [{
                    "code": "CS 1000", "subject": "CS", "number": "1000", "title": "New title", "career": "UG",
                    "crse_id": course_id, "offer_number": 1, "distributions": [], "course_attributes": [],
                    "enroll_groups": [{"credits": {"min": 2, "max": 4}}],
                }]}
                (directory / f"{term}.json").write_text(json.dumps(roster))
            history, terms = merge_rosters(rows, ids, directory)

        self.assertEqual(terms, ["FA26", "SP27"])
        self.assertEqual([v["crse_id"] for v in history["CS 1000"]], [100, 200])
        self.assertEqual(rows[0][2:], ["New title", 2, 4, 1, "", "", "SP27", "UG", ""])

    def test_removed_listing_remains_a_catalog_course(self):
        rows, ids = [], []
        previous = [{"code": "CS 1000", "subject": "CS", "number": "1000", "title": "Title", "career": "UG",
                     "crse_id": 100, "credits": {"min": 3, "max": 3}, "distributions": [], "attributes": []}]
        self.assertEqual(retain_previous_courses(rows, ids, previous), {"CS 1000"})
        self.assertIsNone(rows[0][8])
        self.assertEqual(ids, [100])
