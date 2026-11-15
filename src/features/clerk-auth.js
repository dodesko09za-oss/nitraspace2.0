let clerkPromise

export async function getClerk() {
  if (clerkPromise) return clerkPromise
  const publishableKey = import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY
  if (!publishableKey) throw new Error('Clerk ešte nie je pripojený k tejto verzii. Pridaj VITE_CLERK_PUBLISHABLE_KEY do prostredia aplikácie.')
  clerkPromise = (async () => {
    const { Clerk } = await import('@clerk/clerk-js')
    const clerk = new Clerk(publishableKey)
    await clerk.load()
    const callbackParams = new URLSearchParams(location.search)
    if (['__clerk_status', '__clerk_ticket', '__clerk_created_session', '__clerk_handshake'].some(key => callbackParams.has(key))) {
      await clerk.handleRedirectCallback({ signInUrl: '/account', signUpUrl: '/account', signInFallbackRedirectUrl: '/account', signUpFallbackRedirectUrl: '/account' })
    }
    return clerk
  })().catch(error => {
    clerkPromise = null
    throw error
  })
  return clerkPromise
}

export async function syncClerkSessionToSupabase(db, profile = null) {
  const clerk = await getClerk()
  if (!clerk.user || !clerk.session) return { user: null, profileRequired: false }
  const token = await clerk.session.getToken()
  if (!token) throw new Error('Nepodarilo sa obnoviť Clerk reláciu. Prihlás sa znova.')
  const response = await fetch('/api/auth-bridge', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(profile ? { profile } : {}),
  })
  const result = await response.json().catch(() => ({}))
  if (response.status === 409 && result.code === 'profile_required') {
    return { user: null, profileRequired: true, clerkUser: clerk.user, message: result.error }
  }
  if (!response.ok || !result.token_hash) throw new Error(result.error || `Prepojenie účtu zlyhalo (${response.status}).`)
  const exchange = await db.auth.verifyOtp({ token_hash: result.token_hash, type: 'magiclink' })
  if (exchange.error) throw exchange.error
  if (!exchange.data.user || exchange.data.user.id !== result.user_id) throw new Error('Supabase vrátil iný účet. Pre istotu sa odhlás a prihlás znova.')
  return { user: exchange.data.user, profileRequired: false, clerkUser: clerk.user }
}

export async function signOutClerk() {
  const clerk = await getClerk()
  if (clerk.user) await clerk.signOut()
}

export function clerkPublishableKeyExists() {
  return Boolean(import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY)
}
