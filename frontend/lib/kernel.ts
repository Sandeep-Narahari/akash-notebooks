import { v4 as uuidv4 } from 'uuid'
import type { CellOutput } from './types'

type OutputCallback = (output: CellOutput) => void
type StatusCallback = (status: 'idle' | 'busy' | 'reconnecting') => void

interface PendingExecution {
  onOutput: OutputCallback
  resolve: () => void
  reject: (err: Error) => void
}

const RECONNECT_DELAYS_MS = [0, 500, 1000, 2000, 4000]
const EXECUTE_WAIT_MS = 5000
const HEARTBEAT_INTERVAL_MS = 25000

class JupyterKernel {
  private ws: WebSocket | null = null
  private sessionId: string = ''        // our backend session id (Akash)
  private kernelId: string = ''         // Jupyter kernel id
  private jupyterSessionId: string = '' // stable Jupyter channel session id — passed to proxy
                                        // so it can forward to Jupyter as ?session_id=...
                                        // Same value on every reconnect → Jupyter replays
                                        // buffered messages instead of discarding them.
  private pending: Map<string, PendingExecution> = new Map()
  private onStatusChange: StatusCallback | null = null
  private connected: boolean = false
  private intentionalClose: boolean = false
  private reconnectAttempt: number = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private connectResolve: (() => void) | null = null
  private connectReject: ((err: Error) => void) | null = null

  setStatusCallback(cb: StatusCallback) {
    this.onStatusChange = cb
  }

  connect(sessionId: string, kernelId: string): Promise<void> {
    this.sessionId = sessionId
    this.kernelId = kernelId
    // Generate a NEW stable jupyter session id for this connection lifecycle.
    // This is reused on every upstream reconnect so Jupyter knows it's the same client.
    this.jupyterSessionId = uuidv4()
    this.intentionalClose = false
    this.reconnectAttempt = 0
    return this._openSocket()
  }

  private _openSocket(): Promise<void> {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    return new Promise((resolve, reject) => {
      this.connectResolve = resolve
      this.connectReject = reject

      const apiHost = process.env.NEXT_PUBLIC_API_HOST || ''
      const host = apiHost
        ? apiHost.replace(/^https?:\/\//, '')
        : window.location.host
      const isSecure = apiHost
        ? apiHost.startsWith('https')
        : window.location.protocol === 'https:'
      const proto = isSecure ? 'wss:' : 'ws:'
      // Pass jupyter_session_id so the proxy forwards it to Jupyter as ?session_id=...
      const wsUrl = `${proto}//${host}/api/sessions/${this.sessionId}/channels` +
        `?kernel_id=${this.kernelId}&jupyter_session_id=${this.jupyterSessionId}`

      try {
        this.ws = new WebSocket(wsUrl)
      } catch (err) {
        reject(new Error(`Failed to create WebSocket: ${err}`))
        return
      }

      this.ws.onopen = () => {
        this.connected = true
        this.reconnectAttempt = 0
        this._startHeartbeat()
        if (this.connectResolve) {
          this.connectResolve()
          this.connectResolve = null
          this.connectReject = null
        }
      }

      this.ws.onclose = () => {
        this.connected = false
        this._stopHeartbeat()

        if (this.connectReject) {
          this.connectReject(new Error('WebSocket closed before connection established'))
          this.connectResolve = null
          this.connectReject = null
        }

        this.pending.forEach((p) => p.reject(new Error('WebSocket connection closed')))
        this.pending.clear()

        if (!this.intentionalClose && this.sessionId && this.kernelId) {
          this.onStatusChange?.('reconnecting')
          this._scheduleReconnect()
        }
      }

      this.ws.onerror = () => {
        if (this.connectReject) {
          this.connectReject(new Error('WebSocket connection error'))
          this.connectResolve = null
          this.connectReject = null
        }
      }

      this.ws.onmessage = (event) => {
        try {
          this._handleMessage(JSON.parse(event.data))
        } catch {
          // ignore parse errors
        }
      }
    })
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || !this.connected || this.ws.readyState !== WebSocket.OPEN) return
      if (this.pending.size > 0) return
      this.ws.send(JSON.stringify({
        header: {
          msg_id: uuidv4(),
          session: this.jupyterSessionId,
          username: 'user',
          date: new Date().toISOString(),
          msg_type: 'kernel_info_request',
          version: '5.3',
        },
        parent_header: {},
        metadata: {},
        content: {},
        channel: 'shell',
        buffers: [],
      }))
    }, HEARTBEAT_INTERVAL_MS)
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private _scheduleReconnect(): void {
    const delay = RECONNECT_DELAYS_MS[
      Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
    ]
    this.reconnectAttempt++

    this.reconnectTimer = setTimeout(async () => {
      if (this.intentionalClose) return
      try {
        await this._openSocket()
        this.onStatusChange?.('idle')
      } catch {
        if (!this.intentionalClose) {
          this._scheduleReconnect()
        }
      }
    }, delay)
  }

  private _handleMessage(msg: Record<string, unknown>) {
    const header = (msg.header as Record<string, string>) || {}
    const msgType = header.msg_type || ''
    const parentHeader = (msg.parent_header as Record<string, string>) || {}
    const parentMsgId = parentHeader.msg_id || ''
    const content = (msg.content as Record<string, unknown>) || {}

    const pending = this.pending.get(parentMsgId)

    if (msgType === 'status') {
      const execState = content.execution_state as string
      if (execState === 'busy') {
        // Only show busy if it corresponds to one of our executions
        if (pending) this.onStatusChange?.('busy')
      } else if (execState === 'idle') {
        // Only flip to idle if no other executions are in flight
        if (this.pending.size === 0 || (pending && this.pending.size === 1)) {
          this.onStatusChange?.('idle')
        }
      }
      return
    }

    // execute_reply signals execution is complete — all output messages are
    // guaranteed to have been sent before this message arrives.
    // Resolving here is faster and more reliable than waiting for status:idle.
    if (msgType === 'execute_reply') {
      if (pending) {
        pending.resolve()
        this.pending.delete(parentMsgId)
      }
      return
    }

    if (!pending) return

    if (msgType === 'stream') {
      pending.onOutput({
        output_type: 'stream',
        name: (content.name as string) || 'stdout',
        text: content.text as string,
      })
    } else if (msgType === 'execute_result') {
      const data = content.data as Record<string, string>
      pending.onOutput({
        output_type: 'execute_result',
        data,
        text: data?.['text/plain'] || '',
      })
    } else if (msgType === 'display_data') {
      const data = content.data as Record<string, string>
      pending.onOutput({
        output_type: 'display_data',
        data,
        text: data?.['text/plain'] || '',
      })
    } else if (msgType === 'error') {
      pending.onOutput({
        output_type: 'error',
        ename: content.ename as string,
        evalue: content.evalue as string,
        traceback: content.traceback as string[],
      })
    }
  }

  execute(code: string, onOutput: OutputCallback): Promise<void> {
    return new Promise(async (resolve, reject) => {
      // Wait up to EXECUTE_WAIT_MS for auto-reconnect before failing
      if (!this.connected && !this.intentionalClose && this.sessionId && this.kernelId) {
        const deadline = Date.now() + EXECUTE_WAIT_MS
        while (!this.connected && Date.now() < deadline) {
          await new Promise<void>((r) => setTimeout(r, 50))
        }
      }

      if (!this.ws || !this.connected) {
        reject(new Error('Kernel not connected'))
        return
      }

      const msgId = uuidv4()

      let settled = false
      let timerId: ReturnType<typeof setTimeout>

      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timerId)
        fn()
      }

      timerId = setTimeout(() => {
        if (this.pending.has(msgId)) {
          this.pending.delete(msgId)
          settle(() => reject(new Error('Execution timed out')))
        }
      }, 5 * 60 * 1000)

      const msg = {
        header: {
          msg_id: msgId,
          session: this.jupyterSessionId, // stable per kernel connection
          username: 'user',
          date: new Date().toISOString(),
          msg_type: 'execute_request',
          version: '5.3',
        },
        parent_header: {},
        metadata: {},
        content: {
          code,
          silent: false,
          store_history: true,
          user_expressions: {},
          allow_stdin: false,
          stop_on_error: true,
        },
        channel: 'shell',
        buffers: [],
      }

      this.pending.set(msgId, {
        onOutput,
        resolve: () => settle(resolve),
        reject: (err: Error) => settle(() => reject(err)),
      })
      this.ws.send(JSON.stringify(msg))
    })
  }

  disconnect(): void {
    this.intentionalClose = true
    this._stopHeartbeat()
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected = false
    this.pending.clear()
  }

  isConnected(): boolean {
    return this.connected && this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  injectSecrets(secrets: Record<string, string>): void {
    if (!this.ws || !this.connected || Object.keys(secrets).length === 0) return
    const lines = Object.entries(secrets).map(
      ([k, v]) => `os.environ[${JSON.stringify(k)}] = ${JSON.stringify(v)}`
    )
    const code = `import os\n${lines.join('\n')}`
    this.ws.send(JSON.stringify({
      header: {
        msg_id: uuidv4(),
        session: this.jupyterSessionId,
        username: 'user',
        date: new Date().toISOString(),
        msg_type: 'execute_request',
        version: '5.3',
      },
      parent_header: {},
      metadata: {},
      content: {
        code,
        silent: true,
        store_history: false,
        user_expressions: {},
        allow_stdin: false,
        stop_on_error: false,
      },
      channel: 'shell',
      buffers: [],
    }))
  }
}

export const kernel = new JupyterKernel()
