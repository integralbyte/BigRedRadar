"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { checkPrerequisite, type CourseRequirement } from "@/lib/academics/prerequisites";
import { catalogLink, planningTerm, rosterLink } from "@/lib/academics/snapshot";
import type { CourseDetail, PlannedCourse } from "@/lib/academics/plan-store";
import { matchingGroups, restoreSections, sectionSelectionComplete, type SectionSelection } from "@/lib/academics/timetable";
import styles from "./planner.module.css";

type SearchHit = { code: string; title: string; credits: { min: number | null; max: number | null }; offered: boolean };

export function CoursePicker({ add }: { add: (course: PlannedCourse) => void }) {
  const [query, setQuery] = useState("");
  const [offered, setOffered] = useState(false);
  const [term, setTerm] = useState(planningTerm);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!query.trim()) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ q: query, ...(offered ? { offered: "1" } : {}) });
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/academics?" + params, { signal: controller.signal });
        if (!response.ok) throw new Error("Course search is unavailable.");
        const { courses } = await response.json();
        if (!controller.signal.aborted) setHits(courses);
      } catch {
        if (!controller.signal.aborted) setError("Course search is unavailable. Try again in a moment.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, offered]);

  return <section className={styles.card}>
    <h2>Find a course</h2>
    <label>Course code or name
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="CS 3780 or machine learning" type="search" maxLength={100} />
    </label>
    <div className={styles.row}>
      <label className={styles.inline}><input type="checkbox" checked={offered} onChange={(event) => setOffered(event.target.checked)} /> SP27 offerings only</label>
      <label className={styles.inline}>Add to term
        <select value={term} onChange={(event) => setTerm(event.target.value)}>
          {["SP27", "FA26", "SU26", "SP26", "WI26", "FA25", "SU25", "SP25", "FA24", "SP24", "FA23", "PRE"].map((option) => (
            <option key={option} value={option}>{option === "PRE" ? "Before Cornell" : option}</option>
          ))}
        </select>
      </label>
    </div>
    {query.trim() && <div aria-live="polite">
      {error ? <p role="alert">{error}</p> : loading ? <p>Searching…</p> : hits.length === 0 ? <p>No matching courses.</p> :
        <ul className={styles.results}>{hits.map((course) => (
          <li key={course.code}>
            <span><strong>{course.code}</strong> {course.title}<small>{course.offered ? "Offered SP27" : "No SP27 offering"}</small></span>
            <button type="button" onClick={() => {
              add({ id: crypto.randomUUID(), code: course.code, title: course.title, term,
                credits: course.credits.max ?? course.credits.min ?? 0, status: "planned",
                origin: term === "PRE" ? "transfer" : "cornell", sections: {} });
              setQuery("");
            }} aria-label={`Add ${course.code}`}>Add</button>
          </li>))}
        </ul>}
    </div>}
  </section>;
}

function requirementName(requirement: CourseRequirement): string {
  if ("course" in requirement) return requirement.course;
  const separator = requirement.operator === "any" ? " or " : " and ";
  return requirement.requirements.map((item) => "course" in item ? item.course : `(${requirementName(item)})`).join(separator);
}

function Conditions({ detail, prior, simultaneous }: { detail: CourseDetail; prior: Set<string>; simultaneous: Set<string> }) {
  const rules = detail.rules;
  if (!rules || !detail.offering) return null;
  const course = detail.offering;
  return <div className={styles.conditions}>
    {([["Prerequisites", rules.prerequisites], ["Corequisites", rules.corequisites]] as const).map(([name, rule]) => {
      const result = checkPrerequisite(rule, prior, simultaneous);
      if (result.status === "not_listed") return null;
      return <div key={name}>
        <strong>{name} · {result.status === "met" ? "Met in plan" : result.status === "unmet" ? "Missing from plan" : "Review needed"}</strong>
        <p>{result.text}</p>
        {result.status === "unmet" && <p>Remaining requirement · {requirementName(result.missing)}</p>}
        {result.status === "needs_review" && <p>{result.reason} {result.source && <a href={result.source} target="_blank" rel="noreferrer">Department guidance</a>}</p>}
      </div>;
    })}
    {course.enrollment_priority && <p>Enrollment · {course.enrollment_priority}</p>}
    {course.forbidden_overlaps && <p>Credit overlap · {course.forbidden_overlaps}</p>}
    {course.fee && <p>{course.fee}</p>}
  </div>;
}

function Sections({ detail, entry, update }: { detail: CourseDetail; entry: PlannedCourse; update: (changes: Partial<PlannedCourse>) => void }) {
  const offering = detail.offering!;
  const picked = Object.keys(entry.sections).length ? entry.sections :
    entry.legacySections ? restoreSections(offering, entry.legacySections) ?? {} : {};
  const compatible = matchingGroups(offering, picked);
  const [groupIndex, setGroupIndex] = useState<number | undefined>(undefined);
  const active = groupIndex !== undefined ? offering.enroll_groups[groupIndex] : compatible[0] ?? offering.enroll_groups[0];
  if (!active) return <p>There are no selectable sections in the SP27 snapshot.</p>;
  const components = [...new Set([...active.components_required, ...active.components_optional,
    ...active.sections.map((section) => section.component)])];
  const index = offering.enroll_groups.indexOf(active);

  function select(component: string, classNumber: string) {
    const next: SectionSelection = { ...picked };
    if (classNumber) next[component] = Number(classNumber);
    else delete next[component];
    if (matchingGroups(offering, next).length) update({ sections: next, legacySections: undefined });
  }

  return <div className={styles.sectionPicker}>
    {offering.enroll_groups.length > 1 && <label>Enrollment group
      <select value={index} onChange={(event) => {
        setGroupIndex(Number(event.target.value));
        update({ sections: {}, legacySections: undefined });
      }}>
        {offering.enroll_groups.map((group, i) => (
          <option key={i} value={i}>{group.session ?? "Enrollment group"} · {group.sections.map((s) => s.component + " " + s.section).slice(0, 5).join(", ")}</option>
        ))}
      </select>
    </label>}
    {components.map((component) => <label key={component}>{component}{active.components_required.includes(component) ? " (required)" : ""}
      <select value={active.sections.some((section) => section.class_nbr === picked[component]) ? picked[component] : ""} onChange={(event) => select(component, event.target.value)}>
        <option value="">Select a section</option>
        {active.sections.filter((section) => section.component === component).map((section) => (
          <option key={section.class_nbr} value={section.class_nbr}>
            {section.section} · #{section.class_nbr} · {section.meetings.map((m) => m.days.join("/") + (m.start ? " " + m.start : "")).join("; ") || "Time TBA"}
          </option>
        ))}
      </select>
    </label>)}
    <p>{sectionSelectionComplete(active, picked) ? "Required sections selected" : "Select each required component to complete this group"}
      {active.credits?.min != null && active.credits.max != null && ` · ${active.credits.min === active.credits.max ? active.credits.min : active.credits.min + "–" + active.credits.max} credits`}
      {active.grading ? ` · ${active.grading}` : ""}</p>
    {active.sections.filter((section) => picked[section.component] === section.class_nbr).map((section) => (
      <div key={section.class_nbr}><p>{section.component} {section.section} · {section.instruction_mode} · {section.campus} · {section.consent}</p>
        {section.notes.map((note, i) => <p key={i}>{note}</p>)}</div>
    ))}
  </div>;
}

export function CourseCard({ entry, update, remove, prior, simultaneous, detail, approvals }: {
  entry: PlannedCourse; update: (changes: Partial<PlannedCourse>) => void; remove: () => void;
  prior: Set<string>; simultaneous: Set<string>; detail?: CourseDetail; approvals: string[];
}) {
  return <details className={styles.courseCard}>
    <summary><strong>{entry.code}</strong> {entry.title} <small>{entry.term} · {entry.credits} cr · {entry.status.replace("_", " ")}</small></summary>
    <div className={styles.courseForm}>
      <div className={styles.formGrid}>
        <label>Term <input key={entry.term} defaultValue={entry.term} maxLength={4} pattern="PRE|(?:FA|SP|WI|SU)[0-9]{2}" onBlur={(event) => {
          const term = event.target.value.toUpperCase().trim();
          if (term !== entry.term && /^(?:PRE|(?:FA|SP|WI|SU)\d{2})$/.test(term)) update({ term, sections: {}, legacySections: undefined });
          else event.target.value = entry.term;
        }} onFocus={(event) => event.target.select()} /></label>
        <label>Credits <input type="number" min="0" max="24" step=".5" value={entry.credits} onChange={(event) => {
          const credits = event.target.valueAsNumber;
          if (Number.isFinite(credits) && credits >= 0 && credits <= 24) update({ credits });
        }} /></label>
        <label>Progress <select value={entry.status} onChange={(event) => update({ status: event.target.value as PlannedCourse["status"] })}>
          <option value="planned">Planned</option><option value="in_progress">In progress</option><option value="completed">Completed</option>
        </select></label>
        {entry.status === "completed" && <label>Grade <select value={entry.grade ?? ""} onChange={(event) => update({ grade: event.target.value || undefined })}>
          <option value="">None recorded</option>{["A+", "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "S", "U", "SX", "UX", "W", "I"].map((grade) => <option key={grade}>{grade}</option>)}
        </select></label>}
        <label>Credit origin <select value={entry.origin} onChange={(event) => update({ origin: event.target.value as PlannedCourse["origin"] })}>
          <option value="cornell">Cornell</option><option value="transfer">Transfer</option><option value="study_abroad">Study abroad</option><option value="exam">Placement or exam</option>
        </select></label>
        <label>Special topic <input value={entry.topic ?? ""} placeholder="As shown on roster or transcript" maxLength={150}
          onChange={(event) => update({ topic: event.target.value || undefined })} /></label>
      </div>
      <details><summary>Advisor approvals</summary>
        <div className={styles.approvals}>{["repeat-credit-confirmed", ...approvals].map((approval) => <label key={approval} className={styles.inline}>
          <input type="checkbox" checked={entry.approvals?.includes(approval) ?? false} onChange={(event) => {
            update({ approvals: event.target.checked ? [...(entry.approvals ?? []), approval] : entry.approvals?.filter((item) => item !== approval) });
          }} /> {approval === "repeat-credit-confirmed" ? "This repeated course earned separate credit" : approval.replaceAll("-", " ")}
        </label>)}</div>
      </details>
      {detail?.offering && <Sections key={entry.term + entry.code} detail={detail} entry={entry} update={update} />}
      {detail && <Conditions detail={detail} prior={prior} simultaneous={simultaneous} />}
      {detail?.course && <div className={styles.row}>
        <a href={detail.offering ? rosterLink(entry.code) : catalogLink(detail.course)} target="_blank" rel="noreferrer">{detail.offering ? "Cornell roster and syllabus" : "Cornell course catalog"}</a>
        {detail.offering?.syllabus_url?.startsWith("https://") && <a href={detail.offering.syllabus_url} target="_blank" rel="noreferrer">Syllabus PDF</a>}
      </div>}
      <button type="button" onClick={remove}>Remove course</button>
    </div>
  </details>;
}

export function loadCourseDetail(entry: Pick<PlannedCourse, "code" | "term">) {
  return apiGet<CourseDetail>("/academics?" + new URLSearchParams({ code: entry.code, term: entry.term === "PRE" ? "FA23" : entry.term }));
}
