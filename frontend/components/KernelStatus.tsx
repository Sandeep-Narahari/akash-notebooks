'use client'

import type { KernelStatus as KernelStatusType } from '@/lib/types'

interface Props {
  status: KernelStatusType
}

export default function KernelStatus({ status }: Props) {
  if (status === 'idle') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
        <span>Kernel idle</span>
      </div>
    )
  }

  if (status === 'busy') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0 pulse-dot" />
        <span>Kernel busy</span>
      </div>
    )
  }

  if (status === 'deploying') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0 pulse-dot" />
        <span>Deploying...</span>
      </div>
    )
  }

  if (status === 'connecting') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0 pulse-dot" />
        <span>Connecting...</span>
      </div>
    )
  }

  if (status === 'reconnecting') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span className="w-2 h-2 rounded-full bg-yellow-400 flex-shrink-0 pulse-dot" />
        <span>Reconnecting...</span>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <span className="w-2 h-2 rounded-full bg-accent flex-shrink-0" />
        <span>Error</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted">
      <span className="w-2 h-2 rounded-full bg-muted flex-shrink-0" />
      <span>Not connected</span>
    </div>
  )
}
