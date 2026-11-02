import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { type Balance, type Bill, call, createBill, createHome, type Share } from './helpers'

function pay(billId: string, shareId: string, key: string) {
  return call<Share>('POST', `/api/bills/${billId}/shares/${shareId}/pay`, {
    headers: { 'Idempotency-Key': key },
  })
}

function firstShareOf(bill: Bill): Share {
  const share = bill.shares[0]
  if (!share) throw new Error('bill has no shares')
  return share
}

async function outstanding(homeId: string) {
  const result = await call<{ balances: Balance[] }>('GET', `/api/homes/${homeId}/balances`)
  return result.body.balances.map((balance) => balance.outstandingCents)
}

async function rawRequest(path: string, body: string) {
  return exports.default.fetch(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  )
}

describe('wrong input', () => {
  it.each(['', '   ', 7, null, undefined, 'x'.repeat(101)])('rejects the name %j', async (name) => {
    const home = await call<{ error: string }>('POST', '/api/homes', { body: { name } })
    expect(home.status).toBe(422)
    expect(home.body.error).toEqual(expect.any(String))

    const { homeId } = await createHome([])
    const member = await call('POST', `/api/homes/${homeId}/members`, { body: { name } })
    expect(member.status).toBe(422)
  })

  it.each(['', '  ', 7, null])('rejects the bill title %j', async (title) => {
    const { homeId } = await createHome(['Asha'])
    const bill = await call('POST', `/api/homes/${homeId}/bills`, {
      body: { title, totalCents: 100 },
    })
    expect(bill.status).toBe(422)
  })

  it.each([1e300, Number.MAX_SAFE_INTEGER + 1, [100], { cents: 100 }, true])(
    'rejects the amount %j',
    async (totalCents) => {
      const { homeId } = await createHome(['Asha'])
      const bill = await call('POST', `/api/homes/${homeId}/bills`, {
        body: { title: 'Rent', totalCents },
      })
      expect(bill.status).toBe(422)
    },
  )

  it('answers broken JSON with a JSON 400', async () => {
    const response = await rawRequest('/api/homes', '{not json')
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: expect.any(String) })
  })

  it.each(['[]', 'null', '"text"', '3'])('rejects the JSON body %s', async (body) => {
    const response = await rawRequest('/api/homes', body)
    expect(response.status).toBe(422)
  })

  it('does not create a bill when the amount is invalid', async () => {
    const { homeId } = await createHome(['Asha'])
    await call('POST', `/api/homes/${homeId}/bills`, { body: { title: 'Rent', totalCents: -1 } })
    expect(await outstanding(homeId)).toEqual([0])
  })

  it('answers an unknown route with JSON', async () => {
    const result = await call<{ error: string }>('GET', '/api/nothing-here')
    expect(result.status).toBe(404)
    expect(result.body.error).toEqual(expect.any(String))
  })
})

describe('splitting', () => {
  it('gives zero shares when there are fewer cents than members', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra'])
    const bill = await createBill(homeId, 2)
    expect(bill.body.shares.map((share) => share.amountCents)).toEqual([1, 1, 0])
  })

  it('stays exact for the largest allowed amount', async () => {
    const { homeId } = await createHome(['Asha', 'Ben', 'Chitra'])
    const bill = await createBill(homeId, Number.MAX_SAFE_INTEGER)
    expect(bill.status).toBe(201)
    const sum = bill.body.shares.reduce((total, share) => total + share.amountCents, 0)
    expect(sum).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('keeps the order members were added, for a large home', async () => {
    const names = Array.from({ length: 30 }, (_, index) => `Member ${index}`)
    const { homeId, members } = await createHome(names)
    const bill = await createBill(homeId, 31)
    expect(bill.body.shares.map((share) => share.memberId)).toEqual(members.map((m) => m.id))
    expect(bill.body.shares[0]?.amountCents).toBe(2)
    expect(bill.body.shares[1]?.amountCents).toBe(1)
  })

  it('leaves out members added after the bill', async () => {
    const { homeId } = await createHome(['Asha'])
    const bill = await createBill(homeId, 100)
    await call('POST', `/api/homes/${homeId}/members`, { body: { name: 'Late' } })
    expect(bill.body.shares).toHaveLength(1)
    expect(await outstanding(homeId)).toEqual([100, 0])
  })
})

describe('paying at the same time', () => {
  it('lets only one of many different keys win, and every loser gets a 409', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const { body: bill } = await createBill(homeId, 1000)
    const share = firstShareOf(bill)

    const results = await Promise.all(
      Array.from({ length: 10 }, () => pay(bill.id, share.id, crypto.randomUUID())),
    )

    const statuses = results.map((result) => result.status).sort()
    expect(statuses).toEqual([200, ...Array<number>(9).fill(409)])
    expect(await outstanding(homeId)).toEqual([0, 500])
  })

  it('gives every request with the same key the same answer', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const { body: bill } = await createBill(homeId, 1000)
    const share = firstShareOf(bill)
    const key = crypto.randomUUID()

    const results = await Promise.all(Array.from({ length: 10 }, () => pay(bill.id, share.id, key)))

    expect(results.every((result) => result.status === 200)).toBe(true)
    expect(new Set(results.map((result) => result.body.paidAt)).size).toBe(1)
    expect(await outstanding(homeId)).toEqual([0, 500])
  })
})

describe('idempotency keys', () => {
  it('allows the same key on two different shares', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const { body: bill } = await createBill(homeId, 1000)
    const key = crypto.randomUUID()
    const [first, second] = bill.shares
    if (!first || !second) throw new Error('expected two shares')

    expect((await pay(bill.id, first.id, key)).status).toBe(200)
    expect((await pay(bill.id, second.id, key)).status).toBe(200)
    expect(await outstanding(homeId)).toEqual([0, 0])
  })

  it('replays the whole response and does not change paidAt', async () => {
    const { homeId } = await createHome(['Asha', 'Ben'])
    const { body: bill } = await createBill(homeId, 1000)
    const share = firstShareOf(bill)
    const key = crypto.randomUUID()

    const first = await pay(bill.id, share.id, key)
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await pay(bill.id, share.id, key)

    expect(second.body).toEqual(first.body)
    expect(Object.keys(first.body).sort()).toEqual(['amountCents', 'id', 'memberId', 'paidAt'])
  })

  it('rejects a key that is only spaces', async () => {
    const { homeId } = await createHome(['Asha'])
    const { body: bill } = await createBill(homeId, 100)
    const paid = await pay(bill.id, firstShareOf(bill).id, '   ')
    expect(paid.status).toBe(400)
  })

  it('returns 404 for a share paid through a bill it does not belong to', async () => {
    const { homeId } = await createHome(['Asha'])
    const { body: billA } = await createBill(homeId, 100)
    const { body: billB } = await createBill(homeId, 200)

    const paid = await pay(billA.id, firstShareOf(billB).id, crypto.randomUUID())

    expect(paid.status).toBe(404)
    expect(await outstanding(homeId)).toEqual([300])
  })
})

describe('listing for the web page', () => {
  it('returns the home', async () => {
    const created = await call<{ id: string }>('POST', '/api/homes', { body: { name: 'Flat' } })
    const home = await call('GET', `/api/homes/${created.body.id}`)
    expect(home.body).toEqual({ id: created.body.id, name: 'Flat' })
    expect((await call('GET', '/api/homes/does-not-exist')).status).toBe(404)
  })

  it('returns bills newest first, with shares in member order and their payment', async () => {
    const { homeId, members } = await createHome(['Asha', 'Ben'])
    const { body: older } = await createBill(homeId, 101)
    const { body: newer } = await createBill(homeId, 200)
    const paid = await pay(older.id, firstShareOf(older).id, crypto.randomUUID())

    const list = await call<{ bills: Bill[] }>('GET', `/api/homes/${homeId}/bills`)

    expect(list.status).toBe(200)
    expect(list.body.bills.map((bill) => bill.id)).toEqual([newer.id, older.id])
    expect(list.body.bills[1]?.shares).toEqual([
      paid.body,
      { ...older.shares[1], memberId: members[1]?.id, paidAt: null },
    ])
  })

  it('returns an empty list, or 404 for an unknown home', async () => {
    const { homeId } = await createHome(['Asha'])
    expect((await call('GET', `/api/homes/${homeId}/bills`)).body).toEqual({ bills: [] })
    expect((await call('GET', '/api/homes/does-not-exist/bills')).status).toBe(404)
  })
})

describe('database constraints', () => {
  async function fixture() {
    const { homeId, members } = await createHome(['Asha'])
    const { body: bill } = await createBill(homeId, 100)
    const memberId = members[0]?.id ?? ''
    return { homeId, memberId, bill, share: firstShareOf(bill) }
  }

  it('rejects a member of a home that does not exist', async () => {
    await expect(
      env.DB.prepare("INSERT INTO members (id, home_id, name) VALUES ('m', 'no-home', 'A')").run(),
    ).rejects.toThrow(/FOREIGN KEY/)
  })

  it.each([0, -1])('rejects a bill total of %d', async (total) => {
    const { homeId } = await fixture()
    await expect(
      env.DB.prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), homeId, 'Rent', total)
        .run(),
    ).rejects.toThrow(/CHECK/)
  })

  it('rejects a decimal bill total', async () => {
    const { homeId } = await fixture()
    await expect(
      env.DB.prepare('INSERT INTO bills (id, home_id, title, total_cents) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), homeId, 'Rent', 10.5)
        .run(),
    ).rejects.toThrow()
  })

  it('rejects a second share for the same member and bill', async () => {
    const { homeId, memberId, bill } = await fixture()
    await expect(
      env.DB.prepare(
        'INSERT INTO shares (id, home_id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?, 1)',
      )
        .bind(crypto.randomUUID(), homeId, bill.id, memberId)
        .run(),
    ).rejects.toThrow(/UNIQUE/)
  })

  it('rejects a share that links a bill to a member of another home', async () => {
    const { homeId, bill } = await fixture()
    const other = await createHome(['Stranger'])
    await expect(
      env.DB.prepare(
        'INSERT INTO shares (id, home_id, bill_id, member_id, amount_cents) VALUES (?, ?, ?, ?, 1)',
      )
        .bind(crypto.randomUUID(), homeId, bill.id, other.members[0]?.id ?? '')
        .run(),
    ).rejects.toThrow(/FOREIGN KEY/)
  })

  it('rejects a paid share without a key', async () => {
    const { share } = await fixture()
    await expect(
      env.DB.prepare("UPDATE shares SET paid_at = '2026-01-01' WHERE id = ?").bind(share.id).run(),
    ).rejects.toThrow(/CHECK/)
  })
})
