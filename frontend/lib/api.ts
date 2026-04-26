import axios from 'axios'
import type { Notebook, NotebookCell, Resources, Session, ProgressEvent } from './types'

const API_HOST = process.env.NEXT_PUBLIC_API_HOST || ''

const client = axios.create({
  baseURL: `${API_HOST}/api`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
})

function getApiKey(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem('akash_api_key')
}

client.interceptors.request.use((config) => {
  const key = getApiKey()
  if (key) config.headers['X-API-Key'] = key
  return config
})

export const api = {
  notebooks: {
    async list(): Promise<Notebook[]> {
      const res = await client.get<Notebook[]>('/notebooks')
      return res.data
    },
    async create(name: string, resources: Resources): Promise<Notebook> {
      const res = await client.post<Notebook>('/notebooks', { name, resources })
      return res.data
    },
    async get(id: string): Promise<Notebook> {
      const res = await client.get<Notebook>(`/notebooks/${id}`)
      return res.data
    },
    async update(
      id: string,
      updates: { name?: string; cells?: NotebookCell[]; resources?: Resources }
    ): Promise<Notebook> {
      const res = await client.put<Notebook>(`/notebooks/${id}`, updates)
      return res.data
    },
    async delete(id: string): Promise<void> {
      await client.delete(`/notebooks/${id}`)
    },
  },

  sessions: {
    async list(): Promise<Session[]> {
      const res = await client.get<Session[]>('/sessions')
      return res.data
    },
    async create(
      resources: Resources,
      notebookId?: string
    ): Promise<{ session_id: string; status: string }> {
      const apiKey = getApiKey()
      const res = await client.post<{ session_id: string; status: string }>('/sessions', {
        api_key: apiKey,
        resources,
        notebook_id: notebookId ?? null,
      })
      return res.data
    },
    async get(id: string): Promise<Session> {
      const res = await client.get<Session>(`/sessions/${id}`)
      return res.data
    },
    async delete(id: string): Promise<void> {
      await client.delete(`/sessions/${id}`)
    },
    async restart(id: string): Promise<{ status: string; kernel_id: string }> {
      const res = await client.post<{ status: string; kernel_id: string }>(`/sessions/${id}/restart`)
      return res.data
    },
    async createTerminal(id: string): Promise<{ name: string }> {
      const res = await client.post<{ name: string }>(`/sessions/${id}/terminal`)
      return res.data
    },
    async upload(id: string, formData: FormData): Promise<{ path: string; status: string }> {
      const res = await client.post<{ path: string; status: string }>(
        `/sessions/${id}/upload`,
        formData,
      )
      return res.data
    },
    streamProgress(
      id: string,
      onEvent: (event: ProgressEvent) => void,
      onError?: (err: Event) => void
    ): EventSource {
      const url = `${API_HOST}/api/sessions/${id}/status-stream`
      const es = new EventSource(url)
      es.onopen = () => console.log('[SSE] connected')
      es.onmessage = (e) => {
        try {
          const data: ProgressEvent = JSON.parse(e.data)
          onEvent(data)
          if (data.type === 'ready' || data.type === 'error') es.close()
        } catch {
          // ignore parse errors
        }
      }
      es.onerror = (err) => {
        if (onError) onError(err)
        es.close()
      }
      return es
    },
  },
}
