/**
 * Manages one Vite/Next dev server subprocess per project.
 * The portal embeds the running server in an iframe.
 */

import { execa } from 'execa'
import path from 'path'
import net from 'net'
import { setPreviewPort } from './project-manager'

// projectId → running subprocess
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const processes = new Map<string, any>()

const PORT_RANGE_START = 3100

export async function startPreview(projectId: string, projectDir: string): Promise<number> {
  // Stop any existing preview for this project
  await stopPreview(projectId)

  const clientDir = path.join(projectDir, 'client-x')
  const port = await findFreePort(PORT_RANGE_START)

  const proc = execa('npm', ['run', 'dev', '--', '--port', String(port), '--hostname', '0.0.0.0'], {
    cwd: clientDir,
    env: { ...process.env, BROWSER: 'none', FORCE_COLOR: '0' },
    reject: false,
  })

  processes.set(projectId, proc)

  // Wait for the port to be open (max 30s)
  await waitForPort(port, 30_000)

  setPreviewPort(projectId, port)
  return port
}

export async function stopPreview(projectId: string): Promise<void> {
  const proc = processes.get(projectId)
  if (proc) {
    proc.kill('SIGTERM')
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

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    function attempt() {
      if (Date.now() > deadline) {
        reject(new Error(`Timed out waiting for port ${port}`))
        return
      }
      const sock = net.createConnection(port, '127.0.0.1')
      sock.once('connect', () => {
        sock.destroy()
        resolve()
      })
      sock.once('error', () => {
        sock.destroy()
        setTimeout(attempt, 500)
      })
    }
    attempt()
  })
}
