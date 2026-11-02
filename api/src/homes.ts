import { Hono } from 'hono'
import { HttpError, readJsonObject, requireText } from './http'

type HomeRow = { id: string; name: string }
type BalanceRow = { memberId: string; name: string; outstandingCents: number }

export async function requireHome(db: D1Database, homeId: string): Promise<HomeRow> {
  const home = await db
    .prepare('SELECT id, name FROM homes WHERE id = ?')
    .bind(homeId)
    .first<HomeRow>()
  if (!home) throw new HttpError(404, 'Home not found')
  return home
}

export const homes = new Hono<{ Bindings: Env }>()

homes.post('/', async (c) => {
  const body = await readJsonObject(c)
  const name = requireText(body.name, 'name')
  const id = crypto.randomUUID()

  await c.env.DB.prepare('INSERT INTO homes (id, name) VALUES (?, ?)').bind(id, name).run()

  return c.json({ id, name }, 201)
})

homes.get('/:homeId', async (c) => {
  return c.json(await requireHome(c.env.DB, c.req.param('homeId')))
})

homes.post('/:homeId/members', async (c) => {
  const homeId = c.req.param('homeId')
  await requireHome(c.env.DB, homeId)
  const body = await readJsonObject(c)
  const name = requireText(body.name, 'name')
  const id = crypto.randomUUID()

  await c.env.DB.prepare('INSERT INTO members (id, home_id, name) VALUES (?, ?, ?)')
    .bind(id, homeId, name)
    .run()

  return c.json({ id, homeId, name }, 201)
})

homes.get('/:homeId/balances', async (c) => {
  const homeId = c.req.param('homeId')
  await requireHome(c.env.DB, homeId)

  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS memberId, m.name AS name, COALESCE(SUM(s.amount_cents), 0) AS outstandingCents
     FROM members m
     LEFT JOIN shares s ON s.member_id = m.id AND s.paid_at IS NULL
     WHERE m.home_id = ?
     GROUP BY m.seq
     ORDER BY m.seq`,
  )
    .bind(homeId)
    .all<BalanceRow>()

  return c.json({ balances: results })
})
