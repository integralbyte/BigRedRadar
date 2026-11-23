import assert from "node:assert/strict";
import test from "node:test";

import { checkPrerequisite, parsePrerequisites } from "./prerequisites";

const codes = (...values: string[]) => new Set(values);
const catalog = codes("STSCI 3080", "CS 2800", "ECON 3130", "ENGRD 2700", "MATH 4710", "MATH 2210",
  "MATH 2310", "MATH 2940", "MATH 1110", "MATH 1910", "CS 2110", "CS 3152", "ENGRC 3152", "INFO 3152");

test("keeps alternatives within each required group and reports the missing group", () => {
  const text = "STSCI 3080 or CS 2800 or ECON 3130 or ENGRD 2700 or MATH 4710; "
    + "MATH 2210 or MATH 2310 or MATH 2940; MATH 1110 or MATH 1910; CS 2110.";
  const { prerequisites } = parsePrerequisites({ code: "CS 3780", prerequisites: text }, catalog);
  const partial = codes("CS 2800", "MATH 2940", "CS 2110");
  const result = checkPrerequisite(prerequisites, partial, codes("MATH 1910"));
  assert.equal(result.status, "unmet");
  if (result.status !== "unmet") return;
  assert.deepEqual(result.missing, { operator: "any", requirements: [{ course: "MATH 1110" }, { course: "MATH 1910" }] });
  partial.add("MATH 1910");
  assert.equal(checkPrerequisite(prerequisites, partial, codes()).status, "met");
});

test("distinguishes concurrent completion from Cornell's prior-or-concurrent wording", () => {
  const sameTerm = parsePrerequisites({ code: "CS 3152", corequisites: "ENGRC 3152." }, catalog).corequisites;
  assert.equal(checkPrerequisite(sameTerm, codes(), codes("ENGRC 3152")).status, "met");
  assert.equal(checkPrerequisite(sameTerm, codes("ENGRC 3152"), codes()).status, "unmet");
  const either = parsePrerequisites({ code: "CS 3110", corequisites: "or prerequisites: CS 2800." }, catalog).corequisites;
  assert.equal(checkPrerequisite(either, codes("CS 2800"), codes()).status, "met");
  assert.equal(checkPrerequisite(either, codes(), codes("CS 2800")).status, "met");
});

test("preserves prose and avoids guessing from incomplete or ambiguous course strings", () => {
  for (const text of ["CS 2110 or equivalent.", "CS 2110 and CS 2800 or MATH 1910.", "CS 9999.", "CS 2110; or permission."]) {
    const { prerequisites } = parsePrerequisites({ code: "TEST 1000", prerequisites: text }, catalog);
    assert.equal(prerequisites.status, "needs_review");
    if (prerequisites.status === "needs_review") assert.equal(prerequisites.text, text);
  }
  const legacy = parsePrerequisites({ code: "TEST 1000", prerequisites_and_corequisites: "CS 2110." }, catalog);
  assert.equal(legacy.prerequisites.status, "needs_review");
  assert.equal(legacy.corequisites.status, "not_listed");
});

test("sends conflicting sources and changed override wording for review", () => {
  const conflict = parsePrerequisites({ code: "ENGRC 3152", corequisites: "CS 3152 and INFO 3152." }, catalog).corequisites;
  assert.equal(conflict.status, "needs_review");
  if (conflict.status === "needs_review") assert.match(conflict.reason, /department/);
  const changed = parsePrerequisites({ code: "ENGRC 3152", corequisites: "CS 3152 or INFO 3152." }, catalog).corequisites;
  assert.equal(changed.status, "needs_review");
  if (changed.status === "needs_review") assert.match(changed.reason, /changed/);
});
