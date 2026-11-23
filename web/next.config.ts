import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  outputFileTracingIncludes: { '/api/academics': ['./academic-data/SP27.json'] },
}

export default nextConfig
