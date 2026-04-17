import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'
import type { Project, ProjectPhase, ChatMessage } from '@/types'

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

// Migration: add messages column for existing databases
try {
  db.exec(`ALTER TABLE projects ADD COLUMN messages TEXT NOT NULL DEFAULT '[]'`)
} catch {
  // column already exists — safe to ignore
}

try {
  db.exec(`ALTER TABLE projects ADD COLUMN build_queue TEXT`)
  db.exec(`ALTER TABLE projects ADD COLUMN discovered_pages TEXT`)
} catch {
  // already exist
}

function rowToProject(row: Record<string, unknown>): Project {
  let buildQueue: string[] | null = null
  let discoveredPages: string[] | null = null
  try {
    if (row.build_queue) buildQueue = JSON.parse(row.build_queue as string)
    if (row.discovered_pages) discoveredPages = JSON.parse(row.discovered_pages as string)
  } catch { }

  return {
    id: row.id as string,
    name: row.name as string,
    phase: row.phase as ProjectPhase,
    dir: (row.dir as string) ?? null,
    previewPort: (row.preview_port as number) ?? null,
    buildQueue,
    discoveredPages,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  }
}

export function createProject(project: Project): void {
  db.prepare(`
    INSERT INTO projects (id, name, phase, dir, preview_port, build_queue, discovered_pages, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    project.id,
    project.name,
    project.phase,
    project.dir,
    project.previewPort,
    project.buildQueue ? JSON.stringify(project.buildQueue) : null,
    project.discoveredPages ? JSON.stringify(project.discoveredPages) : null,
    project.createdAt,
    project.updatedAt
  )
}

export function getProject(id: string): Project | null {
  const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined
  return row ? rowToProject(row) : null
}

export function listProjects(limit = 5): Project[] {
  const rows = db
    .prepare('SELECT * FROM projects ORDER BY created_at DESC LIMIT ?')
    .all(limit) as Record<string, unknown>[]
  return rows.map(rowToProject)
}

/**
 * Before storing a preview port for a project, null it out on every OTHER project
 * that currently holds the same number. Port numbers are reused across portal restarts
 * so without this two separate projects end up pointing to the same dev server.
 */
export function evictPreviewPort(port: number, keepId: string): void {
  db.prepare(
    'UPDATE projects SET preview_port = NULL WHERE preview_port = ? AND id != ?'
  ).run(port, keepId)
}

export function getMessages(id: string): ChatMessage[] {
  const row = db.prepare('SELECT messages FROM projects WHERE id = ?').get(id) as Record<string, unknown> | undefined
  if (!row) return []
  try {
    return JSON.parse(row.messages as string) as ChatMessage[]
  } catch {
    return []
  }
}

export function saveMessages(id: string, messages: ChatMessage[]): void {
  db.prepare('UPDATE projects SET messages = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(messages), Date.now(), id)
}

export function updateProject(id: string, updates: Partial<Project>): void {
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
  if (updates.phase !== undefined) { fields.push('phase = ?'); values.push(updates.phase) }
  if (updates.dir !== undefined) { fields.push('dir = ?'); values.push(updates.dir) }
  if (updates.previewPort !== undefined) { fields.push('preview_port = ?'); values.push(updates.previewPort) }
  if (updates.buildQueue !== undefined) { fields.push('build_queue = ?'); values.push(updates.buildQueue ? JSON.stringify(updates.buildQueue) : null) }
  if (updates.discoveredPages !== undefined) { fields.push('discovered_pages = ?'); values.push(updates.discoveredPages ? JSON.stringify(updates.discoveredPages) : null) }

  fields.push('updated_at = ?')
  values.push(Date.now())
  values.push(id)

  db.prepare(`UPDATE projects SET ${fields.join(', ')} WHERE id = ?`).run(...values)
}
