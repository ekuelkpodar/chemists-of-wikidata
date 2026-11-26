import { lazy, Suspense, Component, type ReactNode } from 'react'
import { StateProvider, useAppState } from './lib/state'
import { ControlBar, Header } from './components/Shell'
import { CommandPalette } from './components/CommandPalette'
import { PersonDrawer } from './components/PersonDrawer'
import { Skeleton } from './components/ui'
// The landing page is bundled eagerly: it is the LCP for most visitors.
import StoryPage from './pages/Story'
const Story = StoryPage as unknown as React.LazyExoticComponent<() => ReactNode>

const pages: Record<string, React.LazyExoticComponent<() => ReactNode>> = {
  '/': Story,
  '/migration': lazy(() => import('./pages/Migration')),
  '/gravity': lazy(() => import('./pages/Gravity')),
  '/specialties': lazy(() => import('./pages/Specialties')),
  '/lifespans': lazy(() => import('./pages/Lifespans')),
  '/families': lazy(() => import('./pages/Families')),
  '/explorer': lazy(() => import('./pages/Explorer')),
  '/methods': lazy(() => import('./pages/Methods')),
}

class Boundary extends Component<{ children: ReactNode; k: string }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) { return { err } }
  componentDidUpdate(prev: { k: string }) { if (prev.k !== this.props.k && this.state.err) this.setState({ err: null }) }
  render() {
    if (this.state.err) return (
      <div role="alert" className="rounded-xl border border-rule bg-surface p-6">
        <p className="font-medium">Something went wrong rendering this page.</p>
        <p className="mt-1 text-sm text-muted">{this.state.err.message}</p>
        <button className="mt-3 rounded-full border border-rule px-3 py-1 text-sm" onClick={() => this.setState({ err: null })}>Try again</button>
      </div>
    )
    return this.props.children
  }
}

function Router() {
  const { route } = useAppState()
  const Page = pages[route.path]
  return (
    <main id="main" className="mx-auto max-w-7xl px-4 pb-40 pt-8 sm:px-6">
      <Boundary k={route.path}>
        <Suspense fallback={<div className="space-y-4"><Skeleton h={48} className="max-w-lg" /><Skeleton h={420} /></div>}>
          {Page ? <Page /> : <NotFound />}
        </Suspense>
      </Boundary>
    </main>
  )
}

function NotFound() {
  const { navigate } = useAppState()
  return <div className="py-20 text-center"><h1 className="font-display text-4xl">Not found</h1><button className="mt-4 text-accent" onClick={() => navigate('/')}>Back to the story</button></div>
}

export default function App() {
  return (
    <StateProvider>
      <Header />
      <Router />
      <ControlBar />
      <CommandPalette />
      <PersonDrawer />
    </StateProvider>
  )
}
