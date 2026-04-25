'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { kernel } from '@/lib/kernel'
import NotebookEditor from '@/components/NotebookEditor'
import ApiKeyGate from '@/components/ApiKeyGate'

export default function NotebookPage() {
  const params = useParams()
  const router = useRouter()
  const id = params.id as string
  const { apiKey, setCurrentNotebook, setActiveSessions } = useStore()
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!apiKey || !id) return
    setLoading(true)

    Promise.all([
      api.notebooks.get(id),
      api.sessions.list().catch(() => []),
    ]).then(([notebook, sessions]) => {
      setCurrentNotebook(notebook)
      setActiveSessions(sessions)
      setLoading(false)
    }).catch((err) => {
      console.error('Failed to load notebook:', err)
      setError('Notebook not found')
      setLoading(false)
    })

    return () => {
      setCurrentNotebook(null)
      kernel.disconnect()
    }
  }, [id, apiKey, setCurrentNotebook, setActiveSessions])

  if (!mounted) return null
  if (!apiKey) return <ApiKeyGate />

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-muted text-sm">Loading notebook...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-4">
        <div className="text-accent text-sm">{error}</div>
        <button
          onClick={() => router.push('/')}
          className="text-sm text-muted hover:text-text transition-colors"
        >
          ← Back to notebooks
        </button>
      </div>
    )
  }

  return <NotebookEditor />
}
