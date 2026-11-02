export function formatCents(cents: number): string {
  const remainder = cents % 100
  const dollars = (cents - remainder) / 100
  return `$${dollars.toLocaleString('en-US')}.${String(remainder).padStart(2, '0')}`
}

// Parses the text, because 19.99 * 100 is 1998.9999999999998.
export function parseDollars(text: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim())
  if (!match) return null
  const cents = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null
}
