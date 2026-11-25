import { createClient } from 'npm:@supabase/supabase-js@2.57.0'
import { verifyToken } from 'npm:@clerk/backend@3.29.0'

const allowedOrigins = new Set([
  'https://nitraspace.sk',
  'https://www.nitraspace.sk',
  'https://nitraspace.xyz',
  'https://www.nitraspace.xyz',
  'https://nitra-space-social-preview.vercel.app',
  'http://localhost:5173',
  'http://127.0.0.1:5176',
])
const appOrigin = Deno.env.get('APP_ORIGIN')
if (appOrigin) allowedOrigins.add(appOrigin)

const cors = (request: Request) => {
  const origin = request.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}
const json = (request: Request, body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(request), 'Content-Type': 'application/json' } })

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors(request) })
  const origin = request.headers.get('origin') || ''
  if (!allowedOrigins.has(origin)) return json(request, { error: 'Nepovolený pôvod.' }, 403)
  if (request.method !== 'POST') return json(request, { error: 'Method not allowed' }, 405)

  const authorization = request.headers.get('authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!authorization?.startsWith('Bearer ') || !supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(request, { error: 'Authentication required' }, 401)
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error: userError } = await userClient.auth.getUser()
  if (userError || !data.user) return json(request, { error: 'Invalid session' }, 401)

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const metadata = data.user.app_metadata
  if (metadata.auth_provider === 'clerk' || metadata.clerk_user_id) {
    const clerkId = metadata.clerk_user_id
    const secretKey = Deno.env.get('CLERK_SECRET_KEY')
    if (!secretKey || typeof clerkId !== 'string' || !/^user_[a-zA-Z0-9]+$/.test(clerkId)) {
      return json(request, { error: 'Vymazanie Clerk účtu nie je nastavené.' }, 503)
    }

    const body = await request.json().catch(() => null)
    const token = typeof body?.clerkToken === 'string' ? body.clerkToken : ''
    const claims = token
      ? await verifyToken(token, { secretKey, authorizedParties: [...allowedOrigins] }).catch(() => null)
      : null
    const verified = claims?.sub === clerkId
    // Without a matching Clerk session, only resume if Clerk already deleted the user.
    const result = await fetch(`https://api.clerk.com/v1/users/${clerkId}`, {
      method: verified ? 'DELETE' : 'GET',
      headers: { Authorization: `Bearer ${secretKey}` },
    }).catch(() => null)
    if (result?.status !== 404) {
      if (!result?.ok) return json(request, { error: 'Clerk účet sa nepodarilo overiť alebo vymazať.' }, 502)
      if (!verified) return json(request, { error: 'Potvrď prihlásenie do Clerk účtu.' }, 403)
    }
  }

  const { error } = await adminClient.auth.admin.deleteUser(data.user.id)
  if (error && error.code !== 'user_not_found') {
    return json(request, { error: 'Účet sa nepodarilo vymazať. Zopakuj požiadavku.' }, 500)
  }
  return json(request, { success: true })
})
