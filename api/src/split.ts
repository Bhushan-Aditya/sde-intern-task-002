export function splitCents(totalCents: number, count: number): number[] {
  const remainder = totalCents % count
  const base = (totalCents - remainder) / count
  return Array.from({ length: count }, (_, index) => (index < remainder ? base + 1 : base))
}
