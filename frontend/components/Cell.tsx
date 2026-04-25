'use client'

import { useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { Play, Trash2, Plus, Loader2, ArrowUp, ArrowDown } from 'lucide-react'
import type { NotebookCell } from '@/lib/types'
import CellOutput from './CellOutput'

// Dynamically import Monaco to avoid SSR issues
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

interface Props {
  cell: NotebookCell
  onRun: (cellId: string) => void
  onUpdate: (cellId: string, source: string) => void
  onDelete: (cellId: string) => void
  onAddAfter: (cellId: string) => void
  onMoveUp: (cellId: string) => void
  onMoveDown: (cellId: string) => void
  isRunning: boolean
  sessionReady: boolean
  isFirst: boolean
  isLast: boolean
}

function editorHeight(source: string): number {
  const lines = source.split('\n').length
  const lineHeight = 20
  const padding = 24
  const computed = lines * lineHeight + padding
  return Math.min(Math.max(computed, 80), 500)
}

export default function Cell({
  cell,
  onRun,
  onUpdate,
  onDelete,
  onAddAfter,
  onMoveUp,
  onMoveDown,
  isRunning,
  sessionReady,
  isFirst,
  isLast,
}: Props) {
  const height = useMemo(() => editorHeight(cell.source), [cell.source])

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      onUpdate(cell.id, value || '')
    },
    [cell.id, onUpdate]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        if (sessionReady && !isRunning) {
          onRun(cell.id)
        }
      }
    },
    [cell.id, onRun, sessionReady, isRunning]
  )

  return (
    <div
      className="group relative border border-border rounded-lg overflow-hidden bg-surface hover:border-border/80 transition-colors"
      onKeyDown={handleKeyDown}
    >
      {/* Cell header bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-bg/40 border-b border-border">
        {/* Run button */}
        <button
          onClick={() => onRun(cell.id)}
          disabled={!sessionReady || isRunning}
          title={sessionReady ? 'Run cell (Ctrl+Enter)' : 'Connect to a kernel first'}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-accent/10 hover:bg-accent/20 text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {isRunning ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Play className="w-3 h-3" />
          )}
          <span>{isRunning ? 'Running' : 'Run'}</span>
        </button>

        {/* Execution count */}
        <span className="text-xs text-muted font-mono min-w-[2rem]">
          [{cell.execution_count !== null ? cell.execution_count : ' '}]
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Cell actions - shown on hover */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onMoveUp(cell.id)}
            disabled={isFirst}
            title="Move cell up"
            className="p-1 rounded text-muted hover:text-text hover:bg-border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowUp className="w-3 h-3" />
          </button>
          <button
            onClick={() => onMoveDown(cell.id)}
            disabled={isLast}
            title="Move cell down"
            className="p-1 rounded text-muted hover:text-text hover:bg-border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ArrowDown className="w-3 h-3" />
          </button>
          <button
            onClick={() => onDelete(cell.id)}
            title="Delete cell"
            className="p-1 rounded text-muted hover:text-accent hover:bg-border transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Monaco Editor */}
      <div style={{ height: `${height}px` }}>
        <MonacoEditor
          height={`${height}px`}
          defaultLanguage="python"
          value={cell.source}
          onChange={handleEditorChange}
          theme="vs-dark"
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            fontFamily: "'JetBrains Mono', monospace",
            automaticLayout: true,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            padding: { top: 12, bottom: 12 },
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            renderLineHighlight: 'gutter',
            scrollbar: {
              verticalScrollbarSize: 4,
              horizontalScrollbarSize: 4,
            },
            folding: false,
            glyphMargin: false,
            lineDecorationsWidth: 4,
            lineNumbersMinChars: 3,
            contextmenu: false,
            wordWrap: 'off',
          }}
        />
      </div>

      {/* Cell Outputs */}
      {cell.outputs && cell.outputs.length > 0 && (
        <CellOutput outputs={cell.outputs} />
      )}

      {/* Add cell below button */}
      <div className="flex justify-center py-1 border-t border-border/50 opacity-0 group-hover:opacity-100 transition-opacity bg-bg/20">
        <button
          onClick={() => onAddAfter(cell.id)}
          className="flex items-center gap-1 text-xs text-muted hover:text-text px-2 py-0.5 rounded transition-colors"
        >
          <Plus className="w-3 h-3" />
          <span>Add cell</span>
        </button>
      </div>
    </div>
  )
}
