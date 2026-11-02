import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export const MAX_NAME_LENGTH = 100

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    message: string,
  ) {
    super(message)
  }
}

export async function readJsonObject(c: Context): Promise<Record<string, unknown>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(422, 'Request body must be a JSON object')
  }
  return body as Record<string, unknown>
}

export function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new HttpError(422, `${field} must be a non-empty string`)
  }
  const text = value.trim()
  if (text.length > MAX_NAME_LENGTH) {
    throw new HttpError(422, `${field} must be at most ${MAX_NAME_LENGTH} characters`)
  }
  return text
}

// isInteger would accept 1e300, which a number cannot hold exactly.
export function requireCents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new HttpError(422, `${field} must be a positive whole number of cents`)
  }
  return value
}
