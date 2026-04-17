import { NextRequest, NextResponse } from 'next/server'
import { loadProject } from '@/lib/project-manager'
import { startBuild } from '@/lib/build-runner'

export async function POST(req: NextRequest) {
  const { projectId, userRequest }: { projectId: string; userRequest: string } = await req.json()

  const project = loadProject(projectId)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  if (!project.dir) return NextResponse.json({ error: 'Project directory not set up yet' }, { status: 400 })

  const started = startBuild(projectId, project.dir, 'edit', undefined, userRequest)
  if (!started) {
    return NextResponse.json({ error: 'A build is already running for this project' }, { status: 409 })
  }

  return NextResponse.json({ success: true })
}
