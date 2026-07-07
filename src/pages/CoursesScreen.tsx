import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { getCatalogue } from '../lib/totara'
import type { Course } from '../lib/totara'

export default function CoursesScreen() {
  const navigate = useNavigate()
  const enrolledIds = useStore((s) => s.enrolledCourseIds)
  const catalogue = useStore((s) => s.catalogue)
  const setCatalogue = useStore((s) => s.setCatalogue)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [courses, setCourses] = useState<Course[]>([])

  const totaraUrl = import.meta.env.VITE_TOTARA_URL || ''

  useEffect(() => {
    async function load() {
      let cat = catalogue
      if (!cat.length) {
        setLoading(true)
        try {
          cat = await getCatalogue()
          setCatalogue(cat)
        } catch (err) {
          setError(String(err))
          setLoading(false)
          return
        }
        setLoading(false)
      }
      setCourses(cat.filter((c) => enrolledIds.includes(c.id)))
    }

    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrolledIds])

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
          ←
        </button>
        <p className="text-sm font-bold text-gray-900">My courses</p>
      </header>

      <div className="px-4 py-6 max-w-lg mx-auto">
        {loading && (
          <p className="text-sm text-gray-400 text-center py-12">Loading…</p>
        )}

        {error && (
          <div className="border border-red-300 rounded p-4 text-xs text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && courses.length === 0 && (
          <div className="text-center py-16">
            <p className="text-sm text-gray-500 mb-6">No enrolled courses on record</p>
            <button
              onClick={() => navigate('/diagnostic')}
              className="bg-brand-700 text-white text-sm font-semibold rounded px-6 py-3"
            >
              Run diagnostic
            </button>
          </div>
        )}

        <div className="space-y-3">
          {courses.map((course) => (
            <div key={course.id} className="bg-white border border-gray-200 border-l-2 border-l-brand-600 rounded overflow-hidden">
              {course.imageUrl && (
                <img src={course.imageUrl} alt={course.title} className="w-full h-24 object-cover" />
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-gray-900 text-sm">{course.title}</h3>
                  <span className="text-xs font-semibold border border-brand-600 text-brand-700 rounded-sm px-1.5 py-0.5 whitespace-nowrap flex-shrink-0">
                    Enrolled
                  </span>
                </div>

                {course.estimated_duration > 0 && (
                  <p className="text-xs text-gray-500 mb-3">{course.estimated_duration} min</p>
                )}

                <a
                  href={`${totaraUrl}/course/view.php?id=${course.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full border border-gray-300 hover:border-brand-600 hover:text-brand-700 text-gray-600 rounded text-xs py-2.5 text-center transition-colors"
                >
                  Open in Totara →
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
