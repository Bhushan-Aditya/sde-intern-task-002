export type Home = { id: string; name: string }
export type Member = { id: string; homeId: string; name: string }
export type Share = { id: string; memberId: string; amountCents: number; paidAt: string | null }
export type Bill = {
  id: string
  homeId: string
  title: string
  totalCents: number
  shares: Share[]
}
export type Balance = { memberId: string; name: string; outstandingCents: number }

const REQUEST_TIMEOUT_MS = 10_000

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
  }
}

type Guard<T> = (value: unknown) => value is T

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const isHome: Guard<Home> = (v): v is Home =>
  isRecord(v) && typeof v.id === 'string' && typeof v.name === 'string'

const isMember: Guard<Member> = (v): v is Member => isHome(v) && 'homeId' in v

const isShare: Guard<Share> = (v): v is Share =>
  isRecord(v) &&
  typeof v.id === 'string' &&
  typeof v.memberId === 'string' &&
  typeof v.amountCents === 'number' &&
  (v.paidAt === null || typeof v.paidAt === 'string')

const isBill: Guard<Bill> = (v): v is Bill =>
  isRecord(v) &&
  typeof v.id === 'string' &&
  typeof v.title === 'string' &&
  typeof v.totalCents === 'number' &&
  Array.isArray(v.shares) &&
  v.shares.every(isShare)

const isBalance: Guard<Balance> = (v): v is Balance =>
  isRecord(v) &&
  typeof v.memberId === 'string' &&
  typeof v.name === 'string' &&
  typeof v.outstandingCents === 'number'

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function request<T>(
  path: string,
  guard: Guard<T>,
  options: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {},
  method: 'GET' | 'POST' = options.body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout

  let response: Response
  let text: string
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: { 'content-type': 'application/json', ...options.headers },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
    text = await response.text()
  } catch (error) {
    if (options.signal?.aborted) throw error
    if (timeout.aborted) throw new ApiError('The server took too long to answer.', null)
    throw new ApiError('Could not reach the server. Check your connection.', null)
  }

  const data = parseJson(text)
  if (!response.ok) {
    const message = isRecord(data) && typeof data.error === 'string' ? data.error : null
    throw new ApiError(
      message ?? `The server answered with an error (${response.status}).`,
      response.status,
    )
  }
  if (!guard(data)) {
    throw new ApiError('The server sent an answer we could not read.', response.status)
  }
  return data
}

export function createHome(name: string): Promise<Home> {
  return request('/api/homes', isHome, { body: { name } })
}

export function getHome(homeId: string, signal?: AbortSignal): Promise<Home> {
  return request(`/api/homes/${encodeURIComponent(homeId)}`, isHome, { signal })
}

export function addMember(homeId: string, name: string): Promise<Member> {
  return request(`/api/homes/${encodeURIComponent(homeId)}/members`, isMember, { body: { name } })
}

export function createBill(homeId: string, title: string, totalCents: number): Promise<Bill> {
  return request(`/api/homes/${encodeURIComponent(homeId)}/bills`, isBill, {
    body: { title, totalCents },
  })
}

export async function getBills(homeId: string, signal?: AbortSignal): Promise<Bill[]> {
  const isList = (v: unknown): v is { bills: Bill[] } =>
    isRecord(v) && Array.isArray(v.bills) && v.bills.every(isBill)
  const { bills } = await request(`/api/homes/${encodeURIComponent(homeId)}/bills`, isList, {
    signal,
  })
  return bills
}

export async function getBalances(homeId: string, signal?: AbortSignal): Promise<Balance[]> {
  const isList = (v: unknown): v is { balances: Balance[] } =>
    isRecord(v) && Array.isArray(v.balances) && v.balances.every(isBalance)
  const { balances } = await request(`/api/homes/${encodeURIComponent(homeId)}/balances`, isList, {
    signal,
  })
  return balances
}

export function payShare(billId: string, shareId: string, idempotencyKey: string): Promise<Share> {
  const path = `/api/bills/${encodeURIComponent(billId)}/shares/${encodeURIComponent(shareId)}/pay`
  return request(path, isShare, { headers: { 'Idempotency-Key': idempotencyKey } }, 'POST')
}
