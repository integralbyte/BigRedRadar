#!/usr/bin/env python3
"""Fingerprint observed Cornell program sections and report differences for review."""

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import unicodedata
from urllib.parse import urlsplit

from update_rosters import write_json


ROOT = Path(__file__).resolve().parent.parent
COURSE = re.compile(r"^[A-Z]{2,12} ?\d{4}[A-Z]?$")
STRUCTURAL_CLASSES = {"areaheader", "areasubheader", "orclass", "sum", "hourscol", "codecol", "footnote"}


def text(value):
    return " ".join(unicodedata.normalize("NFKC", value).split())


def structure(classes):
    return sorted(set(classes.split()) & STRUCTURAL_CLASSES)


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def describe_panel(nodes):
    counts = Counter()
    sections = []
    course_codes = set()
    for node in nodes:
        tag = node["tag"]
        if tag == "TABLE":
            counts["tables"] += 1
            rows = []
            for row in node["rows"]:
                cells = []
                for cell in row["cells"]:
                    links = [text(link) for link in cell["courseLinks"]]
                    for link in links:
                        if COURSE.fullmatch(link):
                            course_codes.add(link)
                    cells.append([text(cell["text"]), cell["span"], structure(cell["style"]), links])
                rows.append([structure(row["style"]), cells])
            sections.append([tag, rows])
        elif node.get("text"):
            if tag in {"H2", "H3", "H4", "H5"}:
                counts["headings"] += 1
            if tag == "DL":
                counts["notes"] += 1
            sections.append([tag, text(node["text"])])
    if not sections:
        raise ValueError("The page panel has no visible content")
    return {"sha256": fingerprint(sections), "table_count": counts["tables"], "heading_count": counts["headings"],
            "footnote_block_count": counts["notes"], "verified_course_link_count": len(course_codes)}


def summarize(program, folder):
    path = folder / f"{program['id']}.json"
    with path.open(encoding="utf-8") as file:
        page = json.load(file)
    observed = urlsplit(page["url"])
    expected = urlsplit(program["source_url"])
    if page["id"] != program["id"] or observed.netloc != expected.netloc or observed.path.rstrip("/") != expected.path.rstrip("/"):
        raise ValueError("The captured page does not match the inventory URL")
    if not {"Overview", "Curriculum"}.issubset(page["sections"]):
        raise ValueError("Overview or Curriculum is missing")
    return {"url": program["source_url"],
            "sections": {name: describe_panel(panel["nodes"]) for name, panel in page["sections"].items()}}


def compare(previous, current):
    report = {}
    for id in sorted(previous.keys() | current.keys()):
        a, b = previous.get(id), current.get(id)
        if a is None or b is None:
            report[id] = {"status": "new_source" if a is None else "source_not_in_current_index"}
            continue
        changes = sorted(name for name in a["sections"].keys() | b["sections"].keys()
                         if a["sections"].get(name) != b["sections"].get(name))
        if changes or a["url"] != b["url"]:
            report[id] = {"status": "changed", "sections": changes, "url": b["url"]}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("captures", type=Path)
    parser.add_argument("--inventory", type=Path, default=ROOT / "source/program_index_2026_27.json")
    parser.add_argument("--establish-baseline", type=Path, help="Write a baseline to a new file for an observed catalog edition")
    parser.add_argument("--compare-with", type=Path)
    args = parser.parse_args()
    inventory = json.loads(args.inventory.read_text(encoding="utf-8"))
    observations, errors = {}, {}
    expected = [program for program in inventory["programs"] if program["listing"] == "catalog"]
    for program in expected:
        try:
            observations[program["id"]] = summarize(program, args.captures)
        except (KeyError, ValueError, OSError) as error:
            errors[program["id"]] = str(error)
    if args.establish_baseline:
        if errors:
            print(json.dumps({"failed_reads": errors}, indent=2))
            return 1
        if args.establish_baseline.exists():
            parser.error("Choose a new baseline file. Review changes before replacing a baseline.")
        write_json(args.establish_baseline, {"catalog_year": inventory["catalog_year"],
            "observations": observations}, pretty=True)
    changes = {}
    if args.compare_with:
        baseline = json.loads(args.compare_with.read_text(encoding="utf-8"))["observations"]
        safe_baseline = {id: value for id, value in baseline.items() if id not in errors}
        changes = compare(safe_baseline, observations)
    print(json.dumps({"observations": len(observations), "changes": changes, "failed_reads": errors}, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
