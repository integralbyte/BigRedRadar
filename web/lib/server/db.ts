import postgres from 'postgres'

const url = process.env.DATABASE_URL

const globals = globalThis as unknown as { brrSql?: ReturnType<typeof postgres> }

export const databaseConfigured = Boolean(url)

export function getDatabase() {
  if (!url) throw new Error('DATABASE_URL is missing')
  globals.brrSql ??= postgres(url, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  })
  return globals.brrSql
}
