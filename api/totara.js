// Server-side proxy for the Totara GraphQL API.
// Holds the OAuth client credentials so the browser never sees them.

let tokenCache = null

async function getAccessToken() {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token
  }

  const totaraUrl = process.env.VITE_TOTARA_URL
  const clientId = process.env.VITE_TOTARA_CLIENT_ID
  const clientSecret = process.env.VITE_TOTARA_CLIENT_SECRET

  const res = await fetch(`${totaraUrl}/totara/oauth2/token.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OAuth token request failed: ${res.status} ${res.statusText} — ${body}`)
  }

  const data = await res.json()
  if (!data.access_token) {
    throw new Error(`OAuth response missing access_token: ${JSON.stringify(data)}`)
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }

  return tokenCache.token
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const { query, variables } = req.body
    const totaraUrl = process.env.VITE_TOTARA_URL
    const token = await getAccessToken()

    const upstream = await fetch(`${totaraUrl}/api/graphql.php`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables: variables ?? {} }),
    })

    const body = await upstream.text()
    res.status(upstream.status)
    res.setHeader('Content-Type', 'application/json')
    res.send(body)
  } catch (err) {
    res.status(502).json({ error: String(err) })
  }
}
