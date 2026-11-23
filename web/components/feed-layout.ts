import { useLayoutPreference } from './LayoutSwitcher'

export const feedLayouts = { cards: 'Event cards', agenda: 'Agenda', week: 'Weekly view' } as const

export function useFeedLayout() {
  return useLayoutPreference('brr.feed.layout', feedLayouts, 'cards')
}
