// Server-side proxy for the Anthropic Messages API.
// Holds the API key so the browser bundle never contains it.

// Skill extraction over a large catalogue can take longer than Vercel's
// default function timeout — raise it so slow generations don't get killed
// mid-flight (which looks like a silent hang to the client).
export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  try {
    const { model, max_tokens, system, messages } = req.body
    const apiKey = process.env.VITE_ANTHROPIC_API_KEY

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens, system, messages }),
    })

    const body = await upstream.text()
    res.status(upstream.status)
    res.setHeader('Content-Type', 'application/json')
    res.send(body)
  } catch (err) {
    res.status(502).json({ error: String(err) })
  }
}
