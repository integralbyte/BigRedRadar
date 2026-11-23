import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parsePrerequisites } from "../academics/prerequisites";
import { courseCode, planningTerm, type AcademicSnapshot } from "../academics/snapshot";

const bundle = "academic-data/SP27.json";
export function validateAcademicSnapshot(snapshot: AcademicSnapshot) {
  const { roster, catalog, coverage, rules } = snapshot;
  if (snapshot.schemaVersion !== 1 || roster.term !== planningTerm || catalog.schema_version !== 2 ||
      !roster.roster_timestamp || !roster.classes.length || !coverage.programs.length) {
    throw new Error("Academic snapshot is incomplete or uses an unsupported format");
  }
  const subjects = roster.subjects.map((subject) => subject.code);
  const offeredSubjects = new Set(roster.classes.map((offering) => offering.subject));
  if (new Set(subjects).size !== subjects.length || offeredSubjects.size !== subjects.length ||
      subjects.some((subject) => !offeredSubjects.has(subject))) {
    throw new Error("SP27 roster does not cover every published subject");
  }
  const scheduled = new Set(catalog.courses.filter((course) => course.offered_terms.includes(planningTerm)).map((course) => course.code));
  const codes = new Set(catalog.courses.map((course) => course.code));
  if (codes.size !== catalog.courses.length) {
    throw new Error("Duplicate course codes in academic snapshot");
  }
  if (scheduled.size !== roster.classes.length || roster.classes.some((course) => !scheduled.delete(course.code))) {
    throw new Error("Course catalog and SP27 roster are from different snapshots");
  }
  const key = (id: string, variant: string | null | undefined, version: string) => JSON.stringify([id, variant ?? null, version]);
  const expected = new Set(coverage.programs.flatMap((program) =>
    program.pilot_rules.map((variant) => key(program.id, variant.variant_id, variant.version))));
  const expectedLayers = new Set(coverage.shared_requirements?.map(({ id }) => id));
  if (rules.some((rule) => rule.layer ? !expectedLayers.delete(rule.programId) :
    !expected.delete(key(rule.programId, rule.variantId, rule.version))) || expected.size || expectedLayers.size) {
    throw new Error("Program coverage and the packaged requirements do not match");
  }
}

function indexSnapshot(snapshot: AcademicSnapshot) {
  validateAcademicSnapshot(snapshot);
  const courses = new Map(snapshot.catalog.courses.map((course) => [course.code, course]));
  const offerings = new Map(snapshot.roster.classes.map((course) => [course.code, course]));
  const codes = new Set(courses.keys());
  const aliasesByTerm = new Map<string, string[]>();
  for (const course of courses.values()) {
    for (const version of course.roster_history) {
      const key = `${version.term}:${version.crse_id}`;
      const aliases = aliasesByTerm.get(key) ?? [];
      aliases.push(course.code);
      aliasesByTerm.set(key, aliases);
    }
  }
  return { snapshot, courses, offerings, codes, aliasesByTerm };
}

let cache: Promise<ReturnType<typeof indexSnapshot>> | undefined;
let checkedAt = 0;

async function loadSnapshot() {
  const path = process.env.BRR_ACADEMIC_SNAPSHOT ?? resolve(process.cwd(), bundle);
  return JSON.parse(await readFile(/* turbopackIgnore: true */ path, "utf8")) as AcademicSnapshot;
}

export async function academicData() {
  const now = Date.now();
  if (cache && now - checkedAt < 60_000) return cache;
  const previous = cache;
  checkedAt = now;
  cache = loadSnapshot().then(indexSnapshot).catch((error) => {
    console.error("Academic snapshot unavailable", error);
    if (previous) return previous;
    cache = undefined;
    throw error;
  });
  return cache;
}

export function academicCourse(data: Awaited<ReturnType<typeof academicData>>, code: string, term: string) {
  const course = data.courses.get(courseCode(code));
  if (!course) return undefined;
  const offering = term === planningTerm ? data.offerings.get(course.code) : undefined;
  const history = course.roster_history.find((version) => version.term === term);
  const creditKey = history ? `${history.crse_id}` : course.code;
  const crossListedCodes = history ? (data.aliasesByTerm.get(`${term}:${history.crse_id}`) ?? []).filter((alias) => alias !== course.code) : [];
  const credit = history?.credits;
  return { course, offering, creditKey, crossListedCodes, distributions: history?.distributions ?? [], attributes: history?.attributes ?? [],
    academicCollege: history?.academic_college, fixedCredits: credit?.min != null && credit.min === credit.max,
    writingSeminar: !!history?.title?.match(/^FWS\b/i), passFailOnly: history?.pass_fail_only,
    requiredComponents: history?.required_components,
    rules: offering ? parsePrerequisites(offering, data.codes) : undefined };
}
