'use client'

import { useEffect, useRef, useMemo } from 'react'
import AnsiToHtml from 'ansi-to-html'
import type { CellOutput as CellOutputType } from '@/lib/types'

const ansiConverter = new AnsiToHtml({
  fg: '#e5e5e5',
  bg: '#0a0a0a',
  newline: true,
  escapeXML: true,
})

interface Props {
  outputs: CellOutputType[]
}

function StreamOutput({ output }: { output: CellOutputType }) {
  const html = useMemo(() => {
    const text = output.text || ''
    return ansiConverter.toHtml(text)
  }, [output.text])

  return (
    <div
      className="font-mono text-xs text-text leading-5 whitespace-pre-wrap break-all"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function ExecuteResultOutput({ output }: { output: CellOutputType }) {
  if (output.data?.['text/html']) {
    return (
      <div
        className="text-sm text-text output-html"
        dangerouslySetInnerHTML={{ __html: output.data['text/html'] }}
      />
    )
  }

  if (output.data?.['image/png']) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`data:image/png;base64,${output.data['image/png']}`}
        alt="Cell output"
        className="max-w-full"
      />
    )
  }

  if (output.data?.['image/jpeg']) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`data:image/jpeg;base64,${output.data['image/jpeg']}`}
        alt="Cell output"
        className="max-w-full"
      />
    )
  }

  const text = output.data?.['text/plain'] || output.text || ''
  return (
    <div className="font-mono text-xs text-text leading-5 whitespace-pre-wrap break-all">
      {text}
    </div>
  )
}

function ErrorOutput({ output }: { output: CellOutputType }) {
  const traceback = output.traceback || []

  const formattedTraceback = useMemo(() => {
    return traceback.map((line) => {
      try {
        return ansiConverter.toHtml(line)
      } catch {
        return line
      }
    })
  }, [traceback])

  return (
    <div className="bg-red-950/30 border border-red-900/40 rounded-md p-3">
      <div className="font-mono text-xs text-red-400 mb-1">
        <span className="font-semibold">{output.ename}</span>
        {output.evalue && <span className="text-red-300">: {output.evalue}</span>}
      </div>
      {formattedTraceback.length > 0 && (
        <div className="mt-2 space-y-0">
          {formattedTraceback.map((line, i) => (
            <div
              key={i}
              className="font-mono text-xs leading-5 whitespace-pre-wrap"
              dangerouslySetInnerHTML={{ __html: line }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function CellOutput({ outputs }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)

  // Track whether user manually scrolled up — pause auto-scroll if so.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      userScrolledUpRef.current = distFromBottom > 80
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Stick to bottom on new output unless user scrolled up.
  useEffect(() => {
    if (userScrolledUpRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [outputs])

  if (!outputs || outputs.length === 0) return null

  return (
    <div
      ref={scrollRef}
      className="border-t border-border bg-bg/50 px-4 py-3 space-y-2 max-h-96 overflow-y-auto"
    >
      {outputs.map((output, i) => {
        if (output.output_type === 'stream') {
          return <StreamOutput key={i} output={output} />
        }
        if (output.output_type === 'execute_result' || output.output_type === 'display_data') {
          return <ExecuteResultOutput key={i} output={output} />
        }
        if (output.output_type === 'error') {
          return <ErrorOutput key={i} output={output} />
        }
        return null
      })}
    </div>
  )
}
