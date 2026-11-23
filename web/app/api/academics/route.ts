import { academicCourse, academicData } from "@/lib/server/academics";
import { courseCode, planningTerm } from "@/lib/academics/snapshot";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  try {
    const data = await academicData();
    const { snapshot } = data;
    const programIds = searchParams.get("programs")?.split(",").filter(Boolean).slice(0, 20);
    if (programIds) return Response.json({ rules: snapshot.rules.filter((rule) => rule.layer || programIds.includes(rule.programId)) });

    if (searchParams.has("code")) {
      const term = searchParams.get("term") ?? planningTerm;
      if (!/^(?:FA|SP|WI|SU)\d{2}$/.test(term)) return Response.json({ error: "Invalid term." }, { status: 400 });
      const result = academicCourse(data, searchParams.get("code")!.slice(0, 40), term);
      return result ? Response.json(result) : Response.json({ error: "Course not found." }, { status: 404 });
    }

    if (searchParams.has("q")) {
      const raw = searchParams.get("q")!.trim().slice(0, 100);
      const normalized = courseCode(raw);
      if (!normalized) return Response.json({ courses: [] });
      const words = raw.toLowerCase().split(/\s+/);
      const offered = searchParams.get("offered") === "1";
      const matches = [];
      for (const course of data.courses.values()) {
        const hasOffering = data.offerings.has(course.code);
        if (offered && !hasOffering) continue;
        const label = `${course.code} ${course.title}`.toLowerCase();
        const rank = course.code === normalized ? 0 : course.code.startsWith(normalized) ? 1 :
          words.every((word) => label.includes(word)) ? 2 : 3;
        if (rank < 3) matches.push({ rank, code: course.code, title: course.title, credits: course.credits, offered: hasOffering });
      }
      matches.sort((a, b) => a.rank - b.rank || Number(b.offered) - Number(a.offered) || a.code.localeCompare(b.code));
      return Response.json({ courses: matches.slice(0, 25).map(({ rank: _, ...course }) => course) });
    }

    return Response.json({ term: snapshot.roster.term, version: snapshot.version, rosterTimestamp: snapshot.roster.roster_timestamp,
      catalogYear: snapshot.coverage.catalog_year, programs: snapshot.coverage.programs });
  } catch {
    return Response.json({ error: "The academic snapshot is temporarily unavailable." }, { status: 503 });
  }
}
