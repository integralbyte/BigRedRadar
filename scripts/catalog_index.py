"""Merge the existing course catalog with evidence from published term snapshots."""

from collections import defaultdict
import json
from pathlib import Path
import re


def term_key(term):
    return int(term[2:]), {"WI": 0, "SP": 1, "SU": 2, "FA": 3}[term[:2]]


def roster_paths(directory):
    return sorted((p for p in directory.glob("*.json") if re.fullmatch(r"(?:WI|SP|SU|FA)\d{2}", p.stem)),
                  key=lambda p: term_key(p.stem))


def course_version(raw, term):
    credits = [g["credits"] for g in raw["enroll_groups"] if g.get("credits")]
    grading_codes = {g.get("grading_code") for g in raw["enroll_groups"]}
    component_sets = [set(g.get("components_required", [])) for g in raw["enroll_groups"]]
    minimums = [pair["min"] for pair in credits if pair["min"] is not None]
    maximums = [pair["max"] for pair in credits if pair["max"] is not None]
    version = {
        "term": term,
        "crse_id": raw["crse_id"],
        "title": raw.get("title"),
        "academic_college": raw.get("college"),
        "pass_fail_only": bool(grading_codes) and grading_codes <= {"SUI", "SUS", "SUX"},
        "credits": {"min": min(minimums, default=None), "max": max(maximums, default=None)},
    }
    if component_sets:
        version["required_components"] = sorted(set.intersection(*component_sets))
    if raw.get("offer_number") is not None:
        version["offer_number"] = raw["offer_number"]
    if "course_attributes" in raw or raw.get("distributions"):
        version["distributions"] = raw["distributions"]
    if "course_attributes" in raw or raw.get("attributes"):
        version["attributes"] = raw.get("attributes", [])
    return version


def merge_rosters(rows, course_ids, directory):
    by_code = {f"{r[0]} {r[1]}": r for r in rows}
    id_positions = {course_id: i for i, course_id in enumerate(course_ids)}
    history = defaultdict(list)
    published_terms = []
    for path in roster_paths(Path(directory)):
        with path.open(encoding="utf-8") as f:
            snapshot = json.load(f)
        term = snapshot["term"]
        if term != path.stem:
            raise ValueError(f"{path}: contains {term} instead of {path.stem}")
        published_terms.append(term)
        for course in snapshot["classes"]:
            code = course["code"]
            version = course_version(course, term)
            history[code].append(version)
            if version["crse_id"] not in id_positions:
                id_positions[version["crse_id"]] = len(course_ids)
                course_ids.append(version["crse_id"])
            pos = id_positions[version["crse_id"]]
            prior = by_code.get(code)
            if prior is None:
                prior = [course["subject"], course["number"], "", None, None, pos, "", "", term, "", ""]
                by_code[code] = prior
                rows.append(prior)
            if term_key(term) < term_key(prior[8] or "WI00"):
                continue
            if prior[5] != pos:
                prior[3:8] = [None, None, pos, "", ""]
                prior[10] = ""
            prior[8] = term
            prior[2] = course.get("title") or prior[2]
            prior[9] = course.get("career") or prior[9]
            if version["credits"]["min"] is not None:
                prior[3] = version["credits"]["min"]
            if version["credits"]["max"] is not None:
                prior[4] = version["credits"]["max"]
            if "distributions" in version:
                prior[6] = ",".join(version["distributions"])
            if "course_attributes" in course or course.get("attributes"):
                prior[10] = ",".join(course.get("attributes", []))
    return history, published_terms


def retain_previous_courses(rows, course_ids, previous):
    """Keep course identities when a listing disappears from the published roster."""
    by_code = {f"{r[0]} {r[1]}" for r in rows}
    id_positions = {course_id: i for i, course_id in enumerate(course_ids)}
    retained = set()
    for course in previous:
        code = course["code"]
        if code in by_code or course.get("catalog_record_source") == "university_catalog":
            continue
        course_id = course["crse_id"]
        if course_id not in id_positions:
            id_positions[course_id] = len(course_ids)
            course_ids.append(course_id)
        rows.append([course["subject"], course["number"], course["title"], course["credits"]["min"],
                     course["credits"]["max"], id_positions[course_id], ",".join(course["distributions"]),
                     "", None, course["career"], ",".join(course["attributes"])])
        retained.add(code)
    return retained


def add_catalog_supplements(courses, supplements):
    known = {course["code"] for course in courses}
    for entry in supplements:
        if entry["code"] in known:
            continue
        subject, number = entry["code"].split()
        courses.append({
            **entry, "subject": subject, "number": number, "crse_id": None, "career": "UG",
            "catalog_record_source": "university_catalog", "distributions": [], "attributes": [],
            "when_offered": [], "last_offered": None, "cross_listed": [], "alternate_codes": [],
            "same_course_as": [], "offered_terms": [], "roster_history": [],
        })
        known.add(entry["code"])
    courses.sort(key=lambda course: (course["subject"], course["number"]))
