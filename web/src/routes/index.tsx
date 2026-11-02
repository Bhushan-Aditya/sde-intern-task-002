import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { createHome } from '../api'
import { HomePage } from '../components/HomePage'
import { TextForm } from '../components/TextForm'

type Search = { home?: string }

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): Search =>
    typeof search.home === 'string' && search.home !== '' ? { home: search.home } : {},
  component: Index,
})

function Index() {
  const { home } = Route.useSearch()
  const navigate = useNavigate()

  return (
    <main className="page">
      {home ? (
        <HomePage key={home} homeId={home} />
      ) : (
        <div className="panel start">
          <h1>Bill Splitter</h1>
          <p className="muted">Create a home, add the members, and split your bills.</p>
          <TextForm
            fields={[{ name: 'name', label: 'Home name', placeholder: 'Flat 4B' }]}
            submitLabel="Create home"
            onSubmit={async ({ name = '' }) => {
              const created = await createHome(name)
              await navigate({ to: '/', search: { home: created.id } })
            }}
          />
        </div>
      )}
    </main>
  )
}
