import { NextResponse } from 'next/server'
import { listOrgs } from '@/lib/server/queries'
import { databaseConfigured } from '@/lib/server/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  if (!databaseConfigured) return NextResponse.json({ error: 'Clubs are unavailable on this deployment.' }, { status: 503 })
  return NextResponse.json({ orgs: await listOrgs() })
}
