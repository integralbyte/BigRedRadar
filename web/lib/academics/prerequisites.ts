export type CourseRequirement =
  | { course: string }
  | { operator: "all" | "any"; requirements: CourseRequirement[] };

type Timing = "before" | "concurrent" | "before_or_concurrent";

type Rule =
  | { status: "not_listed" }
  | { status: "needs_review"; text: string; reason: string; source?: string }
  | { status: "parsed"; text: string; timing: Timing; requirement: CourseRequirement; source?: string };

type PrerequisiteFields = {
  code: string;
  prerequisites?: string | null;
  corequisites?: string | null;
  prerequisites_and_corequisites?: string | null;
};

export type PrerequisiteOverride = {
  expectedText: string;
  reason: string;
  source: string;
} | {
  expectedText: string;
  requirement: CourseRequirement;
  timing: Timing;
  source: string;
};

type Overrides = Partial<Record<"prerequisites" | "corequisites", PrerequisiteOverride>>;

const courseCode = /^[A-Z]{2,12} \d{4}[A-Z]?$/;
const priorOrConcurrentPrefix = /^or prerequisites?:\s*/i;
const exceptions: Readonly<Record<string, Overrides>> = {
  "ENGRC 3152": {
    corequisites: {
      expectedText: "CS 3152 and INFO 3152.",
      source: "https://www.cs.cornell.edu/courses/cs3152/2026sp/info/faq/",
      reason: "The roster lists both codes, and the department describes a choice between the two listings.",
    },
  },
};

function group(operator: "all" | "any", requirements: CourseRequirement[]): CourseRequirement {
  return requirements.length === 1 ? requirements[0] : { operator, requirements };
}

function parseCourseList(text: string, catalog: ReadonlySet<string>): CourseRequirement | null {
  const requirements: CourseRequirement[] = [];
  for (const clause of text.normalize("NFKC").replace(/\s+/g, " ").trim().replace(/\.$/, "").split(";")) {
    const hasAnd = / and /i.test(clause);
    const hasOr = / or /i.test(clause);
    if (hasAnd && hasOr) return null;

    const courses = clause.trim().split(/ (?:and|or) /i).map((value) => value.toUpperCase());
    if (courses.some((value) => !courseCode.test(value) || !catalog.has(value))) return null;
    requirements.push(group(hasOr ? "any" : "all", courses.map((course) => ({ course }))));
  }
  return group("all", requirements);
}

function parseRule(
  raw: string | null | undefined,
  defaultTiming: Timing,
  catalog: ReadonlySet<string>,
  override?: PrerequisiteOverride,
): Rule {
  const text = raw?.trim();
  if (!text) return { status: "not_listed" };
  if (override) {
    if (text !== override.expectedText) {
      return { status: "needs_review", text, reason: "Cornell changed the wording since the last review.", source: override.source };
    }
    if ("reason" in override) return { status: "needs_review", text, reason: override.reason, source: override.source };
    return { status: "parsed", text, timing: override.timing, requirement: override.requirement, source: override.source };
  }

  const priorOrConcurrent = defaultTiming === "concurrent" && priorOrConcurrentPrefix.test(text);
  const requirement = parseCourseList(priorOrConcurrent ? text.replace(priorOrConcurrentPrefix, "") : text, catalog);
  if (!requirement) return { status: "needs_review", text, reason: "Check the published wording for this condition." };
  return { status: "parsed", text, timing: priorOrConcurrent ? "before_or_concurrent" : defaultTiming, requirement };
}

export function parsePrerequisites(fields: PrerequisiteFields, catalog: ReadonlySet<string>, overrides = exceptions[fields.code]) {
  const legacy = fields.prerequisites_and_corequisites?.trim();
  const prerequisites: Rule = legacy
    ? { status: "needs_review", text: legacy, reason: "Cornell published prerequisites and corequisites together for this term." }
    : parseRule(fields.prerequisites, "before", catalog, overrides?.prerequisites);
  return { prerequisites, corequisites: parseRule(fields.corequisites, "concurrent", catalog, overrides?.corequisites) };
}

export type PrerequisiteCheck =
  | Exclude<Rule, { status: "parsed" }>
  | { status: "met"; text: string; source?: string }
  | { status: "unmet"; text: string; timing: Timing; missing: CourseRequirement; source?: string };

function missing(requirement: CourseRequirement, has: (code: string) => boolean): CourseRequirement | null {
  if ("course" in requirement) return has(requirement.course) ? null : requirement;
  const remaining = requirement.requirements.map((child) => missing(child, has));
  if (requirement.operator === "any" && remaining.some((child) => child === null)) return null;
  const unmet = remaining.filter((child): child is CourseRequirement => child !== null);
  return unmet.length ? group(requirement.operator, unmet) : null;
}

export function checkPrerequisite(
  rule: Rule,
  completedBefore: ReadonlySet<string>,
  takingConcurrently: ReadonlySet<string>,
): PrerequisiteCheck {
  if (rule.status !== "parsed") return rule;
  const unmet = missing(rule.requirement, (code) => {
    if (rule.timing === "before") return completedBefore.has(code);
    if (rule.timing === "concurrent") return takingConcurrently.has(code);
    return completedBefore.has(code) || takingConcurrently.has(code);
  });
  return unmet
    ? { status: "unmet", text: rule.text, timing: rule.timing, missing: unmet, source: rule.source }
    : { status: "met", text: rule.text, source: rule.source };
}
