'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
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
  const [resources, setResources] = useState<Resources>(
    currentNotebook?.resources || DEFAULT_RESOURCES
  )
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync resources from notebook
  useEffect(() => {
    if (currentNotebook?.resources) {
      setResources(currentNotebook.resources)
    }
  }, [currentNotebook?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
      if (!session || kernelStatus === 'error') return
      if (runningCells.has(cellId)) return

      const cell = currentNotebook?.cells.find((c) => c.id === cellId)
      if (!cell) return

      // Clear old outputs
      updateCell(cellId, { outputs: [] })
      setRunningCells((prev) => new Set(prev).add(cellId))

      const accumulatedOutputs: CellOutput[] = []

      try {
        // Batch output updates via RAF — prevents a re-render per streaming chunk.
        let rafId: number | null = null
        await kernel.execute(cell.source, (output) => {
          accumulatedOutputs.push(output)
          if (rafId !== null) cancelAnimationFrame(rafId)
          rafId = requestAnimationFrame(() => {
            rafId = null
            updateCell(cellId, { outputs: [...accumulatedOutputs] })
          })
        })
        // Let any pending RAF fire first, then do final update with execution_count.
        if (rafId !== null) {
          await new Promise<void>((r) => requestAnimationFrame(() => r()))
          rafId = null
        }

        const count = executionCounter
        setExecutionCounter((n) => n + 1)
        updateCell(cellId, {
          outputs: [...accumulatedOutputs],
          execution_count: count,
        })
      } catch (err) {
        const errOutput: CellOutput = {
          output_type: 'error',
          ename: 'ExecutionError',
          evalue: err instanceof Error ? err.message : String(err),
          traceback: [],
        }
        updateCell(cellId, {
          outputs: [...accumulatedOutputs, errOutput],
        })
      } finally {
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

  const sessionReady = session !== null && kernelStatus !== 'error' && kernelStatus !== null

  return (
    <div className="flex flex-col min-h-screen bg-bg">
      <Toolbar
        onRunAll={handleRunAll}
        isSaving={isSaving}
        resources={resources}
        onResourceChange={handleResourceChange}
      />

      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-6 space-y-3">
        {currentNotebook.cells.map((cell, index) => (
          <Cell
            key={cell.id}
            cell={cell}
            onRun={handleRunCell}
            onUpdate={handleUpdateCell}
            onDelete={deleteCell}
            onAddAfter={addCell}
            onMoveUp={(id) => moveCell(id, 'up')}
            onMoveDown={(id) => moveCell(id, 'down')}
            isRunning={runningCells.has(cell.id)}
            sessionReady={sessionReady}
            isFirst={index === 0}
            isLast={index === currentNotebook.cells.length - 1}
          />
        ))}

        {/* Add cell at bottom */}
        <div className="flex justify-center pt-2">
          <button
            onClick={() => addCell()}
            className="flex items-center gap-2 text-sm text-muted hover:text-text border border-dashed border-border hover:border-muted rounded-lg px-4 py-2.5 transition-colors w-full justify-center"
          >
            <Plus className="w-4 h-4" />
            <span>Add cell</span>
          </button>
        </div>

        {/* Bottom padding */}
        <div className="h-16" />
      </div>
    </div>
  )
}
