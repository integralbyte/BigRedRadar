import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { degreeProgress, type Attempt, type ProgramRules } from "./degree-progress";
import { reviewProgramOverlap } from "./program-overlap";

function program(file: string, directory = "reviewed"): ProgramRules {
  return JSON.parse(readFileSync(new URL(
    `../../../../bigredradarinfo/programs/${directory}/2026-27/${file}.json`,
    import.meta.url,
  ), "utf8"));
}

const rules = program("economics-minor-ilr");

function completed(code: string, grade = "A"): Attempt {
  const [subject, number] = code.split(" ");
  return { id: code, code, subject, number: Number(number), credits: 3, status: "completed", grade, origin: "cornell" };
}

const ilr = { college: "IL", transfer: false };
const standard = ["ECON 1110", "ECON 1120", "MATH 1110", "ECON 3030", "ECON 3040", "ECON 3130",
  "ECON 3140", "ECON 3850", "ECON 4020", "ECON 2850"].map((code) => completed(code));

test("checks the Cornell Economics minor and keeps calculus outside the nine-course pool", () => {
  const result = degreeProgress(rules, standard, ilr);
  assert.equal(result.eligibleCollege, true);
  assert.equal(result.needsAllocationReview, false);
  assert.equal(result.slots.filter((slot) => slot.id !== "calculus").reduce((sum, slot) => sum + slot.earned.count, 0), 9);
  assert.ok(result.slots.every((slot) => slot.earned.count >= slot.need));
  assert.deepEqual(result.manual.map((item) => item.id), ["certification"]);
  assert.equal(degreeProgress(rules, standard, { ...ilr, college: "AS" }).eligibleCollege, false);
});

test("enforces elective limits, excludes independent study, and separates planned from earned", () => {
  const history = standard.filter((attempt) => attempt.code !== "ECON 4020");
  const candidates = [...history, completed("ECON 4999"), completed("ECON 2530"),
    { ...completed("ECON 4020"), status: "planned" } as Attempt];
  const result = degreeProgress(rules, candidates, ilr);
  const advanced = result.slots.find((slot) => slot.id === "advanced")!;
  assert.equal(advanced.earned.count, 1);
  assert.equal(advanced.projected.count, 2);
  assert.equal(result.slots.find((slot) => slot.id === "elective")?.earned.count, 1);
});

test("grade thresholds and department approvals are checked separately from course identity", () => {
  const lowGrade = standard.map((attempt) => attempt.code === "ECON 1110" ? { ...attempt, grade: "C+" } : attempt);
  assert.equal(degreeProgress(rules, lowGrade, ilr).slots.find((slot) => slot.id === "micro-intro")?.earned.count, 0);
  const placement: Attempt = { ...completed("ECON 1110"), id: "placement", grade: undefined, origin: "exam", approvals: ["econ-intro-credit"] };
  const result = degreeProgress(rules, [...lowGrade, placement], { ...ilr, transfer: true });
  assert.equal(result.slots.find((slot) => slot.id === "micro-intro")?.earned.count, 1);
  assert.ok(result.manual.some((item) => item.id === "transfer-residency" && !item.confirmed));
});

test("finds an allocation that leaves the only eligible course for the constrained slot", () => {
  const flexible = { ...rules, colleges: undefined, slots: [
    { id: "any", label: "Any course", need: 1, unit: "courses", options: [{}] },
    { id: "specific", label: "Microeconomics", need: 1, unit: "courses", options: [{ codes: ["ECON 1110"] }] },
  ] } satisfies ProgramRules;
  const attempts = [completed("ECON 1110"), completed("ECON 1120"), { ...completed("ECON 1110"), id: "repeat" }];
  const result = degreeProgress(flexible, attempts, ilr);
  assert.deepEqual(result.slots[0].earned.attemptIds, ["ECON 1120"]);
  assert.equal(result.slots[1].earned.count, 1);
});

test("shows ILR, Labor and Social Justice, and planned overlap on the same record", () => {
  const college = program("ilr-bs", "requirements");
  const major = program("industrial-labor-relations-bs");
  const minor = program("labor-social-justice-minor");
  const baseline = [completed("ILRGL 1100"), completed("PE 1100"), completed("MATH 1006"), completed("ILRGL 4900")];
  const planned: Attempt = { ...completed("ILRGL 2010"), status: "planned", grade: undefined };
  const run = (courses: Attempt[]) => {
    const options = { college: "IL", transfer: false };
    const majorResult = { rule: major, type: "major" as const, progress: degreeProgress(major, courses, options) };
    const minorResult = { rule: minor, type: "minor" as const, progress: degreeProgress(minor, courses, options) };
    return {
      college: degreeProgress(college, courses, options),
      minor: minorResult.progress,
      warnings: reviewProgramOverlap(minorResult, [majorResult, minorResult], courses),
    };
  };
  assert.deepEqual(run(baseline).warnings, []);
  const withPlan = run([...baseline, planned]);
  assert.equal(withPlan.college.slots.find((slot) => slot.id === "degree")?.earned.count, 6);
  assert.equal(withPlan.college.slots.find((slot) => slot.id === "graded")?.projected.count, 9);
  assert.equal(withPlan.minor.slots[0].earned.count, 3);
  assert.deepEqual(withPlan.warnings[0].projected.courses.sort(), ["ILRGL 1100", "ILRGL 2010"]);
  assert.equal(withPlan.warnings[0].earned.count, 3);
});

test("Brooks and Human Ecology credit rules apply to their own college plans", () => {
  const he = program("human-ecology-bs", "requirements");
  const brooks = program("brooks-bs", "requirements");
  const core = [completed("HE 1800"), completed("HE 1850"), completed("HE 2000")];
  const science = { ...completed("BIOEE 1610"), distributionCodes: ["BIO-AG", "PBS-HE"] };
  const writing = { ...completed("ENGL 1130"), approvals: ["as-writing-seminar"] };
  const exam: Attempt = { ...completed("TRAN 9999"), origin: "exam", grade: undefined,
    approvals: ["he-approved-ap-ib-writing"] };
  const study = Array.from({ length: 5 }, (_, index) => ({ ...completed(`HD 40${index}0`), components: ["IND"] }));
  const plan = [...core, science, writing, exam, ...study];
  const heResult = degreeProgress(he, plan, { college: "HE", transfer: false, choices: { entry: "internal-transfer" } });
  assert.ok(!heResult.slots.some((slot) => slot.id === "he-intro-first"));
  assert.equal(heResult.slots.find((slot) => slot.id === "natural")?.earned.count, 3);
  assert.deepEqual(heResult.slots.find((slot) => slot.id === "fws-second")?.earned.attemptIds, [exam.id]);
  assert.equal(heResult.slots.find((slot) => slot.id === "degree")?.earned.count, 27);
  const brooksResult = degreeProgress(brooks, [...plan, completed("MATH 1710")], {
    college: "PP", transfer: false, declaredPrograms: new Set(["public-policy-bs"]),
  });
  assert.equal(brooksResult.slots.find((slot) => slot.id === "science")?.earned.count, 3);
  assert.equal(brooksResult.slots.find((slot) => slot.id === "mathematics")?.earned.count, 0);
  assert.equal(brooksResult.slots.find((slot) => slot.id === "fws-second")?.earned.count! +
    brooksResult.slots.find((slot) => slot.id === "fws")?.earned.count!, 1);
});

test("applies the different BA and BS mathematics rules and only accepts an approved external elective", () => {
  const attempts = ["MATH 1110", "MATH 2310", "ECON 4710"].map((code) => completed(code));
  attempts.push({ ...completed("MATH 1910"), id: "ap", origin: "exam", grade: undefined, approvals: ["cs-placement-credit"] });
  const ba = degreeProgress(program("computer-science-ba"), attempts, { college: "AS", transfer: false });
  const bs = degreeProgress(program("computer-science-bs"), attempts, { college: "EN", transfer: false });
  assert.equal(ba.slots.find((slot) => slot.id === "linear-algebra")?.earned.count, 1);
  assert.equal(bs.slots.find((slot) => slot.id === "linear-algebra")?.earned.count, 0);
  assert.deepEqual(bs.slots.find((slot) => slot.id === "calculus-i")?.earned.attemptIds, ["ap"]);
  assert.equal(bs.slots.find((slot) => slot.id === "external")?.earned.count, 0);
});

test("uses separate Information Science college paths and checks special topics, grade and credit", () => {
  const context = { college: "EN", transfer: false, choices: { concentration: "data-science" } };
  const engineering = program("information-science-minor__duffield");
  const nolan = program("information-science-minor__nolan");
  const attempts = ["INFO 2950", "INFO 3720", "COMM 3190", "INFO 1300"].map((code) => completed(code));
  const special = { ...completed("COMM 4940"), topic: "Data and Technology for Organizing" };
  assert.equal(degreeProgress(engineering, [...attempts, { ...special, grade: "C-" }], context)
    .slots.find((slot) => slot.id === "concentration-courses")?.earned.count, 2);
  assert.equal(degreeProgress(engineering, [...attempts, { ...special, topic: "Other topic" }], context)
    .slots.find((slot) => slot.id === "concentration-courses")?.earned.count, 2);
  const ready = degreeProgress(engineering, [...attempts, special], context);
  assert.ok(ready.slots.every((slot) => slot.earned.count >= slot.need));
  assert.equal(ready.slots.find((slot) => slot.id === "minor-credits")?.earned.count, 15);
  const hotel = degreeProgress(nolan, [...attempts, special], { ...context, college: "HA" });
  assert.equal(hotel.slots.find((slot) => slot.id === "database")?.earned.count, 0);
  assert.equal(hotel.slots.find((slot) => slot.id === "concentration-courses")?.need, 2);
  const blocked = degreeProgress(engineering, attempts, { ...context, declaredPrograms: new Set(["data-science-minor"]) });
  assert.ok(blocked.unresolvedChoices[0].options.every((option) => option.id !== "data-science"));
});

test("counts two distinct introductory biology areas and lab credit within the allocated electives", () => {
  const biology = program("biological-sciences-bs");
  const history = ["BIOG 1440", "BIOG 1445", "BIOAP 3110", "BIOAP 3160", "ANSC 2400", "BIOAP 2140"]
    .map((code) => completed(code));
  const lab = { ...completed("BIOAP 3200"), credits: 4, grade: "S", passFailOnly: true };
  const context = { college: "AG", transfer: false, choices: {
    concentration: "animal-physiology", "intro-cluster": "physiology-ecology",
  } };
  const progress = degreeProgress(biology, [...history, lab], context);
  assert.equal(progress.slots.find((slot) => slot.id === "intro-physiology")?.earned.count, 1);
  assert.equal(progress.slots.find((slot) => slot.id === "intro-ecology")?.earned.count, 0);
  assert.ok((progress.slots.find((slot) => slot.id === "animal-electives")?.earned.count ?? 0) >= 7);
  assert.deepEqual(progress.slots.find((slot) => slot.id === "animal-lab")?.earned.attemptIds, ["BIOAP 3200"]);
  const alternate = degreeProgress(biology, [...history, { ...lab, passFailOnly: false }], context);
  assert.equal(alternate.slots.find((slot) => slot.id === "animal-lab")?.earned.count, 0);
});

test("activates every Biology concentration and keeps incompatible chemistry paths unresolved", () => {
  const biology = program("biological-sciences-bs");
  const concentrations = biology.choices?.find((rule) => rule.id === "concentration")?.options ?? [];
  assert.equal(concentrations.length, 14);
  for (const concentration of concentrations) {
    const progress = degreeProgress(biology, [], { college: "AG", transfer: false, choices: {
      concentration: concentration.id, "plant-path": "evolutionary", "bc-physical": "bc-standard",
      "organic-chemistry": "intro-organic",
    } });
    assert.ok(!progress.unresolvedChoices.some((choice) => choice.id === "concentration"));
    assert.equal(progress.unresolvedChoices.some((choice) => choice.id === "organic-chemistry"),
      ["biochemistry", "molecular-and-cell-biology"].includes(concentration.id));
    const ids = progress.slots.map((slot) => slot.id);
    assert.equal(ids.length, new Set(ids).size);
  }
});

test("uses no more than two courses for double-counting Arts and Sciences distributions", () => {
  const arts = program("arts-sciences-ba", "requirements");
  const attempt = (code: string, ...distributionCodes: string[]): Attempt => ({
    ...completed(code), fixedCredits: true, distributionCodes, academicCollege: "AS",
  });
  const history = [
    attempt("ART 3000", "ALC-AS", "ETM-AS"), attempt("BIOG 3000", "BIO-AS", "PHS-AS"),
    attempt("HIST 3000", "HST-AS", "GLC-AS"), attempt("SOC 3000", "SSC-AS", "SCD-AS"),
    attempt("STSCI 3000", "SDS-AS"), attempt("MATH 3000", "SMR-AS"),
  ];
  const evaluate = (courses: Attempt[]) => degreeProgress(arts, courses, { college: "AS", transfer: false });
  const distributions = new Set(arts.slots.filter((slot) => slot.allocationGroup === "distributions").map((slot) => slot.id));
  const count = (courses: Attempt[]) => evaluate(courses).slots.filter((slot) => distributions.has(slot.id) && slot.earned.count > 0).length;
  assert.equal(count(history), 8);
  assert.equal(count([...history, attempt("COML 3000", "ALC-AS"), attempt("ANTHR 3000", "SSC-AS")]), 10);
  assert.equal(count(history.map((item) => item.code === "MATH 3000" ? { ...item, fixedCredits: false } : item)), 7);
  assert.equal(count(history.map((item) => item.code === "MATH 3000" ? { ...item, approvals: ["as-writing-seminar"] } : item)), 7);
});

test("allocates capped credit across different slots without exceeding the shared allowance", () => {
  const limited: ProgramRules = {
    ...rules, manual: [],
    slots: [
      { id: "foundation", label: "Foundation", need: 1, unit: "courses", options: [{ codes: ["ANTHR 3000", "ARKEO 3000"] }] },
      { id: "extras", label: "Additional courses", need: 0, unit: "credits", options: [{ subjects: ["ARKEO"] }] },
    ],
    checks: [{ id: "credits", label: "Major credits", unit: "credits", need: 10 }],
    limits: [{ slots: ["foundation", "extras"], max: 4, unit: "credits", options: [{ approval: "independent-study" }] }],
  };
  const independent = ["ARKEO 3000", "ARKEO 4981"].map((code) => ({ ...completed(code), credits: 4, approvals: ["independent-study"] }));
  const attempts = [...independent, completed("ANTHR 3000"), completed("ARKEO 3220")];
  const result = degreeProgress(limited, attempts, ilr);
  const credits = result.slots.find((slot) => slot.id === "credits")!;
  assert.equal(credits.earned.count, 10);
  assert.equal(credits.earned.attemptIds.filter((id) => independent.some((attempt) => attempt.id === id)).length, 1);
  assert.deepEqual(result.slots.find((slot) => slot.id === "foundation")?.earned.attemptIds, ["ANTHR 3000"]);
});

test("checks a semester-specific Comparative Literature theory designation", () => {
  const theory = program("comparative-literature-ba");
  const course = { ...completed("COML 2591"), term: "SP27" };
  const ctx = { college: "AS", transfer: false, choices: { track: "literary" } };
  assert.equal(degreeProgress(theory, [course], ctx).slots.find((s) => s.id === "theory")?.earned.count, 1);
  assert.equal(degreeProgress(theory, [{ ...course, term: "FA26" }], ctx).slots.find((s) => s.id === "theory")?.earned.count, 0);
});

test("counts paired half-course Italian electives and enforces the English elective cap", () => {
  const italian = program("italian-ba");
  const context = { college: "AS", transfer: false };
  const elective = (code: string, credits: number, language: string, period = false): Attempt => ({
    ...completed(code), credits, approvals: [`ital-elective-${language}`, ...(period ? ["ital-before-1800"] : [])],
  });
  const all = [
    ...["ITAL 2202", "ITAL 2203", "ITAL 2900"].map((code) => completed(code)),
    elective("ITAL 2204", 3, "english"),
    elective("ARTH 3300", 3, "english"),
    elective("ARCH 3300", 3, "english"),
    elective("MUSIC 3300", 3, "english"),
    elective("ITAL 3100", 3, "other", true),
    elective("ITAL 3101", 1.5, "other"),
    elective("ITAL 3102", 2, "other"),
  ];
  const result = degreeProgress(italian, all, context);
  const electives = result.slots.find((slot) => slot.id === "ital-electives")!;
  assert.equal(electives.earned.count, 5);
  assert.ok(electives.earned.attemptIds.includes("ITAL 3101"));
  assert.ok(electives.earned.attemptIds.includes("ITAL 3102"));
  assert.equal(degreeProgress(italian, all.filter((item) => item.code !== "ITAL 3102"), context)
    .slots.find((slot) => slot.id === "ital-electives")?.earned.count, 4.5);
});

test("opens each published program variant and its individual option branches without inconsistent slot IDs", () => {
  for (const directory of ["reviewed", "requirements"]) {
    const files = readdirSync(new URL(`../../../../bigredradarinfo/programs/${directory}/2026-27/`, import.meta.url));
    for (const filename of files.filter((file) => file.endsWith(".json"))) {
      const published = program(filename.slice(0, -5), directory);
      const base = { college: published.colleges?.[0] ?? "AS", transfer: false, declaredPrograms: new Set(published.onlyWhenDeclared) };
      const check = (choices: Record<string, string> = {}, transfer = base.transfer) => {
        const result = degreeProgress(published, [], { ...base, transfer, choices });
        const ids = result.slots.map((slot) => slot.id);
        assert.equal(ids.length, new Set(ids).size, filename);
        assert.ok(result.slots.every((slot) => Number.isFinite(slot.need) && slot.need > 0), filename);
      };
      check();
      for (const choice of published.choices ?? []) {
        for (const option of choice.options) {
          const preferences = Object.fromEntries(Object.entries({ ...choice.onlyWhen, ...option.onlyWhen })
            .map(([key, values]) => [key, values[0]]));
          check({ ...preferences, [choice.id]: option.id }, option.transfer);
        }
      }
    }
  }
});

test("Nolan breadth credits above a category minimum also count toward the 15-credit total", () => {
  const rules = program("hotel-management-bs");
  const tagged = (code: string, credits: number, ...distributionCodes: string[]): Attempt =>
    ({ ...completed(code), credits, distributionCodes });
  const attempts = [
    tagged("ENGL 2000", 5, "ALC-AS", "SCD-AS"),
    tagged("GOVT 2000", 4, "GLC-AS"),
    tagged("ECON 2000", 3, "SSC-AS"),
    tagged("MATH 2000", 3, "SMR-AS"),
    tagged("AEM 2000", 3, "SSC-AS"),
  ];
  const choices = { "non-jcb-breadth": "arts-literature-and-history--global-citizenship-and-social-difference--social-science" };
  const progress = (courses: Attempt[]) => degreeProgress(rules, courses, { college: "HA", transfer: false, choices });
  assert.equal(progress(attempts).slots.find((slot) => slot.id === "non-jcb-total")?.earned.count, 15);
  const withoutSocialScience = progress(attempts.filter((attempt) => attempt.code !== "ECON 2000"));
  assert.equal(withoutSocialScience.slots.find((slot) => slot.id === "non-jcb-social-science")?.earned.count, 0);
});

test("Engineering allocates liberal studies across distinct groups and caps engineering communications", () => {
  const rules = program("engineering-bs", "requirements");
  const tagged = (code: string, ...distributionCodes: string[]): Attempt => ({ ...completed(code), distributionCodes });
  const attempts = [
    tagged("ENGL 2000", "ALC-AS", "SCD-AS"), tagged("HIST 2000", "HST-AS"), tagged("HIST 2001", "HST-AS"),
    tagged("ENGRC 3000", "CE-EN"), tagged("ENGRC 3001", "CE-EN"), tagged("ENGRC 3002", "CE-EN"),
  ];
  const progress = (courses: Attempt[]) => degreeProgress(rules, courses, {
    college: "EN", transfer: false, choices: {
      curriculum: "fall-2024-onward",
      "liberal-groups-fall-2024-onward": "culture--history--equity",
    },
  });
  const withEquity = progress([...attempts, tagged("SOC 3000", "SCD-AS")]);
  assert.equal(withEquity.slots.find((slot) => slot.id === "liberal-count")?.earned.count, 6);
  assert.equal(withEquity.slots.find((slot) => slot.id === "liberal-equity")?.earned.count, 3);
  const oneMultiTagged = progress(attempts);
  const soloArts = oneMultiTagged.slots.filter((slot) => ["liberal-culture", "liberal-equity"].includes(slot.id));
  assert.equal(soloArts.filter((slot) => slot.earned.count >= slot.need).length, 1);
  assert.equal(oneMultiTagged.slots.find((slot) => slot.id === "liberal-count")?.earned.count, 5);
});

test("applies the CALS cohort-specific 55- and 75-credit floors", () => {
  const cals = program("cals-bs", "requirements");
  const check = (curriculum: string, transfer: boolean) => degreeProgress(cals, [completed("BSOC 2061")], {
    college: "AG", transfer, choices: { curriculum },
  });
  const legacy = check("pre-2025", true);
  const fall2025 = check("fall-2025", false);
  const fall2026 = check("fall-2026-or-later", false);
  const newTransfer = check("new-transfer", true);
  assert.equal(legacy.slots.find((slot) => slot.id === "cals-credits")?.need, 55);
  assert.equal(legacy.slots.find((slot) => slot.id === "science-total")?.need, 18);
  assert.equal(fall2025.slots.find((slot) => slot.id === "cals-credits")?.need, 75);
  assert.equal(fall2025.slots.find((slot) => slot.id === "cals-credits")?.earned.count, 3);
  assert.equal(fall2026.slots.find((slot) => slot.id === "cals-credits")?.earned.count, 0);
  assert.equal(newTransfer.slots.find((slot) => slot.id === "cals-credits")?.need, 55);
  assert.ok(check("new-transfer", false).unresolvedChoices.some((choice) => choice.id === "curriculum"));
});

test("allocates CALS distribution credits to distinct courses and keeps E3 separate", () => {
  const cals = program("cals-bs", "requirements");
  const tagged = (code: string, ...distributionCodes: string[]): Attempt => ({ ...completed(code), distributionCodes });
  const attempts = [
    tagged("NS 1150", "AFS-AG"), tagged("BIOG 1440", "BSC-AG"), tagged("PHYS 2208", "PSC-AG"),
    tagged("PLSCI 1300", "SCH-AG"), tagged("AEM 2100", "DLS-AG"),
    tagged("STSCI 2150", "DLS-AG"), tagged("PHIL 2400", "ETH-AG"),
    tagged("HIST 2400", "HA-AG"), tagged("SOC 2400", "SBA-AG"), tagged("ASRC 2400", "D-AG"),
    tagged("ENGL 1160", "WRT-AG"), tagged("ENGL 1170", "WRT-AG"), tagged("COMM 2010", "ORL-AG"),
  ];
  const context = { college: "AG", transfer: false, choices: { curriculum: "fall-2026-or-later", "current-breadth": "ha-sba", e3: "course" } };
  const overlap = [...attempts.slice(0, 3), { ...attempts[3], attributeCodes: ["CU-CEL"] }, ...attempts.slice(4)];
  const incomplete = degreeProgress(cals, overlap, context).slots;
  assert.ok(["dist-sustainability", "e3-course"].some((id) => incomplete.find((slot) => slot.id === id)?.earned.count === 0));
  const withSeparate = degreeProgress(cals, [...overlap, { ...tagged("NTRES 2010"), attributeCodes: ["CU-CEL"] }], context).slots;
  assert.equal(withSeparate.find((slot) => slot.id === "distribution-credits")?.earned.count, 39);
  assert.equal(withSeparate.find((slot) => slot.id === "e3-course")?.earned.count, 1);
  assert.deepEqual(withSeparate.find((slot) => slot.id === "e3-course")?.earned.attemptIds, ["NTRES 2010"]);
});
