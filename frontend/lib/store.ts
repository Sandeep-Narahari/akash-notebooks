import { create } from 'zustand'
import { v4 as uuidv4 } from 'uuid'
import type { Notebook, NotebookCell, Session } from './types'

interface AppStore {
  // API Key
  apiKey: string | null
  setApiKey: (key: string) => void
  clearApiKey: () => void

  // Notebooks list
  notebooks: Notebook[]
  setNotebooks: (notebooks: Notebook[]) => void
  updateNotebook: (id: string, updates: Partial<Notebook>) => void

  // Current notebook
  currentNotebook: Notebook | null
  setCurrentNotebook: (notebook: Notebook | null) => void
  updateCell: (cellId: string, updates: Partial<NotebookCell>) => void
  addCell: (afterCellId?: string) => void
  deleteCell: (cellId: string) => void
  moveCell: (cellId: string, direction: 'up' | 'down') => void

  // Session
  session: Session | null
  setSession: (session: Session | null) => void

  // Active sessions (for session-resume feature)
  activeSessions: Session[]
  setActiveSessions: (sessions: Session[]) => void

  // Deployment logs
  deploymentLogs: string[]
  addLog: (msg: string) => void
  clearLogs: () => void

  // Kernel status
  kernelStatus: 'idle' | 'busy' | 'deploying' | 'connecting' | 'reconnecting' | 'error' | null
  setKernelStatus: (status: 'idle' | 'busy' | 'deploying' | 'connecting' | 'reconnecting' | 'error' | null) => void
}

function createEmptyCell(): NotebookCell {
  return {
    id: uuidv4(),
    type: 'code',
    source: '',
    outputs: [],
    execution_count: null,
  }
}

export const useStore = create<AppStore>((set) => ({
  // API Key
  apiKey:
    typeof window !== 'undefined' ? localStorage.getItem('akash_api_key') : null,
  setApiKey: (key: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('akash_api_key', key)
    }
    set({ apiKey: key })
  },
  clearApiKey: () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('akash_api_key')
    }
    set({ apiKey: null })
  },

  // Notebooks
  notebooks: [],
  setNotebooks: (notebooks) => set({ notebooks }),
  updateNotebook: (id, updates) =>
    set((state) => ({
      notebooks: state.notebooks.map((n) => (n.id === id ? { ...n, ...updates } : n)),
    })),

  // Current notebook
  currentNotebook: null,
  setCurrentNotebook: (notebook) => set({ currentNotebook: notebook }),

  updateCell: (cellId, updates) =>
    set((state) => {
      if (!state.currentNotebook) return state
      return {
        currentNotebook: {
          ...state.currentNotebook,
          cells: state.currentNotebook.cells.map((c) =>
            c.id === cellId ? { ...c, ...updates } : c
          ),
        },
      }
    }),

  addCell: (afterCellId) =>
    set((state) => {
      if (!state.currentNotebook) return state
      const newCell = createEmptyCell()
      const cells = [...state.currentNotebook.cells]
      if (afterCellId) {
        const idx = cells.findIndex((c) => c.id === afterCellId)
        cells.splice(idx + 1, 0, newCell)
      } else {
        cells.push(newCell)
      }
      return {
        currentNotebook: {
          ...state.currentNotebook,
          cells,
        },
      }
    }),

  deleteCell: (cellId) =>
    set((state) => {
      if (!state.currentNotebook) return state
      const cells = state.currentNotebook.cells.filter((c) => c.id !== cellId)
      // Always keep at least one cell
      const finalCells = cells.length === 0 ? [createEmptyCell()] : cells
      return {
        currentNotebook: {
          ...state.currentNotebook,
          cells: finalCells,
        },
      }
    }),

  moveCell: (cellId, direction) =>
    set((state) => {
      if (!state.currentNotebook) return state
      const cells = [...state.currentNotebook.cells]
      const idx = cells.findIndex((c) => c.id === cellId)
      if (idx === -1) return state
      if (direction === 'up' && idx === 0) return state
      if (direction === 'down' && idx === cells.length - 1) return state

      const targetIdx = direction === 'up' ? idx - 1 : idx + 1
      ;[cells[idx], cells[targetIdx]] = [cells[targetIdx], cells[idx]]

      return {
        currentNotebook: {
          ...state.currentNotebook,
          cells,
        },
      }
    }),

  // Session
  session: null,
  setSession: (session) => set({ session }),

  // Active sessions (for session-resume feature)
  activeSessions: [],
  setActiveSessions: (activeSessions) => set({ activeSessions }),

  // Deployment logs
  deploymentLogs: [],
  addLog: (msg) =>
    set((state) => ({
      deploymentLogs: [...state.deploymentLogs, msg],
    })),
  clearLogs: () => set({ deploymentLogs: [] }),

  // Kernel status
  kernelStatus: null,
  setKernelStatus: (status) => set({ kernelStatus: status }),
}))
