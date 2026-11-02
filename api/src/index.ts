import { Hono } from 'hono'
import { homes } from './homes'
import { HttpError } from './http'

const app = new Hono<{ Bindings: Env }>()

app.get('/api/health', (c) => c.json({ status: 'ok' }))

app.route('/api/homes', homes)

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((error, c) => {
  if (error instanceof HttpError) return c.json({ error: error.message }, error.status)
  console.error(error)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
