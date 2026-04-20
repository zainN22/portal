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

When you feel you have a clear enough picture to build the app, structure your final message in
TWO parts separated by the exact delimiter below.

PART 1 — write a warm, concise summary for the user:
**Project:** ...
**What it does:** ...
**Who it's for:** ...
**Key features:** ...
**Pages:** ...
**Design direction:** ...
**Tech notes:** ...

Then on its own line write exactly:
---SPEC---

PART 2 — write the complete overview.md spec document. This will be saved to disk and read by
AI code-generation agents, so be thorough and precise:

# {Project Name}

## Description
What the app does and why it exists.

## Target Users
Who uses it and what their goals are.

## Features
Bullet list of every feature described in the conversation.

## Pages & Flows
For each page: what it shows, what the user can do, how it connects to other pages.

## Design
Visual style, colour palette (specify real hex values if mentioned, otherwise choose appropriate
defaults), typography mood, overall feel.

## Tech Stack
- Frontend: {framework — use Next.js 14 + TypeScript + Tailwind CSS unless the user specifically
  requested something else}
- Backend: {framework — use Hono + Drizzle ORM + SQLite unless the user needs something else, or
  "None — frontend only" if no data persistence is needed}
- Any third-party APIs or services

## Technical Notes
Any integrations, authentication requirements, special behaviour, or constraints.

Then on the very last line write:
[READY_TO_PROCEED]

Important: only add [READY_TO_PROCEED] when you genuinely have enough to build the app.
Keep asking until you\'re confident.`

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

        const rawMessages = messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

        // Cache everything up to and including the last assistant turn
        const lastAssistantIdx = rawMessages.reduce((last, m, i) => (m.role === 'assistant' ? i : last), -1)
        const anthropicMessages: Anthropic.MessageParam[] = rawMessages.map((m, i) => {
          if (i === lastAssistantIdx) {
            return {
              role: m.role,
              content: [{ type: 'text' as const, text: m.content as string, cache_control: { type: 'ephemeral' as const } }],
            }
          }
          return { role: m.role, content: m.content } as Anthropic.MessageParam
        })

        const response = await anthropic.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 2048,
          system: [{ type: 'text', text: GATHERING_SYSTEM, cache_control: { type: 'ephemeral' } }],
          messages: anthropicMessages,
          stream: true,
        })

        for await (const chunk of response) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            fullText += chunk.delta.text
            send('delta', { text: chunk.delta.text })
          }
        }

        const isReady = fullText.includes('[READY_TO_PROCEED]')

        if (!isReady) {
          // Normal conversational reply
          send('done', { text: fullText.trim(), ready: false })
          return
        }

        // The response has two parts separated by ---SPEC---:
        //   Part 1 — user-facing summary (shown in chat)
        //   Part 2 — full overview.md spec document (saved to disk)
        const specDelimiter = '---SPEC---'
        const delimIdx = fullText.indexOf(specDelimiter)

        let displayText: string
        let overviewContent: string

        if (delimIdx !== -1) {
          displayText = fullText.slice(0, delimIdx).replace(/\[READY_TO_PROCEED\]/g, '').trim()
          overviewContent = fullText
            .slice(delimIdx + specDelimiter.length)
            .replace(/\[READY_TO_PROCEED\]/g, '')
            .trim()
        } else {
          // Fallback: model didn't use the delimiter — use the whole response as both
          displayText = fullText.replace(/\[READY_TO_PROCEED\]/g, '').trim()
          overviewContent = displayText
        }

        setPhase(projectId, 'ready')
        // overview-ready fires immediately — no second API call, no spinner delay
        send('done', { text: displayText, ready: true })
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
