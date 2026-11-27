// Client behaviour for listing pages. Browser-safe only: no seed loader and no
// node:* imports. All cycle data is already present in the server-rendered DOM.
import {
  loadTracker,
  removeEntry,
  saveTracker,
  upsertEntry,
  type TrackerEntry,
  type TrackerStatus,
} from '../lib/tracker'

const STATUS_VALUES: readonly TrackerStatus[] = [
  'saved',
  'applied',
  'interview',
  'offer',
  'rejected',
]

function isStatus(value: string): value is TrackerStatus {
  return (STATUS_VALUES as readonly string[]).includes(value)
}

function initCycleTabs(): void {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-cycle-tab]'))
  if (tabs.length === 0) return
  const panels = Array.from(document.querySelectorAll<HTMLElement>('[data-cycle-panel]'))

  // The server renders every panel so all cycles are readable without
  // JavaScript. Once the tabs are live, show only the default panel.
  const defaultPanel =
    panels.find((panel) => panel.dataset.cycleDefault === 'true') ?? panels[0]
  for (const panel of panels) {
    panel.hidden = panel !== defaultPanel
  }

  function select(tab: HTMLButtonElement, moveFocus = false): void {
    const cycleId = tab.dataset.cycleId
    for (const candidate of tabs) {
      const active = candidate === tab
      candidate.setAttribute('aria-selected', String(active))
      candidate.tabIndex = active ? 0 : -1
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.cycleId !== cycleId
    }
    if (moveFocus) tab.focus()
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab))
    tab.addEventListener('keydown', (event) => {
      let next = index
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
      else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
      else if (event.key === 'Home') next = 0
      else if (event.key === 'End') next = tabs.length - 1
      else return
      event.preventDefault()
      select(tabs[next], true)
    })
  })
}

function initTracker(): void {
  const controls = Array.from(document.querySelectorAll<HTMLElement>('[data-tracker-controls]'))
  if (controls.length === 0) return

  let state = loadTracker()

  function findEntry(programId: string, cycleId: string): TrackerEntry | undefined {
    return state.entries.find(
      (entry) => entry.programId === programId && entry.cycleId === cycleId,
    )
  }

  function persist(entry: TrackerEntry): void {
    state = upsertEntry(state, entry)
    saveTracker(state)
  }

  function render(control: HTMLElement, entry: TrackerEntry | undefined): void {
    const start = control.querySelector<HTMLElement>('[data-tracker-start]')
    const saved = control.querySelector<HTMLElement>('[data-tracker-saved]')
    const status = control.querySelector<HTMLSelectElement>('[data-tracker-status]')
    const note = control.querySelector<HTMLTextAreaElement>('[data-tracker-note]')
    if (!start || !saved || !status || !note) return
    start.hidden = entry !== undefined
    saved.hidden = entry === undefined
    if (entry) {
      status.value = entry.status
      note.value = entry.note
    }
  }

  for (const control of controls) {
    const programId = control.dataset.programId
    const cycleId = control.dataset.cycleId
    if (!programId || !cycleId) continue

    const save = control.querySelector<HTMLButtonElement>('[data-tracker-save]')
    const remove = control.querySelector<HTMLButtonElement>('[data-tracker-remove]')
    const status = control.querySelector<HTMLSelectElement>('[data-tracker-status]')
    const note = control.querySelector<HTMLTextAreaElement>('[data-tracker-note]')
    if (!save || !remove || !status || !note) continue

    render(control, findEntry(programId, cycleId))

    save.addEventListener('click', () => {
      const entry: TrackerEntry = {
        programId,
        cycleId,
        status: 'saved',
        note: note.value,
        updatedAt: new Date().toISOString(),
      }
      persist(entry)
      render(control, entry)
    })

    status.addEventListener('change', () => {
      if (!isStatus(status.value)) return
      const existing = findEntry(programId, cycleId)
      if (!existing) return
      const entry: TrackerEntry = {
        ...existing,
        status: status.value,
        updatedAt: new Date().toISOString(),
      }
      persist(entry)
      render(control, entry)
    })

    note.addEventListener('input', () => {
      const existing = findEntry(programId, cycleId)
      if (!existing) return
      persist({
        ...existing,
        note: note.value,
        updatedAt: new Date().toISOString(),
      })
    })

    remove.addEventListener('click', () => {
      state = removeEntry(state, programId, cycleId)
      saveTracker(state)
      render(control, undefined)
    })
  }
}

function initShareLink(): void {
  const shares = document.querySelectorAll<HTMLAnchorElement>('[data-share-link]')
  if (shares.length === 0) return
  shares.forEach((share) => {
    const title = share.dataset.shareTitle ?? document.title
    share.href = `https://wa.me/?text=${encodeURIComponent(`${title} — ${window.location.href}`)}`
  })
}

function init(): void {
  initCycleTabs()
  initTracker()
  initShareLink()
}

init()
