import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store'
import { getUserJobAssignment, getDirectReports } from '../lib/totara'

function Avatar({ user }: { user: { fullname: string; profileImageUrl?: string } }) {
  const [imgFailed, setImgFailed] = useState(false)
  const initials = user.fullname
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  if (user.profileImageUrl && !imgFailed) {
    return (
      <img
        src={user.profileImageUrl}
        alt={user.fullname}
        onError={() => setImgFailed(true)}
        className="w-8 h-8 rounded-full object-cover border border-gray-300"
      />
    )
  }

  return (
    <div className="w-8 h-8 rounded-full bg-brand-700 flex items-center justify-center flex-shrink-0">
      <span className="text-xs font-bold text-white">{initials}</span>
    </div>
  )
}

export default function HomeScreen() {
  const navigate = useNavigate()
  const currentUser = useStore((s) => s.currentUser)
  const setCurrentUser = useStore((s) => s.setCurrentUser)
  const gapProfile = useStore((s) => s.gapProfile)
  const jobAssignment = useStore((s) => s.jobAssignment)
  const setJobAssignment = useStore((s) => s.setJobAssignment)
  const setDirectReports = useStore((s) => s.setDirectReports)
  const isDev = import.meta.env.DEV

  useEffect(() => {
    if (!currentUser) return
    getUserJobAssignment(currentUser.id)
      .then(async (ja) => {
        setJobAssignment(ja)
        if (ja?.id) {
          const reports = await getDirectReports(ja.id)
          setDirectReports(reports)
        }
      })
      .catch(() => {})
  }, [currentUser?.id])

  function signOut() {
    setCurrentUser(null)
    useStore.setState({
      jobAssignment: null,
      directReports: [],
      gapProfile: null,
      messages: [],
      diagnosticSubject: null,
      selectedRoles: [],
      enrolledCourseIds: [],
    })
  }

  function runAgain() {
    useStore.getState().clearMessages()
    useStore.setState({ gapProfile: null, diagnosticSubject: null })
    navigate('/diagnostic')
  }

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">

      {/* User bar */}
      <div className="flex items-center justify-between px-4 pt-4 pb-0">
        <button
          onClick={signOut}
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
        >
          Not you?
        </button>
        {currentUser && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 hidden sm:block">{currentUser.fullname}</span>
            <Avatar user={currentUser} />
          </div>
        )}
      </div>

      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">

        <div className="flex items-center gap-2 mb-2">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900">
            Compass
          </h1>
          <span className="text-xs font-semibold uppercase tracking-wide bg-gray-800 text-white px-2 py-0.5 rounded-sm">
            Prototype
          </span>
        </div>
        <p className="text-sm text-gray-500 mb-8">
          Leadership skills diagnostic
        </p>

        {jobAssignment?.userName && (
          <div className="bg-white border border-gray-200 border-l-4 border-l-brand-700 rounded px-4 py-3 text-left w-full max-w-xs mb-8">
            <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Identified as</p>
            <p className="text-base font-bold text-gray-900">{jobAssignment.userName}</p>
            {jobAssignment.position && (
              <p className="text-sm text-brand-700 mt-0.5">{jobAssignment.position}</p>
            )}
            {jobAssignment.organisation && (
              <p className="text-xs text-gray-500 mt-0.5">{jobAssignment.organisation}</p>
            )}
          </div>
        )}

        {!gapProfile ? (
          <button
            onClick={() => navigate('/diagnostic')}
            className="bg-brand-700 hover:bg-brand-800 active:bg-brand-900 text-white font-semibold rounded px-8 py-4 w-full max-w-xs transition-colors text-base"
          >
            Start diagnostic
          </button>
        ) : (
          <div className="w-full max-w-xs space-y-3">
            <div className="bg-white border border-gray-200 rounded p-4 text-left">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Gaps on record</p>
              {gapProfile.gaps.slice(0, 2).map((gap, i) => (
                <div key={i} className="flex items-center gap-2 mt-1.5">
                  <span className={`text-xs font-semibold px-1.5 py-0.5 border rounded-sm ${
                    gap.severity === 'compliance' ? 'border-red-600 text-red-700'
                    : gap.severity === 'development' ? 'border-blue-600 text-blue-700'
                    : 'border-purple-500 text-purple-700'
                  }`}>
                    {gap.severity.toUpperCase()}
                  </span>
                  <span className="text-sm text-gray-700">{gap.domain}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => navigate('/results')}
              className="bg-brand-700 hover:bg-brand-800 text-white font-semibold rounded px-6 py-3 w-full transition-colors text-base"
            >
              View results
            </button>
            <button
              onClick={runAgain}
              className="bg-white hover:bg-gray-50 border border-gray-400 text-gray-800 font-semibold rounded px-6 py-3 w-full transition-colors"
            >
              Run again
            </button>
            <button
              onClick={() => navigate('/courses')}
              className="text-brand-700 hover:text-brand-800 text-sm font-semibold px-6 py-2 w-full transition-colors underline"
            >
              My courses
            </button>
          </div>
        )}
      </main>

      {isDev && (
        <footer className="pb-6 text-center">
          <a href="/debug" className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            [debug]
          </a>
        </footer>
      )}
    </div>
  )
}
