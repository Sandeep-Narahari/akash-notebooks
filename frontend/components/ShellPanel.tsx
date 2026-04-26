'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal, Loader2 } from 'lucide-react'
import AnsiToHtml from 'ansi-to-html'
import { api } from '@/lib/api'
import { useStore } from '@/lib/store'

const ansiConverter = new AnsiToHtml({
  fg: '#e5e5e5',
  bg: '#0a0a0a',
  newline: true,
  escapeXML: true,
})

interface OutputChunk {
  id: number
  html: string
}

interface Props {
  sessionId: string | null
}

let chunkId = 0

export default function ShellPanel({ sessionId }: Props) {
  const { kernelStatus } = useStore()
  const [chunks, setChunks] = useState<OutputChunk[]>([])
  const [input, setInput] = useState('')
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const outputRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const historyRef = useRef<string[]>([])
  const historyIdxRef = useRef(-1)

  const appendChunk = useCallback((text: string) => {
    const html = ansiConverter.toHtml(text)
    setChunks((prev) => [...prev, { id: chunkId++, html }])
    requestAnimationFrame(() => {
      if (outputRef.current) {
        outputRef.current.scrollTop = outputRef.current.scrollHeight
      }
    })
  }, [])

  const connect = useCallback(async () => {
    if (!sessionId || connecting || connected) return
    setConnecting(true)
    try {
      const { name } = await api.sessions.createTerminal(sessionId)

      const apiHost = process.env.NEXT_PUBLIC_API_HOST || ''
      const host = apiHost ? apiHost.replace(/^https?:\/\//, '') : window.location.host
      const isSecure = apiHost ? apiHost.startsWith('https') : window.location.protocol === 'https:'
      const proto = isSecure ? 'wss:' : 'ws:'
      const wsUrl = `${proto}//${host}/api/sessions/${sessionId}/terminal/${name}`

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        setConnecting(false)
        appendChunk('\x1b[32mShell connected\x1b[0m\r\n')
        inputRef.current?.focus()
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data as string)
          if (Array.isArray(msg)) {
            const [type, data] = msg as [string, string]
            if (type === 'stdout' && data) appendChunk(data)
            else if (type === 'disconnect') {
              setConnected(false)
              appendChunk('\r\n\x1b[33mShell disconnected\x1b[0m\r\n')
            }
          }
        } catch {
          // ignore
        }
      }

      ws.onclose = () => {
        setConnected(false)
        setConnecting(false)
      }

      ws.onerror = () => {
        setConnecting(false)
        appendChunk('\x1b[31mConnection error\x1b[0m\r\n')
      }
    } catch (err) {
      setConnecting(false)
      appendChunk(`\x1b[31mFailed: ${err}\x1b[0m\r\n`)
    }
  }, [sessionId, connecting, connected, appendChunk])

  // Clean up WS on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close()
    }
  }, [])

  const sendRaw = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(['stdin', data]))
    }
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const cmd = input
        setInput('')
        historyRef.current.unshift(cmd)
        if (historyRef.current.length > 100) historyRef.current.pop()
        historyIdxRef.current = -1
        sendRaw(cmd + '\r')
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const next = Math.min(historyIdxRef.current + 1, historyRef.current.length - 1)
        historyIdxRef.current = next
        if (next >= 0) setInput(historyRef.current[next])
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = Math.max(historyIdxRef.current - 1, -1)
        historyIdxRef.current = next
        setInput(next >= 0 ? historyRef.current[next] : '')
      } else if (e.key === 'c' && e.ctrlKey) {
        sendRaw('\x03')
      } else if (e.key === 'd' && e.ctrlKey) {
        sendRaw('\x04')
      }
    },
    [input, sendRaw]
  )

  const notReady = !sessionId || kernelStatus === null || kernelStatus === 'deploying'

  if (notReady) {
    return (
      <div className="flex items-center justify-center h-full p-4">
        <div className="text-xs text-muted text-center">Connect kernel to use shell</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      {!connected && (
        <div className="p-3">
          <button
            onClick={connect}
            disabled={connecting}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-muted hover:text-text border border-dashed border-border hover:border-muted rounded-md transition-colors disabled:opacity-50"
          >
            {connecting
              ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              : <Terminal className="w-3.5 h-3.5 shrink-0" />}
            <span>{connecting ? 'Connecting...' : 'Open Shell'}</span>
          </button>
        </div>
      )}

      {connected && (
        <>
          <div
            ref={outputRef}
            className="flex-1 overflow-y-auto font-mono text-xs p-2 text-text leading-5 cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            {chunks.map((chunk) => (
              <span
                key={chunk.id}
                className="whitespace-pre-wrap break-all"
                dangerouslySetInnerHTML={{ __html: chunk.html }}
              />
            ))}
          </div>

          <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-border shrink-0">
            <span className="text-green-400 font-mono text-xs shrink-0">$</span>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent outline-none text-text font-mono text-xs caret-white"
              autoFocus
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
            />
          </div>
        </>
      )}
    </div>
  )
}
