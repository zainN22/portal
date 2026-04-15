import { NextRequest, NextResponse } from 'next/server'
import { setupProjectDir, loadProject } from '@/lib/project-manager'
import path from 'path'
import fs from 'fs'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const { dirPath, projectName, overviewContent }:
    { dirPath: string; projectName: string; overviewContent: string } = await req.json()

  if (!dirPath?.trim())
    return NextResponse.json({ error: 'dirPath is required' }, { status: 400 })
  if (!projectName?.trim())
    return NextResponse.json({ error: 'projectName is required' }, { status: 400 })
  if (!overviewContent?.trim())
    return NextResponse.json({ error: 'overviewContent is empty — requirement gathering may not have completed. Please try again.' }, { status: 400 })

  const project = loadProject(id)
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  try {
    const resolvedPath = path.resolve(dirPath.trim())
    const projectDir = setupProjectDir(id, resolvedPath, projectName.trim(), overviewContent)

    // Verify the file was written with content
    const written = fs.readFileSync(path.join(projectDir, 'overview.md'), 'utf-8')
    if (!written.trim())
      return NextResponse.json({ error: 'overview.md was written but is empty' }, { status: 500 })

    console.log(`[setup] Created: ${projectDir} (overview: ${written.length} chars)`)
    return NextResponse.json({ projectDir, projectName: projectName.trim() })
  } catch (err) {
    console.error('[setup] Error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
