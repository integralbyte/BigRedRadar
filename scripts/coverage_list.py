"""Reconcile the official program inventory with available Big Red Radar rules."""

from collections import Counter, defaultdict
import json
from pathlib import Path

from update_rosters import write_json


ROOT = Path(__file__).resolve().parent.parent


def read_json(path):
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def main():
    inventory = read_json(ROOT / "source" / "program_index_2026_27.json")
    program_dir = ROOT / "programs"
    reviewed = defaultdict(list)
    variants = set()
    for path in sorted((program_dir / "reviewed" / inventory["catalog_year"]).glob("*.json")):
        program = read_json(path)
        if program["catalogYear"] != inventory["catalog_year"] or not program["sources"]:
            raise ValueError(f"{path}: program rules must name the governing catalog and sources")
        variant = (program["programId"], program.get("variantId"))
        if variant in variants:
            raise ValueError(f"{path}: duplicate program variant {variant}")
        variants.add(variant)
        reviewed[program["programId"]].append({
            "variant_id": program.get("variantId"), "version": program["version"], "reviewed_on": program["reviewedOn"],
            "scope": program["scope"], "file": path.relative_to(ROOT).as_posix(),
        })
    existing = {}
    for filename in ("majors.json", "minors.json"):
        for program in read_json(program_dir / filename)["programs"]:
            existing[program["id"]] = program

    shared_requirements = []
    for path in sorted((program_dir / "requirements" / inventory["catalog_year"]).glob("*.json")):
        rule = read_json(path)
        if rule["catalogYear"] != inventory["catalog_year"] or rule["layer"] not in ("college", "university") or not rule["sources"]:
            raise ValueError(f"{path}: invalid shared requirement layer")
        shared_requirements.append({"id": rule["programId"], "file": path.relative_to(ROOT).as_posix()})

    seen = set()
    workbook_rows = set()
    matched = set()
    summary = {kind: Counter() for kind in ("major", "minor")}
    programs = []
    for row in inventory["programs"]:
        key = (row["type"], row["id"])
        if key in seen:
            raise ValueError(f"Duplicate program {key}")
        seen.add(key)
        for number in row["workbook_rows"]:
            if number in workbook_rows:
                raise ValueError(f"Workbook row {number} matches multiple programs")
            workbook_rows.add(number)
        candidates = []
        for rule_id in row["existing_rule_ids"]:
            rule = existing.get(rule_id)
            if rule is None or rule["type"] != row["type"]:
                raise ValueError(f"{row['id']}: invalid existing rule {rule_id}")
            matched.add(rule_id)
            candidates.append({"id": rule_id, "original_status": rule["status"], "catalog_year": rule["catalog_year"]})
        pilot_rules = reviewed.pop(row["id"], [])
        if pilot_rules:
            status = "pilot_rules"
        else:
            status = "existing_rules_to_review" if candidates else "missing_rules"
        summary[row["type"]][status] += 1
        programs.append({**row, "status": status, "existing_rules": candidates, "pilot_rules": pilot_rules})

    if workbook_rows != set(range(2, 222)):
        raise ValueError("Expected all 220 workbook rows to map to the program inventory")
    if reviewed:
        raise ValueError(f"Rules for unknown programs: {', '.join(sorted(reviewed))}")
    document = {**inventory, "summary": summary, "workbook_rows": len(workbook_rows), "programs": programs,
                "shared_requirements": shared_requirements,
                "unmatched_existing_rule_ids": sorted(existing.keys() - matched)}
    write_json(program_dir / "coverage.json", document, pretty=True)
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
