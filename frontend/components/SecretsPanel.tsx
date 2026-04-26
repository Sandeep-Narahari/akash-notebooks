'use client'

import { useState } from 'react'
import { Plus, Trash2, Eye, EyeOff, KeyRound } from 'lucide-react'
import { useStore } from '@/lib/store'

export default function SecretsPanel() {
  const { secrets, addSecret, removeSecret } = useStore()
  const [newKey, setNewKey] = useState('')
  const [newValue, setNewValue] = useState('')
  const [visible, setVisible] = useState<Set<string>>(new Set())

  const handleAdd = () => {
    const key = newKey.trim()
    const value = newValue.trim()
    if (!key || !value) return
    addSecret(key, value)
    setNewKey('')
    setNewValue('')
  }

  const toggleVisible = (key: string) => {
    setVisible((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const entries = Object.entries(secrets)

  return (
    <div className="p-3 space-y-3 overflow-y-auto h-full">
      <div className="text-xs text-muted leading-relaxed">
        Secrets are stored locally and injected as{' '}
        <code className="text-text bg-border px-1 rounded text-[10px]">os.environ</code>{' '}
        on kernel connect.
      </div>

      {/* Existing secrets */}
      <div className="space-y-1.5">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-center gap-1.5 group">
            <KeyRound className="w-3 h-3 text-muted shrink-0" />
            <span className="text-xs text-text font-mono flex-1 truncate">{key}</span>
            <span className="text-xs text-muted font-mono shrink-0">
              {visible.has(key) ? value : '••••••'}
            </span>
            <button
              onClick={() => toggleVisible(key)}
              className="p-0.5 text-muted hover:text-text opacity-0 group-hover:opacity-100 transition-opacity"
            >
              {visible.has(key) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            </button>
            <button
              onClick={() => removeSecret(key)}
              className="p-0.5 text-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
        {entries.length === 0 && (
          <div className="text-xs text-muted italic">No secrets yet</div>
        )}
      </div>

      {/* Add new */}
      <div className="space-y-1.5 pt-2 border-t border-border">
        <input
          type="text"
          placeholder="KEY_NAME"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
          className="w-full px-2 py-1.5 text-xs font-mono bg-bg border border-border rounded focus:outline-none focus:border-muted text-text placeholder-muted"
        />
        <input
          type="password"
          placeholder="value"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          className="w-full px-2 py-1.5 text-xs font-mono bg-bg border border-border rounded focus:outline-none focus:border-muted text-text placeholder-muted"
        />
        <button
          onClick={handleAdd}
          disabled={!newKey.trim() || !newValue.trim()}
          className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs bg-border hover:bg-muted/20 text-text rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Secret</span>
        </button>
      </div>
    </div>
  )
}
