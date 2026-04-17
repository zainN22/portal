export type ProjectPhase =
  | 'gathering'   // chat: asking requirements
  | 'ready'       // enough context, showing summary + proceed button
  | 'writing-specs'  // Claude Code running /generate-specs
  | 'building'    // Claude Code running /build-frontend
  | 'preview'     // preview running, user can chat edits
  | 'building-backend' // Claude Code running /build-backend
  | 'complete'

export interface Project {
  id: string
  name: string
  phase: ProjectPhase
  dir: string | null     // null until user provides a path and we create it
  previewPort: number | null
  buildQueue: string[] | null // skills left to run (scaffold, layout, pages...)
  discoveredPages: string[] | null // pages found during generate-specs
  createdAt: number
  updatedAt: number
}

export type MessageRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  role: MessageRole
  content: string
}

export type GenerationEventKind =
  | 'text'        // assistant thinking/narration
  | 'file'        // file written
  | 'shell'       // shell command run
  | 'phase'       // pipeline phase transition (e.g. "Building Navbar & Footer...")
  | 'done'        // generation complete
  | 'warning'     // non-fatal issue (e.g. max-turns reached but work saved)
  | 'error'

export interface GenerationEvent {
  kind: GenerationEventKind
  data: string
}
