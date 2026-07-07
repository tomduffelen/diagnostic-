import { useState, useEffect, useRef, Fragment } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { useStore } from '../store'
import { sendMessage, extractGapProfile, type Message, type DiagnosticSubjectContext } from '../lib/diagnostic'
import { getCatalogue } from '../lib/totara'

const ROLE_OPTIONS = [
  'Kitchen Porter',
  'Commis Chef',
  'Chef de Partie',
  'Sous Chef',
  'Head Chef',
  'Bar Staff',
  'Bar Supervisor',
  'Floor Staff',
  'Front of House Manager',
  'General Manager',
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
      ? `I'm completing this assessment on behalf of my team member ${subject.userName}, who works as ${roles.join(', ') || 'a member of my team'}.`
      : roles.length > 0
      ? `I work as ${roles.join(', ')}.`
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
      addMessage({ role: 'assistant', content: reply })
      const profile = extractGapProfile(reply)
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
      <header className="bg-white border-b border-zinc-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/')} className="font-mono text-sm text-gray-400 hover:text-gray-700 transition-colors">
          ←
        </button>
        <div>
          <p className="font-mono text-sm font-semibold text-gray-900 tracking-tight">JEEVES</p>
          <p className="font-mono text-xs text-gray-400 tracking-widest">{subtitle}</p>
        </div>
      </header>
    )
  }

  // ── Mode select ───────────────────────────────────────────────────────────────

  if (phase === 'mode-select') {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <Header subtitle="NEW DIAGNOSTIC" />

        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-12">
          {jobAssignment?.userName && (
            <p className="font-mono text-xs text-teal-600 mb-6 tracking-wide">
              Signed in as {jobAssignment.userName}
            </p>
          )}

          <p className="font-mono text-xs text-gray-400 uppercase tracking-widest mb-6">
            // who is this check-in for?
          </p>

          <div className="flex gap-3 w-full max-w-xs">
            <button
              onClick={() => {
                setIsManagerMode(false)
                setPhase('role-select')
              }}
              className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-mono text-sm font-semibold py-5 transition-colors tracking-widest uppercase"
            >
              Myself
            </button>
            <button
              onClick={() => {
                setIsManagerMode(true)
                setPhase('member-select')
              }}
              className="flex-1 bg-white hover:bg-zinc-50 border border-zinc-300 hover:border-teal-500 text-gray-700 hover:text-teal-700 font-mono text-sm font-semibold py-5 transition-colors tracking-widest uppercase"
            >
              A team member
            </button>
          </div>

          <p className="font-mono text-xs text-gray-400 mt-4 text-center">
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
        <Header subtitle="SELECT TEAM MEMBER" />

        <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
          <p className="font-mono text-xs text-gray-400 uppercase tracking-widest mb-5">
            // select team member
          </p>

          <div className="space-y-2">
            {directReports.map((report) => {
              const selected = selectedMemberId === report.userId
              return (
                <button
                  key={report.userId}
                  onClick={() => setSelectedMemberId(report.userId)}
                  className={`w-full text-left px-4 py-4 border transition-colors ${
                    selected
                      ? 'bg-teal-600 border-teal-600 text-white'
                      : 'bg-white border-zinc-200 hover:border-teal-400 text-gray-800'
                  }`}
                >
                  <p className={`font-mono text-sm font-semibold ${selected ? 'text-white' : 'text-gray-900'}`}>
                    {selected ? '✓ ' : ''}{report.userName}
                  </p>
                  {report.position && (
                    <p className={`font-mono text-xs mt-0.5 ${selected ? 'text-teal-100' : 'text-teal-600'}`}>
                      {report.position}
                    </p>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        <div className="bg-white border-t-2 border-teal-600 px-4 py-4 sticky bottom-0">
          <button
            onClick={() => selectedMemberId && setPhase('role-select')}
            disabled={!selectedMemberId}
            className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-mono font-semibold py-4 transition-colors tracking-widest uppercase text-sm"
          >
            {selectedMemberId
              ? `→ Continue with ${selectedMember?.userName}`
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
        <Header subtitle={isManagerMode ? 'ASSESSING TEAM MEMBER' : 'SELECT YOUR ROLE'} />

        <div className="flex-1 px-4 py-6 max-w-lg mx-auto w-full">
          {subjectName ? (
            <div className="mb-5">
              <p className="font-mono text-xs text-gray-400 uppercase tracking-widest mb-1">
                {isManagerMode ? '// assessing' : '// identified as'}
              </p>
              <p className="font-mono text-lg font-bold text-gray-900">{subjectName}</p>
              {subjectPosition && (
                <p className="font-mono text-xs text-teal-600 mt-0.5">{subjectPosition}</p>
              )}
              <p className="text-sm text-gray-500 mt-3">
                {isManagerMode
                  ? `Confirm or adjust ${selectedMember?.userName.split(' ')[0]}'s role(s) below.`
                  : 'Confirm or adjust your role(s) below.'}
              </p>
            </div>
          ) : (
            <div className="mb-5">
              <p className="font-mono text-xs text-gray-400 uppercase tracking-widest mb-1">// who are you?</p>
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
                  className={`font-mono text-xs px-3 py-3 text-left border transition-colors ${
                    selected
                      ? 'bg-teal-600 text-white border-teal-600'
                      : 'bg-white text-gray-700 border-zinc-300 hover:border-teal-400 hover:text-teal-700'
                  }`}
                >
                  {selected ? '✓ ' : '  '}{role}
                </button>
              )
            })}
          </div>

          {loadingCatalogue && (
            <p className="font-mono text-xs text-gray-400 text-center mb-4 cursor-blink">loading catalogue</p>
          )}
        </div>

        <div className="bg-white border-t-2 border-teal-600 px-4 py-4 sticky bottom-0">
          <button
            onClick={confirmRoles}
            disabled={loadingCatalogue}
            className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-mono font-semibold py-4 transition-colors tracking-widest uppercase text-sm"
          >
            {roles.length === 0 ? '→ Skip' : `→ Start diagnostic (${roles.length} selected)`}
          </button>
        </div>
      </div>
    )
  }

  // ── Chat ──────────────────────────────────────────────────────────────────────

  const chatSubject = useStore.getState().diagnosticSubject

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="bg-white border-b border-zinc-200 px-4 py-3 flex items-center gap-3 sticky top-0 z-10">
        <button onClick={() => navigate('/')} className="font-mono text-sm text-gray-400 hover:text-gray-700 transition-colors">
          ←
        </button>
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 border-2 border-teal-600 flex items-center justify-center rotate-45 flex-shrink-0">
            <div className="w-1.5 h-1.5 bg-teal-600 rotate-[-45deg]" />
          </div>
          <div>
            <p className="font-mono text-sm font-semibold text-gray-900 tracking-tight">JEEVES</p>
            <p className="font-mono text-xs text-gray-400 tracking-widest">
              {chatSubject?.isManagerMode ? `ASSESSING ${chatSubject.userName.toUpperCase()}` : 'DIAGNOSTIC'}
            </p>
          </div>
        </div>
        {storedRoles.length > 0 && (
          <div className="ml-auto">
            <p className="font-mono text-xs text-teal-600 truncate max-w-[140px]">{storedRoles.join(', ')}</p>
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
                  <div className={`max-w-[82%] px-4 py-3 text-base leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-teal-600 text-white rounded-sm'
                      : 'bg-white border border-zinc-200 text-gray-800 rounded-sm'
                  }`}>
                    {msg.role === 'assistant' && (
                      <span className="font-mono text-xs text-teal-600 block mb-1 tracking-widest">JEEVES ›</span>
                    )}
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
                  <p className="font-mono text-sm text-gray-700 leading-snug px-1">{mc.question}</p>
                  {mc.options.map((option, j) => (
                    <button
                      key={j}
                      onClick={() => handleSend(option)}
                      disabled={loading}
                      className="w-full text-left font-mono text-sm border border-zinc-300 hover:border-teal-500 hover:text-teal-700 hover:bg-teal-50 text-gray-700 bg-white px-4 py-3 transition-colors disabled:opacity-50 rounded-sm"
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
            <div className="bg-white border border-zinc-200 rounded-sm px-4 py-3">
              <span className="font-mono text-xs text-teal-600 block mb-1 tracking-widest">JEEVES ›</span>
              <span className="font-mono text-sm text-gray-400 cursor-blink">thinking</span>
            </div>
          </div>
        )}

        {error && (
          <div className="border border-red-300 bg-red-50 p-3 text-sm text-red-700 font-mono">
            ERR: {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {profileDetected && (
        <div className="px-4 pb-3">
          <button
            onClick={() => navigate('/results')}
            className="w-full bg-teal-600 hover:bg-teal-700 text-white font-mono font-semibold py-4 rounded-sm transition-colors tracking-widest uppercase text-sm"
          >
            → View results
          </button>
        </div>
      )}

      {!profileDetected && (
        <div className="bg-white border-t-2 border-teal-600 px-5 py-5">
          <div className="flex gap-3 items-center">
            <span className="font-mono text-teal-600 text-lg select-none">›</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="type your reply..."
              disabled={loading}
              className="flex-1 bg-transparent text-base font-mono text-gray-800 placeholder-gray-400 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="font-mono text-sm text-teal-600 hover:text-teal-800 disabled:text-gray-300 transition-colors px-3 py-2 border border-teal-600 disabled:border-gray-300 rounded-sm tracking-widest"
            >
              SEND
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
