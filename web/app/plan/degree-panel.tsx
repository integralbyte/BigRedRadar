"use client";

import { degreeProgress, type Attempt, type ProgramRules } from "@/lib/academics/degree-progress";
import { colleges, type Plan } from "@/lib/academics/plan-store";
import { reviewProgramOverlap } from "@/lib/academics/program-overlap";
import type { AcademicOverview, ProgramEntry } from "@/lib/academics/snapshot";
import styles from "./planner.module.css";

const ruleKey = (rule: ProgramRules) => [rule.programId, rule.variantId, rule.catalogYear, rule.version].filter(Boolean).join("/");

function RuleProgress({ rule, program, plan, progress, overlaps, update }: {
  rule: ProgramRules; program?: ProgramEntry; plan: Plan; progress: ReturnType<typeof degreeProgress>;
  overlaps?: ReturnType<typeof reviewProgramOverlap>; update: (changes: Partial<Plan>) => void;
}) {
  const key = ruleKey(rule);
  const choices = plan.choices[key] ?? {};
  const confirmed = plan.confirmations[key] ?? [];
  return <section className={styles.card}>
    <h3>{rule.name}</h3>
    <p>{rule.scope}</p>
    {program?.listing === "teach_out" && <p>Teach-out for eligible continuing students.
      {program.last_admit_term && ` Cornell lists ${termName(program.last_admit_term)} as the last admission term.`}
      {program.last_graduation_term && ` The last graduation term is ${termName(program.last_graduation_term)}.`}
    </p>}
    {!progress.eligiblePrograms ? <p role="status">The selected programs include a combination Cornell excludes.</p> : <>
      {progress.applicableChoices.map((choice) => <label key={choice.id}>{choice.label}
        <select value={choice.options.some((option) => option.id === choices[choice.id]) ? choices[choice.id] : ""} onChange={(event) =>
          update({ choices: { ...plan.choices, [key]: { ...choices, [choice.id]: event.target.value } } })}>
          <option value="">Choose an option</option>
          {choice.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </label>)}
      {progress.unresolvedChoices.length > 0 && <p>Choose the remaining paths to load their requirements.</p>}
      {progress.needsAllocationReview && <p>Review this allocation with an advisor. The planner reached its search limit.</p>}
      {!!overlaps?.length && <div className={styles.conditions}>
        <h4>Review shared coursework</h4>
        {overlaps.map((overlap, index) => {
          const matched = overlap.projected.count > overlap.max ? overlap.projected : overlap.earned;
          return <p key={index}>
            The {matched === overlap.projected ? "projected" : "earned"} allocation shares {matched.count} {overlap.unit} with {overlap.with === "program" ? "other" : `your ${overlap.with}`} requirements.
            The limit for these requirements is {overlap.max}. Review {matched.courses.join(", ")} for a different assignment.
          </p>;
        })}
      </div>}
      {progress.slots.length > 0 && <table className={styles.progress}>
        <thead><tr><th scope="col">Requirement</th><th scope="col">Earned</th><th scope="col">Projected</th></tr></thead>
        <tbody>{progress.slots.map((slot) => (
          <tr key={slot.id}>
            <th scope="row">{slot.label}<small>{slot.need} {slot.unit === "credits" ? "credits required" : slot.need === 1 ? "course required" : "courses required"}</small>
              {slot.projected.attemptIds.length > 0 && <small>{slot.projected.attemptIds.map((id) => plan.courses.find((course) => course.id === id)?.code).filter(Boolean).join(", ")}</small>}
            </th>
            <td>{slot.earned.count}/{slot.need}</td><td>{slot.projected.count}/{slot.need}</td>
          </tr>
        ))}</tbody>
      </table>}
      {progress.manual.length > 0 && <div className={styles.conditions}>
        <h4>Confirm with your advisor</h4>
        {progress.manual.map((item) => <label className={styles.checklist} key={item.id}>
          <input type="checkbox" checked={item.confirmed} onChange={(event) =>
            update({ confirmations: { ...plan.confirmations, [key]: event.target.checked ? [...confirmed, item.id] : confirmed.filter((id) => id !== item.id) } })} />
          <span><strong>{item.label}</strong><small>{item.instruction}</small></span>
        </label>)}
      </div>}
    </>}
    <p className={styles.sources}>{rule.sources.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">
      {index === 0 ? "Official requirements" : "Department policy"}
    </a>)}</p>
  </section>;
}

function chooseRule(rules: ProgramRules[], college: string) {
  return rules.find((rule) => rule.colleges?.includes(college)) ??
    rules.find((rule) => !rule.colleges && !rule.excludeColleges?.includes(college));
}

function programOption(program: ProgramEntry) {
  return <option key={program.id} value={program.id}>{program.name}</option>;
}

function termName(term: string) {
  const match = /^(SP|FA|SU|WI)(\d{2})$/.exec(term);
  if (!match) return term;
  const seasons = { SP: "Spring", FA: "Fall", SU: "Summer", WI: "Winter" };
  return `${seasons[match[1] as keyof typeof seasons]} 20${match[2]}`;
}

export function DegreePanel({ plan, overview, rules, attempts, update, loading }: {
  plan: Plan; overview: AcademicOverview; rules: ProgramRules[]; attempts: Attempt[];
  update: (changes: Partial<Plan>) => void; loading: boolean;
}) {
  const addable = overview.programs.filter((program) => !plan.programs.includes(program.id));
  const current = addable.filter((program) => program.listing !== "teach_out");
  const teachOuts = addable.filter((program) => program.listing === "teach_out");
  const programs = new Map<string, ProgramEntry>(overview.programs.map((program) => [program.id, program]));
  const ready = Object.hasOwn(colleges, plan.college);
  const declaredPrograms = new Set(plan.programs);
  const evaluateRule = (rule: ProgramRules) => degreeProgress(rule, attempts, {
    college: plan.college, transfer: plan.transfer, choices: plan.choices[ruleKey(rule)], declaredPrograms,
    confirmed: new Set(plan.confirmations[ruleKey(rule)]),
  });
  const evaluations = ready ? plan.programs.flatMap((id) => {
    const rule = chooseRule(rules.filter((entry) => entry.programId === id), plan.college);
    return rule ? [{ rule, type: programs.get(id)?.type, progress: evaluateRule(rule) }] : [];
  }) : [];
  return <div className={styles.stack}>
    <section className={styles.card}>
      <h2>Degree progress</h2>
      <div className={styles.formGrid}>
        <label>Enrolling college <select value={plan.college} onChange={(event) => update({ college: event.target.value })}>
          <option value="">Select your college</option>
          {Object.entries(colleges).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          {plan.college && !(plan.college in colleges) && <option value={plan.college}>{plan.college} (imported)</option>}
        </select></label>
        <label>Catalog edition <select value={plan.catalogYear} onChange={(event) => update({ catalogYear: event.target.value })}>
          <option value="">Select your edition</option>
          <option value={overview.catalogYear}>{overview.catalogYear}</option>
          <option value="2025-26">2025-26</option><option value="earlier">Earlier edition</option>
        </select></label>
        <label>Add a major or minor
          <select value="" disabled={plan.programs.length >= 20} onChange={(event) => update({ programs: [...plan.programs, event.target.value] })}>
            <option value="">Choose a program</option>
            <optgroup label="Majors">{current.filter((program) => program.type === "major").map(programOption)}</optgroup>
            <optgroup label="Minors">{current.filter((program) => program.type === "minor").map(programOption)}</optgroup>
            {teachOuts.length > 0 && <optgroup label="Teach-outs for eligible continuing students">{teachOuts.map(programOption)}</optgroup>}
          </select>
        </label>
      </div>
      <label className={styles.inline}><input type="checkbox" checked={plan.transfer} onChange={(event) => update({ transfer: event.target.checked })} /> External transfer student</label>
      {plan.programs.length > 0 && <ul className={styles.results}>{plan.programs.map((id) => (
        <li key={id}><span>{programs.get(id)?.name ?? id}</span><button type="button"
          onClick={() => update({ programs: plan.programs.filter((program) => program !== id) })}>Remove</button></li>
      ))}</ul>}
    </section>
    {ready && rules.filter((rule) =>
      rule.layer && (!rule.colleges || rule.colleges.includes(plan.college)) &&
      !rule.excludeColleges?.includes(plan.college) &&
      !rule.excludePrograms?.some((id) => plan.programs.includes(id)) &&
      (!rule.onlyWhenDeclared || rule.onlyWhenDeclared.some((id) => plan.programs.includes(id))))
      .map((rule) => <RuleProgress key={rule.programId} rule={rule} plan={plan} progress={evaluateRule(rule)} update={update} />)}
    {plan.programs.map((id) => {
      const program = programs.get(id);
      const applicable = evaluations.find(({ rule }) => rule.programId === id);
      if (applicable) return <RuleProgress key={id} rule={applicable.rule} program={program} plan={plan}
        progress={applicable.progress} overlaps={reviewProgramOverlap(applicable, evaluations, attempts)} update={update} />;
      return <section key={id} className={styles.card}>
        <h3>{program?.name ?? id}</h3>
        <p>{loading ? "Loading requirements…" : !program ? "Select the current college and degree variant for this imported program." :
          !plan.college || !plan.catalogYear ? "Select your college and catalog edition to load applicable rules." :
          program.pilot_rules.length === 0 ? "Planner rules are awaiting review. Follow the official requirements while planning." :
          "Reviewed rules are currently unavailable for this college and catalog edition."}</p>
        {program && <a href={program.source_url} target="_blank" rel="noreferrer">Official requirements</a>}
      </section>;
    })}
  </div>;
}
