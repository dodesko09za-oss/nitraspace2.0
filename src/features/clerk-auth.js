let clerkPromise
let clerkUiPromise

function loadClerkUi(publishableKey) {
  if (window.__internal_ClerkUICtor) return Promise.resolve(window.__internal_ClerkUICtor)
  if (clerkUiPromise) return clerkUiPromise

  clerkUiPromise = new Promise((resolve, reject) => {
    let frontendApi
    try {
      const encodedFrontendApi = publishableKey.split('_')[2]
      const decodedFrontendApi = atob(encodedFrontendApi)
      if (!decodedFrontendApi.endsWith('$')) throw new Error('Invalid Clerk frontend API')
      frontendApi = decodedFrontendApi.slice(0, -1)
      if (!/^[a-z0-9.-]+$/i.test(frontendApi)) throw new Error('Invalid Clerk frontend API')
    } catch {
      reject(new Error('Clerk kľúč neobsahuje platnú adresu Frontend API. Skontroluj VITE_CLERK_PUBLISHABLE_KEY.'))
      return
    }

    const script = document.createElement('script')
    script.src = `https://${frontendApi}/npm/@clerk/ui@1/dist/ui.browser.js`
    script.async = true
    script.crossOrigin = 'anonymous'
    script.dataset.clerkUi = 'true'
    script.onload = () => {
      if (window.__internal_ClerkUICtor) resolve(window.__internal_ClerkUICtor)
      else reject(new Error('Clerk UI sa načítalo, ale bezpečnostná výzva nie je dostupná. Obnov stránku a skús znova.'))
    }
    script.onerror = () => reject(new Error('Nepodarilo sa načítať bezpečnostnú kontrolu Clerk-u. Skontroluj pripojenie a skús znova.'))
    document.head.appendChild(script)
  }).catch(error => {
    clerkUiPromise = null
    throw error
  })

  return clerkUiPromise
}

export async function getClerk() {
  if (clerkPromise) return clerkPromise
  const publishableKey = String(import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY || '').trim()
  if (!publishableKey) throw new Error('Clerk ešte nie je pripojený k tejto verzii. Pridaj VITE_CLERK_PUBLISHABLE_KEY do prostredia aplikácie.')
  if (!publishableKey.startsWith('pk_test_') && !publishableKey.startsWith('pk_live_')) {
    throw new Error('Clerk nastavenie vo Verceli: VITE_CLERK_PUBLISHABLE_KEY musí obsahovať iba Publishable Key z Clerk Dashboardu.')
  }
  if (/\s|CLERK_SECRET_KEY\s*=|sk_(test|live)_/.test(publishableKey)) {
    throw new Error('Clerk nastavenie vo Verceli: do VITE_CLERK_PUBLISHABLE_KEY skopíruj iba jeden verejný pk_live_ kľúč. Tajný sk_live_ kľúč patrí samostatne do CLERK_SECRET_KEY.')
  }
  clerkPromise = (async () => {
    const { Clerk } = await import('@clerk/clerk-js')
    const ClerkUI = await loadClerkUi(publishableKey)
    const clerk = new Clerk(publishableKey)
    await clerk.load({ ui: { ClerkUI } })
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
  if (!exchange.data.user || exchange.data.user.id !== result.user_id) {
    await db.auth.signOut({ scope: 'local' })
    throw new Error('Supabase vrátil iný účet. Prihlás sa znova.')
  }
  return { user: exchange.data.user, profileRequired: false, clerkUser: clerk.user }
}

export async function signOutClerk() {
  if (!clerkPublishableKeyExists()) return
  const clerk = await getClerk()
  if (clerk.session) await clerk.signOut()
}

export async function signOutAccount(db) {
  const results = await Promise.allSettled([
    signOutClerk(),
    (async () => {
      const { error } = await db.auth.signOut({ scope: 'global' })
      if (error) throw error
    })(),
  ])
  if (results.some(result => result.status === 'rejected')) {
    throw new Error('Odhlásenie sa nedokončilo. Skús to znova.')
  }
}

export function clerkPublishableKeyExists() {
  return Boolean(import.meta.env?.VITE_CLERK_PUBLISHABLE_KEY)
}
