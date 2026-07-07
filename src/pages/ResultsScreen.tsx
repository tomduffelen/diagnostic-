import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { enrolUser, createGoal, getCatalogue } from '../lib/totara'
import type { Course } from '../lib/totara'
import type { GapProfile } from '../lib/diagnostic'

// ── Helpers ───────────────────────────────────────────────────────────────────

function findCourse(title: string | undefined, catalogue: Course[]): Course | null {
  if (!title) return null
  const t = title.toLowerCase()
  return catalogue.find((c) => c.title.toLowerCase().includes(t) || t.includes(c.title.toLowerCase())) ?? null
}

// ── Severity config ───────────────────────────────────────────────────────────

const SEV_CONFIG = {
  compliance: {
    label: 'HIGH RISK',
    border: 'border-l-red-500',
    badge: 'bg-red-50 text-red-700 border-red-200',
    dot: 'bg-red-500',
  },
  development: {
    label: 'DEVELOPMENT',
    border: 'border-l-blue-500',
    badge: 'bg-blue-50 text-blue-700 border-blue-200',
    dot: 'bg-blue-500',
  },
  aspiration: {
    label: 'STRETCH',
    border: 'border-l-purple-400',
    badge: 'bg-purple-50 text-purple-700 border-purple-200',
    dot: 'bg-purple-400',
  },
}

// ── Sub-components ────────────────────────────────────────────────────────────

type EnrolStatus = 'loading' | 'enrolled' | 'already_enrolled' | 'error'

function WhyButton({ reason }: { reason?: string }) {
  const [open, setOpen] = useState(false)
  if (!reason) return null
  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="font-mono text-xs text-gray-400 hover:text-teal-600 transition-colors no-print"
      >
        {open ? '▲ hide' : '? why this'}
      </button>
      {open && (
        <p className="font-mono text-xs text-gray-500 mt-1.5 leading-relaxed border-l-2 border-teal-200 pl-2">
          {reason}
        </p>
      )}
    </div>
  )
}

function AutoEnrolCard({
  course,
  status,
  error,
  reason,
  totaraUrl,
}: {
  course: Course
  status: EnrolStatus
  error?: string
  reason?: string
  totaraUrl: string
}) {
  return (
    <div className="bg-white border border-zinc-200 print-section">
      {course.imageUrl && (
        <img src={course.imageUrl} alt={course.title} className="w-full h-24 object-cover no-print" />
      )}
      <div className="p-4">
        <p className="font-semibold text-gray-900 text-sm leading-tight mb-3">{course.title}</p>

        {status === 'loading' && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-teal-500 rounded-full animate-pulse" />
            <span className="font-mono text-xs text-gray-400">enrolling...</span>
          </div>
        )}

        {status === 'enrolled' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-green-600 font-semibold">✓ ENROLLED</span>
            </div>
            <a
              href={`${totaraUrl}/course/view.php?id=${course.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="no-print block font-mono text-xs border border-zinc-300 hover:border-teal-500 text-gray-600 hover:text-teal-700 py-2 text-center transition-colors"
            >
              Open in Totara →
            </a>
          </div>
        )}

        {status === 'already_enrolled' && (
          <div className="space-y-2">
            <div className="bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="font-mono text-xs text-amber-700 font-semibold">Already enrolled</p>
              <p className="font-mono text-xs text-amber-600 mt-0.5">Prioritise this course</p>
            </div>
            <a
              href={`${totaraUrl}/course/view.php?id=${course.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="no-print block font-mono text-xs border border-zinc-300 hover:border-teal-500 text-gray-600 hover:text-teal-700 py-2 text-center transition-colors"
            >
              Open in Totara →
            </a>
          </div>
        )}

        {status === 'error' && (
          <p className="font-mono text-xs text-red-600">
            Enrolment failed — enable manual enrolment on this course in Totara admin.
            {error && <span className="block text-gray-400 mt-0.5">{error}</span>}
          </p>
        )}
        <WhyButton reason={reason} />
      </div>
    </div>
  )
}

function DevCourseCard({
  course,
  userId,
  totaraUrl,
  reason,
  onEnrolled,
}: {
  course: Course
  userId: string
  totaraUrl: string
  reason?: string
  onEnrolled: (id: string) => void
}) {
  const enrolledIds = useStore((s) => s.enrolledCourseIds)
  // Pre-existing enrollment from Totara API (amber state)
  const preEnrolled = !!course.completion?.statuskey
  // Enrolled via this app this session (green state)
  const justEnrolled = !preEnrolled && enrolledIds.includes(course.id)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  async function handleEnrol() {
    setStatus('loading')
    setError(null)
    try {
      await enrolUser(course.id, userId)
      onEnrolled(course.id)
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setError(String(err))
    }
  }

  return (
    <div className="bg-white border border-zinc-200 print-section">
      {course.imageUrl && (
        <img src={course.imageUrl} alt={course.title} className="w-full h-24 object-cover no-print" />
      )}
      <div className="p-4">
        <p className="font-semibold text-gray-900 text-sm leading-tight mb-1">{course.title}</p>
        {course.estimated_duration > 0 && (
          <p className="font-mono text-xs text-gray-400 mb-3">{course.estimated_duration}min</p>
        )}

        {preEnrolled ? (
          <div className="space-y-2">
            <div className="bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="font-mono text-xs text-amber-700 font-semibold">You're already enrolled — prioritise this</p>
            </div>
            <a
              href={`${totaraUrl}/course/view.php?id=${course.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="no-print block font-mono text-xs border border-zinc-300 hover:border-teal-500 text-gray-600 hover:text-teal-700 py-2 text-center transition-colors"
            >
              OPEN →
            </a>
          </div>
        ) : justEnrolled ? (
          <div className="flex gap-2">
            <span className="flex-1 font-mono text-xs border border-teal-500 text-teal-700 py-2 text-center tracking-widest">
              ✓ ENROLLED
            </span>
            <a
              href={`${totaraUrl}/course/view.php?id=${course.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="no-print flex-1 font-mono text-xs border border-zinc-300 hover:border-teal-500 text-gray-600 hover:text-teal-700 py-2 text-center transition-colors"
            >
              OPEN →
            </a>
          </div>
        ) : (
          <>
            <button
              onClick={handleEnrol}
              disabled={status === 'loading'}
              className="no-print w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-400 text-white font-mono text-xs py-2.5 transition-colors tracking-widest uppercase"
            >
              {status === 'loading' ? 'enrolling...' : '→ Enrol'}
            </button>
            {status === 'error' && error && (
              <p className="font-mono text-xs text-red-600 mt-2">{error}</p>
            )}
          </>
        )}
        <WhyButton reason={reason} />
      </div>
    </div>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function ResultsScreen() {
  const navigate = useNavigate()
  const gapProfile = useStore((s) => s.gapProfile) as GapProfile | null
  const catalogue = useStore((s) => s.catalogue)
  const setCatalogue = useStore((s) => s.setCatalogue)
  const diagnosticSubject = useStore((s) => s.diagnosticSubject)
  const addEnrolledCourse = useStore((s) => s.addEnrolledCourse)

  const currentUser = useStore((s) => s.currentUser)
  const userId = diagnosticSubject?.userId ?? currentUser?.id ?? ''
  const totaraUrl = import.meta.env.VITE_TOTARA_URL || ''

  const [catalogueLoading, setCatalogueLoading] = useState(false)
  const [catalogueError, setCatalogueError] = useState<string | null>(null)

  // Auto-enrol states keyed by courseId
  const [autoEnrolStates, setAutoEnrolStates] = useState<
    Record<string, { status: EnrolStatus; error?: string }>
  >({})

  function setEnrolState(courseId: string, update: { status: EnrolStatus; error?: string }) {
    setAutoEnrolStates((prev) => ({ ...prev, [courseId]: update }))
  }

  // Load catalogue if not already in store (e.g. after a page refresh)
  useEffect(() => {
    if (catalogue.length) return
    setCatalogueLoading(true)
    getCatalogue()
      .then((cat) => setCatalogue(cat))
      .catch(() => setCatalogueError('Course recommendations unavailable — please speak to your manager'))
      .finally(() => setCatalogueLoading(false))
  }, [])

  useEffect(() => {
    if (!gapProfile) return

    // Auto-enrol HIGH RISK gap courses (top 3)
    const complianceGaps = gapProfile.gaps
      .filter((g) => g.severity === 'compliance' && g.course)
      .slice(0, 3)

    complianceGaps.forEach((gap) => {
      const course = findCourse(gap.course, catalogue)
      if (!course) return

      setEnrolState(course.id, { status: 'loading' })

      enrolUser(course.id, userId)
        .then(({ wasAlreadyEnrolled }) => {
          setEnrolState(course.id, {
            status: wasAlreadyEnrolled ? 'already_enrolled' : 'enrolled',
          })
          addEnrolledCourse(course.id)
        })
        .catch((err) => {
          setEnrolState(course.id, { status: 'error', error: String(err) })
        })
    })

    // Create goals in background — fire-and-forget, never surface errors
    gapProfile.gaps.forEach((gap) => {
      const title = gap.severity === 'compliance' && gap.course
        ? `Complete: ${gap.course}`
        : `Develop: ${gap.domain}`
      createGoal(title, userId).catch((err) =>
        console.log('[Goals] Failed to create goal:', title, err)
      )
    })
  }, [])

  if (!gapProfile) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-6 text-center">
        <div>
          <p className="font-mono text-sm text-gray-400 mb-4">no diagnostic on record</p>
          <button
            onClick={() => navigate('/diagnostic')}
            className="bg-teal-600 text-white font-mono text-xs px-6 py-3 tracking-widest uppercase"
          >
            → Run diagnostic
          </button>
        </div>
      </div>
    )
  }

  const complianceGaps = gapProfile.gaps.filter((g) => g.severity === 'compliance')
  const devGaps = gapProfile.gaps.filter((g) => g.severity !== 'compliance')

  const complianceCourses = complianceGaps
    .filter((g) => g.course)
    .map((g) => ({ gap: g, course: findCourse(g.course, catalogue) }))
    .filter((x): x is { gap: typeof x.gap; course: Course } => x.course !== null)
    .slice(0, 3)

  const devCourses = devGaps
    .filter((g) => g.course)
    .map((g) => ({ gap: g, course: findCourse(g.course, catalogue) }))
    .filter((x): x is { gap: typeof x.gap; course: Course } => x.course !== null)
    .slice(0, 3)

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-zinc-200 px-4 py-3 flex items-center justify-between sticky top-0 z-10 no-print">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="font-mono text-sm text-gray-400 hover:text-gray-700 transition-colors"
          >
            ←
          </button>
          <div>
            <p className="font-mono text-sm font-semibold text-gray-900 tracking-tight">
              DIAGNOSTIC RESULTS
            </p>
            {diagnosticSubject?.isManagerMode && (
              <p className="font-mono text-xs text-teal-600 tracking-wide">
                for {diagnosticSubject.userName}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => window.print()}
          className="font-mono text-xs border border-zinc-300 hover:border-teal-500 text-gray-600 hover:text-teal-700 px-3 py-2 transition-colors tracking-wide"
        >
          Print / PDF
        </button>
      </header>

      {/* Print header (only shows when printing) */}
      <div className="hidden print:block px-6 pt-6 pb-2 border-b border-zinc-200 mb-4">
        <p className="font-mono text-lg font-bold text-gray-900">JEEVES — DIAGNOSTIC RESULTS</p>
        {diagnosticSubject?.userName && (
          <p className="font-mono text-sm text-gray-500 mt-1">
            {diagnosticSubject.isManagerMode ? `Assessment for: ${diagnosticSubject.userName}` : `Learner: ${diagnosticSubject.userName}`}
          </p>
        )}
        <p className="font-mono text-xs text-gray-400 mt-0.5">{new Date().toLocaleDateString()}</p>
      </div>

      <div className="px-4 py-6 max-w-lg mx-auto space-y-10">

        {/* ── SECTION 1: STRENGTHS & GAPS ──────────────────────────────── */}
        <section className="print-section">
          <p className="font-mono text-xs text-gray-400 tracking-widest uppercase mb-4">
            // 1. Strengths &amp; Gaps
          </p>

          {/* Strengths */}
          {gapProfile.strengths.length > 0 && (
            <div className="mb-6">
              <p className="font-mono text-xs font-semibold text-green-700 uppercase tracking-widest mb-2">
                Strengths
              </p>
              <div className="space-y-2">
                {gapProfile.strengths.map((s, i) => (
                  <div key={i} className="flex items-start gap-3 bg-white border border-zinc-100 px-4 py-3">
                    <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>
                    <div>
                      <p className="font-semibold text-sm text-gray-900">{s.domain}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{s.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* High risk gaps */}
          {complianceGaps.length > 0 && (
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 bg-red-500 rounded-full" />
                <p className="font-mono text-xs font-semibold text-red-700 uppercase tracking-widest">
                  High Risk — Action Required
                </p>
              </div>
              <div className="space-y-2">
                {complianceGaps.map((gap, i) => (
                  <div
                    key={i}
                    className="bg-red-50 border border-red-100 border-l-4 border-l-red-500 px-4 py-3"
                  >
                    <p className="font-semibold text-sm text-gray-900">{gap.domain}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{gap.summary}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Development gaps */}
          {devGaps.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="w-2 h-2 bg-blue-500 rounded-full" />
                <p className="font-mono text-xs font-semibold text-blue-700 uppercase tracking-widest">
                  Development Areas
                </p>
              </div>
              <div className="space-y-2">
                {devGaps.map((gap, i) => {
                  const cfg = SEV_CONFIG[gap.severity] ?? SEV_CONFIG.development
                  return (
                    <div
                      key={i}
                      className={`bg-white border border-zinc-100 border-l-4 ${cfg.border} px-4 py-3`}
                    >
                      <p className="font-semibold text-sm text-gray-900">{gap.domain}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{gap.summary}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        <hr className="border-zinc-200" />

        {/* ── SECTION 2: LEARNING PLAN ─────────────────────────────────── */}
        <section className="print-section">
          <p className="font-mono text-xs text-gray-400 tracking-widest uppercase mb-1">
            // 2. Your Learning Plan
          </p>
          <p className="text-xs text-gray-500 mb-4">
            These courses have been automatically enrolled based on your high-risk gaps.
          </p>

          {catalogueError ? (
            <div className="bg-amber-50 border border-amber-200 px-4 py-3">
              <p className="font-mono text-sm text-amber-700">{catalogueError}</p>
            </div>
          ) : catalogueLoading ? (
            <p className="font-mono text-xs text-gray-400 cursor-blink py-2">loading courses...</p>
          ) : complianceCourses.length > 0 ? (
            <div className="space-y-3">
              {complianceCourses.map(({ course, gap }) => (
                <AutoEnrolCard
                  key={course.id}
                  course={course}
                  status={autoEnrolStates[course.id]?.status ?? 'loading'}
                  error={autoEnrolStates[course.id]?.error}
                  reason={gap.reason}
                  totaraUrl={totaraUrl}
                />
              ))}
            </div>
          ) : (
            <p className="font-mono text-xs text-gray-400 py-2">
              No high-risk gaps identified — no automatic enrolments.
            </p>
          )}
        </section>

        <hr className="border-zinc-200" />

        {/* ── SECTION 3: RECOMMENDED ───────────────────────────────────── */}
        <section className="print-section">
          <p className="font-mono text-xs text-gray-400 tracking-widest uppercase mb-1">
            // 3. Recommended for You
          </p>
          <p className="text-xs text-gray-500 mb-4">
            Development courses matched to your growth areas. Enrol when ready.
          </p>

          {catalogueError ? (
            <div className="bg-amber-50 border border-amber-200 px-4 py-3">
              <p className="font-mono text-sm text-amber-700">{catalogueError}</p>
            </div>
          ) : catalogueLoading ? (
            <p className="font-mono text-xs text-gray-400 cursor-blink py-2">loading courses...</p>
          ) : devCourses.length > 0 ? (
            <div className="space-y-3">
              {devCourses.map(({ course, gap }) => (
                <DevCourseCard
                  key={course.id}
                  course={course}
                  userId={userId}
                  totaraUrl={totaraUrl}
                  reason={gap.reason}
                  onEnrolled={addEnrolledCourse}
                />
              ))}
            </div>
          ) : (
            <p className="font-mono text-xs text-gray-400 py-2">
              No development course recommendations.
            </p>
          )}
        </section>

        {/* Footer CTA */}
        <div className="pb-8 no-print">
          <button
            onClick={() => {
              useStore.getState().clearMessages()
              useStore.setState({ gapProfile: null, diagnosticSubject: null })
              navigate('/diagnostic')
            }}
            className="w-full border border-zinc-300 hover:border-teal-500 text-gray-600 hover:text-teal-700 font-mono text-xs py-4 transition-colors tracking-widest uppercase"
          >
            ↺ Start a new check-in
          </button>
        </div>
      </div>
    </div>
  )
}
