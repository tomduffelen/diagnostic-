import type { Course } from './totara'

// Word-boundary patterns so "context" isn't caught by "test"
const EXCLUDED_PATTERNS = [/\btest\b/i, /\bwebhook\b/i]

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

export function isExcludedCourse(course: Course): boolean {
  if (!course.title?.trim()) return true
  return EXCLUDED_PATTERNS.some((p) => p.test(course.title))
}

export function matchRecommendedCourses(
  recommendedTitles: string[],
  catalogue: Course[]
): Course[] {
  const valid = catalogue.filter((c) => !isExcludedCourse(c))

  return recommendedTitles
    .map((title) => {
      const t = title.toLowerCase()

      // 1. Title — primary signal
      let match = valid.find(
        (c) => c.title.toLowerCase().includes(t) || t.includes(c.title.toLowerCase())
      )
      if (match) return match

      // 2. Summary — secondary signal (strip HTML first)
      match = valid.find((c) => {
        if (!c.summary) return false
        return stripHtml(c.summary).toLowerCase().includes(t)
      })
      if (match) return match

      // 3. SkillArea — tertiary signal, only if populated
      match = valid.find((c) => {
        if (!c.skillArea) return false
        const area = c.skillArea.toLowerCase()
        return area.includes(t) || t.includes(area)
      })
      return match
    })
    .filter((c): c is Course => c !== undefined)
}
