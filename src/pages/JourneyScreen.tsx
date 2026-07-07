import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import {
  getJourneyProgrammes,
  getJourneyModules,
  bookEvent,
  checkBooking,
  downloadIcs,
} from '../lib/journey'
import type { JourneyProgramme, JourneyModule, JourneyEvent, BookingResult } from '../lib/journey'

// ── Local, lightweight persistence (plain localStorage, no extra store) ───────
// Selections are tentative until the final "Confirm and book" step, so what's
// persisted is "what the learner has picked so far", not real bookings, plus
// whether they've actually confirmed (fired the real mutations) yet.

interface TentativeSelection {
  eventId: string
  startDate: number
  finishDate: number
  roomNames: string[]
}

interface JourneyState {
  selections: (TentativeSelection | null)[]
  isConfirmed: boolean
  confirmResults: (BookingResult | null)[]
}

const EMPTY_STATE: JourneyState = { selections: [], isConfirmed: false, confirmResults: [] }

// Keyed per subject + programme so a manager planning journeys for several
// team members (or across different programmes) doesn't clobber one plan
// with another.
function storageKey(userId: string, courseId: string): string {
  return `compass-journey-${userId}-${courseId}`
}

function loadState(userId: string, courseId: string): JourneyState {
  try {
    const raw = localStorage.getItem(storageKey(userId, courseId))
    return raw ? JSON.parse(raw) : EMPTY_STATE
  } catch {
    return EMPTY_STATE
  }
}

function saveState(userId: string, courseId: string, state: JourneyState): void {
  localStorage.setItem(storageKey(userId, courseId), JSON.stringify(state))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

function formatGap(fromMs: number, toMs: number): string {
  const days = Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24))
  if (days < 7) return `${days} day${days !== 1 ? 's' : ''}`
  const weeks = Math.round(days / 7)
  return `${weeks} week${weeks !== 1 ? 's' : ''}`
}

// ── Timeline sub-components ───────────────────────────────────────────────────

type CircleState = 'selected' | 'current' | 'locked'

function ModuleCircle({ state }: { state: CircleState }) {
  if (state === 'selected') {
    return (
      <div className="w-8 h-8 rounded-full bg-brand-700 flex items-center justify-center text-white text-sm flex-shrink-0">
        ✓
      </div>
    )
  }
  if (state === 'current') {
    return (
      <div className="relative flex-shrink-0 w-8 h-8">
        <div className="absolute inset-0 rounded-full bg-brand-600 animate-ping opacity-40" />
        <div className="relative w-8 h-8 rounded-full bg-brand-700" />
      </div>
    )
  }
  return (
    <div className="w-8 h-8 rounded-full border-2 border-gray-300 bg-white flex items-center justify-center text-xs flex-shrink-0">
      🔒
    </div>
  )
}

function ModuleCard({
  module,
  index,
  selection,
  unlocked,
  onOpen,
}: {
  module: JourneyModule
  index: number
  selection: TentativeSelection | null
  unlocked: boolean
  onOpen: () => void
}) {
  if (selection) {
    return (
      <div className="bg-white border-2 border-brand-600 rounded p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Module {index + 1}</p>
            <p className="font-bold text-gray-900 mb-2">{module.name}</p>
            <p className="text-sm text-brand-700 font-semibold">{formatDate(selection.startDate)}</p>
            <p className="text-xs text-gray-500">
              {formatTime(selection.startDate)}–{formatTime(selection.finishDate)} ·{' '}
              {selection.roomNames.join(', ') || 'Virtual'}
            </p>
          </div>
          <button onClick={onOpen} className="text-xs font-semibold text-brand-700 hover:text-brand-800 underline flex-shrink-0">
            Change
          </button>
        </div>
      </div>
    )
  }

  if (!unlocked) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded p-4 opacity-70">
        <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Module {index + 1} · Locked</p>
        <p className="font-semibold text-gray-500">{module.name}</p>
        <p className="text-xs text-gray-400 mt-1">Pick the previous module's date first</p>
      </div>
    )
  }

  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-white border-2 border-brand-600 rounded p-4 hover:bg-brand-50 transition-colors"
    >
      <p className="text-xs text-brand-700 uppercase tracking-wide font-semibold mb-1">Module {index + 1}</p>
      <p className="font-bold text-gray-900 mb-2">{module.name}</p>
      {module.description && (
        <p className="text-xs text-gray-500 mb-2">{stripHtml(module.description).slice(0, 100)}</p>
      )}
      <p className="text-xs text-brand-700 font-semibold">
        Choose a date · {module.events.length} session{module.events.length !== 1 ? 's' : ''} available
      </p>
    </button>
  )
}

function DateCard({
  event,
  selected,
  onSelect,
}: {
  event: JourneyEvent
  selected: boolean
  onSelect: () => void
}) {
  const urgent = event.seatsAvailable < 5
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left border-2 rounded p-4 transition-colors ${
        selected ? 'border-brand-700 bg-brand-50' : 'border-gray-200 bg-white hover:border-brand-400'
      }`}
    >
      <p className="font-bold text-gray-900">{formatDate(event.startDate)}</p>
      <p className="text-sm text-gray-600">
        {formatTime(event.startDate)} – {formatTime(event.finishDate)}
      </p>
      <p className="text-xs text-gray-500 mt-1">{event.roomNames.join(', ') || 'Virtual'}</p>
      <p className={`text-xs mt-1 font-semibold ${urgent ? 'text-red-600' : 'text-gray-400'}`}>
        {urgent
          ? `Only ${event.seatsAvailable} seat${event.seatsAvailable !== 1 ? 's' : ''} left`
          : `${event.seatsAvailable} seats available`}
      </p>
    </button>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

type SubjectPhase = 'mode-select' | 'member-select' | 'ready'
type ProgrammesPhase = 'loading' | 'ready' | 'empty' | 'error'
type ModulesPhase = 'loading' | 'ready' | 'empty' | 'error'
type View = 'reviewing' | 'date-picker' | 'confirming' | 'booked'

interface JourneySubject {
  userId: string
  userName: string
  isManagerMode: boolean
}

export default function JourneyScreen() {
  const navigate = useNavigate()
  const currentUser = useStore((s) => s.currentUser)
  const directReports = useStore((s) => s.directReports)

  const [subjectPhase, setSubjectPhase] = useState<SubjectPhase>(
    directReports.length > 0 ? 'mode-select' : 'ready'
  )
  const [subject, setSubject] = useState<JourneySubject | null>(
    directReports.length > 0 || !currentUser
      ? null
      : { userId: currentUser.id, userName: currentUser.fullname, isManagerMode: false }
  )

  const [programmesPhase, setProgrammesPhase] = useState<ProgrammesPhase>('loading')
  const [programmes, setProgrammes] = useState<JourneyProgramme[]>([])
  const [programmesError, setProgrammesError] = useState<string | null>(null)
  const [selectedProgramme, setSelectedProgramme] = useState<JourneyProgramme | null>(null)

  const [modulesPhase, setModulesPhase] = useState<ModulesPhase>('loading')
  const [modules, setModules] = useState<JourneyModule[]>([])
  const [modulesError, setModulesError] = useState<string | null>(null)

  const [selections, setSelections] = useState<(TentativeSelection | null)[]>([])
  const [isConfirmed, setIsConfirmed] = useState(false)
  const [confirmResults, setConfirmResults] = useState<(BookingResult | null)[]>([])

  const [view, setView] = useState<View>('reviewing')
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)

  const [confirming, setConfirming] = useState(false)
  const [confirmProgress, setConfirmProgress] = useState(0)

  const [revealIndex, setRevealIndex] = useState<number | null>(null)
  const [revealActive, setRevealActive] = useState(false)

  // Fetch programmes once the subject is known — cached in state so it
  // doesn't re-run just from navigating back to programme selection.
  async function loadProgrammes() {
    setProgrammesPhase('loading')
    setProgrammesError(null)
    try {
      const progs = await getJourneyProgrammes()
      if (progs.length === 0) {
        setProgrammesPhase('empty')
        return
      }
      setProgrammes(progs)
      setProgrammesPhase('ready')
    } catch (err) {
      setProgrammesError(String(err))
      setProgrammesPhase('error')
    }
  }

  useEffect(() => {
    if (subjectPhase === 'ready' && subject && programmes.length === 0 && programmesPhase === 'loading') {
      loadProgrammes()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectPhase, subject?.userId])

  async function selectProgramme(programme: JourneyProgramme) {
    setSelectedProgramme(programme)
    setModulesPhase('loading')
    setModulesError(null)
    try {
      const allModules = await getJourneyModules()
      const scoped = allModules.filter((m) => programme.seminarIds.includes(m.seminarId))
      if (scoped.length === 0) {
        setModulesPhase('empty')
        return
      }
      setModules(scoped)

      if (subject) {
        const persisted = loadState(subject.userId, programme.courseId)
        setSelections(persisted.selections)
        setConfirmResults(persisted.confirmResults)

        if (persisted.isConfirmed) {
          // Reconcile confirmed bookings against Totara; if one no longer
          // exists, drop back into reviewing from that point.
          let stillValid = true
          for (let i = 0; i < persisted.selections.length; i++) {
            const sel = persisted.selections[i]
            if (!sel) continue
            const exists = await checkBooking(subject.userId, sel.eventId)
            if (!exists) {
              stillValid = false
              const nextSelections = [...persisted.selections]
              for (let j = i; j < nextSelections.length; j++) nextSelections[j] = null
              setSelections(nextSelections)
              saveState(subject.userId, programme.courseId, {
                selections: nextSelections,
                isConfirmed: false,
                confirmResults: [],
              })
              break
            }
          }
          setIsConfirmed(stillValid)
        }
      }

      setModulesPhase('ready')
    } catch (err) {
      setModulesError(String(err))
      setModulesPhase('error')
    }
  }

  function persist(nextSelections: (TentativeSelection | null)[], confirmed: boolean, results: (BookingResult | null)[]) {
    if (!subject || !selectedProgramme) return
    saveState(subject.userId, selectedProgramme.courseId, {
      selections: nextSelections,
      isConfirmed: confirmed,
      confirmResults: results,
    })
  }

  function setSelection(index: number, selection: TentativeSelection) {
    setSelections((prev) => {
      const next = [...prev]
      // Changing an earlier module invalidates any later tentative picks,
      // since they may no longer satisfy the after-the-previous-module
      // date constraint -- force re-review of everything downstream.
      for (let i = index + 1; i < next.length; i++) next[i] = null
      next[index] = selection
      persist(next, false, [])
      return next
    })
    setIsConfirmed(false)
    setConfirmResults([])
  }

  useEffect(() => {
    if (view === 'reviewing' && revealIndex !== null) {
      setRevealActive(false)
      const raf = requestAnimationFrame(() => setRevealActive(true))
      const timeout = setTimeout(() => setRevealIndex(null), 900)
      return () => {
        cancelAnimationFrame(raf)
        clearTimeout(timeout)
      }
    }
  }, [view, revealIndex])

  function isUnlocked(index: number): boolean {
    if (index === 0) return true
    return !!selections[index - 1]
  }

  function openModule(index: number) {
    if (!isUnlocked(index)) return
    setActiveIndex(index)
    setSelectedEventId(selections[index]?.eventId ?? null)
    setView('date-picker')
  }

  function closeDatePicker() {
    setActiveIndex(null)
    setView('reviewing')
  }

  const activeModule = activeIndex !== null ? modules[activeIndex] : null

  const availableEvents = useMemo(() => {
    if (!activeModule || activeIndex === null) return []
    const prevSelection = activeIndex > 0 ? selections[activeIndex - 1] : null
    if (!prevSelection) return activeModule.events
    return activeModule.events.filter((e) => e.startDate > prevSelection.finishDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModule, activeIndex, selections])

  function handleSelectDate() {
    if (!selectedEventId || activeIndex === null) return
    const event = availableEvents.find((e) => e.id === selectedEventId)
    if (!event) return
    setSelection(activeIndex, {
      eventId: event.id,
      startDate: event.startDate,
      finishDate: event.finishDate,
      roomNames: event.roomNames,
    })
    setRevealIndex(activeIndex + 1)
    setActiveIndex(null)
    setView('reviewing')
  }

  const allSelected = modules.length > 0 && modules.every((_, i) => !!selections[i])

  async function handleConfirmAll() {
    if (!subject || !selectedProgramme) return
    setConfirming(true)
    const results: (BookingResult | null)[] = modules.map(() => null)

    for (let i = 0; i < modules.length; i++) {
      setConfirmProgress(i)
      const sel = selections[i]
      if (!sel) {
        results[i] = { outcome: 'error', message: 'No date selected for this module' }
        continue
      }
      results[i] = await bookEvent(sel.eventId, subject.userId)
    }

    setConfirmResults(results)
    setIsConfirmed(true)
    setConfirming(false)
    persist(selections, true, results)
    setView('booked')
  }

  async function retryModule(index: number) {
    if (!subject) return
    const sel = selections[index]
    if (!sel) return
    const result = await bookEvent(sel.eventId, subject.userId)
    setConfirmResults((prev) => {
      const next = [...prev]
      next[index] = result
      persist(selections, true, next)
      return next
    })
  }

  // ── Subject selection ────────────────────────────────────────────────────────

  if (subjectPhase === 'mode-select') {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
            ←
          </button>
          <p className="text-sm font-bold text-gray-900">Learning journey</p>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-12">
          <p className="text-sm text-gray-600 mb-6">Who is this journey for?</p>
          <div className="flex gap-3 w-full max-w-xs">
            <button
              onClick={() =>
                currentUser &&
                (setSubject({ userId: currentUser.id, userName: currentUser.fullname, isManagerMode: false }),
                setSubjectPhase('ready'))
              }
              className="flex-1 bg-brand-700 hover:bg-brand-800 text-white font-semibold rounded py-5 transition-colors"
            >
              Myself
            </button>
            <button
              onClick={() => setSubjectPhase('member-select')}
              className="flex-1 bg-white hover:bg-gray-50 border border-gray-400 text-gray-800 font-semibold rounded py-5 transition-colors"
            >
              A team member
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (subjectPhase === 'member-select') {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button
            onClick={() => setSubjectPhase('mode-select')}
            className="text-sm text-gray-400 hover:text-gray-700 transition-colors"
          >
            ←
          </button>
          <p className="text-sm font-bold text-gray-900">Learning journey</p>
        </header>
        <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
          <p className="text-sm text-gray-600 mb-5">Select team member</p>
          <div className="space-y-2">
            {directReports.map((report) => (
              <button
                key={report.userId}
                onClick={() => {
                  setSubject({ userId: report.userId, userName: report.userName, isManagerMode: true })
                  setSubjectPhase('ready')
                }}
                className="w-full text-left px-4 py-4 border rounded bg-white border-gray-300 hover:border-brand-500 transition-colors"
              >
                <p className="text-sm font-semibold text-gray-900">{report.userName}</p>
                {report.position && <p className="text-xs text-brand-700 mt-0.5">{report.position}</p>}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Programme (course) selection ─────────────────────────────────────────────

  if (!selectedProgramme) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
            ←
          </button>
          <div>
            <p className="text-sm font-bold text-gray-900">Learning journey</p>
            {subject?.isManagerMode && <p className="text-xs text-brand-700">For {subject.userName}</p>}
          </div>
        </header>

        {programmesPhase === 'loading' && (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-gray-400">Finding available programmes…</p>
          </div>
        )}

        {programmesPhase === 'error' && (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <div>
              <p className="text-sm text-gray-600 mb-2">Something went wrong finding programmes</p>
              <p className="text-xs text-gray-400 mb-4 break-words">{programmesError}</p>
              <button onClick={loadProgrammes} className="bg-brand-700 text-white text-sm font-semibold rounded px-6 py-3">
                Retry
              </button>
            </div>
          </div>
        )}

        {programmesPhase === 'empty' && (
          <div className="flex-1 flex items-center justify-center p-6 text-center">
            <p className="text-sm text-gray-500">No programmes available right now — check back soon.</p>
          </div>
        )}

        {programmesPhase === 'ready' && (
          <div className="px-4 py-6 max-w-lg mx-auto w-full space-y-3">
            <p className="text-sm text-gray-600 mb-2">Choose a programme</p>
            {programmes.map((programme) => (
              <button
                key={programme.courseId}
                onClick={() => selectProgramme(programme)}
                className="w-full text-left bg-white border-2 border-brand-600 rounded p-4 hover:bg-brand-50 transition-colors"
              >
                <p className="font-bold text-gray-900 mb-1">{programme.name}</p>
                {programme.description && (
                  <p className="text-xs text-gray-500">{stripHtml(programme.description).slice(0, 120)}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Modules loading/error/empty ───────────────────────────────────────────────

  if (modulesPhase === 'loading') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading your learning journey…</p>
      </div>
    )
  }

  if (modulesPhase === 'error') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm text-gray-600 mb-2">Something went wrong loading your journey</p>
          <p className="text-xs text-gray-400 mb-4 break-words">{modulesError}</p>
          <button
            onClick={() => selectProgramme(selectedProgramme)}
            className="bg-brand-700 text-white text-sm font-semibold rounded px-6 py-3"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (modulesPhase === 'empty') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6 text-center">
        <p className="text-sm text-gray-500">No upcoming modules available — check back soon.</p>
      </div>
    )
  }

  // ── Date picker ───────────────────────────────────────────────────────────────

  if (view === 'date-picker' && activeModule && activeIndex !== null) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button onClick={closeDatePicker} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
            ←
          </button>
          <div>
            <p className="text-sm font-bold text-gray-900">{activeModule.name}</p>
            {subject?.isManagerMode && <p className="text-xs text-brand-700">For {subject.userName}</p>}
          </div>
        </header>

        <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-3">
          {availableEvents.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-sm text-gray-600">
                No available dates after your previous module — speak to your coordinator.
              </p>
            </div>
          ) : (
            availableEvents.map((event) => (
              <DateCard
                key={event.id}
                event={event}
                selected={selectedEventId === event.id}
                onSelect={() => setSelectedEventId(event.id)}
              />
            ))
          )}
        </div>

        {availableEvents.length > 0 && (
          <div className="bg-white border-t-2 border-brand-700 px-4 py-4 sticky bottom-0">
            <button
              onClick={handleSelectDate}
              disabled={!selectedEventId}
              className="w-full bg-brand-700 hover:bg-brand-800 disabled:bg-gray-300 text-white font-semibold rounded py-4 transition-colors"
            >
              Select this date
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Confirm-and-book screen ────────────────────────────────────────────────

  if (view === 'confirming' && !isConfirmed) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
          <button
            onClick={() => setView('reviewing')}
            disabled={confirming}
            className="text-sm text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-40"
          >
            ←
          </button>
          <p className="text-sm font-bold text-gray-900">Review your journey</p>
        </header>

        <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full space-y-3">
          {confirming ? (
            <div className="text-center py-12">
              <p className="text-sm text-gray-500">
                Booking module {confirmProgress + 1} of {modules.length}…
              </p>
            </div>
          ) : (
            modules.map((module, i) => {
              const sel = selections[i]!
              return (
                <div key={module.seminarId} className="bg-white border border-gray-200 rounded p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Module {i + 1}</p>
                      <p className="font-bold text-gray-900 mb-1">{module.name}</p>
                      <p className="text-sm text-brand-700 font-semibold">
                        {formatDate(sel.startDate)} · {formatTime(sel.startDate)}–{formatTime(sel.finishDate)}
                      </p>
                      <p className="text-xs text-gray-500">{sel.roomNames.join(', ') || 'Virtual'}</p>
                    </div>
                    <button
                      onClick={() => openModule(i)}
                      className="text-xs font-semibold text-brand-700 hover:text-brand-800 underline flex-shrink-0"
                    >
                      Change
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {!confirming && (
          <div className="bg-white border-t-2 border-brand-700 px-4 py-4 sticky bottom-0">
            <button
              onClick={handleConfirmAll}
              className="w-full bg-brand-700 hover:bg-brand-800 text-white font-semibold rounded py-4 transition-colors"
            >
              Confirm and book everything
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Booked summary ────────────────────────────────────────────────────────────

  if (isConfirmed) {
    return (
      <div className="min-h-screen bg-stone-50">
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10 no-print">
          <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
            ←
          </button>
          <div>
            <p className="text-sm font-bold text-gray-900">Learning journey</p>
            {subject?.isManagerMode && <p className="text-xs text-brand-700">For {subject.userName}</p>}
          </div>
        </header>

        <div className="px-4 py-6 max-w-lg mx-auto space-y-4 print-section">
          <div className="text-center mb-2 no-print">
            <p className="text-2xl mb-1">✓</p>
            <p className="text-lg font-bold text-gray-900">Journey booked</p>
            <p className="text-sm text-gray-500">
              {subject?.isManagerMode ? `${subject.userName}'s learning plan` : 'Your learning plan'}
            </p>
          </div>

          {modules.map((module, i) => {
            const sel = selections[i]!
            const nextSel = selections[i + 1]
            const result = confirmResults[i]
            return (
              <div key={module.seminarId}>
                <div className="bg-white border border-gray-200 rounded p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Module {i + 1}</p>
                  <p className="font-bold text-gray-900 mb-2">{module.name}</p>
                  <p className="text-sm text-brand-700 font-semibold">
                    {formatDate(sel.startDate)} · {formatTime(sel.startDate)}–{formatTime(sel.finishDate)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">{sel.roomNames.join(', ') || 'Virtual'}</p>

                  {result?.outcome === 'waitlisted' && (
                    <p className="no-print text-xs text-amber-700 mt-2">You're on the waitlist for this module.</p>
                  )}
                  {result?.outcome === 'requested' && (
                    <p className="no-print text-xs text-amber-700 mt-2">Booking pending approval for this module.</p>
                  )}
                  {result?.outcome === 'error' && (
                    <div className="no-print mt-2">
                      <p className="text-xs text-red-700">{result.message ?? 'Booking failed for this module.'}</p>
                      <button
                        onClick={() => retryModule(i)}
                        className="text-xs font-semibold text-brand-700 hover:text-brand-800 underline mt-1"
                      >
                        Retry
                      </button>
                    </div>
                  )}

                  <button
                    onClick={() => downloadIcs(module.name, { id: sel.eventId, ...sel })}
                    className="no-print mt-3 text-xs font-semibold text-brand-700 hover:text-brand-800 underline"
                  >
                    Add to calendar
                  </button>
                </div>
                {i < modules.length - 1 && nextSel && (
                  <p className="text-center text-xs text-gray-400 py-2">
                    ↓ {formatGap(sel.finishDate, nextSel.startDate)}
                  </p>
                )}
              </div>
            )
          })}

          <div className="no-print space-y-3 pt-4">
            <button
              onClick={() => window.print()}
              className="w-full border border-gray-400 hover:border-brand-600 text-gray-700 hover:text-brand-700 rounded text-sm font-semibold py-3 transition-colors"
            >
              Print / Save as PDF
            </button>
            <button
              onClick={() => window.print()}
              className="w-full border border-gray-400 hover:border-brand-600 text-gray-700 hover:text-brand-700 rounded text-sm font-semibold py-3 transition-colors"
            >
              {subject?.isManagerMode ? `Share with ${subject.userName.split(' ')[0]}` : 'Share with my manager'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Reviewing (default) ───────────────────────────────────────────────────────

  const selectedCount = selections.filter(Boolean).length

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
          ←
        </button>
        <div>
          <p className="text-sm font-bold text-gray-900">Learning journey</p>
          {subject?.isManagerMode && <p className="text-xs text-brand-700">For {subject.userName}</p>}
        </div>
      </header>

      <div className="bg-white border-b border-gray-200 px-4 py-4">
        <div className="max-w-lg mx-auto">
          <p className="text-sm font-semibold text-gray-900">{selectedProgramme.name}</p>
          <p className="text-xs text-gray-500">
            {modules.length} module{modules.length !== 1 ? 's' : ''} · {selectedCount} of {modules.length} selected
          </p>
          <p className="text-xs text-gray-400 mt-1">Nothing is booked yet — review your dates, then confirm at the end.</p>
        </div>
      </div>

      <div className={`px-4 py-6 max-w-lg mx-auto ${allSelected ? 'pb-24' : ''}`}>
        {modules.map((module, i) => {
          const selection = selections[i] ?? null
          const unlocked = isUnlocked(i)
          const state: CircleState = selection ? 'selected' : unlocked ? 'current' : 'locked'
          const isRevealing = revealIndex === i

          return (
            <div
              key={module.seminarId}
              className={`transition-all duration-500 ${
                isRevealing ? (revealActive ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3') : ''
              }`}
            >
              <div className="flex gap-3">
                <div className="flex flex-col items-center">
                  <ModuleCircle state={state} />
                  {i < modules.length - 1 && (
                    <div
                      className={`flex-1 w-0.5 my-1 ${
                        selection ? 'bg-brand-600' : 'border-l-2 border-dashed border-gray-300'
                      }`}
                      style={{ minHeight: '2.5rem' }}
                    />
                  )}
                </div>
                <div className="flex-1 pb-6">
                  <ModuleCard
                    module={module}
                    index={i}
                    selection={selection}
                    unlocked={unlocked}
                    onOpen={() => openModule(i)}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {allSelected && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-brand-700 px-4 py-4 z-20">
          <div className="max-w-lg mx-auto">
            <button
              onClick={() => setView('confirming')}
              className="w-full bg-brand-700 hover:bg-brand-800 text-white font-semibold rounded py-4 transition-colors"
            >
              Review all bookings
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
