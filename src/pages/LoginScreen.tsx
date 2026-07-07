import { useState, useRef } from 'react'
import { useStore } from '../store'
import { lookupUserByEmail } from '../lib/totara'

export default function LoginScreen() {
  const setCurrentUser = useStore((s) => s.setCurrentUser)
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'not_found' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return

    setStatus('loading')
    setErrorMsg('')

    try {
      const user = await lookupUserByEmail(trimmed)
      if (!user) {
        setStatus('not_found')
        inputRef.current?.focus()
        return
      }
      setCurrentUser(user)
    } catch (err) {
      setStatus('error')
      setErrorMsg(String(err))
    }
  }

  return (
    <div className="min-h-screen bg-stone-50 dot-grid flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xs">

        {/* Logo */}
        <div className="flex flex-col items-center mb-10">
          <div className="w-12 h-12 border-2 border-teal-600 flex items-center justify-center mb-4 rotate-45">
            <div className="w-2.5 h-2.5 bg-teal-600 rotate-[-45deg]" />
          </div>
          <h1 className="font-mono text-4xl font-bold tracking-tight text-gray-900">JEEVES</h1>
          <p className="font-mono text-xs text-gray-400 tracking-[0.2em] uppercase mt-1">
            your learning concierge
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <p className="font-mono text-xs text-gray-400 uppercase tracking-widest mb-3">
              // sign in
            </p>
            <input
              ref={inputRef}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (status === 'not_found') setStatus('idle')
              }}
              placeholder="your.name@company.com"
              autoFocus
              autoComplete="email"
              disabled={status === 'loading'}
              className={`w-full font-mono text-base bg-white border-2 px-4 py-4 placeholder-gray-300 focus:outline-none transition-colors disabled:opacity-50 ${
                status === 'not_found'
                  ? 'border-red-400 focus:border-red-500'
                  : 'border-zinc-300 focus:border-teal-600'
              }`}
            />
          </div>

          {status === 'not_found' && (
            <div className="bg-red-50 border border-red-200 px-4 py-3">
              <p className="font-mono text-xs text-red-700">
                We couldn't find that email address. Check with your manager.
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="bg-red-50 border border-red-200 px-4 py-3">
              <p className="font-mono text-xs text-red-700">
                Something went wrong. Check your connection and try again.
              </p>
              {errorMsg && <p className="font-mono text-xs text-gray-400 mt-1 break-all">{errorMsg}</p>}
            </div>
          )}

          <button
            type="submit"
            disabled={!email.trim() || status === 'loading'}
            className="w-full bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white font-mono font-semibold py-4 transition-colors tracking-widest uppercase text-sm"
          >
            {status === 'loading' ? (
              <span className="cursor-blink">checking</span>
            ) : (
              "Let's go →"
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
