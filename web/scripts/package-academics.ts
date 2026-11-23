import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateAcademicSnapshot } from "../lib/server/academics";
import type { ProgramRules } from "../lib/academics/degree-progress";
import type { AcademicSnapshot } from "../lib/academics/snapshot";

const sourceFiles = ["SP27.json", "courses.json", "programs/coverage.json"] as const;

function checkListedCourses(value: unknown, known: Set<string>, missing: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) checkListedCourses(item, known, missing);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [name, item] of Object.entries(value)) {
    if (name === "codes" && Array.isArray(item)) {
      for (const code of item) if (!known.has(code)) missing.add(String(code));
    } else checkListedCourses(item, known, missing);
  }
}

export async function readAcademicFiles(source: string): Promise<AcademicSnapshot> {
  const raw = await Promise.all(sourceFiles.map((file) => readFile(resolve(source, file), "utf8")));
  const [roster, catalog, coverage] = raw.map((content) => JSON.parse(content)) as
    [AcademicSnapshot["roster"], AcademicSnapshot["catalog"], AcademicSnapshot["coverage"]];
  const files = coverage.programs.flatMap((item) => item.pilot_rules.map((pilot) => ({ item, pilot })));
  const ruleBodies = await Promise.all(files.map(async ({ pilot }) => {
    if (!/^programs\/reviewed\/[\w-]+\/[\w-]+\.json$/.test(pilot.file)) throw new Error("Invalid academic rule path");
    return readFile(resolve(source, pilot.file), "utf8");
  }));
  const rules = ruleBodies.map((body, index) => {
    const rule: ProgramRules = JSON.parse(body);
    const { item, pilot } = files[index];
    if (rule.programId !== item.id || rule.catalogYear !== coverage.catalog_year ||
        rule.version !== pilot.version || (rule.variantId ?? null) !== pilot.variant_id) {
      throw new Error(`Mismatched academic rule ${pilot.file}`);
    }
    return rule;
  });
  const sharedBodies = await Promise.all((coverage.shared_requirements ?? []).map(async ({ id, file }) => {
    if (!/^programs\/requirements\/[\w-]+\/[\w-]+\.json$/.test(file)) throw new Error("Invalid shared requirement path");
    const body = await readFile(resolve(source, file), "utf8");
    const rule: ProgramRules = JSON.parse(body);
    if (rule.programId !== id || rule.catalogYear !== coverage.catalog_year || !rule.layer) {
      throw new Error(`Mismatched shared academic requirement ${file}`);
    }
    rules.push(rule);
    return body;
  }));
  const knownCourses = new Set(catalog.courses.map((course) => course.code));
  for (const rule of rules) {
    const missing = new Set<string>();
    checkListedCourses(rule, knownCourses, missing);
    if (missing.size) throw new Error(`${rule.programId} references unknown courses: ${[...missing].sort().join(", ")}`);
  }
  rules.sort((a, b) => (b.layer ?? "").localeCompare(a.layer ?? "") || a.programId.localeCompare(b.programId) ||
    (a.variantId ?? "").localeCompare(b.variantId ?? ""));
  const hash = createHash("sha256");
  for (const body of [...raw, ...ruleBodies, ...sharedBodies]) hash.update(body);
  return { schemaVersion: 1, version: hash.digest("hex").slice(0, 16), roster, catalog, coverage, rules };
}

async function main() {
  const source = resolve(process.argv[2] ?? "../../bigredradarinfo");
  const out = resolve("academic-data");
  const snapshot = await readAcademicFiles(source);
  validateAcademicSnapshot(snapshot);
  await mkdir(out, { recursive: true });
  const staged = resolve(out, `.SP27.${process.pid}.json`);
  await writeFile(staged, JSON.stringify(snapshot));
  await rename(staged, resolve(out, "SP27.json"));
  console.log(`Packaged SP27 ${snapshot.version} with ${snapshot.roster.classes.length} listings and ${snapshot.rules.length} rule variants.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
