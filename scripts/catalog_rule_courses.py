"""Add missing course identities when a reviewed official curriculum supplies a title."""

import argparse
from collections import defaultdict
import json
from pathlib import Path
import re
import sys

from catalog_evidence import text
from update_rosters import write_json

ROOT = Path(__file__).resolve().parent.parent
COURSE = re.compile(r"^[A-Z]{2,12} \d{4}[A-Z]?$")
CREDITS = re.compile(r"(\d+(?:\.\d+)?|\.\d+)(?:\s*[–-]\s*(\d+(?:\.\d+)?))?")


def listed_codes(config):
    if isinstance(config, dict):
        for key, value in config.items():
            if key == "codes":
                yield from value
            else:
                yield from listed_codes(value)
    elif isinstance(config, list):
        for child in config:
            yield from listed_codes(child)


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def collect_records(page, missing):
    curriculum = page["sections"]["Curriculum"]
    for node in curriculum["nodes"]:
        if text(node.get("text", "")).startswith("University Graduation Requirements"):
            break
        if node["tag"] != "TABLE":
            continue
        for row in node["rows"]:
            if len(row["cells"]) != 3:
                continue
            code_cell, title_cell, credit_cell = row["cells"]
            linked = {text(link) for link in code_cell["courseLinks"]}
            if len(linked) != 1:
                continue
            code = next(iter(linked))
            if code not in missing or not COURSE.fullmatch(code):
                continue
            title = re.sub(r"\s*\(crosslisted\)\s*.*$", "", text(title_cell["text"]), flags=re.IGNORECASE)
            if not title or "(" == title[0]:
                continue
            credit = CREDITS.fullmatch(text(credit_cell["text"]))
            low = float(credit[1]) if credit else None
            high = float(credit[2] or credit[1]) if credit else None
            yield {"code": code, "title": title, "credits": {"min": low, "max": high}, "source_url": page["url"]}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("captures", type=Path)
    cli.add_argument("--write", action="store_true", help="append exact catalogue evidence to the supplements")
    args = cli.parse_args()
    destination = ROOT / "source/catalog_supplements.json"
    prior = read_json(destination)
    existing = {course["code"] for course in read_json(ROOT / "courses.json")["courses"]}
    existing.update(entry["code"] for entry in prior)
    expected = defaultdict(set)
    for path in sorted((ROOT / "programs/reviewed/2026-27").glob("*.json")):
        rule = read_json(path)
        for code in sorted(set(listed_codes(rule)) - existing):
            expected[code].add(rule["programId"])

    observations = defaultdict(list)
    program_ids = set().union(*expected.values())
    for entity in sorted(program_ids):
        path = args.captures / f"{entity}.json"
        if path.exists():
            for item in collect_records(read_json(path), set(expected)):
                observations[item["code"]].append(item)
    new = []
    for code, options in observations.items():
        # Keep the more precise credit range where all linked program tables supply the same title.
        if len({item["title"].casefold() for item in options}) == 1:
            new.append(next((option for option in options if option["credits"]["min"] is not None), options[0]))
    resolved = {item["code"] for item in new}
    if args.write and new:
        write_json(destination, sorted([*prior, *new], key=lambda item: item["code"]), pretty=True)
    outstanding = {code: sorted(owners) for code, owners in sorted(expected.items()) if code not in resolved}
    print(json.dumps({"catalog_courses_found": len(new), "rule_references_to_verify": outstanding}, indent=2))
    return int(bool(outstanding))


if __name__ == "__main__":
    sys.exit(main())
