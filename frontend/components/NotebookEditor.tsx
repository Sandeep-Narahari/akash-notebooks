'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus, Code2, Type } from 'lucide-react'
import { useStore } from '@/lib/store'
import { api } from '@/lib/api'
import { kernel } from '@/lib/kernel'
import Cell from './Cell'
import Toolbar from './Toolbar'
import type { CellOutput, Resources } from '@/lib/types'

const DEFAULT_RESOURCES: Resources = {
  cpu: 2,
  memory: '4Gi',
  storage: '20Gi',
  gpu: 0,
  gpu_model: null,
}

function AddCellDivider({ onAdd, visible = false }: { onAdd: (type: 'code' | 'markdown') => void, visible?: boolean }) {
  return (
    <div className={`flex items-center w-full my-[-12px] z-10 relative group/divider transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}>
      <div className="flex-grow border-t border-border" />
      <div className="flex gap-2 mx-4">
        <button
          onClick={() => onAdd('code')}
          className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted hover:text-text border border-border rounded bg-bg hover:bg-surface transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Code</span>
        </button>
        <button
          onClick={() => onAdd('markdown')}
          className="flex items-center gap-1.5 px-3 py-1 text-xs text-muted hover:text-text border border-border rounded bg-bg hover:bg-surface transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Markdown</span>
        </button>
      </div>
      <div className="flex-grow border-t border-border" />
    </div>
  )
}

export default function NotebookEditor() {
  const {
    currentNotebook,
    setCurrentNotebook,
    updateCell,
    addCell,
    deleteCell,
    moveCell,
    session,
    kernelStatus,
  } = useStore()

  const [runningCells, setRunningCells] = useState<Set<string>>(new Set())
  const [executionCounter, setExecutionCounter] = useState(1)
  const [isSaving, setIsSaving] = useState(false)
  const [cellExecTimes, setCellExecTimes] = useState<Map<string, number>>(new Map())
  const [resources, setResources] = useState<Resources>(
    currentNotebook?.resources || DEFAULT_RESOURCES
  )
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<Element | null>(null)
  const pageAutoScrollRef = useRef(true)

  // Sync resources from notebook
  useEffect(() => {
    if (currentNotebook?.resources) {
      setResources(currentNotebook.resources)
    }
  }, [currentNotebook?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Find the page scroll container and track user scroll intent.
  useEffect(() => {
    const el = bottomRef.current?.closest('.overflow-y-auto') ?? null
    scrollContainerRef.current = el
    if (!el) return
    const onScroll = () => {
      const dist = el.scrollHeight - el.scrollTop - el.clientHeight
      pageAutoScrollRef.current = dist < 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Page-level auto-scroll: stick to bottom while a cell is running.
  useEffect(() => {
    if (runningCells.size === 0 || !pageAutoScrollRef.current) return
    const el = scrollContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [currentNotebook, runningCells])

  // Auto-save on notebook change (debounced)
  useEffect(() => {
    if (!currentNotebook) return

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
    }

    saveTimerRef.current = setTimeout(async () => {
      try {
        setIsSaving(true)
        await api.notebooks.update(currentNotebook.id, {
          name: currentNotebook.name,
          cells: currentNotebook.cells,
          resources,
        })
      } catch (err) {
        console.error('Auto-save failed:', err)
      } finally {
        setIsSaving(false)
      }
    }, 1000)

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
      }
    }
  }, [currentNotebook, resources]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRunCell = useCallback(
    async (cellId: string) => {
      if (!session || kernelStatus === 'error' || !kernel.isConnected()) return
      if (runningCells.has(cellId)) return

      const cell = currentNotebook?.cells.find((c) => c.id === cellId)
      if (!cell) return

      updateCell(cellId, { outputs: [] })
      setRunningCells((prev) => new Set(prev).add(cellId))

      const accumulatedOutputs: CellOutput[] = []
      let rafId: number | null = null
      let elapsedMs: number | undefined

      try {
        // Batch streaming output via RAF — coalesces rapid chunks into one render.
        // execute() resolves with elapsedMs measured from ws.send → execute_reply.
        elapsedMs = await kernel.execute(cell.source, (output) => {
          accumulatedOutputs.push(output)
          if (rafId !== null) cancelAnimationFrame(rafId)
          rafId = requestAnimationFrame(() => {
            rafId = null
            updateCell(cellId, { outputs: [...accumulatedOutputs] })
          })
        })

        // Cancel any pending streaming RAF — we're about to do the final write.
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
          rafId = null
        }

        // Single synchronous update with both final outputs and execution_count.
        const count = executionCounter
        setExecutionCounter((n) => n + 1)
        updateCell(cellId, {
          outputs: [...accumulatedOutputs],
          execution_count: count,
        })
      } catch (err) {
        if (rafId !== null) {
          cancelAnimationFrame(rafId)
        }
        const errOutput: CellOutput = {
          output_type: 'error',
          ename: 'ExecutionError',
          evalue: err instanceof Error ? err.message : String(err),
          traceback: [],
        }
        updateCell(cellId, { outputs: [...accumulatedOutputs, errOutput] })
      } finally {
        if (elapsedMs !== undefined) {
          setCellExecTimes((prev) => new Map(prev).set(cellId, elapsedMs!))
        }
        setRunningCells((prev) => {
          const next = new Set(prev)
          next.delete(cellId)
          return next
        })
      }
    },
    [session, kernelStatus, runningCells, currentNotebook, updateCell, executionCounter]
  )

  const handleRunAll = useCallback(async () => {
    if (!currentNotebook || !session) return
    for (const cell of currentNotebook.cells) {
      await handleRunCell(cell.id)
    }
  }, [currentNotebook, session, handleRunCell])

  const handleUpdateCell = useCallback(
    (cellId: string, source: string) => {
      updateCell(cellId, { source })
    },
    [updateCell]
  )

  const handleInterruptCell = useCallback(async () => {
    if (!session) return
    try {
      await api.sessions.interrupt(session.id)
    } catch (err) {
      console.error('Interrupt failed:', err)
    }
  }, [session])

  const handleResourceChange = useCallback(
    (r: Resources) => {
      setResources(r)
      if (currentNotebook) {
        setCurrentNotebook({ ...currentNotebook, resources: r })
      }
    },
    [currentNotebook, setCurrentNotebook]
  )

  if (!currentNotebook) {
    return (
      <div className="flex items-center justify-center h-64 text-muted text-sm">
        No notebook loaded
      </div>
    )
  }

  const sessionReady = session !== null && (kernelStatus === 'idle' || kernelStatus === 'busy')

  return (
    <div className="flex flex-col min-h-screen bg-bg">
      <Toolbar
        onRunAll={handleRunAll}
        isSaving={isSaving}
        resources={resources}
        onResourceChange={handleResourceChange}
      />

      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-8 space-y-6">
        {currentNotebook.cells.map((cell, index) => (
          <div key={cell.id} className="flex flex-col">
            <Cell
              cell={cell}
              onRun={handleRunCell}
              onInterrupt={handleInterruptCell}
              onUpdate={handleUpdateCell}
              onDelete={deleteCell}
              onMoveUp={(id) => moveCell(id, 'up')}
              onMoveDown={(id) => moveCell(id, 'down')}
              isRunning={runningCells.has(cell.id)}
              sessionReady={sessionReady}
              isFirst={index === 0}
              isLast={index === currentNotebook.cells.length - 1}
              execTime={cellExecTimes.get(cell.id)}
            />
            
            {/* Inline add cell divider */}
            <AddCellDivider onAdd={(type) => addCell(cell.id, type)} />
          </div>
        ))}

        {/* Add cell at bottom (always visible) */}
        <div className="pt-2">
          <AddCellDivider onAdd={(type) => addCell(undefined, type)} visible={true} />
        </div>

        {/* Bottom padding + scroll sentinel */}
        <div ref={bottomRef} className="h-16" />
      </div>
    </div>
  )
}
