'use client'

import { useState } from 'react'
import { useStore } from '@/lib/store'

export default function ApiKeyGate() {
  const [inputKey, setInputKey] = useState('')
  const [error, setError] = useState('')
  const setApiKey = useStore((s) => s.setApiKey)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = inputKey.trim()
    if (!trimmed) {
      setError('Please enter your API key')
      return
    }
    setApiKey(trimmed)
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
                  fill="white"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span className="text-xl font-semibold text-text tracking-tight">
              Akash Notebooks
            </span>
          </div>
          <p className="text-muted text-sm">
            GPU-accelerated Jupyter notebooks on decentralized compute
          </p>
        </div>

        {/* Card */}
        <div className="bg-surface border border-border rounded-xl p-8">
          <h2 className="text-text text-lg font-semibold mb-1">Get started</h2>
          <p className="text-muted text-sm mb-6">
            Enter your Akash Console API key to continue
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="api-key"
                className="block text-sm font-medium text-text mb-1.5"
              >
                API Key
              </label>
              <input
                id="api-key"
                type="password"
                value={inputKey}
                onChange={(e) => {
                  setInputKey(e.target.value)
                  setError('')
                }}
                placeholder="ak_••••••••••••••••"
                className="w-full bg-bg border border-border rounded-md px-3 py-2.5 text-text placeholder-muted focus:outline-none focus:border-accent transition-colors duration-150 text-sm font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              {error && <p className="mt-1.5 text-accent text-xs">{error}</p>}
            </div>

            <button
              type="submit"
              className="w-full bg-accent hover:bg-red-500 text-white font-medium py-2.5 px-4 rounded-md transition-colors duration-150 text-sm"
            >
              Get Started
            </button>
          </form>

          <p className="mt-4 text-xs text-muted text-center">
            Your key is stored locally and never sent to our servers
          </p>
        </div>

        {/* Footer links */}
        <div className="mt-6 text-center">
          <a
            href="https://console.akash.network"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted hover:text-text transition-colors"
          >
            Get an API key from Akash Console →
          </a>
        </div>
      </div>
    </div>
  )
}
