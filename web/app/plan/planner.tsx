"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";
import type { Attempt, CourseFilter, ProgramRules } from "@/lib/academics/degree-progress";
import { mergeImportedPlans, legacyStorageKey, newPlan, orderedTerm, readPlanStore, resolvePrograms, storageKey,
  type CourseDetail, type Plan, type PlanStore, type PlannedCourse } from "@/lib/academics/plan-store";
import { planningTerm, type AcademicOverview } from "@/lib/academics/snapshot";
import { matchingGroups, restoreSections, selectedSections } from "@/lib/academics/timetable";
import { AccountBackup } from "./account-backup";
import { CourseCard, CoursePicker, loadCourseDetail } from "./course-picker";
import { DegreePanel } from "./degree-panel";
import { keyFor, SchedulePanel } from "./schedule-panel";
import styles from "./planner.module.css";

const emptyStore: PlanStore = { version: 2, active: null, plans: [] };
const tabs = ["Courses", "Progress", "Schedule"] as const;
const noCredit = new Set(["F", "U", "UX", "W", "I", "INC", "NGR", "AUD"]);

function approvalsFor(rules: ProgramRules[], attempt: Attempt) {
  const approvals = new Set<string>();
  function collect(filter: CourseFilter) {
    if (filter.approval && (!filter.codes || filter.codes.some((code) => code === attempt.code || attempt.crossListedCodes?.includes(code))) &&
      (!filter.subjects || filter.subjects.includes(attempt.subject)) &&
      (!filter.origins || filter.origins.includes(attempt.origin))) approvals.add(filter.approval);
  }
  for (const rule of rules) {
    const slots = [...rule.slots, ...(rule.totals ?? []), ...(rule.checks ?? []), ...(rule.limits ?? []),
      ...(rule.choices ?? []).flatMap((choice) => choice.options.flatMap((option) =>
        [...option.slots, ...(option.totals ?? []), ...(option.checks ?? []), ...(option.limits ?? [])]))];
    for (const slot of slots) slot.options?.forEach(collect);
  }
  return [...approvals].sort();
}

function attemptFor(entry: PlannedCourse, detail: CourseDetail | null | undefined): Attempt {
  const [subject, number] = entry.code.split(" ");
  const offering = detail?.offering;
  const selection = Object.keys(entry.sections).length ? entry.sections :
    (offering && entry.legacySections ? restoreSections(offering, entry.legacySections) : undefined) ?? {};
  const group = offering && matchingGroups(offering, selection)[0];
  const sections = group ? selectedSections(group, selection) : [];
  const sectionTopic = sections.find((section) => section.topic)?.topic;
  const approvals = entry.approvals ?? [];
  return { ...entry, subject, number: Number.parseInt(number, 10),
    creditKey: detail?.creditKey ?? entry.code,
    topic: entry.topic ?? sectionTopic ?? undefined, crossListedCodes: detail?.crossListedCodes,
    components: Object.keys(selection).length && group
      ? [...new Set([...group.components_required, ...sections.map((section) => section.component)])]
      : detail?.requiredComponents,
    approvals: detail?.writingSeminar ? [...approvals, "as-writing-seminar"] : approvals,
    academicCollege: detail?.academicCollege, fixedCredits: detail?.fixedCredits,
    distributionCodes: [...new Set([...(detail?.distributions ?? []),
      ...sections.flatMap((section) => section.distributions ?? [])])],
    attributeCodes: [...new Set([...(detail?.attributes ?? []),
      ...sections.flatMap((section) => section.course_attributes?.map((attribute) => attribute.crseAttrValue) ?? [])])],
    passFailOnly: group ? ["SUI", "SUS", "SUX"].includes(group.grading_code ?? "") : detail?.passFailOnly };
}

export default function Planner() {
  const [store, setStore] = useState<PlanStore | null>(null);
  const [overview, setOverview] = useState<AcademicOverview>();
  const [rules, setRules] = useState<ProgramRules[]>([]);
  const [details, setDetails] = useState<Record<string, CourseDetail | null>>({});
  const [tab, setTab] = useState<typeof tabs[number]>("Courses");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rulesLoading, setRulesLoading] = useState(false);
  const [storeBlocked, setStoreBlocked] = useState(false);
  const selected = store?.plans.find((plan) => plan.id === store.active);
  const plan = selected && overview ? { ...selected, programs: resolvePrograms(selected.programs, overview.programs) } : selected;
  const programs = plan?.programs.join(",");
  const courseKeys = [...new Set(plan?.courses.map(keyFor) ?? [])].join("\n");

  useEffect(() => {
    try {
      const local = localStorage.getItem(storageKey);
      const old = local ? null : localStorage.getItem(legacyStorageKey);
      const initial = local || old;
      const imported = initial ? readPlanStore(JSON.parse(initial)) : emptyStore;
      if (old && imported.plans.length) setNotice("Imported your original planner data from this browser.");
      if (imported.plans.length) setStore(imported);
      else {
        const first = newPlan();
        setStore({ ...emptyStore, plans: [first], active: first.id });
      }
    } catch {
      setStore(emptyStore);
      setStoreBlocked(true);
      setNotice("Saved planner data couldn’t be read. Import a backup to open a plan.");
    }
    apiGet<AcademicOverview>("/academics").then(setOverview).catch(() => setError("Academic data is temporarily unavailable."));
  }, []);

  useEffect(() => {
    if (store === null || storeBlocked) return;
    try { localStorage.setItem(storageKey, JSON.stringify(store)); }
    catch { setNotice("This browser couldn’t save the plan. Download a backup."); }
  }, [store, storeBlocked]);

  useEffect(() => {
    if (programs === undefined) return;
    let active = true;
    setRulesLoading(true);
    apiGet<{ rules: ProgramRules[] }>("/academics?" + new URLSearchParams({ programs })).then((result) => {
      if (active) setRules(result.rules);
    }).catch(() => { if (active) setError("Program requirements couldn’t be loaded."); })
      .finally(() => { if (active) setRulesLoading(false); });
    return () => { active = false; };
  }, [programs]);

  const remainingCourseKeys = courseKeys.split("\n").filter((key) => key && !(key in details)).join("\n");
  useEffect(() => {
    if (!overview || !remainingCourseKeys) return;
    const queue = remainingCourseKeys.split("\n");
    let active = true;
    async function load() {
      const loaded: Record<string, CourseDetail | null> = {};
      while (queue.length && active) {
        await Promise.all(queue.splice(0, 12).map(async (key) => {
          const [term, code] = key.split("|");
          loaded[key] = await loadCourseDetail({ term, code }).catch(() => null);
        }));
      }
      if (active) setDetails((current) => ({ ...current, ...loaded }));
    }
    void load();
    return () => { active = false; };
  }, [overview, remainingCourseKeys]);

  const teachOuts = new Set(overview?.programs.filter((entry) => entry.listing === "teach_out").map((entry) => entry.id));
  const relevantRules = rules.filter((rule) => {
    if (!plan || (!rule.layer && !plan.programs.includes(rule.programId))) return false;
    return plan.catalogYear === rule.catalogYear || !!rule.additionalCatalogYears?.includes(plan.catalogYear) ||
      (!rule.layer && teachOuts.has(rule.programId));
  });
  const attempts = useMemo(() => {
    const history = plan?.courses.map((entry) => attemptFor(entry, details[keyFor(entry)])) ?? [];
    const confirmedRepeats = new Set(history.filter((entry) => entry.approvals?.includes("repeat-credit-confirmed"))
      .map((entry) => `${entry.creditKey}:${entry.term}`));
    return history.map((entry) => {
      const repeat = `${entry.creditKey}:${entry.term}`;
      return confirmedRepeats.has(repeat) ? { ...entry, creditKey: repeat } : entry;
    });
  }, [plan?.courses, details]);

  function update(changes: Partial<Plan>) {
    if (!plan) return;
    setStore((current) => current && { ...current, plans: current.plans.map((item) => item.id === plan.id ? { ...item, ...changes } : item) });
  }

  function updateCourse(id: string, changes: Partial<PlannedCourse>) {
    if (!plan) return;
    update({ courses: plan.courses.map((entry) => entry.id === id ? { ...entry, ...changes } : entry) });
  }

  function addPlan() {
    const fresh = newPlan();
    setStore((current) => current && { ...current, active: fresh.id, plans: [...current.plans, fresh] });
  }

  return <div className={styles.planner}>
    <header className={styles.header}>
      <div><h1>Spring 2027 planner</h1>
        {overview && <p>SP27 roster updated {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" })
          .format(new Date(overview.rosterTimestamp.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")))} ET</p>}
      </div>
      <div className={styles.row}>
        {store && <><button type="button" disabled={store.plans.length >= 40} onClick={addPlan}>New plan</button>
          <button type="button" onClick={() => {
            const url = URL.createObjectURL(new Blob([JSON.stringify(store, null, 2)], { type: "application/json" }));
            const link = document.createElement("a"); link.href = url; link.download = "big-red-radar-plans.json"; link.click();
            window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
          }}>Download plans</button></>}
        <label className={styles.import}>Import plan<input type="file" accept=".json,application/json" onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            if (file.size > 5_000_000) throw new Error("Plan imports must be smaller than 5 MB.");
            const incoming = readPlanStore(JSON.parse(await file.text()));
            const next = mergeImportedPlans(store ?? emptyStore, incoming);
            setStore(next);
            setStoreBlocked(false);
            setNotice(`Imported ${incoming.plans.length} plan(s).`);
          } catch (error) { setNotice(error instanceof Error ? error.message : "The export could not be imported."); }
        }} /></label>
      </div>
    </header>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {store && plan ? <>
      <div className={styles.planBar}>
        <label>Plan <select value={plan.id} onChange={(event) => setStore({ ...store, active: event.target.value })}>
          {store.plans.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select></label>
        <label>Plan name <input value={plan.name} maxLength={100} onChange={(event) => {
          if (event.target.value) update({ name: event.target.value });
        }} /></label>
        <p>{storeBlocked ? "Storage needs attention" : "Saved in this browser"}</p>
      </div>
      <AccountBackup store={store} replace={setStore} notice={setNotice} />
      <nav aria-label="Planner views" className={styles.tabs}>
        {tabs.map((item) => <button type="button" key={item} aria-current={tab === item ? "page" : undefined} onClick={() => setTab(item)}>{item}</button>)}
      </nav>
      {tab === "Courses" && <div className={styles.columns}>
        <CoursePicker add={(course) => update({ courses: [...plan.courses, course] })} />
        <section className={styles.card}><h2>Planned and completed courses</h2>
          {plan.courses.length === 0 && <p>Add a course to start your plan.</p>}
          {[...plan.courses].sort((a, b) => orderedTerm(b.term) - orderedTerm(a.term) || a.code.localeCompare(b.code)).map((entry) => {
            const prior = new Set<string>(), simultaneous = new Set<string>();
            for (const candidate of plan.courses) {
              if (candidate.id === entry.id || (candidate.status === "completed" && noCredit.has(candidate.grade ?? ""))) continue;
              const matches = [candidate.code, ...(details[keyFor(candidate)]?.crossListedCodes ?? [])];
              const isBefore = orderedTerm(candidate.term) < orderedTerm(entry.term) && candidate.status === "completed" && candidate.origin === "cornell";
              const isConcurrent = candidate.term === entry.term && candidate.origin === "cornell";
              if (isBefore) for (const code of matches) prior.add(code);
              if (isConcurrent) for (const code of matches) simultaneous.add(code);
            }
            const detail = details[keyFor(entry)];
            return <CourseCard key={entry.id} entry={entry} update={(changes) => updateCourse(entry.id, changes)} prior={prior} simultaneous={simultaneous}
              detail={detail ?? undefined} approvals={approvalsFor(relevantRules, attemptFor(entry, detail))}
              remove={() => update({ courses: plan.courses.filter((course) => course.id !== entry.id) })} />;
          })}
        </section>
      </div>}
      {tab === "Progress" && overview && <DegreePanel plan={plan} overview={overview} rules={relevantRules}
        attempts={attempts} update={update} loading={rulesLoading} />}
      {tab === "Schedule" && <SchedulePanel plan={plan} details={details} />}
      {tab === "Courses" && plan.courses.some((entry) => entry.term === planningTerm && details[keyFor(entry)]?.offering) &&
        <p><a href="https://classes.cornell.edu/browse/roster/SP27" target="_blank" rel="noreferrer">Spring 2027 Class Roster</a></p>}
    </> : !store && <p aria-live="polite">Loading your planner…</p>}
  </div>;
}
