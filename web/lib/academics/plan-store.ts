import type { Attempt } from "./degree-progress";
import { courseCode, planningTerm, type CatalogCourse, type Offering, type ProgramEntry } from "./snapshot";
import type { SectionSelection } from "./timetable";

export const legacyStorageKey = "cornell-course-planner-v1";
export const storageKey = "brr.academic-planner.v2";

export type PlannedCourse = {
  id: string;
  code: string;
  term: string;
  title: string;
  credits: number;
  status: Attempt["status"];
  origin: Attempt["origin"];
  grade?: string;
  topic?: string;
  approvals?: string[];
  sections: SectionSelection;
  legacySections?: Record<string, string>;
};

export type Plan = {
  id: string;
  name: string;
  college: string;
  transfer: boolean;
  catalogYear: string;
  programs: string[];
  choices: Record<string, Record<string, string>>;
  confirmations: Record<string, string[]>;
  courses: PlannedCourse[];
  legacy?: Record<string, unknown>;
};

export type PlanStore = { version: 2; active: string | null; plans: Plan[]; legacyCustom?: unknown[] };

export type CourseDetail = {
  course: CatalogCourse;
  offering?: Offering;
  creditKey: string;
  crossListedCodes: string[];
  distributions: string[];
  attributes?: string[];
  requiredComponents?: string[];
  academicCollege?: string;
  fixedCredits?: boolean;
  writingSeminar?: boolean;
  passFailOnly?: boolean;
  rules?: ReturnType<typeof import("./prerequisites").parsePrerequisites>;
};

export const colleges: Record<string, string> = {
  AG: "Agriculture and Life Sciences", AR: "Architecture, Art, and Planning", AS: "Arts and Sciences",
  BU: "Dyson School", CI: "Bowers Computing and Information Science", EN: "Duffield Engineering",
  HA: "Nolan School", HE: "Human Ecology", IL: "Industrial and Labor Relations", PP: "Brooks Public Policy",
};

type RecordValue = Record<string, unknown>;
const termKey = /^(?:FA|SP|WI|SU)\d{2}$/;
const statuses = new Set(["completed", "planned", "in_progress"]);
const origins = new Set(["cornell", "transfer", "study_abroad", "exam"]);
const present = (val: unknown): val is string => typeof val === "string" && val.length > 0;
const record = (val: unknown): val is RecordValue => !!val && typeof val === "object" && !Array.isArray(val);
const array = (val: unknown) => Array.isArray(val) ? val : [];
const stringMap = (val: unknown) => record(val)
  ? Object.fromEntries(Object.entries(val).filter((entry): entry is [string, string] => present(entry[1])))
  : {};

export function orderedTerm(term: string) {
  if (term === "PRE") return -1;
  if (!termKey.test(term)) return Infinity;
  return Number(term.slice(2)) * 4 + ["WI", "SP", "SU", "FA"].indexOf(term.slice(0, 2));
}

export function newPlan(): Plan {
  return { id: crypto.randomUUID(), name: "My plan", college: "", transfer: false, catalogYear: "2026-27",
    programs: [], choices: {}, confirmations: {}, courses: [] };
}

function migrateLegacy(old: unknown): Plan | undefined {
  if (!record(old) || !present(old.id) || !Array.isArray(old.sems)) return undefined;
  const courses: PlannedCourse[] = [];
  const seen = new Set<string>();
  for (const sem of old.sems) {
    if (!record(sem) || !present(sem.term) || !Array.isArray(sem.courses)) continue;
    if (sem.term !== "PRE" && !termKey.test(sem.term)) continue;
    for (const course of sem.courses) {
      if (!record(course) || !present(course.code) || !present(course.u) || seen.has(course.u)) continue;
      const credits = typeof course.cr === "number" && Number.isFinite(course.cr) && course.cr >= 0 ? course.cr : 0;
      const legacySections = stringMap(course.sec);
      courses.push({ id: course.u, code: courseCode(course.code), title: present(course.t) ? course.t : course.code,
        credits, term: sem.term, status: course.locked && !!course.grade && orderedTerm(sem.term) < orderedTerm(planningTerm)
          ? "completed" : "planned", grade: present(course.grade) ? course.grade : undefined,
        origin: sem.term === "PRE" || course.custom ? "transfer" : "cornell", sections: {},
        legacySections: Object.keys(legacySections).length ? legacySections : undefined });
      seen.add(course.u);
    }
  }
  const aliases: Record<string, string> = { CALS: "AG", CAS: "AS", ENG: "EN", AAP: "AR", CHE: "HE", ILR: "IL",
    Hotel: "HA", SHA: "HA", Dyson: "BU", Brooks: "PP" };
  const college = present(old.college) ? aliases[old.college] ?? old.college : "";
  return { id: old.id, name: present(old.name) ? old.name : "Imported plan", college,
    transfer: false, catalogYear: "", programs: [...new Set([...array(old.majors), ...array(old.minors)].filter(present))],
    choices: {}, confirmations: {}, courses, legacy: old };
}

function validPlan(value: unknown): value is Plan {
  if (!record(value) || !present(value.id) || !present(value.name) || typeof value.college !== "string" ||
      typeof value.transfer !== "boolean" || typeof value.catalogYear !== "string" ||
      !Array.isArray(value.programs) || !value.programs.every(present) ||
      !record(value.choices) || !Object.values(value.choices).every((choice) => record(choice) && Object.values(choice).every(present)) ||
      !record(value.confirmations) || !Object.values(value.confirmations).every((items) => Array.isArray(items) && items.every(present)) ||
      !Array.isArray(value.courses) || value.courses.length > 600) return false;
  const ids = new Set<string>();
  return value.courses.every((course: unknown) => {
    if (!record(course) || !present(course.id) || ids.has(course.id) || !present(course.code) ||
        typeof course.title !== "string" || typeof course.credits !== "number" ||
        !Number.isFinite(course.credits) || course.credits < 0 ||
        !present(course.term) || (course.term !== "PRE" && !termKey.test(course.term)) ||
        !present(course.status) || !statuses.has(course.status) || !present(course.origin) || !origins.has(course.origin) ||
        (course.grade !== undefined && typeof course.grade !== "string") ||
        (course.topic !== undefined && typeof course.topic !== "string") ||
        (course.approvals !== undefined && (!Array.isArray(course.approvals) || !course.approvals.every(present))) ||
        !record(course.sections) || !Object.values(course.sections).every((section) => Number.isSafeInteger(section)) ||
        (course.legacySections !== undefined && (!record(course.legacySections) || !Object.values(course.legacySections).every(present)))) return false;
    ids.add(course.id);
    return true;
  });
}

export function readPlanStore(value: unknown): PlanStore {
  if (!record(value)) throw new Error("Select a Big Red Radar plan export.");
  let plans: Plan[] = [];
  let active: string | null = null;
  let legacyCustom: unknown[] = [];
  if (value.version === 2 && Array.isArray(value.plans)) {
    if (!value.plans.every(validPlan)) throw new Error("One or more plans contain invalid fields.");
    plans = value.plans;
    legacyCustom = array(value.legacyCustom);
  } else if (value.v === 1 && (value.kind === "cornell-course-plan" || Array.isArray(value.plans))) {
    const original = value.kind === "cornell-course-plan" ? [value.plan] : array(value.plans);
    for (const old of original) {
      const plan = migrateLegacy(old);
      if (!plan) throw new Error("The original plan is missing its ID or semester data.");
      plans.push(plan);
    }
    legacyCustom = array(value.custom);
  } else {
    throw new Error("Select a supported Big Red Radar plan export.");
  }
  if (plans.length > 40 || new Set(plans.map((plan) => plan.id)).size !== plans.length) {
    throw new Error("The export contains duplicate IDs or too many plans.");
  }
  active = plans.find((plan) => plan.id === value.active)?.id ?? plans[0]?.id ?? null;
  return { version: 2, active, plans, ...(legacyCustom.length ? { legacyCustom } : {}) };
}

export function resolvePrograms(ids: string[], programs: ProgramEntry[]) {
  return [...new Set(ids.map((id) => {
    if (programs.some((program) => program.id === id)) return id;
    const candidates = programs.filter((program) => program.existing_rule_ids.includes(id));
    return candidates.length === 1 ? candidates[0].id : id;
  }))];
}

export function mergeImportedPlans(current: PlanStore, incoming: PlanStore): PlanStore {
  const used = new Set(current.plans.map((plan) => plan.id));
  const added = incoming.plans.map((plan) => used.has(plan.id) ? { ...plan, id: crypto.randomUUID() } : plan);
  const plans = [...current.plans, ...added];
  if (plans.length > 40) throw new Error("This import exceeds the 40-plan limit.");
  const active = added[incoming.plans.findIndex((plan) => plan.id === incoming.active)]?.id ?? current.active;
  const legacyCustom = [...(current.legacyCustom ?? []), ...(incoming.legacyCustom ?? [])];
  return { version: 2, plans, active, ...(legacyCustom.length ? { legacyCustom } : {}) };
}
