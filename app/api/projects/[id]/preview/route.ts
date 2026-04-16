import { NextRequest, NextResponse } from 'next/server'
import { loadProject } from '@/lib/project-manager'
import { startPreview } from '@/lib/preview-manager'
import fs from 'fs'
import path from 'path'

/**
 * POST /api/projects/:id/preview
 *
 * Starts (or resumes) the dev-server for a project that was previously built.
 * Called by the project page when it loads in `preview` or `complete` phase so
 * the iframe always points to the correct server for that specific project —
 * not a recycled port belonging to a different project.
 *
 * Returns: { port: number }
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const project = loadProject(id)

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  if (!project.dir) {
    return NextResponse.json({ error: 'Project directory not set up yet' }, { status: 400 })
  }
  if (project.phase !== 'preview' && project.phase !== 'complete') {
    return NextResponse.json(
      { error: 'Project is not in a previewable phase' },
      { status: 400 },
    )
  }

  const clientDir = path.join(project.dir, 'client')
  if (!fs.existsSync(path.join(clientDir, 'package.json'))) {
    return NextResponse.json(
      { error: 'client/package.json not found — project may not have been scaffolded' },
      { status: 400 },
    )
  }

  try {
    const port = await startPreview(id, project.dir)
    return NextResponse.json({ port })
  } catch (err) {
    console.error(`[preview] Failed to start preview for ${id}:`, err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
