import { createClerkClient, verifyToken } from '@clerk/backend'
import { createClient } from '@supabase/supabase-js'

const json = (status, body) => ({ status, body })
const normalizedEmail = value => String(value || '').trim().toLowerCase()

function allowedOrigins(env = {}) {
  const values = [
    'https://nitraspace.sk', 'https://www.nitraspace.sk',
    'http://localhost:5173', 'http://localhost:5177', 'http://localhost:5178', 'http://localhost:5179',
    env.APP_ORIGIN,
    env.VERCEL_URL && `https://${env.VERCEL_URL}`,
    env.VERCEL_BRANCH_URL && `https://${env.VERCEL_BRANCH_URL}`,
    env.VERCEL_PROJECT_PRODUCTION_URL && `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`,
  ]
  return [...new Set(values.filter(Boolean).map(value => {
    try { return new URL(value).origin } catch { return null }
  }).filter(Boolean))]
}

function validNewProfile(value) {
  const name = String(value?.display_name || '').trim()
  const username = String(value?.username || '').trim().toLowerCase()
  const birthDate = String(value?.birth_date || '').trim()
  if (!name || name.length > 50) throw new Error('Doplň meno (najviac 50 znakov).')
  if (!/^(?=.*[a-z_])[a-z0-9_]{4,24}$/.test(username)) throw new Error('Používateľské meno musí mať 4 až 24 znakov, aspoň jedno písmeno alebo podčiarkovník a môže obsahovať malé písmená, číslice a podčiarkovníky.')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(`${birthDate}T00:00:00Z`))) throw new Error('Zadaj platný dátum narodenia.')
  const cutoff = new Date()
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 16)
  if (new Date(`${birthDate}T00:00:00Z`) > cutoff) throw new Error('Komunitný účet je dostupný od 16 rokov.')
  return { display_name: name, username, birth_date: birthDate }
}

async function findSupabaseUser(admin, email) {
  const perPage = 1000
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const found = (data.users || []).find(user => normalizedEmail(user.email) === email)
    if (found) return found
    if (!data.users || data.users.length < perPage) return null
  }
  throw new Error('Používateľov sa nepodarilo bezpečne vyhľadať. Kontaktuj podporu.')
}

/**
 * Verify Clerk server-side, link only by a verified primary e-mail, then return
 * a one-use Supabase magic-link token so the old UUID/RLS session stays intact.
 */
export async function handleAuthBridge({ authorization, origin, profile, env = process.env }) {
  const secretKey = env.CLERK_SECRET_KEY
  const supabaseUrl = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!secretKey || !supabaseUrl || !serviceKey) {
    return json(503, { error: 'Prihlasovací mostík ešte nie je nastavený na serveri.' })
  }

  const token = /^Bearer\s+(.+)$/i.exec(authorization || '')?.[1]
  if (!token) return json(401, { error: 'Prihlásenie do Clerk vypršalo. Prihlás sa znova.' })

  const origins = allowedOrigins(env)
  if (!origin || !origins.includes(origin)) return json(403, { error: 'Táto adresa nemá povolený prístup.' })

  try {
    const claims = await verifyToken(token, { secretKey, authorizedParties: origins })
    if (!claims.sub?.startsWith('user_')) return json(401, { error: 'Clerk relácia nie je platná.' })

    const clerk = createClerkClient({ secretKey })
    const clerkUser = await clerk.users.getUser(claims.sub)
    const primary = clerkUser.emailAddresses.find(item => item.id === clerkUser.primaryEmailAddressId)
    const email = normalizedEmail(primary?.emailAddress)
    if (!email || primary?.verification?.status !== 'verified') {
      return json(403, { error: 'Najprv potvrď e-mail v Clerk účte.' })
    }

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    let user = await findSupabaseUser(admin, email)
    if (!user) {
      let fields
      try { fields = validNewProfile(profile || clerkUser.unsafeMetadata?.nitra_profile) }
      catch (error) { return json(409, { code: 'profile_required', error: error.message }) }
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: fields,
      })
      if (created.error) throw created.error
      user = created.data.user
      if (!user) throw new Error('Supabase nevytvoril účet.')
    } else if (!user.email_confirmed_at) {
      const updated = await admin.auth.admin.updateUserById(user.id, { email_confirm: true })
      if (updated.error) throw updated.error
      user = updated.data.user || user
    }

    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email })
    if (link.error) throw link.error
    const tokenHash = link.data?.properties?.hashed_token
    if (!tokenHash) throw new Error('Supabase nevytvoril jednorazovú prihlasovaciu reláciu.')
    return json(200, { token_hash: tokenHash, user_id: user.id })
  } catch (error) {
    console.error('Auth bridge failed:', error?.message || error)
    return json(401, { error: 'Nepodarilo sa bezpečne prepojiť Clerk a Supabase. Skús sa prihlásiť znova.' })
  }
}
