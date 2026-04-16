import { NextRequest, NextResponse } from 'next/server'
import { getMessages, saveMessages } from '@/lib/db'
import { getProject } from '@/lib/db'
import type { ChatMessage } from '@/types'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!getProject(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(getMessages(id))
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!getProject(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const messages: ChatMessage[] = await req.json()
  saveMessages(id, messages)
  return NextResponse.json({ ok: true })
}
