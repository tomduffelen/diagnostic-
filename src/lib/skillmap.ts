import type { Course } from './totara'
import { isExcludedCourse } from './matcher'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CourseSkillGroup {
  course_id: string
  course_title: string
  category: string
  skills: string[]
}

export interface SkillPill {
  name: string
  category: string
  courseIds: string[]
  courseTitles: string[]
}

export interface SkillMapData {
  categoryOrder: string[]
  categories: Record<string, SkillPill[]>
  totalSkills: number
}

const CACHE_KEY = 'compass_skillmap_cache_v1'

// ── Prompt + extraction ───────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function buildPrompt(catalogue: Course[]): string {
  const courseList = catalogue
    .map((c) => {
      const summary = c.summary ? ` | summary: ${stripHtml(c.summary).slice(0, 200)}` : ''
      return `- id: "${c.id}" | title: "${c.title}"${summary}`
    })
    .join('\n')

  return `You are analysing a learning and development course catalogue. For each course below, assign it to ONE broad skill category (infer sensible categories from the course content itself — do not force any fixed list) and extract 2-4 specific skills a learner would gain from completing it.

Return ONLY a JSON array in this format, no other text, no markdown code fences:
[
  {
    "course_id": "20",
    "course_title": "Example Course Title",
    "category": "Example Category",
    "skills": ["specific skill one", "specific skill two"]
  }
]

Courses:
${courseList}`
}

function parseSkillResponse(text: string, stopReason?: string): CourseSkillGroup[] {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    if (stopReason === 'max_tokens') {
      throw new Error(
        `Claude's response was cut off before finishing (catalogue is likely too large for one pass). Raw error: ${String(err)}`
      )
    }
    throw new Error(`Could not parse skill extraction response as JSON: ${String(err)}`)
  }
  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array from skill extraction')
  return parsed as CourseSkillGroup[]
}

function readCache(courseCount: number): CourseSkillGroup[] | null {
  const raw = localStorage.getItem(CACHE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { courseCount: number; data: CourseSkillGroup[] }
    return parsed.courseCount === courseCount ? parsed.data : null
  } catch {
    return null
  }
}

function writeCache(courseCount: number, data: CourseSkillGroup[]): void {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ courseCount, data }))
}

// Demo scope: only the leadership course category, capped to a small
// batch so a single Claude call stays fast and reliable on Vercel.
const LEADERSHIP_CATEGORY_ID = '7'
const DEMO_COURSE_CAP = 20

export async function extractSkills(catalogue: Course[]): Promise<CourseSkillGroup[]> {
  const validCatalogue = catalogue
    .filter((c) => !isExcludedCourse(c))
    .filter((c) => c.category?.id === LEADERSHIP_CATEGORY_ID)
    .slice(0, DEMO_COURSE_CAP)

  const cached = readCache(validCatalogue.length)
  if (cached) return cached

  const body = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 3000,
    messages: [{ role: 'user', content: buildPrompt(validCatalogue) }],
  })

  const res = import.meta.env.DEV
    ? await fetch('/anthropic-api/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body,
      })
    : await fetch('/api/anthropic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Skill extraction failed: ${res.status} ${res.statusText} — ${errBody}`)
  }

  const data = await res.json()
  const text = data.content[0].text as string
  const groups = parseSkillResponse(text, data.stop_reason)

  writeCache(validCatalogue.length, groups)
  return groups
}

// ── Grouping ──────────────────────────────────────────────────────────────────

export function buildSkillMap(groups: CourseSkillGroup[]): SkillMapData {
  const categories: Record<string, SkillPill[]> = {}
  const categoryOrder: string[] = []
  let totalSkills = 0

  for (const group of groups) {
    if (!categories[group.category]) {
      categories[group.category] = []
      categoryOrder.push(group.category)
    }

    for (const skillName of group.skills) {
      const trimmed = skillName.trim()
      if (!trimmed) continue
      const normalized = trimmed.toLowerCase()
      const existing = categories[group.category].find((p) => p.name.toLowerCase() === normalized)

      if (existing) {
        if (!existing.courseIds.includes(group.course_id)) {
          existing.courseIds.push(group.course_id)
          existing.courseTitles.push(group.course_title)
        }
      } else {
        categories[group.category].push({
          name: trimmed,
          category: group.category,
          courseIds: [group.course_id],
          courseTitles: [group.course_title],
        })
        totalSkills++
      }
    }
  }

  return { categoryOrder, categories, totalSkills }
}
