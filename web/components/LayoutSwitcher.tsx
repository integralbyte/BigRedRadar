'use client'

import { useEffect, useId, useRef, useState } from 'react'
import styles from './layout-switcher.module.css'

export function useLayoutPreference<T extends string>(
  key: string,
  layouts: Readonly<Record<T, string>>,
  fallback: NoInfer<T>,
) {
  const [layout, setLayout] = useState<T>(fallback)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(key)
      if (saved && Object.hasOwn(layouts, saved)) setLayout(saved as T)
    } catch {}
  }, [key, layouts])

  function choose(value: T) {
    setLayout(value)
    try { localStorage.setItem(key, value) } catch {}
  }

  return [layout, choose] as const
}

export default function LayoutSwitcher<T extends string>({ name, value, layouts, onChange }: {
  name: string
  value: T
  layouts: Readonly<Record<T, string>>
  onChange: (value: T) => void
}) {
  const details = useRef<HTMLDetailsElement>(null)
  const trigger = useRef<HTMLElement>(null)
  const id = useId()

  useEffect(() => {
    function dismiss(event: PointerEvent) {
      if (details.current?.open && !details.current.contains(event.target as Node)) {
        details.current.open = false
      }
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [])

  function close() {
    if (details.current) details.current.open = false
    trigger.current?.focus()
  }

  return (
    <details ref={details} className={styles.switcher} onKeyDown={(event) => {
      if (event.key === 'Escape' && details.current?.open) {
        event.preventDefault()
        close()
      }
    }}>
      <summary ref={trigger} aria-label={`${name} layout: ${layouts[value]}`}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor"
             strokeWidth="1.5" aria-hidden="true">
          <rect x="2.5" y="3.5" width="15" height="13" rx="2" />
          <path d="M2.5 8h15M8 8v8.5" />
        </svg>
        <span>Layout</span>
      </summary>
      <div className={styles.menu}>
        <p id={id}>{name} layout</p>
        <div role="group" aria-labelledby={id}>
          {(Object.keys(layouts) as T[]).map((choice) => (
            <button type="button" key={choice} aria-pressed={choice === value}
              onClick={() => { onChange(choice); close() }}>
              {layouts[choice]}
              {choice === value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      </div>
    </details>
  )
}
