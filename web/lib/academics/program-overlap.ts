import type { Attempt, degreeProgress, ProgramRules } from "./degree-progress";

type EvaluatedProgram = {
  rule: ProgramRules;
  type?: "major" | "minor";
  progress: ReturnType<typeof degreeProgress>;
};

export function reviewProgramOverlap(program: EvaluatedProgram, all: EvaluatedProgram[], attempts: Attempt[]) {
  const byId = new Map(attempts.map((attempt) => [attempt.id, attempt]));
  const identity = (attempt: Attempt) => attempt.creditKey ?? attempt.code;
  return (program.rule.overlaps ?? []).flatMap((policy) => {
    const peers = all.filter((other) => other !== program && other.type &&
      (policy.with === "program" || other.type === policy.with) && other.progress.eligiblePrograms &&
      (!policy.programIds || policy.programIds.includes(other.rule.programId)));
    if (!peers.length) return [];
    const ownSlots = program.progress.coursework.filter((slot) => !policy.slots || policy.slots.includes(slot.id));
    const shared = (state: "earned" | "projected") => {
      const peerCredits = new Set(peers.flatMap((peer) => peer.progress.coursework.flatMap((slot) => slot[state]))
        .map((id) => byId.get(id)).filter((attempt) => attempt !== undefined).map(identity));
      const counted = new Map<string, Attempt>();
      for (const id of ownSlots.flatMap((slot) => slot[state])) {
        const attempt = byId.get(id);
        if (attempt && peerCredits.has(identity(attempt))) counted.set(identity(attempt), attempt);
      }
      return { courses: [...counted.values()].map((attempt) => attempt.code),
        count: policy.unit === "courses" ? counted.size : [...counted.values()].reduce((total, attempt) => total + attempt.credits, 0) };
    };
    const earned = shared("earned");
    const projected = shared("projected");
    return earned.count > policy.max || projected.count > policy.max ? [{ ...policy, earned, projected }] : [];
  });
}
