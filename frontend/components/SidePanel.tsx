'use client'

import { useState } from 'react'
import { FileUp, KeyRound, Terminal, ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '@/lib/store'
import FilesPanel from './FilesPanel'
import SecretsPanel from './SecretsPanel'
import ShellPanel from './ShellPanel'

type Tab = 'files' | 'secrets' | 'shell'

const TABS: { id: Tab; icon: React.ElementType; label: string }[] = [
  { id: 'files',   icon: FileUp,   label: 'Files'   },
  { id: 'secrets', icon: KeyRound, label: 'Secrets' },
  { id: 'shell',   icon: Terminal, label: 'Shell'   },
]

export default function SidePanel() {
  const { session } = useStore()
  const [collapsed, setCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('files')

  const sessionId = session?.id ?? null

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1 py-2 w-12 bg-surface border-r border-border shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="p-2 text-muted hover:text-text rounded transition-colors"
          title="Expand panel"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        {TABS.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => { setActiveTab(id); setCollapsed(false) }}
            className={`p-2 rounded transition-colors ${activeTab === id ? 'text-text' : 'text-muted hover:text-text'}`}
            title={label}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col w-64 bg-surface border-r border-border shrink-0 h-full">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-border shrink-0">
        <div className="flex gap-0.5">
          {TABS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors ${
                activeTab === id ? 'bg-border text-text' : 'text-muted hover:text-text'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 text-muted hover:text-text rounded transition-colors"
          title="Collapse panel"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'files'   && <FilesPanel sessionId={sessionId} />}
        {activeTab === 'secrets' && <SecretsPanel />}
        {activeTab === 'shell'   && <ShellPanel sessionId={sessionId} />}
      </div>
    </div>
  )
}
