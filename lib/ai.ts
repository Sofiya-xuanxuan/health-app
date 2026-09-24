import Anthropic from '@anthropic-ai/sdk'

export function createAiClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) return null

  const baseURL = process.env.ANTHROPIC_BASE_URL?.trim()
  return new Anthropic({
    apiKey,
    ...(baseURL ? { baseURL } : {}),
  })
}

export function aiConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim())
}

export function isAiAuthError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const value = error as { status?: unknown; message?: unknown }
  return value.status === 401 || (typeof value.message === 'string' && /authentication_error|api key is invalid/i.test(value.message))
}
