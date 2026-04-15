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
  | 'file'        // file written: { path, action }
  | 'shell'       // shell command run
  | 'done'        // generation complete
  | 'error'

export interface GenerationEvent {
  kind: GenerationEventKind
  data: string
}
