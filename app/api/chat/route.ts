import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { loadProject, setPhase } from '@/lib/project-manager'
import type { ChatMessage } from '@/types'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const GATHERING_SYSTEM = `You are a friendly product analyst helping a non-technical user define their web application.
Your job is to understand what they want to build through natural conversation — not a form or checklist.

Ask follow-up questions organically. Cover these areas naturally as the conversation flows:
- What the app does and who it's for
- The key features and user flows that matter most
- Pages and screens they have in mind (don't limit them — let them describe freely)
- The visual style and brand feel they want
- Any specific technical needs or integrations

When you feel you have a clear enough picture to build the app, end your message with exactly this marker on its own line:
[READY_TO_PROCEED]

Before that marker, write a concise summary of everything you understood, formatted as:
**Project:** ...
**What it does:** ...
**Who it\'s for:** ...
**Key features:** ...
**Pages:** ...
**Design direction:** ...
**Tech notes:** ...

Important: Only add [READY_TO_PROCEED] when you genuinely have enough to build the app. Keep asking until you\'re confident.`

const CONDENSE_SYSTEM = `You are writing the overview.md spec file for a web project.
This file is the single source of truth for what needs to be built.
It will be read by an AI agent to generate all other spec files and eventually the full codebase.

Write it in rich markdown. Include:
- Project name and description
- Who it\'s for and why they need it
- All features and user flows described
- All pages and what happens on each
- Design direction (colors, style, mood if mentioned, otherwise suggest sensible defaults)
- Tech stack (use Next.js + Tailwind for frontend, Hono + Drizzle + SQLite for backend unless user specified otherwise)
- Any integrations, third-party services, or special requirements
- Anything else relevant from the conversation

Be thorough and specific. This document is the foundation for the entire build.`

export async function POST(req: NextRequest) {
  const { projectId, messages }: { projectId: string; messages: ChatMessage[] } = await req.json()

  const project = loadProject(projectId)
  if (!project) return new Response('Project not found', { status: 404 })

  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }

      try {
        let fullText = ''

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2048,
          system: GATHERING_SYSTEM,
          messages: messages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })) as Anthropic.MessageParam[],
          stream: true,
        })

        for await (const chunk of response) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            fullText += chunk.delta.text
            send('delta', { text: chunk.delta.text })
          }
        }

        const isReady = fullText.includes('[READY_TO_PROCEED]')
        const displayText = fullText.replace(/\[READY_TO_PROCEED\]/g, '').trim()

        if (!isReady) {
          // Normal reply — just done
          send('done', { text: displayText, ready: false })
          return
        }

        // Agent has enough context — generate overview.md content
        // We return it to the frontend so it can be written to disk
        // only after the user provides their chosen directory path.
        setPhase(projectId, 'ready')
        send('done', { text: displayText, ready: true })

        const condenseMessages = [
          ...messages,
          { role: 'assistant' as const, content: displayText },
          { role: 'user' as const, content: 'Write the overview.md file now based on our entire conversation.' },
        ]

        const overviewRes = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          system: CONDENSE_SYSTEM,
          messages: condenseMessages
            .filter((m) => m.role === 'user' || m.role === 'assistant')
            .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })) as Anthropic.MessageParam[],
        })

        const overviewContent = overviewRes.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')

        // Send the overview content back to the frontend.
        // It will be submitted alongside the directory path when the user clicks Proceed.
        send('overview-ready', { content: overviewContent })

      } catch (err) {
        send('error', { message: String(err) })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
