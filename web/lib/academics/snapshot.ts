import type { ProgramRules } from "./degree-progress";

export const planningTerm = "SP27";

type CreditRange = { min: number | null; max: number | null };
export type CatalogCourse = {
  code: string;
  subject: string;
  number: string;
  title: string;
  credits: CreditRange;
  crse_id: number | null;
  distributions: string[];
  offered_terms: string[];
  source_url?: string;
  roster_history: { term: string; crse_id: number; title?: string; academic_college?: string;
    credits?: CreditRange; distributions?: string[]; attributes?: string[]; pass_fail_only?: boolean; required_components?: string[] }[];
};

export type Meeting = {
  days: string[];
  start: string | null;
  end: string | null;
  start_date: string | null;
  end_date: string | null;
  location: string | null;
};

export type Section = {
  class_nbr: number;
  component: string;
  section: string;
  campus: string | null;
  instruction_mode: string | null;
  consent: string | null;
  start_date: string | null;
  end_date: string | null;
  topic: string | null;
  distributions?: string[];
  course_attributes?: { crseAttrValue: string }[];
  notes: string[];
  meetings: Meeting[];
};

export type EnrollmentGroup = {
  credits: CreditRange | null;
  grading: string | null;
  grading_code: string | null;
  components_required: string[];
  components_optional: string[];
  session: string | null;
  session_dates: (string | null)[];
  sections: Section[];
};

export type Offering = {
  code: string;
  crse_id: number;
  subject: string;
  title: string;
  description: string | null;
  prerequisites: string | null;
  corequisites: string | null;
  prerequisites_and_corequisites: string | null;
  enrollment_priority: string | null;
  forbidden_overlaps: string | null;
  fee: string | null;
  enroll_groups: EnrollmentGroup[];
  syllabus_url?: string;
};

export type ProgramEntry = {
  id: string;
  name: string;
  type: "major" | "minor";
  listing: string;
  source_url: string;
  last_admit_term?: string;
  last_graduation_term?: string;
  existing_rule_ids: string[];
  pilot_rules: { variant_id: string | null; version: string; file: string }[];
};

export type AcademicSnapshot = {
  schemaVersion: 1;
  version: string;
  roster: {
    term: string;
    roster_timestamp: string;
    pulled_at: string;
    subjects: { code: string }[];
    classes: Offering[];
  };
  catalog: { schema_version: number; courses: CatalogCourse[] };
  coverage: { catalog_year: string; programs: ProgramEntry[]; shared_requirements?: { id: string; file: string }[] };
  rules: ProgramRules[];
};

export type AcademicOverview = {
  term: string;
  version: string;
  rosterTimestamp: string;
  catalogYear: string;
  programs: ProgramEntry[];
};

export function courseCode(value: string) {
  return value.normalize("NFKC").trim().toUpperCase().replace(/\s+/g, " ").replace(/^([A-Z]+)\s*(\d)/, "$1 $2");
}

export function rosterLink(code: string) {
  const [subject, number] = code.split(" ");
  return `https://classes.cornell.edu/browse/roster/${planningTerm}/class/${encodeURIComponent(subject)}/${encodeURIComponent(number)}`;
}

export function catalogLink(course: Pick<CatalogCourse, "subject" | "source_url">) {
  return course.source_url ?? `https://catalog.cornell.edu/courses/${course.subject.toLowerCase()}/`;
}
