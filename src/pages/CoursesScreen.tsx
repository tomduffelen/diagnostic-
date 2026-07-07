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
      <header className="bg-white border-b border-zinc-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/')} className="font-mono text-sm text-gray-400 hover:text-gray-700 transition-colors">
          ←
        </button>
        <p className="font-mono text-sm font-semibold text-gray-900 tracking-tight">MY COURSES</p>
      </header>

      <div className="px-4 py-6 max-w-lg mx-auto">
        {loading && (
          <p className="font-mono text-xs text-gray-400 cursor-blink text-center py-12">loading</p>
        )}

        {error && (
          <div className="border border-red-300 p-4 font-mono text-xs text-red-600">
            ERR: {error}
          </div>
        )}

        {!loading && !error && courses.length === 0 && (
          <div className="text-center py-16">
            <p className="font-mono text-xs text-gray-400 mb-6 tracking-wide">no enrolled courses on record</p>
            <button
              onClick={() => navigate('/diagnostic')}
              className="bg-teal-600 text-white font-mono text-xs px-6 py-3 tracking-widest uppercase"
            >
              → Run diagnostic
            </button>
          </div>
        )}

        <div className="space-y-3">
          {courses.map((course) => (
            <div key={course.id} className="bg-white border border-zinc-200 border-l-2 border-l-teal-500 overflow-hidden">
              {course.imageUrl && (
                <img src={course.imageUrl} alt={course.title} className="w-full h-24 object-cover" />
              )}
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <h3 className="font-semibold text-gray-900 text-sm">{course.title}</h3>
                  <span className="font-mono text-xs border border-teal-500 text-teal-700 px-1.5 py-0.5 whitespace-nowrap flex-shrink-0 tracking-widest">
                    ENROLLED
                  </span>
                </div>

                {course.estimated_duration > 0 && (
                  <p className="font-mono text-xs text-gray-400 mb-3">{course.estimated_duration}min</p>
                )}

                <a
                  href={`${totaraUrl}/course/view.php?id=${course.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full border border-zinc-300 hover:border-teal-500 hover:text-teal-700 text-gray-600 font-mono text-xs py-2.5 text-center transition-colors tracking-widest"
                >
                  OPEN IN TOTARA →
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
