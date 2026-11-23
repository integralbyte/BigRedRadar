#!/usr/bin/env python3
"""
Turn the planner's compact catalog (source/catalog.js) into plain JSON a website can use directly.

Writes
  courses.json             catalog courses and published term evidence
  programs/majors.json     major rules
  programs/minors.json     minor rules
  programs/colleges.json   college-level requirements (distributions, FWS, language, ...)
  programs/university.json university-wide requirements (PE, swim test, ...)
  programs/index.json      one line per program: id, name, type, status, file

Every requirement slot carries a plain `rule` (what counts) and, when the list is not huge, the exact
`eligible_courses` resolved against data/courses.json, so a site can show "what counts" without
re-implementing the matching logic. See README.md for the full schema.

Run after rebuilding source/catalog.js (scripts/rebuild_programs.sh does both).
"""
import argparse, json, os, re, sys
from pathlib import Path

from catalog_index import add_catalog_supplements, merge_rosters, retain_previous_courses
from update_rosters import write_json

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "source", "catalog.js")
parser = argparse.ArgumentParser()
parser.add_argument("--courses-only", action="store_true", help="refresh only the course catalog")
parser.add_argument("--output-dir", type=Path, default=Path(ROOT))
parser.add_argument("--roster-dir", type=Path, default=Path(ROOT), help="directory containing the staged term snapshots")
args = parser.parse_args()
DATA = args.output_dir
DATA.mkdir(parents=True, exist_ok=True)
MAX_LIST = 1500   # longer eligible lists are left out (the rule still says what counts)

raw = open(SRC).read()
D = json.loads(raw[raw.index("=") + 1:].rstrip().rstrip(";"))
CAT, POOLS, CIDS, LINKS = D["cat"], D["pools"], D["cids"], D.get("links", {})

SEASON = {"F": "Fall", "S": "Spring", "W": "Winter", "U": "Summer"}

# ---------- merge in the pulled rosters (newer courses, current distribution codes) ----------
history, published_terms = merge_rosters(CAT, CIDS, args.roster_dir)
previous_catalog = Path(ROOT) / "courses.json"
retained = set()
if previous_catalog.exists():
    with previous_catalog.open(encoding="utf-8") as f:
        retained = retain_previous_courses(CAT, CIDS, json.load(f)["courses"])
CAT.sort(key=lambda r: (r[0], r[1]))
split = lambda s: [x for x in (s or "").split(",") if x]
norm_title = lambda t: re.sub(r"[^a-z0-9]+", " ", str(t or "").lower()).strip()

# ---------- courses ----------
by_cid = {}
for r in CAT:
    by_cid.setdefault(r[5], []).append(r)
code_of = lambda r: f"{r[0]} {r[1]}"
codes_for_cid = lambda cid: sorted(code_of(r) for r in by_cid.get(cid, []))

courses = []
for r in CAT:
    code = code_of(r)
    linked = sorted({c for x in LINKS.get(str(r[5]), []) for c in codes_for_cid(x)})
    alternate_codes = [c for c in codes_for_cid(r[5]) if c != code]
    versions = history.get(code, [])
    courses.append({
        "code": code, "subject": r[0], "number": r[1], "title": r[2],
        "credits": {"min": r[3], "max": r[4]},
        "crse_id": CIDS[r[5]] if 0 <= r[5] < len(CIDS) else None,
        "distributions": split(r[6]),
        "when_offered": [SEASON[c] for c in (r[7] or "") if c in SEASON],
        "last_offered": r[8] or None,
        "career": r[9] or None,
        "attributes": split(r[10]),
        "cross_listed": alternate_codes,
        "alternate_codes": alternate_codes,
        "same_course_as": linked,
        "offered_terms": list(dict.fromkeys(v["term"] for v in versions)),
        "roster_history": versions,
        **({"catalog_record_source": "previous_catalog"} if code in retained else {}),
    })

with (Path(ROOT) / "source" / "catalog_supplements.json").open(encoding="utf-8") as f:
    add_catalog_supplements(courses, json.load(f))

meta = {"generated_from": "source/catalog.js", "catalog_built": D.get("built")}
write_json(DATA / "courses.json", {
    **meta,
    "schema_version": 2,
    "catalog_scope": "Cornell DTI historical catalog seed, Cornell Class Roster snapshots, and individually verified University Catalog entries",
    "published_terms": published_terms,
    "count": len(courses),
    "courses": courses,
})
if args.courses_only:
    print(f"courses: {len(courses)} with {len(published_terms)} published terms")
    sys.exit(0)

# ---------- matching (same rules as the planner's matchF) ----------
def pool_cids(i):
    acc, out = 0, set()
    for d in (POOLS[i] or "").split(","):
        if d:
            acc += int(d, 16)
            out.add(acc)
    return out

def row_matches(f, r):
    if "any" in f:
        shared = {key: value for key, value in f.items() if key not in ("any", "minCr")}
        default_credits = {"minCr": f["minCr"]} if "minCr" in f else {}
        return row_matches(shared, r) and any(row_matches({**default_credits, **choice}, r) for choice in f["any"])
    sibs = by_cid.get(r[5], [r])
    codes = {code_of(x) for x in sibs}
    if f.get("not") and any(x in codes for x in f["not"]): return False
    if f.get("notSubj") and r[0] in f["notSubj"]: return False
    if f.get("titles") and norm_title(r[2]) not in [norm_title(t) for t in f["titles"]]: return False
    if f.get("codes") and not any(re.sub(r"\s+", " ", x.upper()) in codes for x in f["codes"]): return False
    if f.get("subj") or any(key in f for key in ("lo", "hi", "notNum")):
        ok = False
        for c in codes:
            s, n = c.split(" ", 1)
            try: num = int(re.match(r"\d+", n).group())
            except Exception: continue
            if f.get("subj") and s not in f["subj"]: continue
            if f.get("lo") is not None and num < f["lo"]: continue
            if f.get("hi") is not None and num > f["hi"]: continue
            if f.get("notNum") and any(p == n or ("X" in p and len(p) == len(n) and all(a == "X" or a == b for a, b in zip(p, n))) for p in f["notNum"]): continue
            ok = True; break
        if not ok: return False
    if f.get("distr"):
        toks = set()
        for x in sibs:
            for t in split(x[6]): toks.add(t); toks.add(t.split("-")[0])
        if not any(d in toks for d in f["distr"]): return False
    if f.get("attr"):
        toks = {t for x in sibs for t in split(x[10])}
        if not any(a in toks for a in f["attr"]): return False
    if f.get("minCr") is not None and not (r[4] or 0) >= f["minCr"]: return False
    return True

def rule(f):
    """The planner's filter in plain words."""
    if not f: return None
    out = {}
    m = {"codes": "courses", "subj": "subjects", "lo": "number_min", "hi": "number_max", "not": "excluded_courses",
         "notNum": "excluded_numbers", "notSubj": "excluded_subjects", "distr": "distributions", "attr": "attributes",
         "titles": "titles", "minCr": "min_credits"}
    for k, v in f.items():
        if k == "any": out["any_of"] = [rule(g) for g in v]
        elif k in m: out[m[k]] = v
        else: out[k] = v
    return out

def slot(s, unit):
    pool = sorted({c for cid in pool_cids(s["p"]) for c in codes_for_cid(cid)}) if s.get("p") is not None else []
    f = s.get("f")
    if f:
        matched = sorted({code_of(r) for r in CAT if row_matches(f, r)})
        eligible = sorted(set(pool) | set(matched))
    else:
        eligible = pool
    out = {"name": s.get("n"), "need": s.get("k"), "unit": unit}
    if pool: out["listed_courses"] = pool
    if f: out["rule"] = rule(f)
    out["eligible_count"] = len(eligible)
    out["eligible_courses"] = eligible if len(eligible) <= MAX_LIST else None
    return out

TYPE = {"c": "courses", "cr": "credits", "tg": "choose_option", "cats": "categories", "sc": "checkbox", "total": "total_credits", "manual": "advisor_assigned"}

def requirement(r):
    t = r.get("t")
    out = {"name": r.get("n"), "type": TYPE.get(t, t), "description": r.get("d") or None}
    if r.get("w"): out["warning"] = r["w"]
    if r.get("src"): out["source_url"] = r["src"]
    if r.get("dbl"): out["can_double_count"] = True
    if r.get("excl"): out["exclusive"] = True
    if r.get("dbl2"): out["two_category_courses_allowed"] = 2
    unit = "credits" if t == "cr" else "courses"
    if t in ("c", "cr"):
        out["slots"] = [slot(s, unit) for s in r.get("slots") or []]
        if r.get("min"): out["complete_any"] = r["min"]
    elif t == "tg":
        out["options"] = [{"name": n, "description": o.get("d") or None,
                           "slots": [slot(s, "credits" if o.get("t") == "cr" else "courses") for s in o.get("slots") or []],
                           **({"complete_any": o["min"]} if o.get("min") else {})}
                          for n, o in (r.get("opts") or {}).items()]
    elif t == "cats":
        out["courses_needed"] = r.get("k"); out["min_categories"] = r.get("minCats"); out["max_per_category"] = r.get("maxPer")
        cats = []
        for c in r.get("cats") or []:
            el = sorted({code_of(x) for x in CAT if row_matches(c["f"], x)})
            cats.append({"name": c["n"], "rule": rule(c["f"]), "eligible_count": len(el), "eligible_courses": el if len(el) <= MAX_LIST else None})
        out["categories"] = cats
    elif t == "total":
        out["credits_needed"] = r.get("k")
    return out

KIND = {"major": "majors", "minor": "minors", "college": "colleges", "university": "university"}
groups = {v: [] for v in KIND.values()}
index = []
for p in D["progs"]:
    verified = p.get("origin") == "new"
    doc = {
        "id": p["id"], "type": p["kind"], "name": p["name"],
        "status": "verified" if verified else "unverified",
        "catalog_year": p.get("verified") or ("2026-27" if verified else None),
        "source_url": p.get("src"),
        "colleges": p.get("schools") or None,
        "requirements": [requirement(r) for r in p["reqs"]],
    }
    if not verified:
        doc["note"] = "From older third-party data (Cornell DTI CoursePlan); not checked against the current catalog."
    groups[KIND[p["kind"]]].append(doc)
    index.append({"id": p["id"], "name": p["name"], "type": p["kind"], "status": doc["status"], "file": f"programs/{KIND[p['kind']]}.json"})

os.makedirs(os.path.join(DATA, "programs"), exist_ok=True)
for name, items in groups.items():
    items.sort(key=lambda x: (x["status"] != "verified", x["name"]))
    json.dump({**meta, "count": len(items), "programs": items}, open(os.path.join(DATA, "programs", f"{name}.json"), "w"), indent=1, ensure_ascii=False)
index.sort(key=lambda x: (x["type"], x["status"] != "verified", x["name"]))
json.dump({**meta, "programs": index}, open(os.path.join(DATA, "programs", "index.json"), "w"), indent=1, ensure_ascii=False)
print(f"courses: {len(courses)}; " + "; ".join(f"{k}: {len(v)} ({sum(x['status'] == 'verified' for x in v)} verified)" for k, v in groups.items()))
