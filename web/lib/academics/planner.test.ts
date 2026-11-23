import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readPlanStore, mergeImportedPlans, resolvePrograms } from "./plan-store";
import type { Offering, ProgramEntry } from "./snapshot";
import { matchingGroups, overlaps, restoreSections, sectionSelectionComplete, weekAppointments } from "./timetable";

const dataRoot = new URL("../../../../bigredradarinfo/", import.meta.url);
const roster = JSON.parse(readFileSync(new URL("SP27.json", dataRoot), "utf8")) as { classes: Offering[] };
const byCode = new Map(roster.classes.map((course) => [course.code, course]));

test("restores original plan and course IDs without granting credit for what-if grades", () => {
  const old = { v: 1, plans: [{ id: "legacy-plan", name: "Example", college: "EN", majors: ["shared-cs"],
    sems: [{ id: "spring", term: "SP27", courses: [{ u: "new-course", code: "cs3780", cr: 4,
      grade: "A", sec: { LEC: "001", PRJ: "601" } }] },
    { id: "fall", term: "FA26", courses: [{ u: "old-course", code: "CS 2110", cr: 4, grade: "B", locked: true }] }],
    petitions: [{ kind: "sub", status: "approved" }] }], active: "legacy-plan" };
  const saved = readPlanStore(old);
  assert.equal(saved.active, "legacy-plan");
  assert.equal(saved.plans[0].courses[0].id, "new-course");
  assert.equal(saved.plans[0].courses[0].status, "planned");
  assert.equal(saved.plans[0].courses[1].status, "completed");
  assert.deepEqual(saved.plans[0].legacy, old.plans[0]);
  assert.deepEqual(restoreSections(byCode.get("CS 3780")!, saved.plans[0].courses[0].legacySections!), { LEC: 6652, PRJ: 6653 });
  assert.equal(mergeImportedPlans(saved, saved).plans.length, 2);
  assert.equal(JSON.stringify(readPlanStore(JSON.parse(JSON.stringify(saved)))), JSON.stringify(saved));
});

test("leaves a shared legacy program ID open for college and degree selection", () => {
  const programs = ["cs-ba", "cs-bs", "economics-minor-ilr"].map((id): ProgramEntry => ({
    id, name: id, type: "major", listing: "catalog", source_url: "https://catalog.cornell.edu/programs/",
    existing_rule_ids: [id.startsWith("cs") ? "shared-cs" : "legacy-ilr"], pilot_rules: [],
  }));
  assert.deepEqual(resolvePrograms(["shared-cs", "legacy-ilr"], programs), ["shared-cs", "economics-minor-ilr"]);
});

test("stops mixing components across enrollment groups and leaves incomplete groups visible", () => {
  const offering = byCode.get("ART 2201")!;
  const [first] = offering.enroll_groups;
  assert.equal(matchingGroups(offering, { STU: 4953, PRJ: 4956 }).length, 0);
  assert.equal(sectionSelectionComplete(first, { STU: 4953 }), false);
  assert.equal(sectionSelectionComplete(first, { STU: 4953, PRJ: 4955 }), true);
});

test("uses SP27 meeting dates, one-off Sunday classes and published Ithaca breaks", () => {
  const ml = byCode.get("CS 3780")!;
  const meetings = weekAppointments(ml, { LEC: 6652, PRJ: 6653 }, "2027-01-25");
  assert.deepEqual(meetings.map((meeting) => [meeting.date, meeting.start]), [["2027-01-26", "13:25"], ["2027-01-28", "13:25"]]);
  assert.deepEqual(weekAppointments(ml, { LEC: 6652 }, "2027-03-29"), []);
  const sunday = byCode.get("HE 2700")!;
  assert.equal(weekAppointments(sunday, { DIS: 13167 }, "2027-02-15").some((meeting) => meeting.date === "2027-02-21"), true);
  assert.equal(weekAppointments(sunday, { DIS: 13167 }, "2027-03-01").length, 0);
  assert.equal(overlaps(meetings[0], { ...meetings[0], start: "14:40", end: "15:30" }), false);
  assert.equal(overlaps(meetings[0], { ...meetings[0], start: "14:39", end: "15:30" }), true);
});
