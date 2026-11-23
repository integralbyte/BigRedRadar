"use client";

import { useEffect, useMemo, useState } from "react";
import { apiGet, eventsPath } from "@/lib/api";
import { fmtKey, fmtTime } from "@/lib/dates";
import { useFollows } from "@/lib/follows";
import type { EventItem } from "@/lib/types";
import type { CourseDetail, Plan } from "@/lib/academics/plan-store";
import { planningTerm } from "@/lib/academics/snapshot";
import { academicCalendar, addDays, overlaps, restoreSections, weekAppointments, type Appointment } from "@/lib/academics/timetable";
import styles from "./planner.module.css";

const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });

export function keyFor(entry: { term: string; code: string }) {
  return `${entry.term}|${entry.code}`;
}

export function SchedulePanel({ plan, details, openCourse }: {
  plan: Plan; details: Readonly<Record<string, CourseDetail | null>>; openCourse: (id: string) => void;
}) {
  const [week, setWeek] = useState("2027-01-25");
  const [showClubs, setShowClubs] = useState(true);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventError, setEventError] = useState(false);
  const { follows } = useFollows();
  const followed = [...follows].sort().join(",");
  useEffect(() => {
    if (!followed || !showClubs) return;
    let ignore = false;
    apiGet<{ events: EventItem[] }>(eventsPath(followed.split(","))).then((result) => {
      if (!ignore) { setEvents(result.events); setEventError(false); }
    }).catch(() => { if (!ignore) setEventError(true); });
    return () => { ignore = true; };
  }, [followed, showClubs]);

  const springCourses = plan.courses.filter((entry) => entry.term === planningTerm);
  const classes = useMemo(() => plan.courses.filter((entry) => entry.term === planningTerm).flatMap((entry) => {
    const detail = details[keyFor(entry)];
    if (!detail?.offering) return [];
    const selection = Object.keys(entry.sections).length ? entry.sections :
      entry.legacySections ? restoreSections(detail.offering, entry.legacySections) ?? {} : {};
    return weekAppointments(detail.offering, selection, week).map((meeting) => ({ ...meeting, entryId: entry.id }));
  }), [plan.courses, details, week]);
  const byDay = Array.from({ length: 7 }, (_, index) => addDays(week, index)).map((date) => ({
    date,
    meetings: classes.filter((appointment) => appointment.date === date).sort((a, b) => a.start.localeCompare(b.start)),
    club: showClubs && !eventError ? events.filter((event) => follows.has(event.org_slug) && fmtKey.format(new Date(event.starts_at)) === date) : [],
  }));
  const conflict = new Set<Appointment>();
  for (const [index, item] of classes.entries()) {
    for (const other of classes.slice(index + 1)) {
      if (overlaps(item, other)) { conflict.add(item); conflict.add(other); }
    }
  }
  return <section className={styles.card}>
    <div className={styles.row}><h2>Spring 2027 schedule</h2>
      <label className={styles.inline}><input type="checkbox" checked={showClubs} onChange={(event) => setShowClubs(event.target.checked)} /> Followed club events</label>
    </div>
    <div className={styles.scheduleToolbar}>
      <div className={styles.actions}>
        <button type="button" onClick={() => setWeek(addDays(week, -7))}>Previous week</button>
        <button type="button" onClick={() => setWeek(addDays(week, 7))}>Next week</button>
      </div>
      <label className={styles.weekDate}>Week of <input type="date" value={week} onChange={(event) => {
        if (event.target.value && event.target.validity.valid) setWeek(event.target.value);
      }} /></label>
    </div>
    {conflict.size > 0 && <p role="status">Overlapping class meetings are marked below.</p>}
    {showClubs && followed && eventError && <p>Club events are temporarily unavailable.</p>}
    {!byDay.some(({ meetings, club }) => meetings.length || club.length) && <p>No classes or club events on this week’s schedule.</p>}
    <div className={styles.week}>
      {byDay.map(({ date, meetings, club }) => {
        return <div key={date} className={styles.day + (!meetings.length && !club.length ? " " + styles.emptyDay : "")}>
          <h3>{dateLabel.format(new Date(date + "T12:00:00Z"))}</h3>
          {meetings.map((item, i) => <button key={i} type="button"
            className={conflict.has(item) ? styles.conflict : styles.meeting} onClick={() => openCourse(item.entryId)}>
            <strong>{item.code}</strong><small>{item.start}–{item.end} · {item.label}</small>
            {item.location && <small>{item.location}</small>}{conflict.has(item) && <small>Time conflict</small>}
          </button>)}
          {club.map((event) => <div key={event.id} className={styles.meeting}><strong>{event.title}</strong>
            <small>{event.all_day ? "All day" : event.time_tba ? "Time TBA" : fmtTime.format(new Date(event.starts_at))} · {event.org_name}</small></div>)}
          {meetings.length + club.length === 0 && <small>—</small>}
        </div>;
      })}
    </div>
    {springCourses.length > 0 && <div className={styles.scheduleCourses}>
      <h3>Spring courses</h3>
      <div className={styles.actions}>
        {springCourses.map((entry) => <button key={entry.id} type="button"
          onClick={() => openCourse(entry.id)} aria-label={"Sections for " + entry.code}>{entry.code} sections</button>)}
      </div>
    </div>}
    <p>Meetings are shown in Ithaca time. Check the roster for room assignments, changes and meetings with times yet to be announced.</p>
    <a href={academicCalendar} target="_blank" rel="noreferrer">Cornell academic calendar</a>
  </section>;
}
