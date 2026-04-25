'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Power, PowerOff, Play, Save, ChevronLeft, RotateCcw } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { kernel } from '@/lib/kernel'
import ResourcePicker from './ResourcePicker'
import KernelStatus from './KernelStatus'
import DeploymentProgress from './DeploymentProgress'
import type { Resources, ProgressEvent } from '@/lib/types'

interface Props {
  onRunAll: () => void
  isSaving: boolean
  resources: Resources
  onResourceChange: (r: Resources) => void
}

export default function Toolbar({ onRunAll, isSaving, resources, onResourceChange }: Props) {
  const router = useRouter()
  const {
    currentNotebook,
    setCurrentNotebook,
    session,
    setSession,
    kernelStatus,
    setKernelStatus,
    addLog,
    clearLogs,
    activeSessions,
    setActiveSessions,
  } = useStore()

  const [isConnecting, setIsConnecting] = useState(false)
  const [isRestarting, setIsRestarting] = useState(false)
  const [showProgress, setShowProgress] = useState(false)
  const [progressReady, setProgressReady] = useState(false)
  const [progressError, setProgressError] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [currentStep, setCurrentStep] = useState(0)
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameInput, setNameInput] = useState(currentNotebook?.name || '')
  const nameInputRef = useRef<HTMLInputElement>(null)
  const esRef = useRef<EventSource | null>(null)

  // Auto-resume: if there's an active session for this notebook, reconnect to it.
  useEffect(() => {
    if (!currentNotebook || session || isConnecting) return
    const existing = activeSessions.find(
      (s) => s.notebook_id === currentNotebook.id && s.status === 'ready' && s.kernel_id
    )
    if (!existing) return

    setIsConnecting(true)
    setKernelStatus('connecting')
    addLog('Resuming existing session...')

    kernel.connect(existing.id, existing.kernel_id!)
      .then(() => {
        kernel.setStatusCallback((ks) => setKernelStatus(ks))
        return api.sessions.get(existing.id)
      })
      .then((sessionData) => {
        setSession(sessionData)
        setKernelStatus('idle')
        addLog('Kernel reconnected to existing session')
      })
      .catch((err) => {
        console.error('Resume failed:', err)
        addLog(`Resume failed: ${err}`)
        setKernelStatus(null)
      })
      .finally(() => {
        setIsConnecting(false)
        setActiveSessions([])
      })
  }, [currentNotebook?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleConnect = useCallback(async () => {
    if (!currentNotebook) return
    setIsConnecting(true)
    setProgressReady(false)
    setProgressError(false)
    setErrorMessage(null)
    setCurrentStep(0)
    clearLogs()
    setShowProgress(true)
    setKernelStatus('deploying')
    addLog('Initiating deployment...')

    try {
      const { session_id } = await api.sessions.create(resources, currentNotebook.id)
      addLog(`Session created: ${session_id}`)

      const es = api.sessions.streamProgress(
        session_id,
        async (event: ProgressEvent) => {
          addLog(event.message)

          if (event.step !== undefined) {
            setCurrentStep(event.step)
          }

          if (event.status === 'connecting') {
            setKernelStatus('connecting')
          }

          if ((event.type === 'ready' || event.status === 'ready') && event.kernel_id) {
            setProgressReady(true)
            setKernelStatus('connecting')

            try {
              await kernel.connect(session_id, event.kernel_id)
              kernel.setStatusCallback((ks) => setKernelStatus(ks))

              const sessionData = await api.sessions.get(session_id)
              setSession(sessionData)
              setKernelStatus('idle')
              addLog('Kernel connected and ready')
            } catch (connErr) {
              console.error('Kernel connect error:', connErr)
              setKernelStatus('error')
              addLog(`Kernel connection failed: ${connErr}`)
            }
            setIsConnecting(false)
          }

          if (event.type === 'error') {
            setProgressError(true)
            setErrorMessage(event.message)
            setKernelStatus('error')
            setIsConnecting(false)
          }
        },
        () => {
          if (!progressReady) {
            setProgressError(true)
            setErrorMessage('Connection to deployment stream lost')
            setKernelStatus('error')
            setIsConnecting(false)
          }
        }
      )
      esRef.current = es
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start deployment'
      addLog(`Error: ${msg}`)
      setProgressError(true)
      setErrorMessage(msg)
      setKernelStatus('error')
      setIsConnecting(false)
    }
  }, [currentNotebook, resources, addLog, clearLogs, setKernelStatus, setSession, progressReady])

  const handleDisconnect = useCallback(async () => {
    if (!session) return
    try {
      await api.sessions.delete(session.id)
    } catch {
      // ignore errors on disconnect
    }
    kernel.disconnect()
    setSession(null)
    setKernelStatus(null)
    esRef.current?.close()
    esRef.current = null
  }, [session, setSession, setKernelStatus])

  const handleRestart = useCallback(async () => {
    if (!session || isRestarting) return
    setIsRestarting(true)
    setKernelStatus('connecting')
    addLog('Restarting kernel...')
    try {
      kernel.disconnect()
      const { kernel_id } = await api.sessions.restart(session.id)
      await kernel.connect(session.id, kernel_id)
      kernel.setStatusCallback((ks) => setKernelStatus(ks))
      setKernelStatus('idle')
      addLog('Kernel restarted')
    } catch (err) {
      addLog(`Restart failed: ${err}`)
      setKernelStatus('error')
    } finally {
      setIsRestarting(false)
    }
  }, [session, isRestarting, addLog, setKernelStatus])

  const handleNameBlur = useCallback(async () => {
    setIsEditingName(false)
    if (!currentNotebook || nameInput.trim() === currentNotebook.name) return
    const updated = await api.notebooks.update(currentNotebook.id, { name: nameInput.trim() })
    setCurrentNotebook(updated)
  }, [currentNotebook, nameInput, setCurrentNotebook])

  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        nameInputRef.current?.blur()
      }
      if (e.key === 'Escape') {
        setNameInput(currentNotebook?.name || '')
        setIsEditingName(false)
      }
    },
    [currentNotebook]
  )

  const isConnected = session !== null && kernelStatus !== 'error'

  return (
    <>
      <div className="flex items-center gap-3 px-4 py-2.5 bg-surface border-b border-border sticky top-0 z-10">
        {/* Back button */}
        <button
          onClick={() => router.push('/')}
          className="p-1 text-muted hover:text-text transition-colors rounded"
          title="Back to notebooks"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="w-px h-4 bg-border" />

        {/* Notebook name */}
        <div className="flex-1 min-w-0">
          {isEditingName ? (
            <input
              ref={nameInputRef}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={handleNameBlur}
              onKeyDown={handleNameKeyDown}
              className="bg-bg border border-accent rounded px-2 py-0.5 text-sm font-medium text-text focus:outline-none w-full max-w-xs"
              autoFocus
            />
          ) : (
            <button
              onClick={() => {
                setNameInput(currentNotebook?.name || '')
                setIsEditingName(true)
                setTimeout(() => nameInputRef.current?.focus(), 50)
              }}
              className="text-sm font-medium text-text hover:text-text/80 transition-colors truncate max-w-xs"
              title="Click to rename"
            >
              {currentNotebook?.name || 'Untitled Notebook'}
            </button>
          )}
        </div>

        {/* Center controls */}
        <div className="flex items-center gap-2">
          <ResourcePicker
            value={resources}
            onChange={onResourceChange}
            disabled={isConnected || isConnecting}
          />

          {isConnected ? (
            <>
              <button
                onClick={handleRestart}
                disabled={isRestarting || kernelStatus === 'busy'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-surface hover:bg-border border border-border text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                title="Restart kernel — clears all variables and re-imports"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isRestarting ? 'animate-spin' : ''}`} />
                <span>{isRestarting ? 'Restarting...' : 'Restart'}</span>
              </button>
              <button
                onClick={handleDisconnect}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-border hover:bg-red-950/40 border border-border hover:border-red-900/50 text-text hover:text-accent transition-colors"
              >
                <PowerOff className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            </>
          ) : (
            <button
              onClick={handleConnect}
              disabled={isConnecting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-accent hover:bg-red-500 text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Power className="w-3.5 h-3.5" />
              <span>{isConnecting ? 'Deploying...' : 'Connect'}</span>
            </button>
          )}

          <KernelStatus status={kernelStatus} />
        </div>

        <div className="w-px h-4 bg-border" />

        {/* Right controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={onRunAll}
            disabled={!isConnected}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-surface hover:bg-border border border-border text-text transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Run all cells"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Run All</span>
          </button>

          <div className="flex items-center gap-1 text-xs text-muted">
            {isSaving ? (
              <>
                <Save className="w-3 h-3 animate-pulse" />
                <span>Saving</span>
              </>
            ) : (
              <>
                <Save className="w-3 h-3" />
                <span>Saved</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Deployment Progress Panel */}
      {showProgress && (
        <DeploymentProgress
          onClose={() => setShowProgress(false)}
          isReady={progressReady}
          isError={progressError}
          errorMessage={errorMessage}
          currentStep={currentStep}
        />
      )}
    </>
  )
}
