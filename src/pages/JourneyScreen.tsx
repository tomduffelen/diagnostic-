import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { getJourneyModules, bookEvent, checkBooking, downloadIcs } from '../lib/journey'
import type { JourneyModule, JourneyEvent } from '../lib/journey'

// ── Local, lightweight persistence (plain localStorage, no extra store) ───────

interface BookedModule {
  eventId: string
  startDate: number
  finishDate: number
  roomNames: string[]
}

// Keyed per subject so a manager planning journeys for several team
// members (or themselves) doesn't clobber one person's bookings with
// another's.
function storageKey(userId: string): string {
  return `compass-journey-bookings-${userId}`
}

function loadBookings(userId: string): (BookedModule | null)[] {
  try {
    const raw = localStorage.getItem(storageKey(userId))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveBookings(userId: string, bookings: (BookedModule | null)[]): void {
  localStorage.setItem(storageKey(userId), JSON.stringify(bookings))
}

interface JourneySubject {
  userId: string
  userName: string
  isManagerMode: boolean
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

type CircleState = 'booked' | 'current' | 'locked'

function ModuleCircle({ state }: { state: CircleState }) {
  if (state === 'booked') {
    return (
      <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white text-sm flex-shrink-0">
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
  booking,
  unlocked,
  onOpen,
}: {
  module: JourneyModule
  index: number
  booking: BookedModule | null
  unlocked: boolean
  onOpen: () => void
}) {
  if (booking) {
    return (
      <div className="bg-white border border-gray-200 rounded p-4">
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Module {index + 1}</p>
        <p className="font-bold text-gray-900 mb-2">{module.name}</p>
        <p className="text-sm text-brand-700 font-semibold">{formatDate(booking.startDate)}</p>
        <p className="text-xs text-gray-500">
          {formatTime(booking.startDate)}–{formatTime(booking.finishDate)} ·{' '}
          {booking.roomNames.join(', ') || 'Virtual'}
        </p>
      </div>
    )
  }

  if (!unlocked) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded p-4 opacity-70">
        <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Module {index + 1} · Locked</p>
        <p className="font-semibold text-gray-500">{module.name}</p>
        <p className="text-xs text-gray-400 mt-1">Book the previous module first</p>
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

type Phase = 'loading' | 'timeline' | 'date-picker' | 'error' | 'empty'
type WaitStatus = 'created' | 'waitlisted' | 'requested' | null
type SubjectPhase = 'mode-select' | 'member-select' | 'ready'

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

  const [phase, setPhase] = useState<Phase>('loading')
  const [modules, setModules] = useState<JourneyModule[]>([])
  const [error, setError] = useState<string | null>(null)
  const [bookings, setBookings] = useState<(BookedModule | null)[]>([])

  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [bookingStatus, setBookingStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [bookingMessage, setBookingMessage] = useState<string | null>(null)
  const [waitStatus, setWaitStatus] = useState<WaitStatus>(null)

  const [revealIndex, setRevealIndex] = useState<number | null>(null)
  const [revealActive, setRevealActive] = useState(false)

  function selectSubject(s: JourneySubject) {
    setSubject(s)
    setSubjectPhase('ready')
  }

  function setBooking(index: number, booking: BookedModule) {
    if (!subject) return
    setBookings((prev) => {
      const next = [...prev]
      next[index] = booking
      saveBookings(subject.userId, next)
      return next
    })
  }

  function clearFrom(index: number) {
    if (!subject) return
    setBookings((prev) => {
      const next = [...prev]
      for (let i = index; i < next.length; i++) next[i] = null
      saveBookings(subject.userId, next)
      return next
    })
  }

  async function load() {
    if (!subject) return
    setPhase('loading')
    setError(null)
    try {
      const mods = await getJourneyModules()
      if (mods.length === 0) {
        setPhase('empty')
        return
      }
      setModules(mods)

      const persisted = loadBookings(subject.userId)
      setBookings(persisted)
      for (let i = 0; i < persisted.length; i++) {
        const b = persisted[i]
        if (!b) continue
        const stillExists = await checkBooking(subject.userId, b.eventId)
        if (!stillExists) {
          clearFrom(i)
          break
        }
      }
      setPhase('timeline')
    } catch (err) {
      setError(String(err))
      setPhase('error')
    }
  }

  useEffect(() => {
    if (subjectPhase === 'ready' && subject) {
      load()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectPhase, subject?.userId])

  useEffect(() => {
    if (phase === 'timeline' && revealIndex !== null) {
      setRevealActive(false)
      const raf = requestAnimationFrame(() => setRevealActive(true))
      const timeout = setTimeout(() => setRevealIndex(null), 900)
      return () => {
        cancelAnimationFrame(raf)
        clearTimeout(timeout)
      }
    }
  }, [phase, revealIndex])

  function isUnlocked(index: number): boolean {
    if (index === 0) return true
    return !!bookings[index - 1]
  }

  function openModule(index: number) {
    if (!isUnlocked(index) || bookings[index]) return
    setActiveIndex(index)
    setSelectedEventId(null)
    setBookingStatus('idle')
    setBookingMessage(null)
    setWaitStatus(null)
    setPhase('date-picker')
  }

  function closeDatePicker() {
    setActiveIndex(null)
    setPhase('timeline')
  }

  const activeModule = activeIndex !== null ? modules[activeIndex] : null

  const availableEvents = useMemo(() => {
    if (!activeModule || activeIndex === null) return []
    const prevBooking = activeIndex > 0 ? bookings[activeIndex - 1] : null
    if (!prevBooking) return activeModule.events
    return activeModule.events.filter((e) => e.startDate > prevBooking.finishDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModule, activeIndex, bookings])

  async function handleBook() {
    if (!selectedEventId || !subject || activeIndex === null) return
    setBookingStatus('loading')
    setBookingMessage(null)

    const result = await bookEvent(selectedEventId, subject.userId)

    if (result.outcome === 'error') {
      setBookingStatus('error')
      setBookingMessage(result.message ?? 'Booking failed')
      return
    }

    const event = availableEvents.find((e) => e.id === selectedEventId)
    if (event) {
      setBooking(activeIndex, {
        eventId: event.id,
        startDate: event.startDate,
        finishDate: event.finishDate,
        roomNames: event.roomNames,
      })
    }
    setWaitStatus(result.outcome)
    setBookingStatus('idle')
    setRevealIndex(activeIndex + 1)

    setTimeout(() => {
      setActiveIndex(null)
      setPhase('timeline')
    }, 1400)
  }

  const allBooked = modules.length > 0 && modules.every((_, i) => !!bookings[i])
  const bookedCount = bookings.filter(Boolean).length

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
                selectSubject({ userId: currentUser.id, userName: currentUser.fullname, isManagerMode: false })
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
                onClick={() => selectSubject({ userId: report.userId, userName: report.userName, isManagerMode: true })}
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

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading your learning journey…</p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-sm text-gray-600 mb-2">Something went wrong loading your journey</p>
          <p className="text-xs text-gray-400 mb-4 break-words">{error}</p>
          <button onClick={load} className="bg-brand-700 text-white text-sm font-semibold rounded px-6 py-3">
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'empty') {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6 text-center">
        <p className="text-sm text-gray-500">No upcoming modules available — check back soon.</p>
      </div>
    )
  }

  if (phase === 'date-picker' && activeModule && activeIndex !== null) {
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
          {waitStatus ? (
            <div className="text-center py-12">
              <p className="text-2xl mb-2">{waitStatus === 'created' ? '✓' : '⏳'}</p>
              <p className="font-bold text-gray-900 mb-1">
                {waitStatus === 'created' && 'Booked!'}
                {waitStatus === 'waitlisted' && "You're on the waitlist"}
                {waitStatus === 'requested' && 'Booking pending approval'}
              </p>
              <p className="text-sm text-gray-500">
                {waitStatus === 'created' && 'Moving to your next module…'}
                {waitStatus === 'waitlisted' && "We'll confirm your place as soon as a seat opens up."}
                {waitStatus === 'requested' && 'Your manager or coordinator will confirm shortly.'}
              </p>
            </div>
          ) : availableEvents.length === 0 ? (
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

          {bookingStatus === 'error' && bookingMessage && (
            <div className="border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-800">{bookingMessage}</div>
          )}
        </div>

        {!waitStatus && availableEvents.length > 0 && (
          <div className="bg-white border-t-2 border-brand-700 px-4 py-4 sticky bottom-0">
            <button
              onClick={handleBook}
              disabled={!selectedEventId || bookingStatus === 'loading'}
              className="w-full bg-brand-700 hover:bg-brand-800 disabled:bg-gray-300 text-white font-semibold rounded py-4 transition-colors"
            >
              {bookingStatus === 'loading' ? 'Booking…' : 'Book this date'}
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Timeline / summary phase ────────────────────────────────────────────────

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

      {!allBooked && (
        <div className="bg-white border-b border-gray-200 px-4 py-4">
          <div className="max-w-lg mx-auto">
            <p className="text-sm font-semibold text-gray-900">
              {subject?.isManagerMode ? `${subject.userName}'s learning journey` : 'Your learning journey'}
            </p>
            <p className="text-xs text-gray-500">
              {modules.length} module{modules.length !== 1 ? 's' : ''} · {bookedCount} of {modules.length} booked
            </p>
          </div>
        </div>
      )}

      {allBooked ? (
        <div className="px-4 py-6 max-w-lg mx-auto space-y-4 print-section">
          <div className="text-center mb-2 no-print">
            <p className="text-2xl mb-1">✓</p>
            <p className="text-lg font-bold text-gray-900">Journey booked</p>
            <p className="text-sm text-gray-500">
              {subject?.isManagerMode ? `${subject.userName}'s learning plan` : 'Your learning plan'}
            </p>
          </div>

          {modules.map((module, i) => {
            const booking = bookings[i]!
            const nextBooking = bookings[i + 1]
            return (
              <div key={module.seminarId}>
                <div className="bg-white border border-gray-200 rounded p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Module {i + 1}</p>
                  <p className="font-bold text-gray-900 mb-2">{module.name}</p>
                  <p className="text-sm text-brand-700 font-semibold">
                    {formatDate(booking.startDate)} · {formatTime(booking.startDate)}–{formatTime(booking.finishDate)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">{booking.roomNames.join(', ') || 'Virtual'}</p>
                  <button
                    onClick={() => downloadIcs(module.name, { id: booking.eventId, ...booking })}
                    className="no-print mt-3 text-xs font-semibold text-brand-700 hover:text-brand-800 underline"
                  >
                    Add to calendar
                  </button>
                </div>
                {i < modules.length - 1 && nextBooking && (
                  <p className="text-center text-xs text-gray-400 py-2">
                    ↓ {formatGap(booking.finishDate, nextBooking.startDate)}
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
      ) : (
        <div className="px-4 py-6 max-w-lg mx-auto">
          {modules.map((module, i) => {
            const booking = bookings[i] ?? null
            const unlocked = isUnlocked(i)
            const state: CircleState = booking ? 'booked' : unlocked ? 'current' : 'locked'
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
                          booking ? 'bg-green-600' : 'border-l-2 border-dashed border-gray-300'
                        }`}
                        style={{ minHeight: '2.5rem' }}
                      />
                    )}
                  </div>
                  <div className="flex-1 pb-6">
                    <ModuleCard
                      module={module}
                      index={i}
                      booking={booking}
                      unlocked={unlocked}
                      onOpen={() => openModule(i)}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
