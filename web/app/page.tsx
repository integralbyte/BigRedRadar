'use client'

import Feed from '@/components/Feed'
import { useFollows } from '@/lib/follows'

export default function FeedPage() {
  const { ready, follows, followedCount } = useFollows()
  const n = followedCount()
  return <Feed slugs={ready ? (n ? [...follows] : []) : undefined} followedCount={n} />
}
