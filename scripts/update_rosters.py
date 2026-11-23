#!/usr/bin/env python3
"""
Pull Cornell's Class Roster into one JSON file per term: <TERM>.json

Source: Cornell's public Class Roster API (https://classes.cornell.edu/api/2.0/), one request per second
as Cornell asks. A full term is ~200 subjects, so roughly 4 minutes per term.

Usage
  python scripts/update_rosters.py                    # the current and upcoming terms (what the scheduled job runs)
  python scripts/update_rosters.py --terms FA26,SP27  # specific terms
  python scripts/update_rosters.py --all              # every term Cornell has (FA14 on; about 3 hours)
  python scripts/update_rosters.py --missing          # every term not already present
  python scripts/update_rosters.py --terms SP27 --output-dir /tmp/roster-check
  add --since FA23 to --all or --missing to skip older terms (this repo keeps Fall 2023 on)

Also updates index.json next to the snapshots.
Standard library only.
"""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://classes.cornell.edu/api/2.0"
ROOT = Path(__file__).resolve().parent.parent
UA = "cornell-planner-data/1.0 (student project; roster sync)"
last_request = float("-inf")


def get(path, **params):
    global last_request
    url = f"{API}/{path}?{urllib.parse.urlencode(params)}"
    for attempt in range(5):
        wait = 1.0 - (time.monotonic() - last_request)
        if wait > 0:
            time.sleep(wait)
        last_request = time.monotonic()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = json.load(r)
            if body.get("status") != "success" or not isinstance(body.get("data"), dict):
                raise ValueError(f"{path} {params}: {body.get('message') or 'invalid API response'}")
            return body
        except urllib.error.HTTPError as e:
            # An error for an advertised subject cannot establish that its classes disappeared.
            if (e.code != 429 and e.code < 500) or attempt == 4:
                raise RuntimeError(f"{path} {params}: HTTP {e.code}") from e
        except (OSError, ValueError):
            if attempt == 4:
                raise
        time.sleep(2 * (attempt + 1))


def hhmm(t):
    """'10:10AM' -> '10:10' (24-hour clock); None when missing."""
    if not t:
        return None
    t = t.strip().upper()
    try:
        return datetime.datetime.strptime(t, "%I:%M%p").strftime("%H:%M")
    except ValueError:
        return t


DAY = {"M": "Mon", "T": "Tue", "W": "Wed", "R": "Thu", "F": "Fri", "S": "Sat", "Su": "Sun", "U": "Sun"}


def days(pattern):
    return [DAY[code] for code in re.findall(r"Su|[MTWRFSU]", pattern or "")]


def split_codes(s):
    return [x.strip() for x in (s or "").replace(";", ",").split(",") if x.strip()]


def distributions(attributes):
    return list(dict.fromkeys(a["crseAttrValue"] for a in attributes
                             if a.get("crseAttr") == "0012" and a.get("crseAttrValue")))


def course(c):
    groups = []
    for g in c.get("enrollGroups") or []:
        sections = []
        for s in g.get("classSections") or []:
            meetings = []
            section_attrs = s.get("crseAttrs") or []
            for m in s.get("meetings") or []:
                meetings.append({
                    "days": days(m.get("pattern")), "pattern": m.get("pattern") or None,
                    "start": hhmm(m.get("timeStart")), "end": hhmm(m.get("timeEnd")),
                    "start_date": m.get("startDt") or None, "end_date": m.get("endDt") or None,
                    "location": " ".join(x for x in [m.get("bldgDescr") or "", m.get("facilityDescr") or ""] if x).strip() or None,
                    "instructors": [{"name": f"{i.get('firstName', '')} {i.get('lastName', '')}".strip(), "netid": i.get("netid")}
                                    for i in m.get("instructors") or []],
                })
            sections.append({
                "class_nbr": s.get("classNbr"), "component": s.get("ssrComponent"), "section": s.get("section"),
                "instruction_mode": s.get("instrModeDescr") or s.get("instructionMode"), "campus": s.get("campusDescr"),
                "instruction_mode_code": s.get("instructionMode"), "campus_code": s.get("campus"),
                "location": s.get("locationDescr"), "open_status": s.get("openStatus"),
                "topic": s.get("topicDescription") or None, "consent": s.get("addConsentDescr") or None,
                "consent_code": s.get("addConsent"), "start_date": s.get("startDt"), "end_date": s.get("endDt"),
                "course_attributes": section_attrs, "distributions": distributions(section_attrs),
                "notes": [n.get("descrlong") for n in s.get("notes") or [] if n.get("descrlong")],
                "meetings": meetings,
            })
        combinations = [{"code": f"{x['subject']} {x['catalogNbr']}", "type": x.get("type")}
                        for x in g.get("simpleCombinations") or []]
        groups.append({
            "credits": {"min": g.get("unitsMinimum"), "max": g.get("unitsMaximum")},
            "grading": g.get("gradingBasisLong") or g.get("gradingBasis"),
            "components_required": g.get("componentsRequired") or [],
            "components_optional": g.get("componentsOptional") or [],
            "session": g.get("sessionLong"), "session_dates": [g.get("sessionBeginDt"), g.get("sessionEndDt")],
            "session_code": g.get("sessionCode"), "grading_code": g.get("gradingBasis"),
            "combinations": combinations,
            "cross_listed": [x["code"] for x in combinations],  # Compatibility with existing snapshot consumers.
            "sections": sections,
        })
    attrs = c.get("crseAttrs") or []
    return {
        "code": f"{c['subject']} {c['catalogNbr']}", "subject": c["subject"], "number": c["catalogNbr"],
        "title": c.get("titleLong"), "title_short": c.get("titleShort"), "crse_id": c.get("crseId"),
        "offer_number": c.get("crseOfferNbr"),
        "career": c.get("acadCareer"), "college": c.get("acadGroup"),
        "description": c.get("description"), "outcomes": c.get("catalogOutcomes") or [],
        "credits_text": c.get("catalogCredits") or None,
        "distributions": distributions(attrs) or split_codes(c.get("catalogDistr")),
        "breadth": split_codes(c.get("catalogBreadth")),
        "attributes": [a["crseAttrValue"] for a in attrs if a.get("crseAttrValue")],
        "course_attributes": attrs, "satisfies": c.get("catalogSatisfiesReq") or None,
        "when_offered": c.get("catalogWhenOffered") or None, "next_offered": c.get("catalogNextOffered") or None,
        "last_terms_offered": c.get("lastTermsOffered") or None,
        "prerequisites": c.get("catalogPrereq") or c.get("catalogPrereqCoreq") or None,
        "corequisites": c.get("catalogCoreq") or None,
        "prerequisites_and_corequisites": c.get("catalogPrereqCoreq") or None,
        "permission": c.get("catalogPermission") or None, "forbidden_overlaps": c.get("catalogForbiddenOverlaps") or None,
        "enrollment_priority": c.get("catalogEnrollmentPriority") or None, "fee": c.get("catalogFee") or None,
        "crosslisted_text": c.get("catalogCrosslistings") or None, "comments": c.get("catalogComments") or None,
        "enroll_groups": groups,
    }


def term_order(t):
    return (int(t[2:]), {"WI": 0, "SP": 1, "SU": 2, "FA": 3}.get(t[:2], 9))


def write_json(path, value, *, pretty=False):
    name = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as f:
            name = f.name
            if pretty:
                json.dump(value, f, indent=1, sort_keys=True)
            else:
                json.dump(value, f, separators=(",", ":"), ensure_ascii=False)
            f.write("\n")
        os.replace(name, path)
    finally:
        if name and os.path.exists(name):
            os.unlink(name)


def pull(term, term_id, output_dir):
    subjects = get("config/subjects.json", roster=term)["data"]["subjects"]
    if not isinstance(subjects, list) or not subjects:
        raise ValueError(f"{term}: expected a nonempty subject list")
    codes = [s["value"] for s in subjects]
    if len(set(codes)) != len(codes):
        raise ValueError(f"{term}: duplicate subject codes")
    out = []
    offerings = set()
    section_owners = {}
    roster_timestamp = None
    for i, subject in enumerate(codes, 1):
        response = get("search/classes.json", roster=term, subject=subject)
        classes = response["data"]["classes"]
        timestamp = response.get("meta", {}).get("rosterDttm")
        if not isinstance(classes, list) or not timestamp:
            raise ValueError(f"{term} {subject}: invalid roster classes or timestamp")
        if roster_timestamp is not None and roster_timestamp != timestamp:
            raise ValueError(f"{term}: Cornell updated the roster during this pull. Retry the term.")
        roster_timestamp = timestamp
        for raw in classes:
            if raw["subject"] != subject or str(raw["strm"]) != term_id:
                raise ValueError(f"{term} {subject}: unexpected subject or term in API response")
            key = (raw["crseId"], raw["crseOfferNbr"])
            if key in offerings:
                raise ValueError(f"{term} {subject}: repeated offering {key}")
            offerings.add(key)
            for group in raw["enrollGroups"]:
                for section in group["classSections"]:
                    number = section["classNbr"]
                    if not isinstance(number, int) or section_owners.setdefault(number, key) != key:
                        raise ValueError(f"{term} {subject}: invalid or reused class number {number}")
            out.append(course(raw))
        if i % 25 == 0:
            print(f"  {term}: {i}/{len(subjects)} subjects, {len(out)} classes", flush=True)
    if not out:
        raise ValueError(f"{term}: entire term is empty")
    doc = {"term": term, "term_id": term_id,
           "pulled_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
           "roster_timestamp": roster_timestamp,
           "source": API + "/",
           "subjects": [{"code": s["value"], "name": s.get("descrformal") or s.get("descr")} for s in subjects],
           "classes": out}
    write_json(output_dir / f"{term}.json", doc)
    return len(out), len(subjects)


def write_index(output_dir, available):
    # Rebuild from published snapshots so a rerun repairs an interruption between writes.
    terms = {}
    for term in available:
        snapshot = output_dir / f"{term}.json"
        if not snapshot.exists():
            continue
        with snapshot.open(encoding="utf-8") as f:
            doc = json.load(f)
        terms[term] = {"classes": len(doc["classes"]), "subjects": len(doc["subjects"]), "pulled_at": doc["pulled_at"]}
        if doc.get("roster_timestamp"):
            terms[term]["roster_timestamp"] = doc["roster_timestamp"]
    if terms:
        write_json(output_dir / "index.json", {"terms": terms, "available": sorted(terms, key=term_order)}, pretty=True)


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--terms")
    g.add_argument("--all", action="store_true")
    g.add_argument("--missing", action="store_true")
    ap.add_argument("--since", help="with --all/--missing: oldest term to pull, e.g. FA23")
    ap.add_argument("--output-dir", type=Path, default=ROOT, help="snapshot directory (default: repository root)")
    a = ap.parse_args()
    a.output_dir.mkdir(parents=True, exist_ok=True)
    with (a.output_dir / ".roster-refresh.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        return refresh(a, ap)


def refresh(a, ap):
    rosters = get("config/rosters.json")["data"]["rosters"]
    every = {r["slug"]: str(r["strm"]) for r in rosters}
    if a.terms:
        terms = [t.strip().upper() for t in a.terms.split(",")]
    elif a.all:
        terms = list(every)
    elif a.missing:
        terms = [t for t in every if not (a.output_dir / f"{t}.json").exists()]
    else:
        # Cornell's default roster, anything newer, and the one before it (late enrollment changes land there too)
        d = next((i for i, r in enumerate(rosters) if r.get("isDefaultRoster") == "Y"), len(rosters) - 1)
        terms = list(every)[max(0, d - 1):]
    unknown = set(terms) - every.keys()
    if unknown:
        ap.error(f"unknown roster: {', '.join(sorted(unknown))}")
    if a.since and (a.all or a.missing):
        terms = [t for t in terms if term_order(t) >= term_order(a.since.upper())]
    print("Pulling:", ", ".join(terms), flush=True)
    failed = 0
    for t in sorted(set(terms), key=term_order, reverse=True):  # newest first
        t0 = time.monotonic()
        try:
            n, s = pull(t, every[t], a.output_dir)
            print(f"{t}: {n} classes from {s} subjects in {time.monotonic() - t0:.0f}s", flush=True)
        except Exception as e:
            failed += 1
            print(f"{t}: FAILED ({e})", flush=True)
    write_index(a.output_dir, every)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
