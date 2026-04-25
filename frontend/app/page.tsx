'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, LogOut, Trash2, Cpu, Zap, Clock } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import ApiKeyGate from '@/components/ApiKeyGate'
import type { Notebook } from '@/lib/types'

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

function resourceBadge(notebook: Notebook): React.ReactNode {
  const r = notebook.resources
  if (r.gpu > 0) {
    return (
      <span className="flex items-center gap-1 text-xs bg-purple/10 border border-purple/20 text-purple rounded px-2 py-0.5">
        <Zap className="w-2.5 h-2.5" />
        {r.gpu}× {r.gpu_model?.toUpperCase() || 'GPU'}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 text-xs bg-surface border border-border text-muted rounded px-2 py-0.5">
      <Cpu className="w-2.5 h-2.5" />
      {r.cpu} vCPU · {r.memory}
    </span>
  )
}

export default function HomePage() {
  const router = useRouter()
  const { apiKey, notebooks, setNotebooks, clearApiKey, activeSessions, setActiveSessions } = useStore()
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { setMounted(true) }, [])

  const loadNotebooks = useCallback(async () => {
    try {
      setLoading(true)
      const [data, sessions] = await Promise.all([
        api.notebooks.list(),
        api.sessions.list().catch(() => []),
      ])
      setNotebooks(data)
      setActiveSessions(sessions)
    } catch (err) {
      console.error('Failed to load notebooks:', err)
      setError('Failed to load notebooks. Is the backend running?')
    } finally {
      setLoading(false)
    }
  }, [setNotebooks, setActiveSessions])

  useEffect(() => {
    if (apiKey) {
      loadNotebooks()
    }
  }, [apiKey, loadNotebooks])

  const handleCreateNotebook = useCallback(async () => {
    setCreating(true)
    setError(null)
    try {
      const notebook = await api.notebooks.create('Untitled Notebook', {
        cpu: 2,
        memory: '4Gi',
        storage: '20Gi',
        gpu: 0,
        gpu_model: null,
      })
      router.push(`/notebook/${notebook.id}`)
    } catch (err) {
      console.error('Failed to create notebook:', err)
      setError('Failed to create notebook')
      setCreating(false)
    }
  }, [router])

  const handleDeleteNotebook = useCallback(
    async (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      e.preventDefault()
      if (!confirm('Delete this notebook?')) return
      setDeletingId(id)
      try {
        await api.notebooks.delete(id)
        setNotebooks(notebooks.filter((n) => n.id !== id))
      } catch (err) {
        console.error('Failed to delete notebook:', err)
        setError('Failed to delete notebook')
      } finally {
        setDeletingId(null)
      }
    },
    [notebooks, setNotebooks]
  )

  if (!mounted) return null

  if (!apiKey) {
    return <ApiKeyGate />
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                <path
                  d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
                  fill="white"
                  stroke="white"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <span className="font-semibold text-text tracking-tight">Akash Notebooks</span>
          </div>

          <button
            onClick={clearApiKey}
            className="flex items-center gap-1.5 text-xs text-muted hover:text-text transition-colors px-2 py-1 rounded hover:bg-border"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Logout</span>
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-text">Notebooks</h1>
            <p className="text-sm text-muted mt-0.5">
              Run Python notebooks on Akash Network compute
            </p>
          </div>

          <button
            onClick={handleCreateNotebook}
            disabled={creating}
            className="flex items-center gap-2 bg-accent hover:bg-red-500 text-white font-medium px-4 py-2 rounded-md transition-colors text-sm disabled:opacity-60"
          >
            <Plus className="w-4 h-4" />
            <span>{creating ? 'Creating...' : 'New Notebook'}</span>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 px-4 py-3 bg-red-950/30 border border-red-900/40 rounded-lg text-sm text-accent">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="bg-surface border border-border rounded-xl p-5 h-32 animate-pulse"
              />
            ))}
          </div>
        ) : notebooks.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-12 h-12 rounded-xl bg-surface border border-border flex items-center justify-center mb-4">
              <svg
                className="w-6 h-6 text-muted"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h3 className="text-text font-medium mb-1">No notebooks yet</h3>
            <p className="text-muted text-sm mb-4">
              Create your first notebook to get started
            </p>
            <button
              onClick={handleCreateNotebook}
              disabled={creating}
              className="flex items-center gap-2 bg-accent hover:bg-red-500 text-white font-medium px-4 py-2 rounded-md transition-colors text-sm"
            >
              <Plus className="w-4 h-4" />
              <span>New Notebook</span>
            </button>
          </div>
        ) : (
          /* Notebook grid */
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {notebooks.map((notebook) => {
              const isLive = activeSessions.some(
                (s) => s.notebook_id === notebook.id && s.status === 'ready'
              )
              return (
                <div
                  key={notebook.id}
                  onClick={() => router.push(`/notebook/${notebook.id}`)}
                  className="group bg-surface border border-border rounded-xl p-5 cursor-pointer hover:border-accent/30 hover:bg-surface/80 transition-all relative"
                >
                  {/* Delete button */}
                  <button
                    onClick={(e) => handleDeleteNotebook(e, notebook.id)}
                    disabled={deletingId === notebook.id}
                    className="absolute top-3 right-3 p-1.5 rounded-md text-muted hover:text-accent hover:bg-border opacity-0 group-hover:opacity-100 transition-all"
                    title="Delete notebook"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  {/* Notebook icon */}
                  <div className="w-8 h-8 rounded-lg bg-bg border border-border flex items-center justify-center mb-3">
                    <svg
                      className="w-4 h-4 text-muted"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                  </div>

                  {/* Name */}
                  <h3 className="font-medium text-text text-sm mb-1 truncate pr-6">
                    {notebook.name}
                  </h3>

                  {/* Meta */}
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2">
                      {resourceBadge(notebook)}
                      {isLive && (
                        <span className="flex items-center gap-1 text-xs text-green-400 bg-green-950/30 border border-green-900/40 rounded px-2 py-0.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />
                          Live
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted">
                      <Clock className="w-3 h-3" />
                      <span>{formatDate(notebook.updated_at)}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}
