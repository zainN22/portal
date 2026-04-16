'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Project } from '@/types'

export default function Home() {
  const router = useRouter()
  const [projects, setProjects] = useState<Project[]>([])
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetch('/api/projects').then((r) => r.json()).then(setProjects).catch(() => {})
  }, [])

  const startNewProject = async () => {
    setCreating(true)
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Project' }),
      })
      const project: Project = await res.json()
      router.push(`/project/${project.id}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 flex flex-col items-center justify-center px-4">
      <div className="max-w-md w-full space-y-8 text-center">
        <div>
          <div className="w-14 h-14 rounded-2xl bg-violet-600 flex items-center justify-center text-2xl font-bold text-white mx-auto mb-4">
            W
          </div>
          <h1 className="text-3xl font-bold text-zinc-100">WebBuilder</h1>
          <p className="text-zinc-400 mt-2 text-sm leading-relaxed">
            Describe your app in plain language.<br />
            We&apos;ll build it, spec by spec, line by line.
          </p>
        </div>

        <button
          onClick={startNewProject}
          disabled={creating}
          className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white font-medium rounded-xl transition-colors text-sm"
        >
          {creating ? 'Starting...' : 'Start a new project →'}
        </button>

        {projects.length > 0 && (
          <div className="space-y-2 text-left">
            <p className="text-xs text-zinc-500 uppercase tracking-wider px-1">Recent projects</p>
            {projects.slice(0, 5).map((p) => (
              <Link
                key={p.id}
                href={`/project/${p.id}`}
                className="w-full flex items-center gap-3 px-4 py-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-xl transition-colors text-left"
              >
                <div className="w-2 h-2 rounded-full bg-violet-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 truncate">{p.name}</p>
                  <p className="text-xs text-zinc-500 capitalize">{p.phase.replace(/-/g, ' ')}</p>
                </div>
                {p.dir && (
                  <p className="text-xs text-zinc-600 font-mono truncate max-w-32">{p.dir.split('/').pop()}</p>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
