// Client behaviour for the home listing. The program index arrives as embedded
// JSON; this module stays browser-safe and never loads seed files or Node APIs.
import { STUDY_LEVELS, type StudyLevel } from '../lib/constants'
import { stagesForCurrentLevel } from '../lib/eligibility'
import {
  filterIndex,
  sortIndex,
  type FilterState,
  type ProgramIndexEntry,
} from '../lib/filters'

const PAGE_SIZE = 24
const STORAGE_KEY = 'scholarship-level'

type Funding = FilterState['funding']
type DeadlineWindow = FilterState['deadlineWindow']
type Sort = Parameters<typeof sortIndex>[1]

const FUNDING_VALUES: Funding[] = ['all', 'fully', 'stipend', 'tuition', 'partial']
const DEADLINE_VALUES: DeadlineWindow[] = ['all', '30', '90']
const SORT_VALUES: Sort[] = ['newest', 'best-funded', 'deadline']

interface State extends FilterState {
  sort: Sort
  page: number
}

function isStudyLevel(value: string | null): value is StudyLevel {
  return value !== null && (STUDY_LEVELS as readonly string[]).includes(value)
}

function isOneOf<T extends string>(value: string | null, allowed: readonly T[]): value is T {
  return value !== null && (allowed as readonly string[]).includes(value)
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector)
  if (!element) throw new Error(`Home listing is missing ${selector}`)
  return element
}

function readEntries(): ProgramIndexEntry[] {
  const node = document.getElementById('program-index')
  if (!node) return []
  try {
    const parsed: unknown = JSON.parse(node.textContent ?? '[]')
    return Array.isArray(parsed) ? (parsed as ProgramIndexEntry[]) : []
  } catch {
    return []
  }
}

function init(): void {
  const grid = document.querySelector<HTMLElement>('#listing-grid')
  const form = document.querySelector<HTMLFormElement>('[data-filter-form]')
  const count = document.querySelector<HTMLElement>('[data-testid="results-count"]')
  const note = document.querySelector<HTMLElement>('[data-testid="eligible-note"]')
  const empty = document.querySelector<HTMLElement>('[data-testid="empty-state"]')
  const pagination = document.querySelector<HTMLElement>('[data-testid="pagination"]')
  const pageStatus = document.querySelector<HTMLElement>('[data-testid="page-status"]')
  const clear = document.querySelector<HTMLButtonElement>('[data-testid="clear-filters"]')
  if (!grid || !form || !count || !note || !empty || !pagination || !pageStatus || !clear) return

  const search = required<HTMLInputElement>(form, '[data-filter="q"]')
  const level = required<HTMLSelectElement>(form, '[data-filter="level"]')
  const current = required<HTMLSelectElement>(form, '[data-filter="current"]')
  const country = required<HTMLSelectElement>(form, '[data-filter="country"]')
  const funding = required<HTMLSelectElement>(form, '[data-filter="funding"]')
  const deadline = required<HTMLSelectElement>(form, '[data-filter="deadline"]')
  const eligible = required<HTMLInputElement>(form, '[data-filter="eligible"]')
  const sort = required<HTMLSelectElement>(document, '[data-filter="sort"]')
  const prev = required<HTMLButtonElement>(pagination, '[data-testid="prev-page"]')
  const next = required<HTMLButtonElement>(pagination, '[data-testid="next-page"]')

  const entries = readEntries()
  const knownCountries = new Set(entries.map((entry) => entry.country))
  const cards = new Map<string, HTMLElement>()
  for (const card of grid.querySelectorAll<HTMLElement>('[data-testid="listing-card"]')) {
    if (card.dataset.programId) cards.set(card.dataset.programId, card)
  }

  function readStoredLevel(): string | null {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch {
      return null
    }
  }

  function initialState(): State {
    const params = new URLSearchParams(window.location.search)
    const urlCurrent = params.get('current')
    const storedCurrent = readStoredLevel()
    const countryParam = params.get('country')
    const fundingParam = params.get('funding')
    const deadlineParam = params.get('deadline')
    const sortParam = params.get('sort')
    const pageParam = Number.parseInt(params.get('page') ?? '1', 10)

    return {
      query: params.get('q') ?? '',
      level: isStudyLevel(params.get('level')) ? (params.get('level') as StudyLevel) : 'all',
      currentLevel: isStudyLevel(urlCurrent)
        ? urlCurrent
        : isStudyLevel(storedCurrent)
          ? storedCurrent
          : 'bachelor',
      country:
        countryParam && countryParam !== 'all' && knownCountries.has(countryParam)
          ? countryParam
          : 'all',
      funding: isOneOf(fundingParam, FUNDING_VALUES) ? fundingParam : 'all',
      deadlineWindow: isOneOf(deadlineParam, DEADLINE_VALUES) ? deadlineParam : 'all',
      sort: isOneOf(sortParam, SORT_VALUES) ? sortParam : 'newest',
      eligibleOnly: params.get('eligible') === '1',
      status: 'active',
      page: Number.isFinite(pageParam) && pageParam > 0 ? pageParam : 1,
    }
  }

  const state = initialState()

  function syncControls(): void {
    search.value = state.query
    level.value = state.level
    current.value = state.currentLevel
    country.value = state.country ?? 'all'
    funding.value = state.funding
    deadline.value = state.deadlineWindow
    sort.value = state.sort
    eligible.checked = state.eligibleOnly
  }

  function syncUrl(): void {
    const params = new URLSearchParams()
    if (state.query.trim() !== '') params.set('q', state.query.trim())
    if (state.level !== 'all') params.set('level', state.level)
    if (state.currentLevel !== 'bachelor') params.set('current', state.currentLevel)
    if (state.country && state.country !== 'all') params.set('country', state.country)
    if (state.funding !== 'all') params.set('funding', state.funding)
    if (state.deadlineWindow !== 'all') params.set('deadline', state.deadlineWindow)
    if (state.sort !== 'newest') params.set('sort', state.sort)
    if (state.eligibleOnly) params.set('eligible', '1')
    if (state.page !== 1) params.set('page', String(state.page))

    const url = new URL(window.location.href)
    url.search = params.toString()
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }

  function updatePills(visible: ProgramIndexEntry[]): void {
    for (const entry of visible) {
      const pill = cards.get(entry.programId)?.querySelector<HTMLElement>('[data-eligible-pill]')
      if (pill) pill.hidden = !entry.likelyEligibleFor.includes(state.currentLevel)
    }
  }

  function render(): void {
    const filtered = sortIndex(
      filterIndex(entries, { ...state }, new Date()),
      state.sort,
    )
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    state.page = Math.min(Math.max(state.page, 1), totalPages)
    const visible = filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE)

    const nodes = visible
      .map((entry) => cards.get(entry.programId))
      .filter((node): node is HTMLElement => node !== undefined)
    grid!.replaceChildren(...nodes)
    updatePills(visible)

    count!.textContent = `${filtered.length} ${filtered.length === 1 ? 'scholarship' : 'scholarships'}`
    note!.hidden = !state.eligibleOnly
    empty!.hidden = filtered.length !== 0
    pagination!.hidden = totalPages <= 1
    prev!.disabled = state.page <= 1
    next!.disabled = state.page >= totalPages
    pageStatus!.textContent = `Page ${state.page} of ${totalPages}`
    syncUrl()
  }

  function changed(): void {
    state.page = 1
    render()
  }

  form.addEventListener('submit', (event) => event.preventDefault())
  search.addEventListener('input', () => {
    state.query = search.value
    changed()
  })
  level.addEventListener('change', () => {
    state.level = isStudyLevel(level.value) ? level.value : 'all'
    changed()
  })
  current.addEventListener('change', () => {
    if (!isStudyLevel(current.value)) return
    state.currentLevel = current.value
    // UI next-stage mapping only; eligibility is precomputed from applicant stages.
    state.level = stagesForCurrentLevel(state.currentLevel)[0]
    level.value = state.level
    try {
      localStorage.setItem(STORAGE_KEY, state.currentLevel)
    } catch {
      // Storage can be blocked; the selection still applies for this visit.
    }
    changed()
  })
  country.addEventListener('change', () => {
    state.country = country.value === 'all' ? 'all' : country.value
    changed()
  })
  funding.addEventListener('change', () => {
    state.funding = isOneOf(funding.value, FUNDING_VALUES) ? funding.value : 'all'
    changed()
  })
  deadline.addEventListener('change', () => {
    state.deadlineWindow = isOneOf(deadline.value, DEADLINE_VALUES) ? deadline.value : 'all'
    changed()
  })
  sort.addEventListener('change', () => {
    state.sort = isOneOf(sort.value, SORT_VALUES) ? sort.value : 'newest'
    changed()
  })
  eligible.addEventListener('change', () => {
    state.eligibleOnly = eligible.checked
    changed()
  })
  prev.addEventListener('click', () => {
    state.page -= 1
    render()
  })
  next.addEventListener('click', () => {
    state.page += 1
    render()
  })
  clear.addEventListener('click', () => {
    state.query = ''
    state.level = 'all'
    state.country = 'all'
    state.funding = 'all'
    state.deadlineWindow = 'all'
    state.sort = 'newest'
    state.eligibleOnly = false
    state.page = 1
    syncControls()
    render()
  })

  syncControls()
  render()
}

init()
