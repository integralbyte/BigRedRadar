export type Attempt = {
  id: string;
  code: string;
  subject: string;
  number: number;
  credits: number;
  term?: string;
  status: "planned" | "in_progress" | "completed";
  grade?: string;
  origin: "cornell" | "transfer" | "study_abroad" | "exam";
  creditKey?: string;
  crossListedCodes?: string[];
  components?: string[];
  distributionCodes?: string[];
  attributeCodes?: string[];
  academicCollege?: string;
  fixedCredits?: boolean;
  approvals?: string[];
  topic?: string;
  passFailOnly?: boolean;
};

export type CourseFilter = {
  codes?: string[];
  acceptCrossListings?: boolean;
  subjects?: string[];
  excludeSubjects?: string[];
  numberMin?: number;
  numberMax?: number;
  excludeNumbers?: number[];
  excludeNumberPatterns?: string[];
  minCredits?: number;
  maxCredits?: number;
  terms?: string[];
  maxCountedCredits?: number;
  courseWeight?: number;
  excludeCodes?: string[];
  distributions?: string[];
  components?: string[];
  attributes?: string[];
  academicColleges?: string[];
  fixedCredits?: boolean;
  origins?: Attempt["origin"][];
  minGrade?: string;
  maxGrade?: string;
  approval?: string;
  excludeApprovals?: string[];
  topics?: string[];
  grades?: string[];
  passFailOnly?: boolean;
  allowPassFailOnly?: boolean;
  allowSatisfactory?: boolean;
};

export type CourseSlot = {
  id: string;
  label: string;
  need: number;
  unit: "courses" | "credits";
  options: CourseFilter[];
  allocationGroup?: string;
};

export type AllocationCheck = {
  id: string;
  label: string;
  need: number;
  unit: CourseSlot["unit"];
  slots?: string[];
  slotPrefix?: string;
  options?: CourseFilter[];
};
type AssignedCheck = AllocationCheck & { slots: string[] };

export type AllocationLimit = {
  slots?: string[];
  slotPrefix?: string;
  slotPrefixes?: string[];
  partitionBy?: "term" | "subject";
  max: number;
  unit: CourseSlot["unit"];
  options: CourseFilter[];
};
type AssignedLimit = AllocationLimit & { slots: string[]; partitionValue?: string };

export type ManualRequirement = {
  id: string;
  label: string;
  instruction: string;
  when?: "transfer" | "external_credit";
};

export type ProgramOverlap = {
  with: "major" | "minor" | "program";
  max: number;
  unit: "courses" | "credits";
  slots?: string[];
  programIds?: string[];
};

export type RuleChoice = {
  id: string;
  label: string;
  onlyWhen?: Record<string, string[]>;
  options: {
    id: string;
    label: string;
    transfer?: boolean;
    onlyWhen?: Record<string, string[]>;
    excludeWhen?: Record<string, string[]>;
    excludePrograms?: string[];
    slots: CourseSlot[];
    totals?: CourseSlot[];
    checks?: AllocationCheck[];
    limits?: AllocationLimit[];
    manual?: ManualRequirement[];
  }[];
};

export type ProgramRules = {
  programId: string;
  name: string;
  catalogYear: string;
  additionalCatalogYears?: string[];
  version: string;
  reviewedOn: string;
  scope: string;
  sources: string[];
  colleges?: string[];
  excludeColleges?: string[];
  excludePrograms?: string[];
  variantId?: string;
  layer?: "college" | "university";
  onlyWhenDeclared?: string[];
  maxDoubleCount?: Record<string, number>;
  slots: CourseSlot[];
  totals?: CourseSlot[];
  checks?: AllocationCheck[];
  limits?: AllocationLimit[];
  overlaps?: ProgramOverlap[];
  manual?: ManualRequirement[];
  choices?: RuleChoice[];
};

const grades = ["F", "D-", "D", "D+", "C-", "C", "C+", "B-", "B", "B+", "A-", "A", "A+"];
const noCredit = new Set(["F", "U", "UX", "W", "I", "INC", "NGR", "AUD"]);
const unitsPerCredit = 100;
const satisfactory = new Set(["S", "SX", "Satisfactory"]);

function normalizeTopic(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function eligible(attempt: Attempt, filter: CourseFilter) {
  if (attempt.status === "completed" && noCredit.has(attempt.grade ?? "")) return false;
  const aliases = filter.acceptCrossListings ? attempt.crossListedCodes ?? [] : [];
  if (filter.excludeCodes?.some((code) => code === attempt.code || aliases.includes(code))) return false;
  const excludesPattern = (number: number) => {
    const suffix = String(number);
    return filter.excludeNumberPatterns?.some((pattern) => pattern.length === suffix.length &&
      [...pattern].every((digit, index) => digit === "X" || digit === suffix[index]));
  };
  const matchesListing = (code: string, subject: string, number: number) =>
    (!filter.codes || filter.codes.includes(code)) &&
    (!filter.subjects || filter.subjects.includes(subject)) &&
    !filter.excludeSubjects?.includes(subject) &&
    !filter.excludeNumbers?.includes(number) &&
    !excludesPattern(number) &&
    (filter.numberMin === undefined || number >= filter.numberMin) &&
    (filter.numberMax === undefined || number <= filter.numberMax);
  if (!matchesListing(attempt.code, attempt.subject, attempt.number) && !aliases.some((code) => {
    const [subject, number] = code.split(" ");
    return matchesListing(code, subject, Number.parseInt(number, 10));
  })) return false;
  if (filter.minCredits !== undefined && attempt.credits < filter.minCredits) return false;
  if (filter.maxCredits !== undefined && attempt.credits > filter.maxCredits) return false;
  if (filter.terms && !filter.terms.includes(attempt.term ?? "")) return false;
  if (filter.academicColleges && !filter.academicColleges.includes(attempt.academicCollege ?? "")) return false;
  if (filter.fixedCredits !== undefined && attempt.fixedCredits !== filter.fixedCredits) return false;
  if (filter.origins && !filter.origins.includes(attempt.origin)) return false;
  if (filter.distributions && !filter.distributions.some((code) => attempt.distributionCodes?.includes(code))) return false;
  if (filter.components && !filter.components.some((code) => attempt.components?.includes(code))) return false;
  if (filter.attributes && !filter.attributes.some((code) => attempt.attributeCodes?.includes(code))) return false;
  if (filter.approval && !attempt.approvals?.includes(filter.approval)) return false;
  if (filter.excludeApprovals?.some((approval) => attempt.approvals?.includes(approval))) return false;
  if (filter.topics && !filter.topics.some((topic) => normalizeTopic(topic) === normalizeTopic(attempt.topic ?? ""))) return false;
  if (filter.grades && !filter.grades.includes(attempt.grade ?? "")) return false;
  if (filter.passFailOnly !== undefined && !!attempt.passFailOnly !== filter.passFailOnly) return false;
  if (filter.maxGrade) {
    const actual = grades.indexOf(attempt.grade ?? "");
    if (attempt.status !== "completed" || actual < 0 || actual > grades.indexOf(filter.maxGrade)) return false;
  }
  if (filter.minGrade && attempt.status === "completed") {
    if ((filter.allowSatisfactory || (filter.allowPassFailOnly && attempt.passFailOnly)) && satisfactory.has(attempt.grade ?? "")) return true;
    const minimum = grades.indexOf(filter.minGrade);
    return minimum >= 0 && grades.indexOf(attempt.grade ?? "") >= minimum;
  }
  return true;
}

function value(credits: number, unit: CourseSlot["unit"], courseWeight: number) {
  return Math.round((unit === "credits" ? credits : courseWeight) * unitsPerCredit);
}

type Selection = {
  attempt: Attempt;
  slots: number[];
  contributions: { target: number; amount: number }[];
  limits: { index: number; amount: number }[];
};
type Allocation = { complete: number; fraction: number; selection: Selection[] };

function better(a: Allocation, b: Allocation) {
  return a.complete > b.complete || (a.complete === b.complete && a.fraction > b.fraction);
}

function allocate(slots: CourseSlot[], checks: AssignedCheck[], limits: AssignedLimit[], attempts: Attempt[], doubleCount: number) {
  const targets = [...slots, ...checks];
  const required = targets.map((slot) => Math.round(slot.need * unitsPerCredit));
  const pairs = new Map<string, Selection[]>();
  for (const attempt of attempts) {
    const key = attempt.creditKey ?? attempt.code;
    const selections: Selection[] = [];
    for (const [index, slot] of slots.entries()) {
      const eligibleOptions = slot.options.filter((filter) => eligible(attempt, filter));
      if (!eligibleOptions.length) continue;
      const eligibleCredits = Math.max(...eligibleOptions.map((filter) => Math.min(attempt.credits, filter.maxCountedCredits ?? attempt.credits)));
      const courseWeight = Math.max(...eligibleOptions.map((filter) => filter.courseWeight ?? 1));
      const amount = value(eligibleCredits, slot.unit, courseWeight);
      if (amount <= 0) continue;
      const contributions = [{ target: index, amount }];
      checks.forEach((check, checkIndex) => {
        if (check.slots.includes(slot.id) && (!check.options || check.options.some((filter) => eligible(attempt, filter)))) {
          contributions.push({ target: slots.length + checkIndex, amount: value(eligibleCredits, check.unit, courseWeight) });
        }
      });
      const usedAllowances = limits.flatMap((limit, index) =>
        limit.slots.includes(slot.id) && (!limit.partitionBy || limit.partitionValue === attempt[limit.partitionBy]) &&
          limit.options.some((filter) => eligible(attempt, filter))
          ? [{ index, amount: value(eligibleCredits, limit.unit, courseWeight) }] : []);
      selections.push({ attempt, slots: [index], contributions, limits: usedAllowances });
    }
    const combined: Selection[] = [];
    if (doubleCount > 0) {
      for (const [index, first] of selections.entries()) {
        for (const second of selections.slice(index + 1)) {
          const contributions = new Map<number, number>();
          for (const { target, amount } of [...first.contributions, ...second.contributions]) {
            contributions.set(target, Math.max(contributions.get(target) ?? 0, amount));
          }
          combined.push({ attempt, slots: [...first.slots, ...second.slots], limits: [],
            contributions: [...contributions].map(([target, amount]) => ({ target, amount })) });
        }
      }
    }
    if (selections.length) pairs.set(key, [...(pairs.get(key) ?? []), ...combined, ...selections]);
  }
  const choices = [...pairs.values()].sort((a, b) => a.length - b.length);
  const memo = new Map<string, Allocation>();
  let truncated = false;

  function solve(index: number, remaining: number[], allowances: number[], doubleLeft: number): Allocation {
    const complete = remaining.filter((count) => count === 0).length;
    const fraction = remaining.reduce((sum, count, i) => required[i] > 0 ? sum + 1 - count / required[i] : sum, 0);
    if (index === choices.length || complete === targets.length) return { complete, fraction, selection: [] };
    if (memo.size >= 50_000) {
      truncated = true;
      return { complete, fraction, selection: [] };
    }
    const key = `${index}:${remaining.join(",")}:${allowances.join(",")}:${doubleLeft}`;
    const cached = memo.get(key);
    if (cached) return cached;
    let best = { complete, fraction, selection: [] } as Allocation;
    for (const choice of choices[index]) {
      if (choice.slots.length > 1 && doubleLeft === 0) continue;
      if (choice.slots.some((slot) => remaining[slot] <= 0 && slots[slot].unit === "courses")) continue;
      if (choice.contributions.every(({ target }) => remaining[target] <= 0)) continue;
      if (choice.limits.some(({ index, amount }) => allowances[index] < amount)) continue;
      const next = remaining.slice();
      for (const { target, amount } of choice.contributions) next[target] = Math.max(0, next[target] - amount);
      const remainingAllowances = allowances.slice();
      for (const { index, amount } of choice.limits) remainingAllowances[index] -= amount;
      const result = solve(index + 1, next, remainingAllowances, doubleLeft - (choice.slots.length - 1));
      if (better(result, best)) best = { ...result, selection: [choice, ...result.selection] };
      if (best.complete === targets.length) break;
    }
    if (best.complete < targets.length) {
      const skipped = solve(index + 1, remaining, allowances, doubleLeft);
      if (better(skipped, best)) best = skipped;
    }
    memo.set(key, best);
    return best;
  }

  const result = solve(0, required,
    limits.map((limit) => Math.round(limit.max * unitsPerCredit)), doubleCount);
  return { ...result, truncated: truncated && result.complete < targets.length };
}

function summarize(slots: CourseSlot[], attempts: Attempt[], totals: CourseSlot[], checks: AllocationCheck[], limits: AllocationLimit[],
  maxDoubleCount: Record<string, number>) {
  const grouped = new Map<string, CourseSlot[]>();
  for (const slot of slots) {
    const group = slot.allocationGroup ?? "program";
    grouped.set(group, [...(grouped.get(group) ?? []), slot]);
  }
  for (const total of totals) grouped.set(`total:${total.id}`, [total]);

  const slotsById = new Map<string, { id: string; count: number; attemptIds: string[] }>();
  const assignedSlots = (rule: Pick<AllocationLimit, "slots" | "slotPrefix" | "slotPrefixes">) => {
    const prefixes = rule.slotPrefixes ?? (rule.slotPrefix ? [rule.slotPrefix] : []);
    return rule.slots ?? (grouped.get("program") ?? [])
      .filter((slot) => !prefixes.length || prefixes.some((prefix) => slot.id.startsWith(prefix))).map((slot) => slot.id);
  };
  const assignedChecks = checks.map((rule) => ({ ...rule, slots: assignedSlots(rule) }));
  const assignedLimits = limits.flatMap((rule) => {
    const slots = assignedSlots(rule);
    if (rule.slotPrefixes && !slots.length) return [];
    const resolved: AssignedLimit = { ...rule, slots };
    if (!rule.partitionBy) return [resolved];
    const keys = new Set(attempts.flatMap((attempt) => {
      const partitionValue = attempt[rule.partitionBy!];
      return partitionValue && rule.options.some((filter) => eligible(attempt, filter)) ? [partitionValue] : [];
    }));
    return [...keys].map((partitionValue) => ({ ...resolved, partitionValue }));
  });
  for (const rule of [...assignedChecks, ...assignedLimits]) {
    if (!Array.from(grouped.values()).some((group) => rule.slots.length > 0 &&
        rule.slots.every((id) => group.some((slot) => slot.id === id)))) {
      throw new Error(`Allocation rule must refer to applying slots in the same group: ${rule.slots.join(", ")}`);
    }
  }
  let truncated = false;
  for (const [groupId, group] of grouped) {
    const groupChecks = assignedChecks.filter((check) => group.some((slot) => slot.id === check.slots[0]));
    const groupLimits = assignedLimits.filter((limit) => group.some((slot) => slot.id === limit.slots[0]));
    const allowance = maxDoubleCount[groupId] ?? 0;
    if (allowance > 0 && (groupLimits.length || group.some((slot) => slot.unit !== "courses"))) {
      throw new Error("A double-counting group must contain only course slots with no allocation limits");
    }
    const distribution = allocate(group, groupChecks, groupLimits, attempts, allowance);
    truncated ||= distribution.truncated;
    const targets = [...group, ...groupChecks];
    targets.forEach((slot, i) => {
      const matched = distribution.selection.flatMap(({ attempt, contributions }) =>
        contributions.filter(({ target, amount }) => target === i && amount > 0).map(({ amount }) => ({ id: attempt.id, amount })));
      const count = matched.reduce((sum, attempt) => sum + attempt.amount, 0);
      slotsById.set(slot.id, { id: slot.id, count: count / unitsPerCredit,
        attemptIds: matched.map((attempt) => attempt.id) });
    });
  }
  return { slotsById, truncated };
}

export function degreeProgress(
  rules: ProgramRules,
  attempts: Attempt[],
  context: {
    college: string;
    transfer: boolean;
    confirmed?: ReadonlySet<string>;
    choices?: Readonly<Record<string, string>>;
    declaredPrograms?: ReadonlySet<string>;
  },
) {
  const unresolvedChoices: RuleChoice[] = [];
  const applicableChoices: RuleChoice[] = [];
  const selections = new Map<string, string>();
  const activeSlots = [...rules.slots];
  const totals = [...(rules.totals ?? [])];
  const checks = [...(rules.checks ?? [])];
  const limits = [...(rules.limits ?? [])];
  const checklists = [...(rules.manual ?? [])];
  const hasProgram = (id: string) => context.declaredPrograms?.has(id) ?? false;
  const matchesChoice = ([rule, values]: [string, string[]]) => values.includes(selections.get(rule) ?? "");
  const matchesChoices = (dependencies?: Record<string, string[]>) => Object.entries(dependencies ?? {}).every(matchesChoice);
  for (const choice of rules.choices ?? []) {
    if (!matchesChoices(choice.onlyWhen)) continue;
    const options = choice.options.filter((option) => {
      const conflicts = Object.entries(option.excludeWhen ?? {}).some(matchesChoice);
      return (option.transfer === undefined || option.transfer === context.transfer) &&
        matchesChoices(option.onlyWhen) && !conflicts && !option.excludePrograms?.some(hasProgram);
    });
    const applicable = { ...choice, options };
    applicableChoices.push(applicable);
    const selected = options.find((option) => option.id === context.choices?.[choice.id]);
    if (!selected) {
      unresolvedChoices.push(applicable);
      continue;
    }
    selections.set(choice.id, selected.id);
    activeSlots.push(...selected.slots);
    totals.push(...(selected.totals ?? []));
    checks.push(...(selected.checks ?? []));
    limits.push(...(selected.limits ?? []));
    checklists.push(...(selected.manual ?? []));
  }
  const earned = summarize(activeSlots, attempts.filter((attempt) => attempt.status === "completed"), totals, checks, limits, rules.maxDoubleCount ?? {});
  const projected = summarize(activeSlots, attempts, totals, checks, limits, rules.maxDoubleCount ?? {});
  const slots = [...activeSlots, ...checks, ...totals].filter((slot) => slot.need > 0).map((slot) => ({
    id: slot.id,
    label: slot.label,
    unit: slot.unit,
    need: slot.need,
    earned: earned.slotsById.get(slot.id)!,
    projected: projected.slotsById.get(slot.id)!,
  }));
  const manual = checklists.filter((item) => {
    if (item.when === "transfer") return context.transfer;
    if (item.when === "external_credit") return attempts.some((attempt) => attempt.origin !== "cornell");
    return true;
  }).map((item) => ({ ...item, confirmed: context.confirmed?.has(item.id) ?? false }));

  const eligibleCollege = (!rules.colleges || rules.colleges.includes(context.college)) && !rules.excludeColleges?.includes(context.college);
  const eligiblePrograms = !rules.excludePrograms?.some(hasProgram) && (!rules.onlyWhenDeclared || rules.onlyWhenDeclared.some(hasProgram));
  const coursework = activeSlots.map((slot) => ({ id: slot.id,
    earned: earned.slotsById.get(slot.id)!.attemptIds,
    projected: projected.slotsById.get(slot.id)!.attemptIds,
  }));
  return { slots, coursework, manual, applicableChoices, unresolvedChoices, eligibleCollege, eligiblePrograms,
    needsAllocationReview: earned.truncated || projected.truncated };
}
