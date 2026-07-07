import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { useStore } from '../store'
import { sendMessage, extractGapProfile, HARD_CAP_EXCHANGES, type Message, type DiagnosticSubjectContext } from '../lib/diagnostic'
import { getCatalogue } from '../lib/totara'

const ROLE_OPTIONS = [
  'Team Leader / Supervisor',
  'First-line Manager',
  'Middle Manager',
  'Senior Manager',
  'Head of Service / Department',
  'Director',
  'Aspiring Manager',
]

function matchPositionToRoles(position: string | undefined): string[] {
  if (!position) return []
  const pos = position.toLowerCase()
  return ROLE_OPTIONS.filter((role) => {
    const r = role.toLowerCase()
    return pos.includes(r) || r.includes(pos) ||
      r.split(' ').some((word) => word.length > 3 && pos.includes(word))
  })
}

type Phase = 'mode-select' | 'member-select' | 'role-select' | 'chat'

export default function DiagnosticScreen() {
  const navigate = useNavigate()
  const catalogue = useStore((s) => s.catalogue)
  const setCatalogue = useStore((s) => s.setCatalogue)
  const messages = useStore((s) => s.messages)
  const addMessage = useStore((s) => s.addMessage)
  const setGapProfile = useStore((s) => s.setGapProfile)
  const currentUser = useStore((s) => s.currentUser)
  const jobAssignment = useStore((s) => s.jobAssignment)
  const directReports = useStore((s) => s.directReports)
  const storedRoles = useStore((s) => s.selectedRoles)
  const setSelectedRoles = useStore((s) => s.setSelectedRoles)
  const setDiagnosticSubject = useStore((s) => s.setDiagnosticSubject)

  const initialPhase: Phase = (() => {
    if (messages.length > 0) return 'chat'
    if (directReports.length > 0) return 'mode-select'
    return 'role-select'
  })()

  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [isManagerMode, setIsManagerMode] = useState(false)
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [roles, setRoles] = useState<string[]>([])

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingCatalogue, setLoadingCatalogue] = useState(false)
  const [profileDetected, setProfileDetected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selectedMember = directReports.find((r) => r.userId === selectedMemberId) ?? null

  // Populate roles whenever we enter role-select
  useEffect(() => {
    if (phase !== 'role-select') return
    if (isManagerMode && selectedMember) {
      setRoles(matchPositionToRoles(selectedMember.position))
    } else if (storedRoles.length > 0) {
      setRoles(storedRoles)
    } else {
      setRoles(matchPositionToRoles(jobAssignment?.position))
    }
  }, [phase])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  // Load catalogue in the background
  useEffect(() => {
    if (catalogue.length) return
    setLoadingCatalogue(true)
    getCatalogue()
      .then((cat) => setCatalogue(cat))
      .catch((err) => console.error('[Diagnostic] catalogue load failed:', err))
      .finally(() => setLoadingCatalogue(false))
  }, [])

  function toggleRole(role: string) {
    setRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]
    )
  }

  async function confirmRoles() {
    const subject: DiagnosticSubjectContext = isManagerMode && selectedMember
      ? { userName: selectedMember.userName, isManagerMode: true }
      : { userName: jobAssignment?.userName ?? '', isManagerMode: false }

    const subjectUserId = isManagerMode && selectedMember
      ? selectedMember.userId
      : currentUser?.id ?? ''

    setSelectedRoles(roles)
    setDiagnosticSubject({
      userId: subjectUserId,
      userName: subject.userName,
      isManagerMode: subject.isManagerMode,
    })
    setPhase('chat')

    const seedContent = subject.isManagerMode
      ? `I'm completing this assessment on behalf of my team member ${subject.userName}, who is a ${roles.join(', ') || 'member of my team'}.`
      : roles.length > 0
      ? `I am a ${roles.join(', ')}.`
      : 'Hi'

    const seedMsg: Message = { role: 'user', content: seedContent }
    addMessage(seedMsg)

    setLoading(true)
    try {
      const reply = await sendMessage([seedMsg], catalogue, roles, subject)
      addMessage({ role: 'assistant', content: reply })
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleSend(overrideText?: string) {
    const text = (overrideText ?? input).trim()
    if (!text || loading) return
    if (!overrideText) setInput('')
    setError(null)

    const userMsg: Message = { role: 'user', content: text }
    addMessage(userMsg)

    setLoading(true)
    try {
      const history: Message[] = [...messages, userMsg]
      const subject: DiagnosticSubjectContext | undefined = isManagerMode && selectedMember
        ? { userName: selectedMember.userName, isManagerMode: true }
        : undefined
      const reply = await sendMessage(history, catalogue, storedRoles, subject)
      let profile = extractGapProfile(reply)
      let finalReply = reply

      // Safety net: if the model was supposed to wrap up on this exchange
      // but didn't produce a valid gap_profile (e.g. it leaked commentary
      // instead), retry once rather than leaving the learner with no way
      // to reach results.
      const exchangeCount = history.filter((m) => m.role === 'user').length
      if (!profile && exchangeCount >= HARD_CAP_EXCHANGES) {
        const retryReply = await sendMessage(history, catalogue, storedRoles, subject)
        const retryProfile = extractGapProfile(retryReply)
        if (retryProfile) {
          finalReply = retryReply
          profile = retryProfile
        }
      }

      addMessage({ role: 'assistant', content: finalReply })
      if (profile) {
        setGapProfile(profile)
        setProfileDetected(true)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  interface McQuestion {
    question: string
    options: string[]
  }

  function parseMcQuestion(content: string): McQuestion | null {
    const match = content.match(/<mc_question>([\s\S]*?)<\/mc_question>/)
    if (!match) return null
    try {
      return JSON.parse(match[1].trim()) as McQuestion
    } catch {
      return null
    }
  }

  function renderMessageContent(content: string) {
    return content
      .replace(/<gap_profile>[\s\S]*?<\/gap_profile>/g, '')
      .replace(/<mc_question>[\s\S]*?<\/mc_question>/g, '')
      .trim()
  }

  // ── Shared header ─────────────────────────────────────────────────────────────

  function Header({ subtitle }: { subtitle: string }) {
    return (
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
          ←
        </button>
        <div>
          <p className="text-sm font-bold text-gray-900">Compass</p>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
      </header>
    )
  }

  // ── Mode select ───────────────────────────────────────────────────────────────

  if (phase === 'mode-select') {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <Header subtitle="New diagnostic" />

        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-12">
          {jobAssignment?.userName && (
            <p className="text-sm text-brand-700 mb-6">
              Signed in as {jobAssignment.userName}
            </p>
          )}

          <p className="text-sm text-gray-600 mb-6">
            Who is this check-in for?
          </p>

          <div className="flex gap-3 w-full max-w-xs">
            <button
              onClick={() => {
                setIsManagerMode(false)
                setPhase('role-select')
              }}
              className="flex-1 bg-brand-700 hover:bg-brand-800 text-white font-semibold rounded py-5 transition-colors"
            >
              Myself
            </button>
            <button
              onClick={() => {
                setIsManagerMode(true)
                setPhase('member-select')
              }}
              className="flex-1 bg-white hover:bg-gray-50 border border-gray-400 hover:border-brand-700 text-gray-800 hover:text-brand-700 font-semibold rounded py-5 transition-colors"
            >
              A team member
            </button>
          </div>

          <p className="text-xs text-gray-400 mt-4 text-center">
            {directReports.length} direct report{directReports.length !== 1 ? 's' : ''} on record
          </p>
        </div>
      </div>
    )
  }

  // ── Member select ─────────────────────────────────────────────────────────────

  if (phase === 'member-select') {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <Header subtitle="Select team member" />

        <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
          <p className="text-sm text-gray-600 mb-5">
            Select team member
          </p>

          <div className="space-y-2">
            {directReports.map((report) => {
              const selected = selectedMemberId === report.userId
              return (
                <button
                  key={report.userId}
                  onClick={() => setSelectedMemberId(report.userId)}
                  className={`w-full text-left px-4 py-4 border rounded transition-colors ${
                    selected
                      ? 'bg-brand-700 border-brand-700 text-white'
                      : 'bg-white border-gray-300 hover:border-brand-500 text-gray-800'
                  }`}
                >
                  <p className={`text-sm font-semibold ${selected ? 'text-white' : 'text-gray-900'}`}>
                    {selected ? '✓ ' : ''}{report.userName}
                  </p>
                  {report.position && (
                    <p className={`text-xs mt-0.5 ${selected ? 'text-brand-100' : 'text-brand-700'}`}>
                      {report.position}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="bg-white border-t-2 border-brand-700 px-4 py-4 sticky bottom-0">
          <button
            onClick={() => selectedMemberId && setPhase('role-select')}
            disabled={!selectedMemberId}
            className="w-full bg-brand-700 hover:bg-brand-800 disabled:bg-gray-300 text-white font-semibold rounded py-4 transition-colors text-base"
          >
            {selectedMemberId
              ? `Continue with ${selectedMember?.userName}`
              : 'Select a team member'}
          </button>
        </div>
      </div>
    )
  }

  // ── Role select ───────────────────────────────────────────────────────────────

  if (phase === 'role-select') {
    const subjectName = isManagerMode && selectedMember ? selectedMember.userName : jobAssignment?.userName
    const subjectPosition = isManagerMode && selectedMember ? selectedMember.position : jobAssignment?.position

    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <Header subtitle={isManagerMode ? 'Assessing team member' : 'Select your role'} />

        <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
          {subjectName ? (
            <div className="mb-5">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                {isManagerMode ? 'Assessing' : 'Identified as'}
              </p>
              <p className="text-lg font-bold text-gray-900">{subjectName}</p>
              {subjectPosition && (
                <p className="text-sm text-brand-700 mt-0.5">{subjectPosition}</p>
              )}
              <p className="text-sm text-gray-500 mt-3">
                {isManagerMode
                  ? `Confirm or adjust ${selectedMember?.userName.split(' ')[0]}'s leadership level below.`
                  : 'Confirm or adjust your leadership level below.'}
              </p>
            </div>
          ) : (
            <div className="mb-5">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Your leadership level</p>
              <p className="text-sm text-gray-500">Select all that apply.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 mb-8">
            {ROLE_OPTIONS.map((role) => {
              const selected = roles.includes(role)
              return (
                <button
                  key={role}
                  onClick={() => toggleRole(role)}
                  className={`text-sm px-3 py-3 text-left border rounded transition-colors ${
                    selected
                      ? 'bg-brand-700 text-white border-brand-700'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-brand-500 hover:text-brand-700'
                  }`}
                >
                  {selected ? '✓ ' : ''}{role}
                </button>
              )
            })}
          </div>

          {loadingCatalogue && (
            <p className="text-sm text-gray-400 text-center mb-4">Loading course catalogue…</p>
          )}
        </div>

        <div className="bg-white border-t-2 border-brand-700 px-4 py-4 sticky bottom-0">
          <button
            onClick={confirmRoles}
            disabled={loadingCatalogue}
            className="w-full bg-brand-700 hover:bg-brand-800 disabled:bg-gray-300 text-white font-semibold rounded py-4 transition-colors text-base"
          >
            {roles.length === 0 ? 'Skip' : `Start diagnostic (${roles.length} selected)`}
          </button>
        </div>
      </div>
    )
  }

  // ── Chat ──────────────────────────────────────────────────────────────────────

  const chatSubject = useStore.getState().diagnosticSubject

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/')} className="text-sm text-gray-400 hover:text-gray-700 transition-colors">
          ←
        </button>
        <div>
          <p className="text-sm font-bold text-gray-900">Compass</p>
          <p className="text-xs text-gray-500">
            {chatSubject?.isManagerMode ? `Assessing ${chatSubject.userName}` : 'Diagnostic'}
          </p>
        </div>
        {storedRoles.length > 0 && (
          <div className="ml-auto">
            <p className="text-xs text-brand-700 truncate max-w-[140px]">{storedRoles.join(', ')}</p>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        {messages.map((msg, i) => {
          const content = renderMessageContent(msg.content)
          const isLastAssistant = msg.role === 'assistant' && i === messages.length - 1
          const mc = isLastAssistant && !profileDetected ? parseMcQuestion(msg.content) : null

          if (!content && !mc) return null

          return (
            <Fragment key={i}>
              {content && (
                <div className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[82%] px-4 py-3 text-base leading-relaxed rounded ${
                    msg.role === 'user'
                      ? 'bg-brand-700 text-white'
                      : 'bg-white border border-gray-200 text-gray-800'
                  }`}>
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                        strong: ({ children }) => <strong className="font-bold">{children}</strong>,
                        em: ({ children }) => <em className="italic">{children}</em>,
                        ul: ({ children }) => <ul className="list-disc list-inside mb-2 space-y-0.5">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal list-inside mb-2 space-y-0.5">{children}</ol>,
                        li: ({ children }) => <li>{children}</li>,
                      }}
                    >
                      {content}
                    </ReactMarkdown>
                  </div>
                </div>
              )}
              {mc && (
                <div className="space-y-2">
                  <p className="text-sm text-gray-700 leading-snug px-1">{mc.question}</p>
                  {mc.options.map((option, j) => (
                    <button
                      key={j}
                      onClick={() => handleSend(option)}
                      disabled={loading}
                      className="w-full text-left text-sm border border-gray-300 hover:border-brand-600 hover:text-brand-700 hover:bg-brand-50 text-gray-700 bg-white px-4 py-3 transition-colors disabled:opacity-50 rounded"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              )}
            </Fragment>
          )
        })}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 rounded px-4 py-3">
              <span className="text-sm text-gray-400">Thinking…</span>
            </div>
          </div>
        )}

        {error && (
          <div className="border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {profileDetected && (
        <div className="px-4 pb-3">
          <button
            onClick={() => navigate('/results')}
            className="w-full bg-brand-700 hover:bg-brand-800 text-white font-semibold py-4 rounded transition-colors text-base"
          >
            View results
          </button>
        </div>
      )}

      {!profileDetected && (
        <div className="bg-white border-t-2 border-brand-700 px-5 py-5">
          <div className="flex gap-3 items-center">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your reply…"
              disabled={loading}
              className="flex-1 bg-transparent text-base text-gray-800 placeholder-gray-400 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || loading}
              className="text-sm font-semibold text-brand-700 hover:text-brand-800 disabled:text-gray-300 transition-colors px-3 py-2 border border-brand-700 disabled:border-gray-300 rounded"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
