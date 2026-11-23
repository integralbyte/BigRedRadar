import { cookies } from "next/headers";

import { readPlanStore } from "@/lib/academics/plan-store";
import { COOKIE_NAME, userFromToken } from "@/lib/server/auth";
import { getDatabase } from "@/lib/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function signedIn() {
  const jar = await cookies();
  return userFromToken(jar.get(COOKIE_NAME)?.value);
}

export async function GET() {
  const user = await signedIn();
  if (!user) return Response.json({ error: "Sign in to use account plans." }, { status: 401 });
  const sql = getDatabase();
  const [row] = await sql`select revision, data from academic_plans where user_id = ${user.id}`;
  return Response.json({ revision: row?.revision ?? 0, data: row?.data ?? null },
    { headers: { "Cache-Control": "private, no-store" } });
}

export async function PUT(request: Request) {
  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Use the Big Red Radar planner." }, { status: 403 });
  }
  const user = await signedIn();
  if (!user) return Response.json({ error: "Sign in to use account plans." }, { status: 401 });
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return Response.json({ error: "Send a JSON plan export." }, { status: 415 });
  }
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Send a JSON plan export." }, { status: 400 });
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 5_000_000) {
      await reader.cancel();
      return Response.json({ error: "Plan backups must be smaller than 5 MB." }, { status: 413 });
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();

  let revision: number;
  let data;
  try {
    const body = JSON.parse(text) as { revision: number; data: unknown };
    if (!Number.isSafeInteger(body.revision) || body.revision < 0 || body.revision >= 2_147_483_647) throw new Error();
    revision = body.revision;
    data = readPlanStore(body.data);
  } catch {
    return Response.json({ error: "Invalid plan backup." }, { status: 400 });
  }

  const sql = getDatabase();
  const rows = revision === 0
    ? await sql`insert into academic_plans (user_id, data) values (${user.id}, ${sql.json(data as never)})
        on conflict (user_id) do nothing returning revision`
    : await sql`update academic_plans
        set data = ${sql.json(data as never)}, revision = revision + 1, updated_at = now()
        where user_id = ${user.id} and revision = ${revision} returning revision`;
  if (!rows.length) return Response.json({ error: "Your account backup changed. Load it before saving." }, { status: 409 });
  return Response.json({ revision: rows[0].revision });
}
