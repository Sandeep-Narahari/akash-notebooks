'use client'

import { useEffect, useRef } from 'react'
import { X, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import { useStore } from '@/lib/store'

interface Props {
  onClose: () => void
  isReady: boolean
  isError: boolean
  errorMessage?: string | null
  currentStep?: number
}

const STEPS = [
  'Creating deployment',
  'Waiting for bids',
  'Accepting bid',
  'Starting kernel',
  'Ready',
]

export default function DeploymentProgress({ onClose, isReady, isError, errorMessage, currentStep: stepProp }: Props) {
  const logs = useStore((s) => s.deploymentLogs)
  const logsEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const currentStep = isReady ? 4 : isError ? -1 : (stepProp ?? 0)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end p-4 pt-16 pointer-events-none">
      <div
        className="w-full max-w-sm bg-surface border border-border rounded-xl shadow-2xl pointer-events-auto slide-in-right overflow-hidden"
        style={{ maxHeight: 'calc(100vh - 5rem)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            {isReady ? (
              <CheckCircle className="w-4 h-4 text-green-500" />
            ) : isError ? (
              <AlertCircle className="w-4 h-4 text-accent" />
            ) : (
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
            )}
            <span className="text-sm font-medium text-text">
              {isReady
                ? 'Deployed to Akash Network'
                : isError
                ? 'Deployment failed'
                : 'Deploying to Akash Network'}
            </span>
          </div>
          {(isReady || isError) && (
            <button
              onClick={onClose}
              className="text-muted hover:text-text transition-colors p-0.5"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Progress steps */}
        {!isError && (
          <div className="px-4 py-3 border-b border-border">
            <div className="space-y-2">
              {STEPS.map((step, i) => {
                const done = i < currentStep || (isReady && i === 4)
                const active = i === currentStep && !isReady

                return (
                  <div key={step} className="flex items-center gap-2.5">
                    <div
                      className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                        done
                          ? 'bg-green-500'
                          : active
                          ? 'bg-blue-500 pulse-dot'
                          : 'bg-border'
                      }`}
                    >
                      {done && (
                        <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                      )}
                    </div>
                    <span
                      className={`text-xs ${
                        done
                          ? 'text-green-500'
                          : active
                          ? 'text-text'
                          : 'text-muted'
                      }`}
                    >
                      {step}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Error message */}
        {isError && errorMessage && (
          <div className="px-4 py-3 border-b border-border">
            <p className="text-xs text-accent font-mono break-all">{errorMessage}</p>
          </div>
        )}

        {/* Logs */}
        <div className="px-4 py-3 overflow-y-auto" style={{ maxHeight: '200px' }}>
          <p className="text-xs text-muted mb-2 font-mono">Deployment logs</p>
          <div className="space-y-0.5">
            {logs.map((log, i) => (
              <div key={i} className="flex gap-2 fade-in">
                <span className="text-muted text-xs font-mono flex-shrink-0">
                  {new Date().toLocaleTimeString('en-US', {
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <span className="text-xs font-mono text-text/80 break-all">{log}</span>
              </div>
            ))}
            {logs.length === 0 && (
              <p className="text-xs text-muted font-mono">Initializing...</p>
            )}
            <div ref={logsEndRef} />
          </div>
        </div>
      </div>
    </div>
  )
}
