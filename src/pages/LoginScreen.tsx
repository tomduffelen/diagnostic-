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
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm">

        {/* Wordmark */}
        <div className="flex flex-col items-center mb-10">
          <div className="flex items-center gap-2 mb-2">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Compass</h1>
            <span className="text-xs font-semibold uppercase tracking-wide bg-gray-800 text-white px-2 py-0.5 rounded-sm">
              Prototype
            </span>
          </div>
          <p className="text-sm text-gray-500">
            Leadership skills diagnostic
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Sign in with your work email
            </label>
            <input
              ref={inputRef}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                if (status === 'not_found') setStatus('idle')
              }}
              placeholder="your.name@organisation.com"
              autoFocus
              autoComplete="email"
              disabled={status === 'loading'}
              className={`w-full text-base bg-white border-2 rounded px-4 py-3 placeholder-gray-400 focus:outline-none transition-colors disabled:opacity-50 ${
                status === 'not_found'
                  ? 'border-red-600 focus:border-red-700'
                  : 'border-gray-400 focus:border-brand-700'
              }`}
            />
          </div>

          {status === 'not_found' && (
            <div className="bg-red-50 border-l-4 border-red-600 px-4 py-3">
              <p className="text-sm text-red-800">
                We couldn't find that email address. Check with your manager.
              </p>
            </div>
          )}

          {status === 'error' && (
            <div className="bg-red-50 border-l-4 border-red-600 px-4 py-3">
              <p className="text-sm text-red-800">
                Something went wrong. Check your connection and try again.
              </p>
              {errorMsg && <p className="text-xs text-gray-500 mt-1 break-all">{errorMsg}</p>}
            </div>
          )}

          <button
            type="submit"
            disabled={!email.trim() || status === 'loading'}
            className="w-full bg-brand-700 hover:bg-brand-800 disabled:bg-gray-300 text-white font-semibold rounded py-3 transition-colors text-base"
          >
            {status === 'loading' ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
