'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import LayoutSwitcher from './LayoutSwitcher'
import { feedLayouts, useFeedLayout } from './feed-layout'
import { apiGet, eventsPath } from '@/lib/api'
import { CATEGORIES, categoryLabel } from '@/lib/categories'
import { dayKeys, fmtKey, fmtTime, fmtWkShort, gcalUrl, ITHACA, keyToDate, matches } from '@/lib/dates'
import type { EventItem } from '@/lib/types'
import styles from './feed.module.css'

const dateLabel = new Intl.DateTimeFormat('en-US', { timeZone: ITHACA, weekday: 'long', month: 'long', day: 'numeric' })
const shortDate = new Intl.DateTimeFormat('en-US', { timeZone: ITHACA, month: 'short', day: 'numeric' })
const batchSize = 18

function Event({ event, card = false }: { event: EventItem; card?: boolean }) {
  const date = new Date(event.starts_at)
  const time = event.time_tba ? 'Time TBA' : event.all_day ? 'All day' : fmtTime.format(date)
  const source = event.url && /^https?:\/\//i.test(event.url) ? event.url : null
  return (
    <article className={card ? styles.eventCard : styles.eventRow}>
      <time dateTime={event.starts_at}>{card ? shortDate.format(date) + ' · ' : ''}{time}</time>
      <div className={styles.eventBody}>
        <h3>{source ? <a href={source} target="_blank" rel="noreferrer">{event.title}</a> : event.title}</h3>
        <p><Link href={'/clubs/' + event.org_slug}>{event.org_name}</Link>{event.location && ' · ' + event.location}</p>
        {card && event.description && <p className={styles.description}>{event.description}</p>}
      </div>
      <a className={styles.calendarLink} href={gcalUrl(event)} target="_blank" rel="noreferrer"
        aria-label={'Add ' + event.title + ' to Google Calendar'}>+ Calendar</a>
    </article>
  )
}

function Agenda({ events }: { events: EventItem[] }) {
  const days = new Map<string, EventItem[]>()
  for (const event of events) {
    const date = fmtKey.format(new Date(event.starts_at))
    const entries = days.get(date)
    if (entries) entries.push(event)
    else days.set(date, [event])
  }
  return <div className={styles.agenda}>
    {[...days].map(([date, entries]) => <section key={date} className={styles.agendaGroup}>
      <h3><time dateTime={date}>{dateLabel.format(keyToDate(date))}</time></h3>
      <div className={styles.agendaEvents}>{entries.map((event) => <Event key={event.id} event={event} />)}</div>
    </section>)}
  </div>
}

function WeeklyFeed({ events }: { events: EventItem[] }) {
  const days = dayKeys(63)
  const eventDays = new Set(events.map((event) => fmtKey.format(new Date(event.starts_at))))
  const firstEvent = days.findIndex((date) => eventDays.has(date))
  const [week, setWeek] = useState(Math.max(0, Math.floor(firstEvent / 7)))
  const [day, setDay] = useState<string>()
  const weekDays = days.slice(week * 7, week * 7 + 7)
  const active = day && weekDays.includes(day) ? day : weekDays.find((date) => eventDays.has(date)) ?? weekDays[0]
  const shown = events.filter((event) => fmtKey.format(new Date(event.starts_at)) === active)
  return <section className={styles.week}>
    <div className={styles.weekHeading}>
      <h2>{shortDate.format(keyToDate(weekDays[0]))} – {shortDate.format(keyToDate(weekDays.at(-1)!))}</h2>
      <div className={styles.actions}>
        <button className={styles.button} type="button" disabled={week === 0}
          onClick={() => { setWeek(week - 1); setDay(undefined) }}>Previous week</button>
        <button className={styles.button} type="button" disabled={week >= Math.ceil(days.length / 7) - 1}
          onClick={() => { setWeek(week + 1); setDay(undefined) }}>Next week</button>
      </div>
    </div>
    <div className={styles.weekDays} aria-label="Choose a day">
      {weekDays.map((date) => {
        const value = keyToDate(date)
        return <button key={date} type="button" aria-pressed={date === active}
          aria-label={dateLabel.format(value)} onClick={() => setDay(date)}>
          <span>{fmtWkShort.format(value)}</span>
          <strong>{value.getUTCDate()}</strong>
          {eventDays.has(date) && <i aria-hidden="true" />}
        </button>
      })}
    </div>
    <div className={styles.dayEvents} aria-live="polite">
      <h3>{dateLabel.format(keyToDate(active))}</h3>
      {shown.length ? shown.map((event) => <Event key={event.id} event={event} />) : <p>No events on this day.</p>}
    </div>
  </section>
}

export default function Feed({ slugs, followedCount }: { slugs?: string[]; followedCount: number }) {
  const [layout, chooseLayout] = useFeedLayout()
  const [state, setState] = useState<{ path: string; events?: EventItem[]; failed?: boolean }>()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [limit, setLimit] = useState(batchSize)
  const [attempt, setAttempt] = useState(0)
  const path = slugs && eventsPath([...slugs].sort())
  const current = state?.path === path ? state : undefined
  const events = current?.events

  useEffect(() => {
    if (!path) return
    let active = true
    apiGet<{ events: EventItem[] }>(path)
      .then((result) => { if (active) setState({ path, events: result.events ?? [] }) })
      .catch(() => { if (active) setState({ path, failed: true }) })
    return () => { active = false }
  }, [path, attempt])

  const categories = useMemo(() => new Set(events?.flatMap((event) => event.org_category ?? []) ?? []), [events])
  const query = search.trim().toLowerCase()
  const selectedCategory = categories.has(category) ? category : ''
  const shown = events?.filter((event) => (!selectedCategory || event.org_category === selectedCategory) && (!query || matches(event, query)))
  const filtered = Boolean(query || selectedCategory)

  return <div className={styles.feed}>
    <header className={styles.header}>
      <div>
        <h1>My feed</h1>
        <p>{followedCount
          ? followedCount + (followedCount === 1 ? ' followed club' : ' followed clubs') + (events ? ' · ' + events.length + ' upcoming' : '')
          : 'Upcoming Cornell events. Follow clubs to personalize your feed.'}</p>
      </div>
      <Link className={styles.button} href="/clubs">{followedCount ? 'Edit clubs' : 'Find clubs'}</Link>
    </header>
    <div className={styles.toolbar}>
      <input type="search" aria-label="Search events" placeholder="Search events or clubs" value={search}
        onChange={(event) => { setSearch(event.target.value); setLimit(batchSize) }} />
      <details className={styles.filters}>
        <summary>Filters{selectedCategory && <span> · {categoryLabel(selectedCategory)}</span>}</summary>
        <div>
          <label>Category
            <select value={selectedCategory} onChange={(event) => { setCategory(event.target.value); setLimit(batchSize) }}>
              <option value="">All categories</option>
              {CATEGORIES.filter(([key]) => categories.has(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
        </div>
      </details>
    </div>

    {current?.failed ? <div className={styles.empty}>
      <p role="alert">Events couldn’t be loaded.</p>
      <button className={styles.button} type="button" onClick={() => { setState(undefined); setAttempt(attempt + 1) }}>Try again</button>
    </div> : !shown ? <p className={styles.empty} role="status">Loading events…</p> : !shown.length ? <div className={styles.empty}>
      <p>{filtered ? 'No events match these filters.' : followedCount ? 'Nothing coming up from your followed clubs.' : 'No upcoming events are available.'}</p>
      {filtered ? <button className={styles.button} type="button" onClick={() => { setSearch(''); setCategory(''); setLimit(batchSize) }}>Clear filters</button> :
        <Link className={styles.button} href="/explore">Explore events</Link>}
    </div> : layout === 'week' ? <WeeklyFeed key={selectedCategory + '|' + query} events={shown} /> : <>
      {layout === 'cards' ? <div className={styles.cards}>
        {shown.slice(0, limit).map((event) => <Event key={event.id} event={event} card />)}
      </div> : <Agenda events={shown.slice(0, limit)} />}
      {shown.length > limit && <button type="button" className={styles.button} onClick={() => setLimit(limit + batchSize)}>Show more events</button>}
    </>}
    <LayoutSwitcher name="Feed" value={layout} layouts={feedLayouts} onChange={chooseLayout} />
  </div>
}
