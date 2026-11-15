import { handleAuthBridge } from '../server/auth-bridge.js'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' })
  const size = JSON.stringify(req.body || {}).length
  if (size > 4096) return res.status(413).json({ error: 'Požiadavka je príliš veľká.' })
  const result = await handleAuthBridge({
    authorization: req.headers.authorization,
    origin: req.headers.origin,
    profile: req.body?.profile,
    env: process.env,
  })
  return res.status(result.status).json(result.body)
}
