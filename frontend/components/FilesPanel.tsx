'use client'

import { useRef, useState } from 'react'
import { Upload, FileText, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { v4 as uuidv4 } from 'uuid'
import { api } from '@/lib/api'
import type { NotebookCell, Resources } from '@/lib/types'

interface Props {
  sessionId: string | null
}

const DEFAULT_RESOURCES: Resources = {
  cpu: 2, memory: '4Gi', storage: '20Gi', gpu: 0, gpu_model: null,
}

export default function FilesPanel({ sessionId }: Props) {
  const router = useRouter()
  const ipynbRef = useRef<HTMLInputElement>(null)
  const dataRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)

  const handleImportNotebook = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true)
    setError(null)
    try {
      const text = await file.text()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ipynb = JSON.parse(text) as { cells?: any[] }
      const cells: NotebookCell[] = (ipynb.cells || [])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((c: any) => c.cell_type === 'code')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((c: any) => ({
          id: uuidv4(),
          type: 'code' as const,
          source: Array.isArray(c.source) ? c.source.join('') : (c.source || ''),
          outputs: [],
          execution_count: null,
        }))

      const notebook = await api.notebooks.create(
        file.name.replace(/\.ipynb$/, '') || 'Imported Notebook',
        DEFAULT_RESOURCES,
      )
      if (cells.length > 0) {
        await api.notebooks.update(notebook.id, { cells })
      }
      router.push(`/notebook/${notebook.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setImporting(false)
      if (ipynbRef.current) ipynbRef.current.value = ''
    }
  }

  const handleUploadData = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !sessionId) return
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      await api.sessions.upload(sessionId, formData)
      setUploadedFiles((prev) => [...prev, file.name])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (dataRef.current) dataRef.current.value = ''
    }
  }

  return (
    <div className="p-3 space-y-4 overflow-y-auto h-full">
      {/* Import .ipynb */}
      <div>
        <div className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Import Notebook</div>
        <input ref={ipynbRef} type="file" accept=".ipynb" className="hidden" onChange={handleImportNotebook} />
        <button
          onClick={() => ipynbRef.current?.click()}
          disabled={importing}
          className="flex items-center gap-2 w-full px-3 py-2 text-xs text-muted hover:text-text border border-dashed border-border hover:border-muted rounded-md transition-colors disabled:opacity-50"
        >
          {importing
            ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            : <Upload className="w-3.5 h-3.5 shrink-0" />}
          <span>{importing ? 'Importing...' : 'Upload .ipynb'}</span>
        </button>
      </div>

      {/* Upload to session */}
      <div>
        <div className="text-xs font-medium text-muted uppercase tracking-wide mb-2">Session Files</div>
        {!sessionId ? (
          <div className="text-xs text-muted italic">Connect kernel to upload files</div>
        ) : (
          <>
            <input ref={dataRef} type="file" className="hidden" onChange={handleUploadData} />
            <button
              onClick={() => dataRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-muted hover:text-text border border-dashed border-border hover:border-muted rounded-md transition-colors disabled:opacity-50"
            >
              {uploading
                ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                : <Upload className="w-3.5 h-3.5 shrink-0" />}
              <span>{uploading ? 'Uploading...' : 'Upload file to kernel'}</span>
            </button>

            {uploadedFiles.length > 0 && (
              <div className="mt-2 space-y-1">
                {uploadedFiles.map((name) => (
                  <div key={name} className="flex items-center gap-2 text-xs text-text">
                    <FileText className="w-3 h-3 text-muted shrink-0" />
                    <span className="truncate font-mono">{name}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {error && <div className="text-xs text-red-400 break-words">{error}</div>}
    </div>
  )
}
