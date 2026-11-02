import { Hono } from 'hono'
import { requireHome } from './homes'
import { HttpError, readJsonObject, requireCents, requireText } from './http'
import { splitCents } from './split'

const MAX_IDEMPOTENCY_KEY_LENGTH = 255

type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
type Bill = { id: string; homeId: string; title: string; totalCents: number; shares: Share[] }

type BillShareRow = {
  billId: string
  title: string
  totalCents: number
  shareId: string
  memberId: string
  amountCents: number
  paidAt: string | null
}

const SHARE_COLUMNS = 'id, member_id AS memberId, amount_cents AS amountCents, paid_at AS paidAt'

export const homeBills = new Hono<{ Bindings: Env }>()

homeBills.post('/:homeId/bills', async (c) => {
  const db = c.env.DB
  const homeId = c.req.param('homeId')
  await requireHome(db, homeId)

  const body = await readJsonObject(c)
  const title = requireText(body.title, 'title')
  const totalCents = requireCents(body.totalCents, 'totalCents')

  const { results: members } = await db
    .prepare('SELECT id FROM members WHERE home_id = ? ORDER BY seq')
    .bind(homeId)
    .all<{ id: string }>()
  if (members.length === 0) throw new HttpError(422, 'Home has no members')

  const amounts = splitCents(totalCents, members.length)
  const billId = crypto.randomUUID()
  const shares: Share[] = members.map((member, index) => ({
    id: crypto.randomUUID(),
    memberId: member.id,
    amountCents: amounts[index] ?? 0,
    paidAt: null,
  }))

  // A batch is one transaction, so a bill is never saved without its shares.
  await db.batch([
    db
      .prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
      .bind(billId, homeId, title, totalCents),
    ...shares.map((share) =>
      db
        .prepare(
          'INSERT INTO shares (id, home_id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(share.id, homeId, billId, share.memberId, share.amountCents),
    ),
  ])

  const bill: Bill = { id: billId, homeId, title, totalCents, shares }
  return c.json(bill, 201)
})

homeBills.get('/:homeId/bills', async (c) => {
  const homeId = c.req.param('homeId')
  await requireHome(c.env.DB, homeId)

  const { results } = await c.env.DB.prepare(
    `SELECT b.id AS billId, b.title AS title, b.total_cents AS totalCents,
            s.id AS shareId, s.member_id AS memberId, s.amount_cents AS amountCents,
            s.paid_at AS paidAt
     FROM bills b
     JOIN shares s ON s.bill_id = b.id
     JOIN members m ON m.id = s.member_id
     WHERE b.home_id = ?
     ORDER BY b.seq DESC, m.seq`,
  )
    .bind(homeId)
    .all<BillShareRow>()

  const bills = new Map<string, Bill>()
  for (const row of results) {
    const bill = bills.get(row.billId) ?? {
      id: row.billId,
      homeId,
      title: row.title,
      totalCents: row.totalCents,
      shares: [],
    }
    bill.shares.push({
      id: row.shareId,
      memberId: row.memberId,
      amountCents: row.amountCents,
      paidAt: row.paidAt,
    })
    bills.set(row.billId, bill)
  }

  return c.json({ bills: [...bills.values()] })
})

export const billShares = new Hono<{ Bindings: Env }>()

billShares.post('/:billId/shares/:shareId/pay', async (c) => {
  const key = c.req.header('Idempotency-Key')?.trim()
  if (!key) throw new HttpError(400, 'Idempotency-Key header is required')
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new HttpError(
      400,
      `Idempotency-Key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
    )
  }

  const { billId, shareId } = c.req.param()
  const db = c.env.DB

  // Atomic: of two concurrent requests, only one can match `paid_at IS NULL`.
  const paid = await db
    .prepare(
      `UPDATE shares SET paid_at = ?, idempotency_key = ?
       WHERE id = ? AND bill_id = ? AND paid_at IS NULL
       RETURNING ${SHARE_COLUMNS}`,
    )
    .bind(new Date().toISOString(), key, shareId, billId)
    .first<Share>()
  if (paid) return c.json(paid)

  const existing = await db
    .prepare(`SELECT ${SHARE_COLUMNS}, idempotency_key AS paidWithKey FROM shares
              WHERE id = ? AND bill_id = ?`)
    .bind(shareId, billId)
    .first<Share & { paidWithKey: string | null }>()
  if (!existing) throw new HttpError(404, 'Bill or share not found')

  const { paidWithKey, ...share } = existing
  if (paidWithKey !== key) throw new HttpError(409, 'Share was already paid with a different key')

  return c.json(share)
})
