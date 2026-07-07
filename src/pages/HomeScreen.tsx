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
        className="w-8 h-8 rounded-full object-cover border border-zinc-200"
      />
    )
  }

  return (
    <div className="w-8 h-8 rounded-full bg-teal-600 flex items-center justify-center flex-shrink-0">
      <span className="font-mono text-xs font-bold text-white">{initials}</span>
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
    <div className="min-h-screen bg-stone-50 dot-grid flex flex-col">

      {/* User bar */}
      <div className="flex items-center justify-between px-4 pt-4 pb-0">
        <button
          onClick={signOut}
          className="font-mono text-xs text-gray-400 hover:text-gray-600 transition-colors"
        >
          Not you?
        </button>
        {currentUser && (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-gray-600 hidden sm:block">{currentUser.fullname}</span>
            <Avatar user={currentUser} />
          </div>
        )}
      </div>

      <main className="flex-1 flex flex-col items-center justify-center p-6 text-center">

        <div className="w-14 h-14 border-2 border-teal-600 flex items-center justify-center mb-6 rotate-45">
          <div className="w-3 h-3 bg-teal-600 rotate-[-45deg]" />
        </div>

        <h1 className="font-mono text-5xl font-bold tracking-tight text-gray-900 mb-1">
          JEEVES
        </h1>
        <p className="font-mono text-xs text-gray-400 tracking-[0.2em] uppercase mb-8">
          your learning concierge
        </p>

        {jobAssignment?.userName && (
          <div className="bg-white border border-zinc-200 border-l-4 border-l-teal-500 px-4 py-3 text-left w-full max-w-xs mb-8">
            <p className="font-mono text-xs text-gray-400 tracking-widest uppercase mb-1">// identified as</p>
            <p className="font-mono text-base font-bold text-gray-900">{jobAssignment.userName}</p>
            {jobAssignment.position && (
              <p className="font-mono text-xs text-teal-600 mt-0.5">{jobAssignment.position}</p>
            )}
            {jobAssignment.organisation && (
              <p className="font-mono text-xs text-gray-400 mt-0.5">{jobAssignment.organisation}</p>
            )}
          </div>
        )}

        {!gapProfile ? (
          <button
            onClick={() => navigate('/diagnostic')}
            className="bg-teal-600 hover:bg-teal-700 active:bg-teal-800 text-white text-sm font-mono font-semibold px-8 py-4 rounded w-full max-w-xs transition-colors tracking-widest uppercase"
          >
            → Run diagnostic
          </button>
        ) : (
          <div className="w-full max-w-xs space-y-3">
            <div className="bg-white border border-zinc-200 p-4 text-left">
              <p className="font-mono text-xs text-gray-400 uppercase tracking-widest mb-2">// gaps on record</p>
              {gapProfile.gaps.slice(0, 2).map((gap, i) => (
                <div key={i} className="flex items-center gap-2 mt-1.5">
                  <span className={`font-mono text-xs px-1.5 py-0.5 border tracking-wide ${
                    gap.severity === 'compliance' ? 'border-red-400 text-red-600'
                    : gap.severity === 'development' ? 'border-amber-400 text-amber-600'
                    : 'border-blue-400 text-blue-600'
                  }`}>
                    {gap.severity.toUpperCase()}
                  </span>
                  <span className="text-sm text-gray-700">{gap.domain}</span>
                </div>
              ))}
            </div>

            <button
              onClick={() => navigate('/results')}
              className="bg-teal-600 hover:bg-teal-700 text-white font-mono font-semibold text-sm px-6 py-3 rounded w-full transition-colors tracking-widest uppercase"
            >
              → View results
            </button>
            <button
              onClick={runAgain}
              className="bg-white hover:bg-zinc-50 border border-zinc-300 text-gray-700 font-mono text-sm px-6 py-3 w-full transition-colors tracking-wide"
            >
              ↺ Run again
            </button>
            <button
              onClick={() => navigate('/courses')}
              className="text-teal-600 hover:text-teal-700 font-mono text-xs px-6 py-2 w-full transition-colors tracking-widest uppercase"
            >
              My courses →
            </button>
          </div>
        )}
      </main>

      {isDev && (
        <footer className="pb-6 text-center">
          <a href="/debug" className="font-mono text-xs text-gray-400 hover:text-gray-600 transition-colors">
            [debug]
          </a>
        </footer>
      )}
    </div>
  )
}
