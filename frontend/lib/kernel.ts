import { v4 as uuidv4 } from 'uuid'
import type { CellOutput } from './types'

type OutputCallback = (output: CellOutput) => void
type StatusCallback = (status: 'idle' | 'busy' | 'reconnecting' | 'error') => void
type KernelIdFetcher = () => Promise<string | null>

interface PendingExecution {
  onOutput: OutputCallback
  sentAt: number
  busyAt: number  // set when kernel reports status:busy — marks actual execution start
  resolve: (elapsedMs: number) => void
  reject: (err: Error) => void
}

const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000]
const EXECUTE_WAIT_MS = 5000
const HEARTBEAT_INTERVAL_MS = 25000
const MAX_RECONNECT_ATTEMPTS = 10
const KERNEL_FETCH_THROTTLE_MS = 5000

class JupyterKernel {
  private ws: WebSocket | null = null
  private sessionId: string = ''        // our backend session id (Akash)
  private kernelId: string = ''         // Jupyter kernel id
  private jupyterSessionId: string = '' // stable Jupyter channel session id — passed to proxy
  // so it can forward to Jupyter as ?session_id=...
  // Same value on every reconnect → Jupyter replays
  // buffered messages instead of discarding them.
  private kernelIdFetcher: KernelIdFetcher | null = null
  private pending: Map<string, PendingExecution> = new Map()
  private onStatusChange: StatusCallback | null = null
  private connected: boolean = false
  private intentionalClose: boolean = false
  private reconnectAttempt: number = 0
  private connectedAt: number = 0       // epoch ms when last onopen fired
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private connectResolve: (() => void) | null = null
  private connectReject: ((err: Error) => void) | null = null
  private lastFetchAt: number = 0        // throttle kernelIdFetcher calls
  private graceUntil: number = 0         // suppress restarting/starting status until this time
  private sawRestartSignal: boolean = false // track if kernel actually sent restarting/starting

  setStatusCallback(cb: StatusCallback) {
    this.onStatusChange = cb
  }

  connect(sessionId: string, kernelId: string, kernelIdFetcher?: KernelIdFetcher): Promise<void> {
    // Tear down any existing connection first — prevents orphaned WebSockets
    // and reconnect timers from accumulating (especially during HMR reloads).
    this.disconnect()
    this.sessionId = sessionId
    this.kernelId = kernelId
    this.kernelIdFetcher = kernelIdFetcher ?? null
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
        this.connectedAt = Date.now()
        // Grace period: ignore restarting/starting status messages for 3s after
        // opening a connection — Jupyter broadcasts these during its initial handshake
        // and they are NOT actual kernel crashes.
        this.graceUntil = Date.now() + 3000
        this.sawRestartSignal = false
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
    // Reset backoff only if the last connection was stable (>5s).
    // Never reset on rapid open→close cycles — that causes a reconnect storm
    // where each new connection is immediately replaced on the Jupyter side.
    if (Date.now() - this.connectedAt > 5000) {
      this.reconnectAttempt = 0
    }

    // Cap reconnect attempts — don't loop forever.
    if (this.reconnectAttempt >= MAX_RECONNECT_ATTEMPTS) {
      console.error(`[kernel] Giving up after ${MAX_RECONNECT_ATTEMPTS} reconnect attempts`)
      this.onStatusChange?.('error')
      return
    }

    const delay = RECONNECT_DELAYS_MS[
      Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
    ]
    this.reconnectAttempt++

    this.reconnectTimer = setTimeout(async () => {
      if (this.intentionalClose) return
      // Refresh kernel_id from backend — it may have been recovered after a 404.
      // Throttled: at most once per KERNEL_FETCH_THROTTLE_MS to prevent
      // hammering /api/sessions/{id}/kernel on rapid reconnects.
      if (this.kernelIdFetcher && Date.now() - this.lastFetchAt >= KERNEL_FETCH_THROTTLE_MS) {
        try {
          this.lastFetchAt = Date.now()
          const freshId = await this.kernelIdFetcher()
          if (freshId) this.kernelId = freshId
        } catch {
          // ignore — continue with cached kernelId
        }
      }
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
      if (execState === 'restarting' || execState === 'starting') {
        // During the grace period after a fresh connection, Jupyter broadcasts
        // restarting/starting as part of its handshake. Ignore these —
        // they are NOT actual kernel crashes.
        if (Date.now() < this.graceUntil) {
          return
        }
        // Genuine kernel restart — reject any in-flight executions.
        this.sawRestartSignal = true
        const hadPending = this.pending.size > 0
        this.pending.forEach((p) => p.reject(new Error('Kernel restarted')))
        this.pending.clear()
        if (hadPending) this.onStatusChange?.('reconnecting')
        return
      }
      if (execState === 'busy') {
        if (pending) {
          if (!pending.busyAt) pending.busyAt = Date.now()
          this.onStatusChange?.('busy')
        }
      } else if (execState === 'idle') {
        if (this.pending.size > 0 && !pending && this.sawRestartSignal) {
          // Idle with no matching parent AND we previously saw a restart signal —
          // kernel restarted without sending a per-message restarting/starting.
          // Only reject here if we actually saw the restart, otherwise this is
          // just a heartbeat reply (kernel_info_reply) which is benign.
          this.pending.forEach((p) => p.reject(new Error('Kernel restarted')))
          this.pending.clear()
          this.sawRestartSignal = false
        }
        if (this.pending.size === 0) {
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
        // Execution time priority:
        // 1. Jupyter server-side timestamps (metadata.started → header.date)
        // 2. Client-side busy→reply (status:busy received → execute_reply received)
        // 3. Full round-trip (sentAt → now) as last resort
        const metadata = (msg.metadata as Record<string, string>) || {}
        const serverStart = metadata.started ? new Date(metadata.started).getTime() : 0
        const serverEnd = header.date ? new Date(header.date).getTime() : 0
        let execMs: number
        if (serverStart && serverEnd && serverEnd > serverStart) {
          execMs = serverEnd - serverStart
        } else if (pending.busyAt) {
          execMs = Date.now() - pending.busyAt
        } else {
          execMs = Date.now() - pending.sentAt
        }
        pending.resolve(execMs)
        this.pending.delete(parentMsgId)
      }
      return
    }

    // input_request — the kernel subprocess is blocking on stdin (e.g. an
    // interactive prompt like `uv venv` asking [y/n]).  We set allow_stdin:
    // false but `!` shell commands bypass that.  Auto-reply with empty input
    // so the subprocess unblocks and execute_reply can be sent.
    if (msgType === 'input_request') {
      if (this.ws && this.connected) {
        this.ws.send(JSON.stringify({
          header: {
            msg_id: uuidv4(),
            session: this.jupyterSessionId,
            username: 'user',
            date: new Date().toISOString(),
            msg_type: 'input_reply',
            version: '5.3',
          },
          parent_header: header,
          metadata: {},
          content: { value: '' },
          channel: 'stdin',
          buffers: [],
        }))
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

  execute(code: string, onOutput: OutputCallback): Promise<number> {
    return new Promise(async (resolve, reject) => {
      // Wait up to EXECUTE_WAIT_MS for auto-reconnect before failing
      if (!this.connected && !this.intentionalClose && this.sessionId && this.kernelId) {
        const deadline = Date.now() + EXECUTE_WAIT_MS
        while (!this.connected && Date.now() < deadline) {
          await new Promise<void>((r) => setTimeout(r, 500))
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
          allow_stdin: true,
          stop_on_error: true,
        },
        channel: 'shell',
        buffers: [],
      }

      const sentAt = Date.now()
      let lastActivityAt = sentAt

      // Stall detector: if no output or reply arrives for 60s, the subprocess
      // is likely blocked on interactive input we can't unblock (e.g. reading
      // /dev/tty directly).  Reject so the cell stops spinning.
      const STALL_CHECK_MS = 10_000
      const STALL_TIMEOUT_MS = 60_000
      const stallId = setInterval(() => {
        if (!this.pending.has(msgId)) {
          clearInterval(stallId)
          return
        }
        if (Date.now() - lastActivityAt > STALL_TIMEOUT_MS) {
          clearInterval(stallId)
          this.pending.delete(msgId)
          settle(() => reject(new Error(
            'Execution stalled — the command may be waiting for interactive input. ' +
            'Use the interrupt button or add non-interactive flags (e.g. --yes, --clear).'
          )))
        }
      }, STALL_CHECK_MS)

      // Wrap the output callback to track activity for stall detection.
      const trackedOnOutput: OutputCallback = (output) => {
        lastActivityAt = Date.now()
        onOutput(output)
      }

      this.pending.set(msgId, {
        onOutput: trackedOnOutput,
        sentAt,
        busyAt: 0,
        resolve: (elapsedMs: number) => { clearInterval(stallId); settle(() => resolve(elapsedMs)) },
        reject: (err: Error) => { clearInterval(stallId); settle(() => reject(err)) },
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
    if (!this.ws || !this.connected) return

    // Always inject non-interactive defaults so tools like uv, apt, pip
    // don't block on stdin prompts inside notebook cells.
    const defaults: Record<string, string> = {
      DEBIAN_FRONTEND: 'noninteractive',
      UV_VENV_CLEAR: '1',
      PIP_NO_INPUT: '1',
      PIP_ROOT_USER_ACTION: 'ignore',
    }
    const merged = { ...defaults, ...secrets }

    const lines = Object.entries(merged).map(
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

// Persist the singleton on globalThis so HMR reloads reuse the same instance
// instead of leaking old WebSockets + reconnect timers.
const KERNEL_KEY = '__akash_kernel_singleton__' as const
export const kernel: JupyterKernel =
  (globalThis as Record<string, unknown>)[KERNEL_KEY] as JupyterKernel ??
  ((globalThis as Record<string, unknown>)[KERNEL_KEY] = new JupyterKernel())
