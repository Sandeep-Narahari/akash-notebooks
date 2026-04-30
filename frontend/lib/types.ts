export interface Resources {
  cpu: number
  memory: string
  storage: string
  gpu: number
  gpu_model: string | null
}

export interface CellOutput {
  output_type: 'stream' | 'execute_result' | 'display_data' | 'error'
  text?: string
  data?: Record<string, string>
  ename?: string
  evalue?: string
  traceback?: string[]
  name?: string // for stream: stdout or stderr
}

export interface NotebookCell {
  id: string
  type: 'code' | 'markdown'
  source: string
  outputs: CellOutput[]
  execution_count: number | null
}

export interface Notebook {
  id: string
  name: string
  cells: NotebookCell[]
  resources: Resources
  created_at: string
  updated_at: string
}

export type SessionStatus = 'deploying' | 'connecting' | 'ready' | 'error' | 'closed'

export interface Session {
  id: string
  status: SessionStatus
  jupyter_url: string | null
  kernel_id: string | null
  error_message: string | null
  notebook_id?: string | null
}

export interface ProgressEvent {
  type: 'progress' | 'ready' | 'error' | string
  message: string
  status?: SessionStatus
  step?: number
  jupyter_url?: string
  kernel_id?: string
}

export type KernelStatus = 'idle' | 'busy' | 'deploying' | 'connecting' | 'reconnecting' | 'error' | null

export interface Secret {
  key: string
  value: string
}
