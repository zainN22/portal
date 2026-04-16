import { NextRequest, NextResponse } from 'next/server'
import { loadProject } from '@/lib/project-manager'
import { startBuild, isBuildRunning, type Skill } from '@/lib/build-runner'

export async function POST(req: NextRequest) {
  const {
    projectId,
    skill,
    pageName,
  }: { projectId: string; skill: Skill; pageName?: string } = await req.json()

  console.log(`[API/generate] ▶ Request received: skill="${skill}", projectId="${projectId}"${pageName ? `, page="${pageName}"` : ''}`)

  const project = loadProject(projectId)
  if (!project) {
    console.error(`[API/generate] Project not found: ${projectId}`)
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }
  if (!project.dir) {
    console.error(`[API/generate] Project dir not set: ${projectId}`)
    return NextResponse.json({ error: 'Project directory not set up yet' }, { status: 400 })
  }

  // Prevent duplicate builds
  if (isBuildRunning(projectId)) {
    console.warn(`[API/generate] Build already running for ${projectId}`)
    return NextResponse.json({ error: 'Build already in progress' }, { status: 409 })
  }

  // Fire-and-forget — build runs in background, events buffered in memory
  const started = startBuild(projectId, project.dir, skill as Skill, pageName)

  if (!started) {
    return NextResponse.json({ error: 'Failed to start build' }, { status: 500 })
  }

  console.log(`[API/generate] ✅ Build started in background for skill="${skill}"`)
  return NextResponse.json({ ok: true, skill })
}
