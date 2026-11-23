import { useLayoutPreference } from './LayoutSwitcher'

export const feedLayouts = { week: 'Weekly view', cards: 'Event cards', agenda: 'Agenda' } as const

export function useFeedLayout() {
  return useLayoutPreference('brr.feed.layout', feedLayouts, 'week')
}
