import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => <Outlet />,
  errorComponent: ({ error, reset }) => (
    <main className="page">
      <div className="panel" role="alert">
        <h1>Something went wrong</h1>
        <p>{error instanceof Error ? error.message : 'Please try again.'}</p>
        <button type="button" className="button" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  ),
  notFoundComponent: () => (
    <main className="page">
      <div className="panel" role="alert">
        <h1>Page not found</h1>
        <Link to="/" search={{}} className="button">
          Go to the start
        </Link>
      </div>
    </main>
  ),
})
