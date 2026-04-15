'use client'

import type { GenerationEvent } from '@/types'

interface Props {
  events: GenerationEvent[]
  label?: string
}

export function GenerationProgress({ events, label }: Props) {
  if (events.length === 0) return null

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-3 font-mono text-xs space-y-1 max-h-64 overflow-y-auto">
      {label && <div className="text-violet-400 mb-2 font-sans font-medium text-xs">{label}</div>}
      {events.map((e, i) => (
        <div key={i} className="flex items-start gap-2">
          {e.kind === 'file' && (
            <>
              <span className="text-green-400 shrink-0">+</span>
              <span className="text-zinc-300">{e.data}</span>
            </>
          )}
          {e.kind === 'shell' && (
            <>
              <span className="text-yellow-400 shrink-0">$</span>
              <span className="text-zinc-400 truncate">{e.data}</span>
            </>
          )}
          {e.kind === 'text' && (
            <>
              <span className="text-zinc-600 shrink-0">·</span>
              <span className="text-zinc-400 line-clamp-2">{e.data}</span>
            </>
          )}
          {e.kind === 'done' && (
            <span className="text-green-400 font-sans font-medium">Done</span>
          )}
          {e.kind === 'error' && (
            <span className="text-red-400">{e.data}</span>
          )}
        </div>
      ))}
    </div>
  )
}
