import type { EnrollmentGroup, Meeting, Offering, Section } from "./snapshot";

export type SectionSelection = Record<string, number>;
export type Appointment = { date: string; start: string; end: string; code: string; label: string; location?: string };
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ithacaBreaks = [["2027-02-13", "2027-02-16"], ["2027-03-27", "2027-04-04"]];
export const academicCalendar = "https://registrar.cornell.edu/calendars-exams/academic-calendar/2026-2027";

export function isoDate(value: string | null | undefined) {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : undefined;
}

export function addDays(date: string, days: number) {
  const start = Date.parse(date + "T12:00:00Z");
  return new Date(start + days * 86_400_000).toISOString().slice(0, 10);
}

export function selectedSections(group: EnrollmentGroup, selection: SectionSelection) {
  return group.sections.filter((section) => selection[section.component] === section.class_nbr);
}

export function matchingGroups(offering: Offering, selection: SectionSelection) {
  const selected = Object.keys(selection);
  return offering.enroll_groups.filter((group) => selectedSections(group, selection).length === selected.length);
}

export function sectionSelectionComplete(group: EnrollmentGroup, selection: SectionSelection) {
  const sections = selectedSections(group, selection);
  return sections.length === Object.keys(selection).length && sections.length > 0 &&
    group.components_required.every((component) => sections.some((section) => section.component === component));
}

export function restoreSections(offering: Offering, oldSections: Record<string, string>) {
  const combinations = new Map<string, SectionSelection>();
  for (const group of offering.enroll_groups) {
    const selection: SectionSelection = {};
    for (const [component, label] of Object.entries(oldSections)) {
      const matches = group.sections.filter((section) => section.component === component && section.section === label);
      if (matches.length === 1) selection[component] = matches[0].class_nbr;
    }
    if (Object.keys(selection).length !== Object.keys(oldSections).length) continue;
    combinations.set(JSON.stringify(selection), selection);
  }
  return combinations.size === 1 ? [...combinations.values()][0] : undefined;
}

function occurs(meeting: Meeting, section: Section, group: EnrollmentGroup, date: string) {
  const weekday = weekdays[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const start = isoDate(meeting.start_date) ?? isoDate(section.start_date) ?? isoDate(group.session_dates[0]);
  const end = isoDate(meeting.end_date) ?? isoDate(section.end_date) ?? isoDate(group.session_dates[1]);
  if (section.campus === "Ithaca" && start !== end && ithacaBreaks.some(([first, last]) => date >= first && date <= last)) return false;
  return !!(meeting.start && meeting.end && meeting.start < meeting.end && start && end &&
    date >= start && date <= end && (meeting.days.includes(weekday) || (start === end && !meeting.days.length)));
}

export function weekAppointments(offering: Offering, selection: SectionSelection, start: string): Appointment[] {
  const group = matchingGroups(offering, selection)[0];
  if (!group) return [];
  return Array.from({ length: 7 }, (_, day) => addDays(start, day)).flatMap((date) =>
    selectedSections(group, selection).flatMap((section) => section.meetings
      .filter((meeting) => occurs(meeting, section, group, date))
      .map((meeting) => ({ date, start: meeting.start!, end: meeting.end!, code: offering.code,
        label: `${section.component} ${section.section}`, location: meeting.location ?? undefined }))));
}

export function overlaps(a: Appointment, b: Appointment) {
  return a.date === b.date && a.start < b.end && b.start < a.end;
}
