'use client'

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Cpu, Zap } from 'lucide-react'
import type { Resources } from '@/lib/types'

interface Preset {
  label: string
  description: string
  resources: Resources
  icon: 'cpu' | 'gpu'
}

const PRESETS: Preset[] = [
  {
    label: 'CPU Small',
    description: '0.5 vCPU · 512Mi RAM',
    icon: 'cpu',
    resources: {
      cpu: 0.5,
      memory: '512Mi',
      storage: '1Gi',
      gpu: 0,
      gpu_model: null,
    },
  },
  {
    label: 'CPU Large',
    description: '1 vCPU · 2Gi RAM',
    icon: 'cpu',
    resources: {
      cpu: 1,
      memory: '2Gi',
      storage: '5Gi',
      gpu: 0,
      gpu_model: null,
    },
  },
  {
    label: 'GPU T4',
    description: '2 vCPU · 8Gi RAM · 1× T4',
    icon: 'gpu',
    resources: {
      cpu: 2,
      memory: '8Gi',
      storage: '20Gi',
      gpu: 1,
      gpu_model: 't4',
    },
  },
  {
    label: 'GPU A100',
    description: '16 vCPU · 117Gi RAM · 1× A100',
    icon: 'gpu',
    resources: {
      cpu: 16,
      memory: '117Gi',
      storage: '200Gi',
      gpu: 1,
      gpu_model: 'a100',
    },
  },
    {
    label: 'GPU 4090',
    description: '8 vCPU · 41Gi RAM · 1× RTX4090',
    icon: 'gpu',
    resources: {
      cpu: 8,
      memory: '41Gi',
      storage: '200Gi',
      gpu: 1,
      gpu_model: 'rtx4090',
    },
  },
]

function resourceLabel(r: Resources): string {
  const cpuStr = Number.isInteger(r.cpu) ? `${r.cpu}` : `${r.cpu}`
  if (r.gpu > 0) {
    return `${r.gpu}× ${r.gpu_model?.toUpperCase() || 'GPU'} · ${cpuStr} vCPU · ${r.memory}`
  }
  return `${cpuStr} vCPU · ${r.memory}`
}

interface Props {
  value: Resources
  onChange: (r: Resources) => void
  disabled?: boolean
}

export default function ResourcePicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => !disabled && setOpen(!open)}
        disabled={disabled}
        className="flex items-center gap-1.5 bg-surface hover:bg-border border border-border rounded-md px-3 py-1.5 text-sm text-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {value.gpu > 0 ? (
          <Zap className="w-3.5 h-3.5 text-purple" />
        ) : (
          <Cpu className="w-3.5 h-3.5 text-muted" />
        )}
        <span className="font-mono text-xs">{resourceLabel(value)}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1.5 w-72 bg-surface border border-border rounded-lg shadow-2xl z-50 py-1 fade-in">
          {PRESETS.map((preset) => {
            const isSelected =
              preset.resources.cpu === value.cpu &&
              preset.resources.memory === value.memory &&
              preset.resources.gpu === value.gpu &&
              preset.resources.gpu_model === value.gpu_model

            return (
              <button
                key={preset.label}
                onClick={() => {
                  onChange(preset.resources)
                  setOpen(false)
                }}
                className={`w-full flex items-start gap-3 px-3 py-2.5 hover:bg-border transition-colors text-left ${
                  isSelected ? 'bg-border' : ''
                }`}
              >
                <div
                  className={`mt-0.5 w-6 h-6 rounded flex items-center justify-center flex-shrink-0 ${
                    preset.icon === 'gpu' ? 'bg-purple/20' : 'bg-surface'
                  }`}
                >
                  {preset.icon === 'gpu' ? (
                    <Zap className="w-3.5 h-3.5 text-purple" />
                  ) : (
                    <Cpu className="w-3.5 h-3.5 text-muted" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text">{preset.label}</span>
                    {isSelected && (
                      <span className="text-xs text-accent">selected</span>
                    )}
                  </div>
                  <span className="text-xs text-muted">{preset.description}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
