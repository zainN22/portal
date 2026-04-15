import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { createProject, getProject, updateProject } from './db'
import { writeSkillFiles } from './skill-writer'
import type { Project } from '@/types'

/**
 * Creates a lightweight session in the DB — no directory yet.
 * Called when the user lands on a new project page and starts chatting.
 */
export function initProject(name: string): Project {
  const id = uuidv4()

  const project: Project = {
    id,
    name,
    phase: 'gathering',
    dir: null,
    previewPort: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }

  createProject(project)
  return project
}

/**
 * Called after requirement gathering, once the user provides a directory path.
 *
 * Creates:
 *   {userPath}/{projectName}/
 *     ├── overview.md          ← condensed from the chat conversation
 *     ├── client-x/            ← empty, Claude Code will populate
 *     ├── server-x/            ← empty, Claude Code will populate
 *     └── .claude/
 *         ├── commands/        ← skill files (generate-specs, build-frontend, etc.)
 *         └── examples/        ← sample spec files for format reference
 */
export function setupProjectDir(
  projectId: string,
  userChosenPath: string,
  projectName: string,
  overviewContent: string
): string {
  const project = getProject(projectId)
  if (!project) throw new Error(`Project ${projectId} not found`)

  // Create project-{name} folder inside the user-chosen path
  const folderName = `project-${slugify(projectName)}`
  const projectDir = path.join(userChosenPath, folderName)
  fs.mkdirSync(projectDir, { recursive: true })

  // Scaffold the directory structure
  fs.mkdirSync(path.join(projectDir, 'client-x'), { recursive: true })
  fs.mkdirSync(path.join(projectDir, 'server-x'), { recursive: true })

  // Write overview.md — this IS the requirements document
  fs.writeFileSync(path.join(projectDir, 'overview.md'), overviewContent, 'utf-8')

  // Write .claude/commands/ skill files + .claude/examples/ sample specs
  writeSkillFiles(projectDir)

  // Persist directory and update name in the DB
  updateProject(projectId, { name: projectName, dir: projectDir, phase: 'writing-specs' })

  return projectDir
}

export function loadProject(id: string): Project | null {
  return getProject(id)
}

export function setPhase(id: string, phase: Project['phase']): void {
  updateProject(id, { phase })
}

export function setPreviewPort(id: string, port: number): void {
  updateProject(id, { previewPort: port })
}

/**
 * Read a skill file so we can pass its content to the Claude Code SDK as the prompt.
 */
export function readSkill(projectDir: string, skillName: string): string {
  const skillPath = path.join(projectDir, '.claude', 'commands', `${skillName}.md`)
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill not found: ${skillPath}`)
  }
  return fs.readFileSync(skillPath, 'utf-8')
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
