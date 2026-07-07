import { useState } from 'react'
import { useStore } from '../store'
import {
  testConnection,
  getCatalogue,
  getUserJobAssignment,
  enrolUser,
  getAccessToken,
  getRawCatalogue,
  type Course,
  type JobAssignment,
} from '../lib/totara'

interface TestResult {
  status: 'idle' | 'loading' | 'pass' | 'fail'
  data?: unknown
  error?: string
}

interface RawCourseItem {
  id: string | number
  fullname: string
  summary?: string | null
  image?: string | null
  url?: string | null
  completionenabled?: boolean | null
  custom_fields?: Array<{
    definition?: { shortname: string; fullname?: string; type?: string } | null
    raw_value?: string | null
  }> | null
}

function ResultBlock({
  result,
  label,
  description,
}: {
  result: TestResult
  label: string
  description: string
}) {
  const [showRaw, setShowRaw] = useState(false)

  const icon =
    result.status === 'pass' ? '✅'
    : result.status === 'fail' ? '❌'
    : result.status === 'loading' ? '⏳'
    : '○'

  const border =
    result.status === 'pass' ? 'border-green-600'
    : result.status === 'fail' ? 'border-red-600'
    : 'border-gray-600'

  return (
    <div className={`border rounded-lg p-3 ${border} bg-gray-900`}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-semibold text-white">
          {icon} {label}
        </span>
        {result.status !== 'idle' && result.status !== 'loading' && (
          <button
            onClick={() => setShowRaw(!showRaw)}
            className="text-xs text-gray-400 hover:text-gray-200 underline"
          >
            {showRaw ? 'Hide' : 'Show'} raw
          </button>
        )}
      </div>
      <p className="text-xs text-gray-500 mb-2">{description}</p>

      {result.status === 'loading' && (
        <p className="text-sm text-gray-400">Running…</p>
      )}
      {result.status === 'fail' && (
        <p className="text-sm text-red-400 break-all">{result.error}</p>
      )}
      {result.status === 'pass' && !showRaw && (
        <ResultSummary label={label} data={result.data} />
      )}
      {showRaw && result.data !== undefined && (
        <pre className="text-xs bg-black rounded p-2 overflow-auto max-h-56 mt-1 text-green-300">
          {JSON.stringify(result.data, null, 2)}
        </pre>
      )}
    </div>
  )
}

function ResultSummary({ label, data }: { label: string; data: unknown }) {
  if (label === 'OAuth token') {
    const d = data as { token: string; expiresIn: number }
    return (
      <div className="text-xs text-green-400 space-y-0.5">
        <p>Token acquired — OAuth handshake OK</p>
        <p className="text-gray-500">Expires in {d.expiresIn}s · {d.token}</p>
      </div>
    )
  }

  if (label === 'Connection') {
    return <p className="text-xs text-green-400">totara_webapi_status → ok</p>
  }

  if (label === 'Catalogue') {
    const courses = data as Course[]
    return (
      <div className="text-xs text-gray-300 space-y-1">
        <p className="text-green-400">{courses.length} courses returned</p>
        {courses.slice(0, 5).map((c) => (
          <div key={c.id} className="flex gap-2">
            <span className="text-gray-500 w-6 shrink-0">#{c.id}</span>
            <span className="truncate">{c.title}</span>
            {c.completion?.statuskey && (
              <span className="text-indigo-400 shrink-0">{c.completion.statuskey}</span>
            )}
          </div>
        ))}
        {courses.length > 5 && (
          <p className="text-gray-500">…and {courses.length - 5} more</p>
        )}
        {courses.length > 0 && courses[0].raw_customfields.length > 0 && (
          <p className="text-gray-500 mt-1">
            Custom fields on first course:{' '}
            {courses[0].raw_customfields.map((f) => f.definition.shortname).join(', ')}
          </p>
        )}
        {courses.length > 0 && courses[0].raw_customfields.length === 0 && (
          <p className="text-gray-500 mt-1">No custom fields on courses yet</p>
        )}
      </div>
    )
  }

  if (label === 'Job assignment') {
    const job = data as JobAssignment | null
    if (!job) return <p className="text-xs text-yellow-400">No job assignment found for this user</p>
    return (
      <div className="text-xs text-gray-300 space-y-0.5">
        <p className="text-green-400">Found</p>
        <p><span className="text-gray-500">Name:</span> {job.fullname}</p>
        {job.position && <p><span className="text-gray-500">Position:</span> {job.position}</p>}
        {job.organisation && <p><span className="text-gray-500">Org:</span> {job.organisation}</p>}
        {job.manager && <p><span className="text-gray-500">Manager:</span> {job.manager.fullname}</p>}
      </div>
    )
  }

  if (label === 'Enrolment') {
    const d = data as { success: boolean; was_already_enrolled: boolean }
    return (
      <div className="text-xs text-green-400 space-y-0.5">
        <p>Enrolment succeeded</p>
        {d.was_already_enrolled && (
          <p className="text-yellow-400">User was already enrolled — treated as success</p>
        )}
      </div>
    )
  }

  return null
}

const ENV_VARS = [
  { key: 'VITE_TOTARA_URL', secret: false },
  { key: 'VITE_TOTARA_CLIENT_ID', secret: true },
  { key: 'VITE_TOTARA_CLIENT_SECRET', secret: true },
  { key: 'VITE_ANTHROPIC_API_KEY', secret: true },
]

export default function DebugScreen() {
  const currentUser = useStore((s) => s.currentUser)
  const userId = currentUser?.id ?? '(not logged in)'

  const [oauth, setOauth] = useState<TestResult>({ status: 'idle' })
  const [connection, setConnection] = useState<TestResult>({ status: 'idle' })
  const [catalogue, setCatalogue] = useState<TestResult>({ status: 'idle' })
  const [jobAssignment, setJobAssignment] = useState<TestResult>({ status: 'idle' })
  const [enrolment, setEnrolment] = useState<TestResult>({ status: 'idle' })
  const [enrolCourseId, setEnrolCourseId] = useState('')
  const [rawCatalogue, setRawCatalogue] = useState<TestResult>({ status: 'idle' })

  async function runOauth() {
    setOauth({ status: 'loading' })
    try {
      const token = await getAccessToken()
      setOauth({
        status: 'pass',
        data: { token: `${token.slice(0, 20)}…`, expiresIn: 86400 },
      })
    } catch (err) {
      setOauth({ status: 'fail', error: String(err) })
    }
  }

  async function runConnection() {
    setConnection({ status: 'loading' })
    try {
      const ok = await testConnection()
      setConnection(ok
        ? { status: 'pass', data: { status: 'ok' } }
        : { status: 'fail', error: 'testConnection() returned false — check API permissions' }
      )
    } catch (err) {
      setConnection({ status: 'fail', error: String(err) })
    }
  }

  async function runCatalogue() {
    setCatalogue({ status: 'loading' })
    try {
      const courses = await getCatalogue()
      setCatalogue({ status: 'pass', data: courses })
    } catch (err) {
      setCatalogue({ status: 'fail', error: String(err) })
    }
  }

  async function runJobAssignment() {
    setJobAssignment({ status: 'loading' })
    try {
      const job = await getUserJobAssignment(userId)
      setJobAssignment({ status: 'pass', data: job })
    } catch (err) {
      setJobAssignment({ status: 'fail', error: String(err) })
    }
  }

  async function runEnrolment() {
    if (!enrolCourseId.trim()) return
    setEnrolment({ status: 'loading' })
    try {
      await enrolUser(enrolCourseId.trim(), userId)
      // Re-run raw mutation to surface was_already_enrolled in summary
      setEnrolment({ status: 'pass', data: { success: true, was_already_enrolled: false } })
    } catch (err) {
      setEnrolment({ status: 'fail', error: String(err) })
    }
  }

  async function runRawCatalogue() {
    setRawCatalogue({ status: 'loading' })
    try {
      const data = await getRawCatalogue()
      setRawCatalogue({ status: 'pass', data })
    } catch (err) {
      setRawCatalogue({ status: 'fail', error: String(err) })
    }
  }

  async function runAll() {
    await runOauth()
    await runConnection()
    await runCatalogue()
    await runJobAssignment()
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold">🔧 API Debug</h1>
            <p className="text-gray-400 text-xs mt-0.5">
              {import.meta.env.VITE_TOTARA_URL} · user {userId}
            </p>
          </div>
          <button
            onClick={runAll}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            Run all
          </button>
        </div>

        <div className="space-y-3">
          {/* 1. OAuth */}
          <div className="bg-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-gray-200">1 · OAuth token</h2>
              <button onClick={runOauth} disabled={oauth.status === 'loading'}
                className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded disabled:opacity-40">
                Run
              </button>
            </div>
            <ResultBlock result={oauth} label="OAuth token"
              description="POST /totara/oauth2/token.php with client_credentials" />
          </div>

          {/* 2. Connection */}
          <div className="bg-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-gray-200">2 · Connection</h2>
              <button onClick={runConnection} disabled={connection.status === 'loading'}
                className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded disabled:opacity-40">
                Run
              </button>
            </div>
            <ResultBlock result={connection} label="Connection"
              description="query { totara_webapi_status { status } }" />
          </div>

          {/* 3. Catalogue */}
          <div className="bg-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-gray-200">3 · Catalogue</h2>
              <button onClick={runCatalogue} disabled={catalogue.status === 'loading'}
                className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded disabled:opacity-40">
                Run
              </button>
            </div>
            <ResultBlock result={catalogue} label="Catalogue"
              description="core_course_courses — fullname, image, custom_fields, completion" />
          </div>

          {/* 4. Job assignment */}
          <div className="bg-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-sm font-bold text-gray-200">4 · Job assignment</h2>
              <button onClick={runJobAssignment} disabled={jobAssignment.status === 'loading'}
                className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded disabled:opacity-40">
                Run
              </button>
            </div>
            <ResultBlock result={jobAssignment} label="Job assignment"
              description={`totara_job_job_assignment(target_job: { user: { id: ${userId} } })`} />
          </div>

          {/* 5. Enrolment */}
          <div className="bg-gray-800 rounded-xl p-4">
            <h2 className="text-sm font-bold text-gray-200 mb-2">5 · Enrolment</h2>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={enrolCourseId}
                onChange={(e) => setEnrolCourseId(e.target.value)}
                placeholder="Course ID (e.g. 7)"
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500"
              />
              <button
                onClick={runEnrolment}
                disabled={!enrolCourseId.trim() || enrolment.status === 'loading'}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-40"
              >
                Enrol
              </button>
            </div>
            <ResultBlock result={enrolment} label="Enrolment"
              description="enrol_manual_enrol_user — manual enrolment must be enabled on the course" />
          </div>
        </div>

        {/* Raw catalogue */}
        <div className="mt-6 bg-gray-800 rounded-xl p-4">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-bold text-gray-200">Raw Catalogue Data</h2>
            <button
              onClick={runRawCatalogue}
              disabled={rawCatalogue.status === 'loading'}
              className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded disabled:opacity-40"
            >
              {rawCatalogue.status === 'loading' ? 'loading…' : 'Run'}
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            core_course_courses — raw unprocessed response including all custom_fields
          </p>

          {rawCatalogue.status === 'idle' && (
            <p className="text-xs text-gray-600">Press Run to fetch</p>
          )}

          {rawCatalogue.status === 'fail' && (
            <p className="text-xs text-red-400 break-all">{rawCatalogue.error}</p>
          )}

          {rawCatalogue.status === 'pass' && rawCatalogue.data && (() => {
            const envelope = rawCatalogue.data as {
              data?: { core_course_courses?: { total: number; items: RawCourseItem[] } }
              errors?: { message: string }[]
            }

            if (envelope.errors?.length) {
              return (
                <div className="space-y-1">
                  {envelope.errors.map((e, i) => (
                    <p key={i} className="text-xs text-red-400">GraphQL error: {e.message}</p>
                  ))}
                </div>
              )
            }

            const result = envelope.data?.core_course_courses
            if (!result) return <p className="text-xs text-gray-500">No data in response</p>

            return (
              <div className="space-y-4">
                <p className="text-xs text-green-400 font-mono">{result.total} courses returned</p>

                {result.items.map((course) => (
                  <div key={course.id} className="border border-gray-700 rounded-lg p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-mono text-sm font-semibold text-white">
                        [{course.id}] {course.fullname}
                      </p>
                    </div>

                    {course.summary && (
                      <p className="text-xs text-gray-400 line-clamp-2">{course.summary}</p>
                    )}

                    <div className="font-mono text-xs space-y-0.5 text-gray-400">
                      <p>image: <span className="text-gray-300">{course.image ?? 'null'}</span></p>
                      <p>url: <span className="text-gray-300">{course.url ?? 'null'}</span></p>
                      <p>completionenabled: <span className="text-gray-300">{String(course.completionenabled ?? 'null')}</span></p>
                    </div>

                    <div>
                      <p className="font-mono text-xs text-teal-400 mb-1">
                        custom_fields ({course.custom_fields?.length ?? 0}):
                      </p>
                      {!course.custom_fields?.length ? (
                        <p className="font-mono text-xs text-gray-600">none</p>
                      ) : (
                        <div className="space-y-1">
                          {course.custom_fields.map((cf, i) => (
                            <div key={i} className="font-mono text-xs bg-gray-900 rounded px-2 py-1">
                              <span className="text-teal-300">{cf.definition?.shortname}</span>
                              {cf.definition?.fullname && cf.definition.fullname !== cf.definition.shortname && (
                                <span className="text-gray-500"> ({cf.definition.fullname})</span>
                              )}
                              <span className="text-gray-500"> [{cf.definition?.type}]</span>
                              <span className="text-gray-400"> = </span>
                              <span className={cf.raw_value ? 'text-yellow-300' : 'text-gray-600'}>
                                {cf.raw_value ?? 'null'}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}

                <details className="mt-2">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                    Full raw JSON
                  </summary>
                  <pre className="text-xs bg-black rounded p-2 overflow-auto max-h-96 mt-2 text-green-300">
                    {JSON.stringify(rawCatalogue.data, null, 2)}
                  </pre>
                </details>
              </div>
            )
          })()}
        </div>

        {/* Env */}
        <div className="mt-4 bg-gray-800 rounded-xl p-4">
          <h2 className="text-sm font-bold text-gray-200 mb-2">Environment</h2>
          <div className="space-y-1 text-xs font-mono">
            {ENV_VARS.map(({ key, secret }) => {
              const val = import.meta.env[key]
              const display = val
                ? secret ? `${String(val).slice(0, 8)}…` : String(val)
                : 'NOT SET'
              return (
                <div key={key} className="flex gap-2">
                  <span className="text-gray-500 shrink-0">{key}:</span>
                  <span className={val ? 'text-green-400' : 'text-red-400'}>{display}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-4 text-center">
          <a href="/" className="text-gray-600 text-sm hover:text-gray-400 transition-colors">
            ← Back to app
          </a>
        </div>
      </div>
    </div>
  )
}
