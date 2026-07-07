import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { getCatalogue, enrolUser } from '../lib/totara'
import type { Course } from '../lib/totara'
import { extractSkills, buildSkillMap } from '../lib/skillmap'
import type { SkillPill } from '../lib/skillmap'

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

// ── Leadership profile radar chart ────────────────────────────────────────────
// Single series (% unlocked per category) — one hue, no legend needed, direct
// value labels carry the data since there are only a handful of categories.

interface CategoryProgress {
  category: string
  percent: number
  completed: number
  total: number
}

const RADAR_BRAND_HEX = '#2a6047' // brand-700, matches the app's action color

// Category names are AI-generated and unbounded in length. Side-anchored
// labels only get half the margin of top/bottom ones, so truncate to the
// safe budget for the worst case rather than risk clipping off-canvas.
function truncateLabel(text: string, max = 18): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

function RadarChart({ data }: { data: CategoryProgress[] }) {
  const size = 360
  const center = size / 2
  const maxRadius = 70
  const n = data.length

  const angleFor = (i: number) => -Math.PI / 2 + (2 * Math.PI * i) / n
  const pointFor = (i: number, value: number) => {
    const angle = angleFor(i)
    const r = maxRadius * (value / 100)
    return { x: center + Math.cos(angle) * r, y: center + Math.sin(angle) * r }
  }

  const ringLevels = [25, 50, 75, 100]
  const ringPolygon = (level: number) =>
    data.map((_, i) => pointFor(i, level)).map((p) => `${p.x},${p.y}`).join(' ')

  const dataPolygon = data.map((d, i) => pointFor(i, d.percent)).map((p) => `${p.x},${p.y}`).join(' ')

  return (
    <div>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-xs mx-auto" role="img" aria-hidden="true">
        {/* Gridline rings (hairline, recessive) */}
        {ringLevels.map((level) => (
          <polygon
            key={level}
            points={ringPolygon(level)}
            fill="none"
            stroke="#d1d5db"
            strokeWidth={1}
          />
        ))}

        {/* Spokes */}
        {data.map((_, i) => {
          const p = pointFor(i, 100)
          return (
            <line key={i} x1={center} y1={center} x2={p.x} y2={p.y} stroke="#d1d5db" strokeWidth={1} />
          )
        })}

        {/* Data area */}
        <polygon points={dataPolygon} fill={RADAR_BRAND_HEX} fillOpacity={0.12} stroke={RADAR_BRAND_HEX} strokeWidth={2} strokeLinejoin="round" />

        {/* Vertex markers with surface ring */}
        {data.map((d, i) => {
          const p = pointFor(i, d.percent)
          return <circle key={i} cx={p.x} cy={p.y} r={5} fill={RADAR_BRAND_HEX} stroke="#ffffff" strokeWidth={2} />
        })}

        {/* Category labels, outside the outer ring — name only, exact
            percentages live in the stat row below (arbitrary AI-generated
            category names can be long; an SVG label has no safe wrap) */}
        {data.map((d, i) => {
          const angle = angleFor(i)
          const labelR = maxRadius + 14
          const x = center + Math.cos(angle) * labelR
          const y = center + Math.sin(angle) * labelR
          const anchor = Math.cos(angle) > 0.3 ? 'start' : Math.cos(angle) < -0.3 ? 'end' : 'middle'
          return (
            <text
              key={i}
              x={x}
              y={y}
              textAnchor={anchor}
              dominantBaseline="middle"
              fontSize={11}
              className="fill-gray-600"
            >
              {truncateLabel(d.category)}
            </text>
          )
        })}
      </svg>

      {/* Exact values as a robust HTML row (no SVG text-overflow risk) */}
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 mt-2">
        {data.map((d) => (
          <span key={d.category} className="text-xs text-gray-500">
            {d.category} <span className="font-semibold text-gray-700">{Math.round(d.percent)}%</span>
          </span>
        ))}
      </div>

      {/* Accessible table fallback for the same data */}
      <table className="sr-only">
        <caption>Leadership profile: percent of skills unlocked per category</caption>
        <thead>
          <tr><th>Category</th><th>Unlocked</th><th>Percent</th></tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.category}>
              <td>{d.category}</td>
              <td>{d.completed} of {d.total}</td>
              <td>{Math.round(d.percent)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function skillKey(skill: SkillPill): string {
  return `${skill.category}::${skill.name}`
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function SkeletonMap() {
  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-6">
      <p className="text-sm text-gray-500 text-center mb-2">Building your skill map…</p>
      {[0, 1, 2].map((section) => (
        <div key={section} className="space-y-3">
          <div className="h-4 w-40 bg-gray-200 rounded animate-pulse" />
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3, 4].map((pill) => (
              <div
                key={pill}
                className="h-7 rounded-full bg-gray-200 animate-pulse"
                style={{ width: `${60 + ((pill * 17) % 60)}px` }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Bulk enrol summary drawer ─────────────────────────────────────────────────

type BulkStatus = 'idle' | 'loading' | 'done'

function EnrolSummaryDrawer({
  skills,
  catalogue,
  onClose,
  onEnrolled,
}: {
  skills: SkillPill[]
  catalogue: Course[]
  onClose: () => void
  onEnrolled: (courseIds: string[]) => void
}) {
  const currentUser = useStore((s) => s.currentUser)
  const [status, setStatus] = useState<BulkStatus>('idle')
  const [results, setResults] = useState<Record<string, 'success' | 'error'>>({})
  const [dragY, setDragY] = useState(0)
  const [dragStartY, setDragStartY] = useState<number | null>(null)

  const plan = useMemo(() => {
    const byCourse: Record<string, { course: Course; skills: SkillPill[] }> = {}
    for (const skill of skills) {
      const courseId = skill.courseIds[0]
      const course = catalogue.find((c) => c.id === courseId)
      if (!course) continue
      if (!byCourse[courseId]) byCourse[courseId] = { course, skills: [] }
      byCourse[courseId].skills.push(skill)
    }
    return Object.values(byCourse)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skills, catalogue])

  async function handleEnrolAll() {
    if (!currentUser) return
    setStatus('loading')
    const newResults: Record<string, 'success' | 'error'> = {}
    for (const { course } of plan) {
      try {
        await enrolUser(course.id, currentUser.id)
        newResults[course.id] = 'success'
      } catch {
        newResults[course.id] = 'error'
      }
    }
    setResults(newResults)
    setStatus('done')
    const successIds = Object.entries(newResults)
      .filter(([, v]) => v === 'success')
      .map(([id]) => id)
    if (successIds.length > 0) onEnrolled(successIds)
  }

  function handleTouchStart(e: React.TouchEvent) {
    setDragStartY(e.touches[0].clientY)
  }

  function handleTouchMove(e: React.TouchEvent) {
    if (dragStartY === null) return
    const delta = e.touches[0].clientY - dragStartY
    if (delta > 0) setDragY(delta)
  }

  function handleTouchEnd() {
    if (dragY > 100) {
      onClose()
    } else {
      setDragY(0)
    }
    setDragStartY(null)
  }

  const successCount = Object.values(results).filter((r) => r === 'success').length
  const errorCount = Object.values(results).filter((r) => r === 'error').length

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative w-full max-w-lg bg-white rounded-t-2xl shadow-xl"
        style={{
          height: '70vh',
          transform: `translateY(${dragY}px)`,
          transition: dragStartY === null ? 'transform 0.2s ease-out' : 'none',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1.5 bg-gray-300 rounded-full" />
        </div>

        <div className="px-6 py-4 overflow-y-auto flex flex-col" style={{ maxHeight: 'calc(70vh - 24px)' }}>
          {status === 'done' ? (
            <div className="text-center py-6">
              <p className="text-lg font-bold text-brand-700 mb-2">
                {successCount} of {plan.length} courses enrolled ✓
              </p>
              {errorCount > 0 && (
                <p className="text-xs text-red-700 mb-4">
                  {errorCount} course{errorCount !== 1 ? 's' : ''} failed to enrol — try again from the map.
                </p>
              )}
              <button
                onClick={onClose}
                className="bg-brand-700 hover:bg-brand-800 text-white text-sm font-semibold rounded px-6 py-3"
              >
                Done
              </button>
            </div>
          ) : (
            <>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">What you'll learn</p>
              <h2 className="text-lg font-bold text-gray-900 mb-4">
                {plan.length} course{plan.length !== 1 ? 's' : ''}, {skills.length} skill{skills.length !== 1 ? 's' : ''}
              </h2>

              <div className="space-y-3 mb-4 overflow-y-auto">
                {plan.map(({ course, skills: courseSkills }) => (
                  <div key={course.id} className="border border-gray-200 rounded p-3">
                    <p className="font-semibold text-gray-900 text-sm mb-1">{course.title}</p>
                    {course.summary && (
                      <p className="text-xs text-gray-600 mb-2 leading-relaxed">
                        {stripHtml(course.summary).slice(0, 140)}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {courseSkills.map((s) => (
                        <span key={s.name} className="text-xs bg-brand-50 text-brand-800 rounded-full px-2 py-0.5">
                          {s.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <button
                onClick={handleEnrolAll}
                disabled={status === 'loading' || plan.length === 0}
                className="w-full bg-brand-700 hover:bg-brand-800 disabled:bg-brand-300 text-white text-sm font-semibold rounded py-3 transition-colors"
              >
                {status === 'loading'
                  ? 'Enrolling…'
                  : `Enrol me in ${plan.length} course${plan.length !== 1 ? 's' : ''}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function SkillMapScreen() {
  const navigate = useNavigate()
  const catalogue = useStore((s) => s.catalogue)
  const setCatalogue = useStore((s) => s.setCatalogue)
  const enrolledCourseIds = useStore((s) => s.enrolledCourseIds)
  const addEnrolledCourse = useStore((s) => s.addEnrolledCourse)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [skillMap, setSkillMap] = useState<ReturnType<typeof buildSkillMap> | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [selectedSkills, setSelectedSkills] = useState<Record<string, SkillPill>>({})
  const [showDrawer, setShowDrawer] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      let cat = catalogue
      if (!cat.length) {
        cat = await getCatalogue()
        setCatalogue(cat)
      }
      const groups = await extractSkills(cat)
      const map = buildSkillMap(groups)
      setSkillMap(map)
      setExpanded(Object.fromEntries(map.categoryOrder.map((c) => [c, true])))
    } catch (err) {
      console.error('[SkillMap] extraction failed:', err)
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function isSkillCompleted(skill: SkillPill): boolean {
    return skill.courseIds.some((courseId) => {
      if (enrolledCourseIds.includes(courseId)) return true
      const course = catalogue.find((c) => c.id === courseId)
      return !!course?.completion?.statuskey
    })
  }

  const { totalSkills, completedSkills } = useMemo(() => {
    if (!skillMap) return { totalSkills: 0, completedSkills: 0 }
    let completed = 0
    for (const cat of skillMap.categoryOrder) {
      for (const pill of skillMap.categories[cat]) {
        if (isSkillCompleted(pill)) completed++
      }
    }
    return { totalSkills: skillMap.totalSkills, completedSkills: completed }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillMap, enrolledCourseIds, catalogue])

  const categoryProgress: CategoryProgress[] = useMemo(() => {
    if (!skillMap) return []
    return skillMap.categoryOrder.map((category) => {
      const pills = skillMap.categories[category]
      const completed = pills.filter((p) => isSkillCompleted(p)).length
      return {
        category,
        completed,
        total: pills.length,
        percent: pills.length > 0 ? (completed / pills.length) * 100 : 0,
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skillMap, enrolledCourseIds, catalogue])

  function toggleCategory(category: string) {
    setExpanded((prev) => ({ ...prev, [category]: !prev[category] }))
  }

  function toggleSkill(skill: SkillPill) {
    setSelectedSkills((prev) => {
      const key = skillKey(skill)
      const next = { ...prev }
      if (next[key]) delete next[key]
      else next[key] = skill
      return next
    })
  }

  const selectedList = Object.values(selectedSkills)

  function handleEnrolled(courseIds: string[]) {
    courseIds.forEach((id) => addEnrolledCourse(id))
  }

  function closeDrawer() {
    setShowDrawer(false)
    setSelectedSkills({})
  }

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
          ←
        </button>
        <p className="text-sm font-bold text-gray-900">Skill map</p>
      </header>

      {!loading && !error && skillMap && (
        <div className="bg-white border-b border-gray-200 px-4 py-4">
          <div className="max-w-lg mx-auto">
            <p className="text-sm font-semibold text-gray-900 mb-2">
              {completedSkills} of {totalSkills} skills unlocked
            </p>
            <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-600 transition-all"
                style={{ width: totalSkills > 0 ? `${(completedSkills / totalSkills) * 100}%` : '0%' }}
              />
            </div>
          </div>
        </div>
      )}

      {!loading && !error && skillMap && categoryProgress.length >= 3 && (
        <div className="bg-white border-b border-gray-200 px-4 py-4">
          <div className="max-w-lg mx-auto">
            <p className="text-sm font-semibold text-gray-900 mb-3">Your leadership profile</p>
            <RadarChart data={categoryProgress} />
          </div>
        </div>
      )}

      {loading && <SkeletonMap />}

      {!loading && error && (
        <div className="px-4 py-16 max-w-lg mx-auto text-center">
          <p className="text-sm text-gray-600 mb-2">Skill map unavailable — try again</p>
          <p className="text-xs text-gray-400 mb-4 break-words">{error}</p>
          <button
            onClick={load}
            className="bg-brand-700 hover:bg-brand-800 text-white text-sm font-semibold rounded px-6 py-3"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && skillMap && (
        <div className={`px-4 py-6 max-w-lg mx-auto space-y-6 ${selectedList.length > 0 ? 'pb-24' : ''}`}>
          <p className="text-xs text-gray-500">Tap skills to select them, then enrol in everything at once.</p>
          {skillMap.categoryOrder.map((category) => (
            <div key={category}>
              <button
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center justify-between mb-3"
              >
                <h3 className="text-sm font-bold text-gray-900">{category}</h3>
                <span className={`text-gray-400 transition-transform ${expanded[category] ? 'rotate-180' : ''}`}>
                  ▾
                </span>
              </button>

              {expanded[category] && (
                <div className="flex flex-wrap gap-2">
                  {skillMap.categories[category].map((skill) => {
                    const completed = isSkillCompleted(skill)
                    const selected = !!selectedSkills[skillKey(skill)]
                    return (
                      <button
                        key={skill.name}
                        onClick={() => !completed && toggleSkill(skill)}
                        disabled={completed}
                        className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                          completed
                            ? 'bg-brand-600 border-brand-600 text-white opacity-70'
                            : selected
                            ? 'bg-brand-700 border-brand-700 text-white'
                            : 'bg-white border-brand-300 text-brand-800 hover:border-brand-600 hover:bg-brand-50'
                        }`}
                      >
                        {completed ? '✓ ' : ''}{skill.name}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedList.length > 0 && !showDrawer && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t-2 border-brand-700 px-4 py-3 z-20">
          <div className="max-w-lg mx-auto flex items-center justify-between gap-3">
            <button
              onClick={() => setSelectedSkills({})}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Clear
            </button>
            <p className="text-sm text-gray-700 flex-1 text-center">
              {selectedList.length} skill{selectedList.length !== 1 ? 's' : ''} selected
            </p>
            <button
              onClick={() => setShowDrawer(true)}
              className="bg-brand-700 hover:bg-brand-800 text-white text-sm font-semibold rounded px-5 py-2.5 transition-colors"
            >
              Review & enrol
            </button>
          </div>
        </div>
      )}

      {showDrawer && selectedList.length > 0 && (
        <EnrolSummaryDrawer
          skills={selectedList}
          catalogue={catalogue}
          onClose={closeDrawer}
          onEnrolled={handleEnrolled}
        />
      )}
    </div>
  )
}
