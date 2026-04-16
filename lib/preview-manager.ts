/**
 * Manages one dev-server subprocess per project.
 * The portal embeds the running server in an iframe.
 *
 * The processes Map stores { proc, port } so startPreview can check whether
 * the existing server is still alive before killing and restarting it.
 * This makes startPreview idempotent: safe to call when reopening a project page.
 */

import { execa } from 'execa'
import path from 'path'
import net from 'net'
import { setPreviewPort } from './project-manager'

interface RunningPreview {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proc: any
  port: number
}

// projectId → running subprocess + port
const processes = new Map<string, RunningPreview>()

const PORT_RANGE_START = 3100

/**
 * Start (or reuse) the dev server for a project.
 *
 * If the server is already tracked AND the port is responding, return the
 * existing port immediately — no restart.  This makes the function safe to
 * call both from the build pipeline and from the "reopen project" path.
 */
export async function startPreview(projectId: string, projectDir: string): Promise<number> {
  // ── Reuse existing server if it is still alive ─────────────────────────────
  const existing = processes.get(projectId)
  if (existing && (await isPortAlive(existing.port))) {
    return existing.port
  }

  // ── Stop any stale tracked process ─────────────────────────────────────────
  await stopPreview(projectId)

  const clientDir = path.join(projectDir, 'client')
  const port = await findFreePort(PORT_RANGE_START)

  const proc = execa(
    'npm',
    ['run', 'dev', '--', '--port', String(port), '--hostname', '0.0.0.0'],
    {
      cwd: clientDir,
      env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
      reject: false,
    },
  )

  processes.set(projectId, { proc, port })

  // Wait for the port to be open (max 60 s — first run after npm install can be slow)
  await waitForPort(port, 60_000)

  setPreviewPort(projectId, port)
  return port
}

export async function stopPreview(projectId: string): Promise<void> {
  const entry = processes.get(projectId)
  if (entry) {
    entry.proc.kill('SIGTERM')
    processes.delete(projectId)
  }
}

async function findFreePort(startFrom: number): Promise<number> {
  for (let port = startFrom; port < startFrom + 100; port++) {
    if (await isPortFree(port)) return port
  }
  throw new Error('No free port found in range')
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

/** Quick liveness check — resolves true if anything is listening on the port. */
function isPortAlive(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection(port, '127.0.0.1')
    sock.once('connect', () => { sock.destroy(); resolve(true) })
    sock.once('error', () => { sock.destroy(); resolve(false) })
  })
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    function attempt() {
      if (Date.now() > deadline) {
        reject(new Error(`Timed out waiting for port ${port}`))
        return
      }
      const sock = net.createConnection(port, '127.0.0.1')
      sock.once('connect', () => { sock.destroy(); resolve() })
      sock.once('error', () => { sock.destroy(); setTimeout(attempt, 500) })
    }
    attempt()
  })
}
