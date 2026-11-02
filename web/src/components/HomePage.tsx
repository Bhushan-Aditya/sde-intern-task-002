import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError,
  addMember,
  type Balance,
  type Bill,
  createBill,
  getBalances,
  getBills,
  getHome,
  type Home,
  payShare,
  type Share,
} from '../api'
import { formatCents, parseDollars } from '../money'
import { TextForm } from './TextForm'

type HomeData = { home: Home; bills: Bill[]; balances: Balance[] }

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError | Error }
  | { status: 'ready'; data: HomeData; refreshFailed: boolean }

function useHomeData(homeId: string) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const current = useRef<AbortController | null>(null)

  const load = useCallback(async () => {
    current.current?.abort()
    const controller = new AbortController()
    current.current = controller
    const { signal } = controller

    try {
      const [home, bills, balances] = await Promise.all([
        getHome(homeId, signal),
        getBills(homeId, signal),
        getBalances(homeId, signal),
      ])
      if (!signal.aborted) {
        setState({ status: 'ready', data: { home, bills, balances }, refreshFailed: false })
      }
    } catch (cause) {
      if (signal.aborted) return
      const error = cause instanceof Error ? cause : new Error('Something went wrong.')
      setState((previous) =>
        previous.status === 'ready'
          ? { ...previous, refreshFailed: true }
          : { status: 'error', error },
      )
    }
  }, [homeId])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    void load()
  }, [load])

  useEffect(() => {
    setState({ status: 'loading' })
    void load()
    return () => current.current?.abort()
  }, [load])

  return { state, load, retry, setState }
}

export function HomePage({ homeId }: { homeId: string }) {
  const { state, load, retry, setState } = useHomeData(homeId)

  if (state.status === 'loading') {
    return (
      <p className="message" role="status">
        Loading this home…
      </p>
    )
  }

  if (state.status === 'error') {
    if (state.error instanceof ApiError && state.error.status === 404) {
      return (
        <div className="panel" role="alert">
          <h1>Home not found</h1>
          <p>This link may be wrong, or the home may not exist on this server.</p>
          <Link to="/" search={{}} className="button">
            Create a new home
          </Link>
        </div>
      )
    }
    return (
      <div className="panel" role="alert">
        <h1>Could not load this home</h1>
        <p>{state.error.message}</p>
        <button type="button" className="button" onClick={retry}>
          Try again
        </button>
      </div>
    )
  }

  const { home, bills, balances } = state.data
  const memberNames = new Map(balances.map((balance) => [balance.memberId, balance.name]))

  function markPaid(billId: string, paid: Share) {
    setState((previous) => {
      if (previous.status !== 'ready') return previous
      const updatedBills = previous.data.bills.map((bill) =>
        bill.id !== billId
          ? bill
          : { ...bill, shares: bill.shares.map((s) => (s.id === paid.id ? paid : s)) },
      )
      const updatedBalances = previous.data.balances.map((balance) =>
        balance.memberId === paid.memberId
          ? {
              ...balance,
              outstandingCents: Math.max(0, balance.outstandingCents - paid.amountCents),
            }
          : balance,
      )
      return {
        ...previous,
        data: { ...previous.data, bills: updatedBills, balances: updatedBalances },
      }
    })
  }

  return (
    <>
      <header className="page-header">
        <h1>{home.name}</h1>
        <Link to="/" search={{}} className="link">
          New home
        </Link>
      </header>

      {state.refreshFailed && (
        <p className="message message-warning" role="status">
          Could not refresh. What you see may be out of date.{' '}
          <button type="button" className="link" onClick={() => void load()}>
            Refresh
          </button>
        </p>
      )}

      <div className="layout">
        <section className="column" aria-labelledby="bills-heading">
          <h2 id="bills-heading">Bills</h2>
          {balances.length > 0 && (
            <div className="panel">
              <h3>Add a bill</h3>
              <TextForm
                fields={[
                  { name: 'title', label: 'Title', placeholder: 'Electricity' },
                  {
                    name: 'amount',
                    label: 'Total ($)',
                    placeholder: '45.50',
                    inputMode: 'decimal',
                  },
                ]}
                submitLabel="Add bill"
                onSubmit={async ({ title = '', amount = '' }) => {
                  const cents = parseDollars(amount)
                  if (cents === null) {
                    throw new Error('Enter a positive amount with at most 2 decimals, like 45.50.')
                  }
                  await createBill(homeId, title, cents)
                  await load()
                }}
              />
            </div>
          )}
          {bills.length === 0 ? (
            <p className="empty">
              {balances.length === 0
                ? 'No bills yet. Add a member first, then you can add a bill.'
                : 'No bills yet. Add your first bill above.'}
            </p>
          ) : (
            bills.map((bill) => (
              <BillCard
                key={bill.id}
                bill={bill}
                memberNames={memberNames}
                onPaid={(share) => {
                  markPaid(bill.id, share)
                  void load()
                }}
                onConflict={() => void load()}
              />
            ))
          )}
        </section>

        <aside className="column" aria-labelledby="members-heading">
          <h2 id="members-heading">Members</h2>
          <div className="panel">
            {balances.length === 0 ? (
              <p className="empty-inline">No members yet.</p>
            ) : (
              <ul className="balances">
                {balances.map((balance) => (
                  <li key={balance.memberId}>
                    <span>{balance.name}</span>
                    <span className="amount">
                      {balance.outstandingCents === 0
                        ? 'Settled'
                        : `${formatCents(balance.outstandingCents)} due`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <TextForm
              fields={[{ name: 'name', label: 'Add a member', placeholder: 'Asha' }]}
              submitLabel="Add"
              onSubmit={async ({ name = '' }) => {
                await addMember(homeId, name)
                await load()
              }}
            />
          </div>
        </aside>
      </div>
    </>
  )
}

type BillCardProps = {
  bill: Bill
  memberNames: Map<string, string>
  onPaid: (share: Share) => void
  onConflict: () => void
}

function BillCard({ bill, memberNames, onPaid, onConflict }: BillCardProps) {
  const paidCount = bill.shares.filter((share) => share.paidAt !== null).length

  return (
    <article className="panel">
      <header className="bill-header">
        <h3>{bill.title}</h3>
        <span className="amount">{formatCents(bill.totalCents)}</span>
      </header>
      <p className="muted">
        {paidCount} of {bill.shares.length} paid
      </p>
      <ul className="shares">
        {bill.shares.map((share) => (
          <ShareRow
            key={share.id}
            billId={bill.id}
            share={share}
            memberName={memberNames.get(share.memberId) ?? 'Unknown member'}
            onPaid={onPaid}
            onConflict={onConflict}
          />
        ))}
      </ul>
    </article>
  )
}

type ShareRowProps = {
  billId: string
  share: Share
  memberName: string
  onPaid: (share: Share) => void
  onConflict: () => void
}

function ShareRow({ billId, share, memberName, onPaid, onConflict }: ShareRowProps) {
  const [paying, setPaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // State updates too late to stop a fast double click.
  const inFlight = useRef(false)
  // Kept after a timeout or 500: the payment may have gone through, so a retry must reuse the key.
  const idempotencyKey = useRef<string | null>(null)

  async function pay() {
    if (inFlight.current) return
    inFlight.current = true
    setPaying(true)
    setError(null)
    idempotencyKey.current ??= crypto.randomUUID()

    try {
      const paid = await payShare(billId, share.id, idempotencyKey.current)
      idempotencyKey.current = null
      onPaid(paid)
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        idempotencyKey.current = null
        setError('Somebody else already paid this share.')
        onConflict()
      } else {
        setError(
          `Payment not confirmed, so this share stays unpaid (${
            cause instanceof Error ? cause.message.replace(/\.$/, '') : 'unknown error'
          }). You can safely try again.`,
        )
      }
    } finally {
      inFlight.current = false
      setPaying(false)
    }
  }

  return (
    <li className="share">
      <div className="share-row">
        <span>{memberName}</span>
        <span className="amount">{formatCents(share.amountCents)}</span>
        {share.paidAt ? (
          <span className="badge">Paid</span>
        ) : (
          <button
            type="button"
            className="button button-small"
            disabled={paying}
            aria-label={`Pay ${formatCents(share.amountCents)} for ${memberName}`}
            onClick={() => void pay()}
          >
            {paying ? 'Paying…' : 'Pay'}
          </button>
        )}
      </div>
      {error && (
        <p className="message message-error" role="alert">
          {error}
        </p>
      )}
    </li>
  )
}
