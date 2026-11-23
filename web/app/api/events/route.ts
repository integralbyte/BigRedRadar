import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { listEvents, parseSlugs } from '@/lib/server/queries'
import { databaseConfigured } from '@/lib/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!databaseConfigured) return NextResponse.json({ error: 'Events are unavailable on this deployment.' }, { status: 503 })
  const slugs = parseSlugs(request.nextUrl.searchParams.get('orgs'))
  return NextResponse.json({ events: await listEvents(slugs) })
}
