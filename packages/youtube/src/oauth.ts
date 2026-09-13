/**
 * OAuth authorization URL and code-exchange helpers for the single-channel
 * YouTube connection. The web app supplies an injectable token transport
 * (controlled in tests); this package never performs routing or user
 * authorization decisions.
 */

export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.readonly",
] as const

export const OAUTH_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
export const OAUTH_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"

export type AuthorizationUrlInput = {
  clientId: string
  redirectUri: string
  state: string
  scopes?: readonly string[]
}

export function buildAuthorizationUrl(input: AuthorizationUrlInput): string {
  const url = new URL(OAUTH_AUTH_ENDPOINT)
  url.searchParams.set("client_id", input.clientId)
  url.searchParams.set("redirect_uri", input.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("access_type", "offline")
  url.searchParams.set("prompt", "consent")
  url.searchParams.set("include_granted_scopes", "true")
  url.searchParams.set("state", input.state)
  url.searchParams.set("scope", (input.scopes ?? YOUTUBE_SCOPES).join(" "))
  return url.toString()
}

export type TokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope: string
  token_type: string
}

export type TokenTransport = (
  url: string,
  init: { method: string; body: string; headers: Record<string, string> },
) => Promise<{ status: number; body: string }>

export async function exchangeAuthorizationCode(input: {
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
  transport: TokenTransport
}): Promise<TokenResponse> {
  const response = await input.transport(OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      grant_type: "authorization_code",
      redirect_uri: input.redirectUri,
    }).toString(),
  })
  if (response.status !== 200) {
    throw new Error(`token exchange failed with status ${response.status}`)
  }
  const parsed = JSON.parse(response.body) as TokenResponse
  if (!parsed.access_token) {
    throw new Error("token exchange returned no access token")
  }
  return parsed
}

export async function refreshAccessToken(input: {
  clientId: string
  clientSecret: string
  refreshToken: string
  transport: TokenTransport
}): Promise<TokenResponse> {
  const response = await input.transport(OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.clientId,
      clientSecret: input.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  })
  if (response.status !== 200) {
    throw new Error(`token refresh failed with status ${response.status}`)
  }
  const parsed = JSON.parse(response.body) as TokenResponse
  if (!parsed.access_token) {
    throw new Error("token refresh returned no access token")
  }
  return parsed
}
