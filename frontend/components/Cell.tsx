'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { Play, Trash2, Loader2, ArrowUp, ArrowDown, Square } from 'lucide-react'
import type { OnMount } from '@monaco-editor/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import type { NotebookCell } from '@/lib/types'
// import { registerAIAutocomplete } from '@/lib/autocomplete'
import CellOutput from './CellOutput'

// Dynamically import Monaco to avoid SSR issues
const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false })

interface Props {
  cell: NotebookCell
  onRun: (cellId: string) => void
  onInterrupt: (cellId: string) => void
  onUpdate: (cellId: string, source: string) => void
  onDelete: (cellId: string) => void
  onMoveUp: (cellId: string) => void
  onMoveDown: (cellId: string) => void
  isRunning: boolean
  sessionReady: boolean
  isFirst: boolean
  isLast: boolean
  execTime?: number    // ms taken by last completed run
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`
  const m = Math.floor(ms / 60_000)
  const s = ((ms % 60_000) / 1000).toFixed(1)
  return `${m}m ${s}s`
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
  onInterrupt,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  isRunning,
  sessionReady,
  isFirst,
  isLast,
  execTime,
}: Props) {
  const height = useMemo(() => editorHeight(cell.source), [cell.source])

  const [isEditing, setIsEditing] = useState(cell.type === 'markdown' ? !cell.source.trim() : true)

  // Keep a stable ref so the Monaco onMount closure never goes stale.
  const runRef = useRef<() => void>(() => { })
  runRef.current = () => {
    if (cell.type === 'markdown') {
      setIsEditing((prev) => !prev)
    } else if (sessionReady && !isRunning) {
      onRun(cell.id)
    }
  }

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      onUpdate(cell.id, value || '')
    },
    [cell.id, onUpdate]
  )

  const cellTypeRef = useRef(cell.type)
  cellTypeRef.current = cell.type

  const setIsEditingRef = useRef(setIsEditing)
  setIsEditingRef.current = setIsEditing

  // Register Ctrl+Enter (Cmd+Enter on Mac) inside Monaco so it fires even
  // when the editor is focused and would otherwise swallow the key event.
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    // Register global AI autocomplete provider (only registers once internally)
    // registerAIAutocomplete(monaco)

    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
      () => runRef.current()
    )

    // Auto-render markdown on blur
    editor.onDidBlurEditorText(() => {
      if (cellTypeRef.current === 'markdown') {
        setIsEditingRef.current(false)
      }
    })
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        runRef.current()
      }
    },
    []
  )

  return (
    <div
      className="group relative border border-border rounded-lg overflow-hidden bg-surface hover:border-border/80 transition-colors"
      onKeyDown={handleKeyDown}
    >
      {/* Cell header bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-bg/40 border-b border-border">
        {/* Run / Stop button */}
        {cell.type === 'code' && (
          isRunning ? (
            <button
              onClick={() => onInterrupt(cell.id)}
              title="Interrupt execution (send SIGINT)"
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 transition-colors"
            >
              <Loader2 className="w-3 h-3 animate-spin" />
              <Square className="w-2.5 h-2.5" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              onClick={() => runRef.current()}
              disabled={!sessionReady}
              title={sessionReady ? 'Run cell (Ctrl+Enter)' : 'Connect to a kernel first'}
              className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-accent/10 hover:bg-accent/20 text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Play className="w-3 h-3" />
              <span>Run</span>
            </button>
          )
        )}

        {/* Execution count */}
        {cell.type === 'code' && (
          <span className="text-xs text-muted font-mono min-w-[2rem]">
            [{cell.execution_count !== null ? cell.execution_count : ' '}]
          </span>
        )}

        {/* Execution time — shown after completion */}
        {!isRunning && execTime !== undefined ? (
          <span className="text-xs font-mono text-muted/60 tabular-nums" title="Last execution time">
            {formatDuration(execTime)}
          </span>
        ) : null}

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

      {/* Cell Content */}
      {cell.type === 'markdown' && !isEditing ? (
        <div
          className="prose prose-invert max-w-none px-4 py-3 cursor-text min-h-[40px]"
          onDoubleClick={() => setIsEditing(true)}
          title="Double-click to edit"
        >
          {cell.source.trim() ? (
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
              {cell.source}
            </ReactMarkdown>
          ) : (
            <span className="text-muted italic">Double-click to add markdown</span>
          )}
        </div>
      ) : (
        <div style={{ height: `${height}px` }}>
          <MonacoEditor
            height={`${height}px`}
            defaultLanguage={cell.type === 'markdown' ? 'markdown' : 'python'}
            value={cell.source}
            onChange={handleEditorChange}
            onMount={handleEditorMount}
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
              wordWrap: 'on',
            }}
          />
        </div>
      )}

      {/* Cell Outputs */}
      {cell.outputs && cell.outputs.length > 0 && (
        <CellOutput outputs={cell.outputs} />
      )}
    </div>
  )
}
