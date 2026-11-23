import { NextResponse } from 'next/server'
import { readRefresh, isRunning } from '@/lib/server/state'
import { databaseConfigured } from '@/lib/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!databaseConfigured) return NextResponse.json({ ok: false, error: 'The events database is unconfigured.' }, { status: 503 })
  const lastRefresh = await readRefresh()

  return NextResponse.json({
    ok: true,
    refreshing: isRunning(lastRefresh),
    lastRefresh,
  })
}
