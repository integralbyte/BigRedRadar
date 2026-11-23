'use client'

import Feed from '@/components/Feed'
import { useFollows } from '@/lib/follows'

export default function FeedPage() {
  const { ready, follows } = useFollows()
  return <Feed slugs={ready ? [...follows] : undefined} />
}
