import { getAccessToken, getCatalogue } from './totara'

// ── Request plumbing ──────────────────────────────────────────────────────────
// Same dev/prod split as diagnostic.ts/skillmap.ts: dev talks to the Vite proxy
// directly (reusing getAccessToken from totara.ts — the exact existing token
// logic, not a duplicate); prod talks to the existing /api/totara serverless
// function, which is content-agnostic and already proxies any query/variables.

async function journeyGqlRequest<T>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const res = import.meta.env.DEV
    ? await (async () => {
        const token = await getAccessToken()
        return fetch('/totara-api/api/graphql.php', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ query, variables }),
        })
      })()
    : await fetch('/api/totara', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      })

  if (!res.ok) {
    throw new Error(`Totara API error: ${res.status} ${res.statusText}`)
  }

  const json = await res.json()
  if (json.errors?.length) {
    const msg = json.errors.map((e: { message: string }) => e.message).join(', ')
    throw new Error(`Totara GraphQL error: ${msg}`)
  }

  return json.data as T
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JourneyEvent {
  id: string
  startDate: number // ms epoch
  finishDate: number // ms epoch
  seatsAvailable: number
  seatsTotal: number
  roomNames: string[]
}

export interface JourneyModule {
  seminarId: string
  name: string
  description: string
  events: JourneyEvent[]
}

export interface BookingResult {
  outcome: 'created' | 'waitlisted' | 'requested' | 'error'
  message?: string
  stateTitle?: string
}

// ── getJourneyProgrammes ──────────────────────────────────────────────────────
// Course-selection screen for the journey feature only: courses in category 8
// with at least one seminar. Reuses getCatalogue() (already fetches
// category{id}) rather than a new catalogue query.

export interface JourneyProgramme {
  courseId: string
  name: string
  description: string
  seminarIds: string[]
}

const PROGRAMME_CATEGORY_ID = '8'

const SEMINARS_IN_COURSE_QUERY = `
  query mod_facetoface_seminars_in_course($course: core_course_course_reference!, $query: mod_facetoface_seminars_in_course_query) {
    mod_facetoface_seminars_in_course(course: $course, query: $query) {
      items { id name }
      total
    }
  }
`

// The spec's status/tense filters don't exist on this query (confirmed
// against the live schema — those are event-level concepts, not seminar-
// in-course ones). getJourneyModules() below already filters to
// FUTURE/ACTIVE at the events level, so a seminar with no qualifying
// events simply won't produce a module downstream anyway — this check
// only needs to answer "does this course have any seminars at all."
async function getCourseSeminarIds(courseId: string): Promise<string[]> {
  const data = await journeyGqlRequest<{
    mod_facetoface_seminars_in_course: { items: Array<{ id: string; name: string }>; total: number }
  }>(SEMINARS_IN_COURSE_QUERY, {
    course: { id: parseInt(courseId, 10) },
    query: {},
  })
  return data.mod_facetoface_seminars_in_course.items.map((s) => s.id)
}

export async function getJourneyProgrammes(): Promise<JourneyProgramme[]> {
  const catalogue = await getCatalogue()
  const categoryCourses = catalogue.filter((c) => c.category?.id === PROGRAMME_CATEGORY_ID)

  // Fired in parallel per the spec, not sequentially.
  const results = await Promise.all(
    categoryCourses.map(async (course) => {
      const seminarIds = await getCourseSeminarIds(course.id)
      return { courseId: course.id, name: course.title, description: course.summary, seminarIds }
    })
  )

  return results.filter((p) => p.seminarIds.length > 0)
}

// ── getJourneyModules ─────────────────────────────────────────────────────────

interface RawEvent {
  id: string
  start_date: string
  finish_date: string
  seats_available: number
  seats_total: number
  seminar: { id: string; name: string; description: string; course_id: string }
  sessions: Array<{
    id: string
    timestart: string
    timefinish: string
    rooms: Array<{ name: string; capacity: number }>
  }>
}

const EVENTS_QUERY = `
  query mod_facetoface_events($query: mod_facetoface_events_query) {
    mod_facetoface_events(query: $query) {
      items {
        id
        start_date
        finish_date
        seats_available
        seats_total
        seminar { id name description course_id }
        sessions { id timestart timefinish rooms { name capacity } }
      }
      total
      next_cursor
    }
  }
`

export async function getJourneyModules(): Promise<JourneyModule[]> {
  const allEvents: RawEvent[] = []
  let cursor = ''

  do {
    const data = await journeyGqlRequest<{
      mod_facetoface_events: { items: RawEvent[]; total: number; next_cursor: string }
    }>(EVENTS_QUERY, {
      query: { filters: { tense: 'FUTURE', status: 'ACTIVE' }, pagination: { cursor, limit: 100 } },
    })
    const result = data.mod_facetoface_events
    allEvents.push(...result.items)
    cursor = result.next_cursor
  } while (cursor)

  const bySeminarId = new Map<string, JourneyModule>()
  for (const item of allEvents) {
    const seminarId = item.seminar.id
    if (!bySeminarId.has(seminarId)) {
      bySeminarId.set(seminarId, {
        seminarId,
        name: item.seminar.name,
        description: item.seminar.description ?? '',
        events: [],
      })
    }
    const roomNames = (item.sessions ?? [])
      .flatMap((s) => (s.rooms ?? []).map((r) => r.name))
      .filter(Boolean)

    bySeminarId.get(seminarId)!.events.push({
      id: item.id,
      startDate: parseInt(item.start_date, 10) * 1000,
      finishDate: parseInt(item.finish_date, 10) * 1000,
      seatsAvailable: item.seats_available,
      seatsTotal: item.seats_total,
      roomNames,
    })
  }

  const modules = Array.from(bySeminarId.values())
  modules.forEach((m) => m.events.sort((a, b) => a.startDate - b.startDate))
  // Seminars in this catalogue all share one course_id, so that can't order
  // them (confirmed against the live API) — seminar.id matches the intended
  // "Seminar 1, 2, 3..." sequence instead.
  modules.sort((a, b) => parseInt(a.seminarId, 10) - parseInt(b.seminarId, 10))
  return modules
}

// ── bookEvent ─────────────────────────────────────────────────────────────────

const BOOK_MUTATION = `
  mutation mod_facetoface_event_create_user_booking($input: mod_facetoface_event_create_user_booking_input!) {
    mod_facetoface_event_create_user_booking(input: $input) {
      created
      booking_errors { message code }
      booking { state { key title } }
    }
  }
`

export async function bookEvent(eventId: string, userId: string): Promise<BookingResult> {
  try {
    const data = await journeyGqlRequest<{
      mod_facetoface_event_create_user_booking: {
        created: boolean
        booking_errors: Array<{ message: string; code: string }>
        booking: { state: { key: string; title: string } } | null
      }
    }>(BOOK_MUTATION, {
      input: {
        event: { id: parseInt(eventId, 10) },
        user: { id: parseInt(userId, 10) },
      },
    })

    const result = data.mod_facetoface_event_create_user_booking

    if (result.booking_errors?.length) {
      return { outcome: 'error', message: result.booking_errors.map((e) => e.message).join(', ') }
    }

    const stateKey = result.booking?.state?.key?.toUpperCase()
    if (stateKey === 'WAITLISTED') {
      return { outcome: 'waitlisted', stateTitle: result.booking?.state?.title }
    }
    if (stateKey === 'REQUESTED') {
      return { outcome: 'requested', stateTitle: result.booking?.state?.title }
    }
    if (result.created) {
      return { outcome: 'created', stateTitle: result.booking?.state?.title }
    }
    return { outcome: 'error', message: 'Booking was not confirmed' }
  } catch (err) {
    return { outcome: 'error', message: String(err) }
  }
}

// ── checkBooking ──────────────────────────────────────────────────────────────
// Verification query for reconciling localStorage against Totara on load.
// Argument names/types here are corrected from the original spec
// (user/event, not target_user/target_event) — confirmed against the live
// API since introspection is disabled. IDs are always our own numeric
// values, never raw user text, so inline embedding here is safe.

export async function checkBooking(userId: string, eventId: string): Promise<boolean> {
  const query = `
    query {
      mod_facetoface_event_user_booking(user: { id: ${parseInt(userId, 10)} }, event: { id: ${parseInt(eventId, 10)} }) {
        found
      }
    }
  `
  try {
    const data = await journeyGqlRequest<{ mod_facetoface_event_user_booking: { found: boolean } }>(query)
    return data.mod_facetoface_event_user_booking.found
  } catch {
    return false
  }
}

// ── ICS download ──────────────────────────────────────────────────────────────

function formatIcsDate(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
}

export function downloadIcs(
  moduleName: string,
  event: { id: string; startDate: number; finishDate: number; roomNames: string[] }
): void {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Compass//Learning Journey//EN',
    'BEGIN:VEVENT',
    `UID:${event.id}@compass-journey`,
    `DTSTAMP:${formatIcsDate(Date.now())}`,
    `DTSTART:${formatIcsDate(event.startDate)}`,
    `DTEND:${formatIcsDate(event.finishDate)}`,
    `SUMMARY:${moduleName}`,
    event.roomNames.length ? `LOCATION:${event.roomNames.join(', ')}` : 'LOCATION:Virtual',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  const blob = new Blob([ics], { type: 'text/calendar' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${moduleName.replace(/[^a-z0-9]/gi, '-')}.ics`
  a.click()
  URL.revokeObjectURL(url)
}
