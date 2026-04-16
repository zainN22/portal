import { ProjectWorkspace } from './project-workspace'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * Server Component wrapper — awaits the route params and passes key={id}
 * to the client component. This forces React to fully unmount/remount the
 * workspace when navigating between projects, guaranteeing fresh state
 * (preview port, phase, build queue, etc.) for each project.
 */
export default async function ProjectPage({ params }: Props) {
  const { id } = await params
  return <ProjectWorkspace key={id} id={id} />
}
