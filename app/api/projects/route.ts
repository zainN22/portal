import { NextRequest, NextResponse } from 'next/server'
import { initProject, loadProject } from '@/lib/project-manager'
import { listProjects } from '@/lib/db'

export async function GET() {
  const projects = listProjects()
  return NextResponse.json(projects)
}

export async function POST(req: NextRequest) {
  const { name } = await req.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }

  const project = initProject(name.trim())
  return NextResponse.json(project)
}
