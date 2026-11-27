// Client behaviour for My Applications. Browser-safe only: the tracker state
// lives in localStorage and the listing data is embedded in the page by the
// build. Never imports seed files or Node APIs.
import type { CycleStatus } from '../lib/constants'
import { daysUntil, formatDate } from '../lib/format'
import {
  TrackerImportError,
  exportTracker,
  importTracker,
  loadTracker,
  removeEntry,
  saveTracker,
  upsertEntry,
  type TrackerEntry,
  type TrackerState,
  type TrackerStatus,
} from '../lib/tracker'

export interface TrackerProgram {
  programId: string
  title: string
  provider: string
}

export interface TrackerCycle {
  programId: string
  cycleId: string
  label: string
  status: CycleStatus
  deadline: string | null
  deadlineVerified: boolean
}

export interface TrackerData {
  programs: TrackerProgram[]
  cycles: TrackerCycle[]
}

const STATUSES: readonly TrackerStatus[] = [
  'saved',
  'applied',
  'interview',
  'offer',
  'rejected',
]

const STATUS_LABELS: Record<TrackerStatus, string> = {
  saved: 'Saved',
  applied: 'Applied',
  interview: 'Interview',
  offer: 'Offer',
  rejected: 'Rejected',
}

function isStatus(value: string): value is TrackerStatus {
  return (STATUSES as readonly string[]).includes(value)
}

function readData(): TrackerData {
  const node = document.getElementById('tracker-data')
  if (!node) return { programs: [], cycles: [] }
  try {
    const parsed: unknown = JSON.parse(node.textContent ?? '')
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as TrackerData).programs) &&
      Array.isArray((parsed as TrackerData).cycles)
    ) {
      return parsed as TrackerData
    }
  } catch {
    // A malformed embedded index must not break the page.
  }
  return { programs: [], cycles: [] }
}

function cycleKey(programId: string, cycleId: string): string {
  return `${programId}:${cycleId}`
}

interface Countdown {
  text: string
  date: string | null
  tone: 'normal' | 'urgent' | 'muted'
}

function countdownFor(cycle: TrackerCycle | undefined): Countdown {
  if (!cycle) {
    return { text: 'Cycle details unavailable — open the listing', date: null, tone: 'muted' }
  }
  if (cycle.status === 'archived') {
    return { text: 'Archived — for reference', date: null, tone: 'muted' }
  }
  if (cycle.status === 'closed') {
    return { text: 'Cycle closed — for reference', date: null, tone: 'muted' }
  }
  if (cycle.deadline === null) {
    return { text: 'No deadline listed', date: null, tone: 'muted' }
  }
  if (!cycle.deadlineVerified) {
    return { text: 'Deadline not confirmed — check official page', date: null, tone: 'muted' }
  }
  const days = daysUntil(cycle.deadline, new Date())
  if (days < 0) return { text: 'Deadline passed', date: cycle.deadline, tone: 'urgent' }
  if (days === 0) return { text: 'Deadline today', date: cycle.deadline, tone: 'urgent' }
  return {
    text: `${days} day${days === 1 ? '' : 's'} left`,
    date: cycle.deadline,
    tone: days <= 14 ? 'urgent' : 'normal',
  }
}

function cycleStatusLabel(status: CycleStatus): string {
  switch (status) {
    case 'open':
      return 'Open'
    case 'upcoming':
      return 'Upcoming'
    case 'closed':
      return 'Closed — for reference'
    case 'archived':
      return 'Archived — for reference'
  }
}

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function init(): void {
  const list = document.querySelector<HTMLElement>('#tracker-list')
  const empty = document.querySelector<HTMLElement>('[data-testid="tracker-empty"]')
  const exportButton = document.querySelector<HTMLButtonElement>('[data-testid="export-tracker"]')
  const exportOutput = document.querySelector<HTMLElement>('[data-testid="export-output"]')
  const exportCode = document.querySelector<HTMLTextAreaElement>('[data-testid="export-code"]')
  const importCode = document.querySelector<HTMLTextAreaElement>('[data-testid="import-code"]')
  const importButton = document.querySelector<HTMLButtonElement>('[data-testid="import-tracker"]')
  const importError = document.querySelector<HTMLElement>('[data-testid="import-error"]')
  const importSuccess = document.querySelector<HTMLElement>('[data-testid="import-success"]')
  if (
    !list ||
    !empty ||
    !exportButton ||
    !exportOutput ||
    !exportCode ||
    !importCode ||
    !importButton ||
    !importError ||
    !importSuccess
  ) {
    return
  }

  const data = readData()
  const programs = new Map(data.programs.map((program) => [program.programId, program]))
  const cycles = new Map(
    data.cycles.map((cycle) => [cycleKey(cycle.programId, cycle.cycleId), cycle]),
  )
  let state: TrackerState = loadTracker()

  function persist(next: TrackerState): void {
    state = next
    saveTracker(state)
  }

  function updateEntry(
    programId: string,
    cycleId: string,
    change: (entry: TrackerEntry) => TrackerEntry,
  ): void {
    const existing = state.entries.find(
      (entry) => entry.programId === programId && entry.cycleId === cycleId,
    )
    if (!existing) return
    persist(upsertEntry(state, change(existing)))
  }

  function renderEntry(entry: TrackerEntry): HTMLElement {
    const program = programs.get(entry.programId)
    const cycle = cycles.get(cycleKey(entry.programId, entry.cycleId))
    const titleId = `tracker-title-${entry.programId}-${entry.cycleId}`
    const statusId = `tracker-status-${entry.programId}-${entry.cycleId}`
    const noteId = `tracker-note-${entry.programId}-${entry.cycleId}`

    const article = element('article', 'tracker-entry')
    article.dataset.testid = 'tracker-entry'
    article.setAttribute('aria-labelledby', titleId)

    const head = element('div', 'tracker-entry__head')
    const heading = element('h3', 'tracker-entry__title')
    heading.id = titleId
    const title = element('a', undefined, program?.title ?? entry.programId)
    title.href = `/listing/${entry.programId}/`
    heading.append(title)
    head.append(heading)
    if (program) head.append(element('p', 'tracker-entry__provider', program.provider))

    const meta = element('div', 'tracker-entry__meta')
    meta.append(element('span', 'badge', cycle?.label ?? 'Cycle details unavailable'))
    if (cycle) {
      const badge = element('span', 'badge', cycleStatusLabel(cycle.status))
      badge.dataset.status = cycle.status
      meta.append(badge)
    }
    head.append(meta)
    article.append(head)

    const countdown = countdownFor(cycle)
    const countdownNode = element(
      'p',
      `tracker-entry__countdown tracker-entry__countdown--${countdown.tone}`,
    )
    countdownNode.dataset.testid = 'tracker-countdown'
    countdownNode.append(element('span', undefined, countdown.text))
    if (countdown.date !== null) {
      const time = element('time', undefined, formatDate(countdown.date))
      time.dateTime = countdown.date
      countdownNode.append(document.createTextNode(' · '), time)
    }
    article.append(countdownNode)

    const fields = element('div', 'tracker-entry__fields')

    const statusField = element('div', 'field')
    const statusLabel = element('label', 'field-label', 'Application status')
    statusLabel.htmlFor = statusId
    const select = element('select')
    select.id = statusId
    select.dataset.testid = 'tracker-status'
    for (const status of STATUSES) {
      const option = element('option', undefined, STATUS_LABELS[status])
      option.value = status
      select.append(option)
    }
    select.value = entry.status
    select.addEventListener('change', () => {
      const value = select.value
      if (!isStatus(value)) return
      updateEntry(entry.programId, entry.cycleId, (current) => ({
        ...current,
        status: value,
        updatedAt: new Date().toISOString(),
      }))
    })
    statusField.append(statusLabel, select)

    const noteField = element('div', 'field')
    const noteLabel = element('label', 'field-label', 'Notes')
    noteLabel.htmlFor = noteId
    const note = element('textarea')
    note.id = noteId
    note.rows = 3
    note.dataset.testid = 'tracker-note'
    note.value = entry.note
    note.addEventListener('input', () => {
      updateEntry(entry.programId, entry.cycleId, (current) => ({
        ...current,
        note: note.value,
        updatedAt: new Date().toISOString(),
      }))
    })
    noteField.append(noteLabel, note)

    fields.append(statusField, noteField)
    article.append(fields)

    const actions = element('div', 'tracker-entry__actions')
    const remove = element('button', 'button--quiet', 'Remove')
    remove.type = 'button'
    remove.dataset.testid = 'tracker-remove'
    remove.setAttribute(
      'aria-label',
      `Remove ${program?.title ?? entry.programId} from My Applications`,
    )
    remove.addEventListener('click', () => {
      persist(removeEntry(state, entry.programId, entry.cycleId))
      render()
      // The clicked button no longer exists; keep keyboard focus in the list.
      if (state.entries.length === 0) empty!.focus()
      else list!.querySelector<HTMLElement>('a')?.focus()
    })
    actions.append(remove)
    article.append(actions)

    return article
  }

  function render(): void {
    const sorted = state.entries.slice().sort((a, b) => {
      const aTitle = programs.get(a.programId)?.title ?? a.programId
      const bTitle = programs.get(b.programId)?.title ?? b.programId
      return aTitle.localeCompare(bTitle)
    })
    list!.replaceChildren(...sorted.map(renderEntry))
    const isEmpty = sorted.length === 0
    list!.hidden = isEmpty
    empty!.hidden = !isEmpty

    // While the file is empty, export is a quiet, disabled secondary action.
    // Once an entry exists, it becomes the page's one primary action.
    exportButton!.disabled = isEmpty
    exportButton!.classList.toggle('button--primary', !isEmpty)
    exportButton!.classList.toggle('button--quiet', isEmpty)
    if (isEmpty) exportOutput!.hidden = true
  }

  exportButton.addEventListener('click', () => {
    exportCode.value = exportTracker(state)
    exportOutput.hidden = false
    exportCode.focus()
    exportCode.select()
  })

  importCode.addEventListener('input', () => {
    importError.hidden = true
    importSuccess.hidden = true
  })

  importButton.addEventListener('click', () => {
    try {
      const imported = importTracker(importCode.value)
      persist(imported)
      render()
      importError.hidden = true
      importSuccess.hidden = false
      importCode.value = ''
    } catch (error) {
      if (!(error instanceof TrackerImportError)) throw error
      importError.textContent =
        'That backup code is not valid. Paste the full code exactly as exported.'
      importError.hidden = false
      importSuccess.hidden = true
    }
  })

  render()
}

init()
