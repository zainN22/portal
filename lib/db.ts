import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'
import type { Project, ProjectPhase } from '@/types'

const DATA_DIR = path.join(os.homedir(), '.webbuilder')
fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(path.join(DATA_DIR, 'projects.db'))

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phase TEXT NOT NULL DEFAULT 'gathering',
    dir TEXT,
    preview_port INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )
`)

function rowToProject(row: Record<string, unknown>): Project {
  return {
    id: row.id as string,
    name: row.name as string,
    phase: row.phase as ProjectPhase,
    dir: (row.dir as string) ?? null,
    previewPort: (row.preview_port as number) ?? null,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function createProject(project: Project): void {
  db.prepare(`
    INSERT INTO projects (id, name, phase, dir, preview_port, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    project.id,
    project.name,
    project.phase,
    project.dir,
    project.previewPort,
    project.createdAt,
    project.updatedAt
  )
}

export function getProject(id: string): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToProject(row) : null
}

export function listProjects(): Project[] {
  const rows = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as Record<string, unknown>[]
  return rows.map(rowToProject)
}

export function updateProject(id: string, updates: Partial<Project>): void {
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
  if (updates.phase !== undefined) { fields.push('phase = ?'); values.push(updates.phase) }
  if (updates.dir !== undefined) { fields.push('dir = ?'); values.push(updates.dir) }
  if (updates.previewPort !== undefined) { fields.push('preview_port = ?'); values.push(updates.previewPort) }

  fields.push('updated_at = ?')
  values.push(Date.now())
  values.push(id)

  db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}
