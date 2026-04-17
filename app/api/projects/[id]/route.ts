import { NextRequest, NextResponse } from 'next/server'
import { loadProject } from '@/lib/project-manager'
import { updateProject } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const project = loadProject(id)
  if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(project)
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json()

  updateProject(id, body)

  return NextResponse.json({ success: true })
}
