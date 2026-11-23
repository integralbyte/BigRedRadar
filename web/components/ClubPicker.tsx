'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useFollows } from '@/lib/follows'
import { CATEGORIES, categoryLabel } from '@/lib/categories'
import LayoutSwitcher from './LayoutSwitcher'
import { feedLayouts, useFeedLayout } from './feed-layout'
import feedStyles from './feed.module.css'
import styles from './club-picker.module.css'

const batchSize = 12

export default function ClubPicker() {
  const router = useRouter()
  const { ready, orgs, follows, followedCount, toggle, setMany, clearAll } = useFollows()
  const [layout, chooseLayout] = useFeedLayout()
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<Set<string>>(new Set())
  const [limit, setLimit] = useState(batchSize)
  const n = followedCount()
  const query = search.trim().toLowerCase()
  const counts = new Map<string, number>()
  for (const org of orgs) {
    if (org.category) counts.set(org.category, (counts.get(org.category) ?? 0) + 1)
  }
  const visible = orgs.filter((org) =>
    (!query || org.name.toLowerCase().includes(query)) &&
    (!filters.size || filters.has(org.category ?? '') || (filters.has('following') && follows.has(org.slug))),
  ).sort((a, b) => (b.upcoming - a.upcoming) || a.name.localeCompare(b.name))
  const filtered = filters.size > 0 || Boolean(query)
  const shown = visible.slice(0, limit)

  function setFilter(key: string, checked: boolean) {
    setFilters((current) => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
    setLimit(batchSize)
  }

  function clearFilters() {
    setSearch('')
    setFilters(new Set())
    setLimit(batchSize)
  }

  return <div className={feedStyles.feed + ' ' + styles.picker}>
    <header className={feedStyles.header}>
      <div>
        <h1>{n ? 'My clubs' : 'Find clubs'}</h1>
        <p>Follow clubs to see their events in My Feed.</p>
      </div>
      <Link className={feedStyles.button} href="/">Open My Feed</Link>
    </header>

    <div className={feedStyles.toolbar}>
      <input type="search" aria-label="Search clubs" value={search}
        placeholder={orgs.length ? 'Search ' + orgs.length + ' clubs' : 'Search clubs'}
        onChange={(event) => { setSearch(event.target.value); setLimit(batchSize) }} />
      <details className={feedStyles.filters}>
        <summary>Filters{filters.size > 0 && <span> · {filters.size} active</span>}</summary>
        <div className={styles.filterPanel}>
          {(n > 0 || filters.has('following')) && <label>
            <input type="checkbox" checked={filters.has('following')}
              onChange={(event) => setFilter('following', event.target.checked)} />
            Following <small>{n}</small>
          </label>}
          {CATEGORIES.filter(([key]) => counts.has(key)).map(([key, label]) => <label key={key}>
            <input type="checkbox" checked={filters.has(key)}
              onChange={(event) => setFilter(key, event.target.checked)} />
            {label} <small>{counts.get(key)}</small>
          </label>)}
        </div>
      </details>
    </div>

    <div className={styles.listHeading}>
      <p role="status">{ready ? visible.length + ' ' + (visible.length === 1 ? 'club' : 'clubs') + ' · ' + n + ' following' : 'Loading clubs…'}</p>
      {filtered && <button type="button" className={styles.textButton} onClick={clearFilters}>Clear filters</button>}
      {visible.length > 0 && <details className={feedStyles.filters + ' ' + styles.bulk}>
        <summary>Bulk actions</summary>
        <div>
          <button type="button" className={feedStyles.button}
            onClick={() => setMany(visible.map((org) => org.slug), true)}>{filtered ? 'Follow matching clubs' : 'Follow all clubs'}</button>
          <button type="button" className={feedStyles.button}
            onClick={() => filtered ? setMany(visible.map((org) => org.slug), false) : clearAll()}>{filtered ? 'Unfollow matching clubs' : 'Unfollow all clubs'}</button>
        </div>
      </details>}
    </div>

    {ready && !visible.length && <p className={styles.empty}>{filtered ? 'No clubs match these filters.' : 'No clubs have upcoming events.'}</p>}
    {shown.length > 0 && <ul className={styles.clubs} aria-label="Clubs">
      {shown.map((org) => {
        const following = follows.has(org.slug)
        const category = categoryLabel(org.category)
        return <li key={org.slug}>
          <div>
            <Link href={'/clubs/' + org.slug}>{org.name}</Link>
            <p>{category && category + ' · '}{org.upcoming} upcoming {org.upcoming === 1 ? 'event' : 'events'}</p>
          </div>
          <button type="button" className={feedStyles.button + ' ' + styles.follow} aria-pressed={following}
            aria-label={(following ? 'Unfollow ' : 'Follow ') + org.name} onClick={() => toggle(org.slug)}>
            {following ? 'Following' : 'Follow'}
          </button>
        </li>
      })}
    </ul>}
    {visible.length > limit && <button type="button" className={feedStyles.button} onClick={() => setLimit(limit + batchSize)}>Show more clubs</button>}

    <LayoutSwitcher name="Feed" value={layout} layouts={feedLayouts} onChange={(choice) => {
      chooseLayout(choice)
      router.push('/')
    }} />
  </div>
}
