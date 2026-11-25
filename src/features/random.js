import { createClient } from '@supabase/supabase-js'
import { getClerk, syncClerkSessionToSupabase } from './clerk-auth.js'
import './random.css'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
const main = document.querySelector('#random-main')
const db = url && key ? createClient(url, key, {
  auth: {
    storageKey: 'nitra-space-random-auth',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
}) : null

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const iconArrow = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg>'
const topicLabels = { music: 'Hudba', events: 'Eventy', food: 'Jedlo', games: 'Hry', city: 'Mesto' }
const searchLines = ['Hľadáme niekoho pre teba…', 'Prehľadávame RANDOM…', 'Možno práve teraz čaká niekto na teba…']

let screen = 'loading'
let profile = null
let randomState = { mode: 'idle' }
let waitingCount = null
let dailyChallenge = ''
let currentUserId = null
let authStatus = 'checking'
let currentMatchId = null
let chatChannel = null
let stateTimer = null
let countTimer = null
let typingTimer = null
let inputTimer = null
let lastSearchLine = 0
let reportOpen = false
let error = ''
let messages = []
let typingRows = []
let typingRefreshTimer = null

function shell(content) {
  main.innerHTML = content
}

function bottomFooter() {
  return '<div class="random-page-bottom">Nitra Space · Nitra, Slovensko · <a href="/chat">Návrat do hlavného chatu</a></div>'
}

function renderHome() {
  const countText = waitingCount === 1 ? 'človek čaká' : waitingCount > 1 && waitingCount < 5 ? 'ľudia čakajú' : 'ľudí čaká'
  const count = Number.isInteger(waitingCount) ? `<span class="random-online"><i></i>${waitingCount} ${countText} v RANDOM</span>` : ''
  const challenge = dailyChallenge ? `<aside class="random-challenge"><span class="random-challenge-label">Daily challenge · dnes</span><p>${esc(dailyChallenge)}</p></aside>` : ''
  const start = currentUserId
    ? `<button class="random-primary" data-action="start">Nájsť človeka ${iconArrow}</button>`
    : `<a class="random-primary" href="/account?return_to=%2Frandom">Prihlásiť sa cez Clerk ${iconArrow}</a>`
  const authNote = currentUserId ? '' : `<aside class="random-notice">${authStatus === 'needsProfile' ? 'Najprv dokonči svoj Nitra Space profil.' : authStatus === 'authError' ? esc(error || 'Clerk prihlásenie sa nepodarilo overiť.') : 'Na RANDOM sa prihlás cez svoj Nitra Space účet. V chate sa zobrazí iba krstné meno a vek.'}</aside>`
  shell(`<section class="random-page random-home">
    <div class="random-home-copy">
      <div class="random-kicker">Nitra Space <span>·</span> Anonymné spoznávanie</div>
      <h1 class="random-title"><span>RANDOM</span></h1>
      <p class="random-copy">Nikdy nevieš, koho stretneš.<br>Noví ľudia. Náhodné stretnutia. Bez fotografií.</p>
      <div class="random-home-actions">${start}${count}</div>
      ${authNote}
      ${challenge}
      <div class="random-home-foot">Bez priezvisk · Bez verejných profilov · Len krstné meno a vek</div>
      ${profile ? '<button class="random-text-button" data-action="edit-profile">Upraviť svoje nastavenia</button>' : ''}
      ${error && currentUserId ? `<p class="random-error" role="alert">${esc(error)}</p>` : ''}
    </div>
    <div class="random-orbit" aria-hidden="true"><span class="random-orbit-dot"></span><span class="random-orbit-dot"></span><span class="random-orbit-dot"></span><div class="random-orbit-core">✳</div></div>
    ${bottomFooter()}
  </section>`)
}

function renderProfile() {
  const p = profile || {}
  shell(`<section class="random-page random-form-wrap">
    <div class="random-kicker">RANDOM · rýchle nastavenie</div>
    <h1 class="random-title">Koho chceš<br>stretnúť?</h1>
    <p class="random-copy">Stačia štyri údaje. Neukladáme fotografie, priezvisko ani presnú polohu.</p>
    <form class="random-form" id="random-profile-form">
      <div class="random-field"><label for="random-first-name">Krstné meno</label><input id="random-first-name" name="first_name" maxlength="24" autocomplete="given-name" pattern="[^\\s]+" value="${esc(p.first_name || '')}" placeholder="Tvoje krstné meno" required><small>Použi iba krstné meno, bez medzier.</small></div>
      <div class="random-field"><label for="random-age">Tvoj vek</label><input id="random-age" name="age" type="number" inputmode="numeric" min="16" max="99" value="${esc(p.age || '')}" placeholder="Napr. 21" required></div>
      <div class="random-field"><label for="random-age-min">Preferovaný vek · od</label><input id="random-age-min" name="age_min" type="number" inputmode="numeric" min="16" max="99" value="${esc(p.age_min ?? 18)}" required></div>
      <div class="random-field"><label for="random-age-max">Preferovaný vek · do</label><input id="random-age-max" name="age_max" type="number" inputmode="numeric" min="16" max="99" value="${esc(p.age_max ?? 99)}" required></div>
      <div class="random-field full"><label for="random-intent">Čo hľadáš?</label><select id="random-intent" name="intent" required><option value="friends" ${p.intent === 'friends' ? 'selected' : ''}>Kamarátov</option><option value="dating" ${p.intent === 'dating' ? 'selected' : ''}>Niekoho na zoznámenie</option></select><small>Ľudia sa párujú len s rovnakým zámerom.</small></div>
      <div class="random-field full"><label for="random-topic">Surprise Match · voliteľná spoločná téma</label><select id="random-topic" name="surprise_topic"><option value="none">Bez témy</option>${Object.entries(topicLabels).map(([id, label]) => `<option value="${id}" ${p.surprise_topic === id ? 'selected' : ''}>${label}</option>`).join('')}</select><small>Ak sa stretnú dvaja ľudia s rovnakou témou, RANDOM ju občas uprednostní.</small></div>
      <div class="random-form-actions"><button class="random-primary" type="submit">Nájsť človeka ${iconArrow}</button><button class="random-text-button" type="button" data-action="back-home">Späť</button></div>
    </form>
    <p class="random-notice">RANDOM je určený pre ľudí od 16 rokov. Používatelia vo veku 16–17 rokov sa párujú iba navzájom a iba na kamarátstvo.</p>
    ${error ? `<p class="random-error" role="alert">${esc(error)}</p>` : ''}
    ${bottomFooter()}
  </section>`)
  syncAgeLimits()
}

function renderSearching() {
  shell(`<section class="random-page random-state-page">
    <div class="random-kicker">RANDOM · anonymné spoznávanie</div>
    <div class="random-search-art" aria-hidden="true"><span class="random-search-icon">✳</span></div>
    <h1 class="random-title">Priprav sa<br>na náhodu.</h1>
    <p class="random-search-status" id="random-search-status">${searchLines[lastSearchLine]}</p>
    <p class="random-copy">Hľadáme človeka, ktorý zodpovedá tvojim nastaveniam.</p>
    <div class="random-match-actions"><button class="random-secondary" data-action="leave">Zrušiť hľadanie</button></div>
    <div id="random-feedback" aria-live="polite">${error ? `<p class="random-error">${esc(error)}</p>` : ''}</div>
    ${bottomFooter()}
  </section>`)
}

function renderOffer() {
  const partner = randomState.partner || {}
  const accepted = randomState.my_accepted === true
  const otherAccepted = randomState.partner_accepted === true
  const consentText = accepted ? (otherAccepted ? 'Obaja ste potvrdili. Otvárame chat…' : 'Tvoj záujem je potvrdený. Čakáme na druhú stranu…') : otherAccepted ? 'Druhá osoba už má záujem. Je to na tebe.' : 'Chat sa otvorí, keď budete súhlasiť obaja.'
  shell(`<section class="random-page random-state-page">
    <div class="random-kicker">RANDOM · anonymné spojenie</div>
    <div class="random-match-card">
      <div class="random-match-glyph" aria-hidden="true">✳</div>
      <div class="random-kicker" style="justify-content:center">Nové náhodné stretnutie</div>
      <h1 class="random-title" style="font-size:clamp(48px,8vw,76px);margin:13px 0 0">Našli sme<br>ti niekoho!</h1>
      <div class="random-match-name">${esc(partner.first_name || 'Niekto z Nitry')}</div>
      <p class="random-match-age">${Number(partner.age) || ''} rokov${randomState.surprise_topic ? ` · spoločná téma ${esc(topicLabels[randomState.surprise_topic] || '')}` : ''}</p>
      <div class="random-question"><small>Mystery question · pre vás oboch</small><p>${esc(randomState.question || 'Čo ti v poslednom čase urobilo radosť?')}</p></div>
      <p class="random-consent-wait" id="random-consent-status">${consentText}</p>
      <div class="random-match-actions"><button class="random-primary" data-action="accept" ${accepted ? 'disabled' : ''}>${accepted ? 'Potvrdené' : 'Mám záujem'} ${accepted ? '' : iconArrow}</button><button class="random-secondary" data-action="decline">Nie, ďalší človek</button></div>
      <div class="random-match-actions"><button class="random-text-button" data-action="block">Zablokovať toto spojenie</button></div>
      <div id="random-feedback" aria-live="polite">${error ? `<p class="random-error">${esc(error)}</p>` : ''}</div>
    </div>
    ${bottomFooter()}
  </section>`)
}

function renderChat() {
  const partner = randomState.partner || {}
  const accepted = randomState.partner_accepted === true && randomState.my_accepted === true
  if (!accepted) return renderOffer()
  shell(`<section class="random-page">
    <div class="random-chat" data-match="${esc(randomState.match_id)}">
      <header class="random-chat-head">
        <div class="random-chat-person"><span class="random-chat-glyph" aria-hidden="true">✳</span><div><strong>${esc(partner.first_name || 'Náhodné spojenie')}</strong><small>${Number(partner.age) || ''} rokov · anonymný chat</small></div></div>
        <div class="random-chat-tools"><button data-action="report-toggle">Nahlásiť</button><button data-action="block">Blokovať</button></div>
      </header>
      ${reportOpen ? `<form class="random-report-form" id="random-report-form"><select name="reason" aria-label="Dôvod nahlásenia"><option value="harassment">Nevhodné správanie</option><option value="spam">Spam</option><option value="unsafe">Nebezpečné správanie</option><option value="other">Iný dôvod</option></select><button class="random-secondary" type="submit">Odoslať hlásenie</button><button class="random-secondary" type="button" data-action="report-cancel">Zrušiť</button></form>` : ''}
      <div class="random-messages" id="random-messages" aria-live="polite"><div class="random-chat-empty"><strong>Rozhovor sa začína</strong>${esc(randomState.question || 'Napíš prvú správu alebo nadviaž na spoločnú otázku.')}</div></div>
      <div><div class="random-typing" id="random-typing" aria-live="polite"></div><form class="random-chat-compose" id="random-chat-form"><textarea name="body" maxlength="1000" rows="1" placeholder="Napíš správu…" aria-label="Tvoja správa" required></textarea><button class="random-primary" type="submit">Odoslať ${iconArrow}</button></form><div class="random-chat-foot"><span>${esc(randomState.daily_challenge || '')}</span><button type="button" data-action="leave">Ukončiť rozhovor</button><button type="button" data-action="next">Ďalší človek</button></div></div>
    </div>
    <div id="random-feedback" aria-live="polite">${error ? `<p class="random-error">${esc(error)}</p>` : ''}</div>
    ${bottomFooter()}
  </section>`)
}

function renderEnded() {
  const reason = randomState.reason
  const heading = reason === 'blocked' ? 'Spojenie ukončené' : 'Rozhovor sa skončil'
  shell(`<section class="random-page random-state-page"><div class="random-search-art" aria-hidden="true"><span class="random-search-icon">✳</span></div><div class="random-kicker" style="justify-content:center">RANDOM · ďalšie náhodné stretnutie</div><h1 class="random-title">${esc(heading)}</h1><p class="random-copy">Keď budeš pripravený/pripravená, nájdeme niekoho nového.</p><div class="random-match-actions"><button class="random-primary" data-action="next">Nájsť ďalšieho človeka ${iconArrow}</button><button class="random-secondary" data-action="home">Späť na RANDOM</button></div>${error ? `<p class="random-error">${esc(error)}</p>` : ''}${bottomFooter()}</section>`)
}

function render() {
  if (screen === 'home') renderHome()
  else if (screen === 'profile') renderProfile()
  else if (screen === 'searching') renderSearching()
  else if (screen === 'offer') renderOffer()
  else if (screen === 'chat') renderChat()
  else if (screen === 'ended') renderEnded()
  else if (screen === 'error') shell(`<section class="random-page random-form-wrap"><div class="random-kicker">RANDOM · pripojenie</div><h1 class="random-title">RANDOM<br>je offline.</h1><p class="random-copy">${esc(error || 'Nepodarilo sa pripojiť k databáze.')}</p><p class="random-notice">RANDOM používa Clerk na prihlásenie a Supabase na databázu. Anonymous sign-ins v Supabase netreba zapínať.</p><div class="random-match-actions"><button class="random-secondary" data-action="retry">Skúsiť znova</button><a class="random-secondary" href="/chat">Späť na Nitra Space</a></div></section>`)
}

function feedback(message, isError = false) {
  const target = document.querySelector('#random-feedback')
  if (target) target.innerHTML = message ? `<p class="${isError ? 'random-error' : 'random-notice'}">${esc(message)}</p>` : ''
  else if (message) { error = message; render() }
}

function setScreen(next) {
  const previous = screen
  if (previous === next) { render(); return }
  if (previous === 'chat') unmountChat()
  screen = next
  render()
  syncStateTimer()
  if (next === 'chat') mountChat().catch(err => feedback(err.message || 'Chat sa nenačítal.', true))
}

async function ensureClerkUser() {
  if (!db) throw new Error('Chýba VITE_SUPABASE_URL alebo VITE_SUPABASE_ANON_KEY.')
  const clerk = await getClerk()
  if (!clerk.user || !clerk.session) throw new Error('Najprv sa prihlás cez Clerk do Nitra Space a potom otvor RANDOM znova.')
  const existing = await db.auth.getSession()
  if (existing.error) throw existing.error
  const user = existing.data.session?.user
  if (user?.app_metadata?.auth_provider === 'clerk' && user.app_metadata?.clerk_user_id === clerk.user.id) {
    currentUserId = user.id
    return
  }
  const linked = await syncClerkSessionToSupabase(db)
  if (linked.profileRequired) throw new Error('Najprv dokonči registráciu a profil Nitra Space, potom môžeš použiť RANDOM.')
  if (!linked.user) throw new Error('Clerk účet sa nepodarilo prepojiť so Supabase. Skús sa znova prihlásiť.')
  currentUserId = linked.user.id
}

function rpcError(result) {
  if (result.error) throw result.error
  return result.data
}

async function loadInitial() {
  try {
    if (!db) throw new Error('Chýba VITE_SUPABASE_URL alebo VITE_SUPABASE_ANON_KEY.')
    const [challengeResult, countResult] = await Promise.all([
      db.rpc('random_daily_challenge'), db.rpc('random_waiting_count')
    ])
    if (challengeResult.error) throw challengeResult.error
    if (countResult.error) throw countResult.error
    dailyChallenge = String(challengeResult.data || '')
    waitingCount = Number(countResult.data)
    try {
      const clerk = await getClerk()
      if (clerk.user && clerk.session) {
        await ensureClerkUser()
        authStatus = 'ready'
      } else {
        const session = await db.auth.getSession()
        if (session.error) throw session.error
        if (session.data.session) await db.auth.signOut({ scope: 'local' })
        currentUserId = null
        authStatus = 'signedOut'
      }
    } catch (authError) {
      currentUserId = null
      error = friendlyError(authError)
      authStatus = /dokonči.*profil/i.test(error) ? 'needsProfile' : 'authError'
    }
    if (currentUserId) {
      const [profileResult, stateResult] = await Promise.all([db.rpc('random_profile'), db.rpc('random_state')])
      profile = rpcError(profileResult)
      randomState = rpcError(stateResult) || { mode: 'idle' }
    } else {
      profile = null
      randomState = { mode: 'idle' }
    }
    screen = ({ offer: 'offer', chat: 'chat', searching: 'searching', ended: 'ended' })[randomState.mode] || 'home'
    render()
    syncStateTimer()
    countTimer = window.setInterval(refreshCount, 20000)
    if (screen === 'chat') await mountChat()
  } catch (err) {
    error = friendlyError(err)
    screen = 'error'
    render()
  }
}

function friendlyError(err) {
  const message = err?.message || String(err || 'Neznáma chyba.')
  if (/Failed to fetch|NetworkError|fetch/i.test(message)) return 'Supabase je momentálne nedostupné. Skontroluj pripojenie a konfiguráciu projektu.'
  if (/Najprv sa prihlás cez Clerk/i.test(message) || /dokonči.*profil/i.test(message)) return message
  if (/Clerk ešte nie je pripojený/i.test(message)) return 'Clerk nie je nakonfigurovaný v tejto lokálnej verzii. Skontroluj Clerk premenné v .env.'
  if (/mostík ešte nie je nastavený/i.test(message)) return 'Serverový mostík Clerk–Supabase nie je nakonfigurovaný. Skontroluj serverové premenné Clerk a Supabase.'
  if (/Could not find the function|schema cache|does not exist/i.test(message)) return 'Databázová migrácia RANDOM ešte nie je aplikovaná na tomto Supabase projekte.'
  return message
}

function modeToScreen(mode) {
  return ({ offer: 'offer', chat: 'chat', searching: 'searching', ended: 'ended' })[mode] || 'home'
}

async function refreshState() {
  if (!db || document.hidden || screen === 'profile' || screen === 'error') return
  const result = await db.rpc('random_state')
  if (result.error) { if (screen !== 'chat') feedback(friendlyError(result.error), true); return }
  const next = result.data || { mode: 'idle' }
  const nextScreen = modeToScreen(next.mode)
  const wasActive = ['offer', 'chat', 'searching'].includes(screen)
  if (nextScreen === 'home' && wasActive) {
    randomState = { mode: 'ended', reason: 'inactive' }
    setScreen('ended')
    return
  }
  randomState = next
  if (screen !== nextScreen) setScreen(nextScreen)
  else if (screen === 'offer') updateOfferStatus()
}

async function refreshCount() {
  if (!db || document.hidden) return
  const result = await db.rpc('random_waiting_count')
  if (result.error) return
  waitingCount = Number(result.data)
  if (screen === 'home') renderHome()
}

function syncStateTimer() {
  window.clearInterval(stateTimer)
  const delay = screen === 'chat' ? 12000 : screen === 'searching' || screen === 'offer' ? 4500 : 18000
  stateTimer = window.setInterval(() => refreshState().catch(() => {}), delay)
}

function syncAgeLimits() {
  const age = document.querySelector('#random-age')
  const min = document.querySelector('#random-age-min')
  const max = document.querySelector('#random-age-max')
  const intent = document.querySelector('#random-intent')
  if (!age || !min || !max || !intent) return
  const minor = Number(age.value) > 0 && Number(age.value) < 18
  const option = intent.querySelector('option[value="dating"]')
  if (option) option.disabled = minor
  if (minor) {
    intent.value = 'friends'
    min.min = '16'; min.max = '17'; max.min = '16'; max.max = '17'
    if (Number(min.value) < 16 || Number(min.value) > 17) min.value = '16'
    if (Number(max.value) < 16 || Number(max.value) > 17) max.value = '17'
  } else {
    min.min = '18'; max.min = '18'; min.max = '99'; max.max = '99'
    if (Number(min.value) < 18) min.value = '18'
    if (Number(max.value) < 18) max.value = '18'
  }
}

async function startMatching(nextProfile) {
  error = ''
  const result = await db.rpc('random_join', {
    p_first_name: nextProfile.first_name,
    p_age: Number(nextProfile.age),
    p_age_min: Number(nextProfile.age_min),
    p_age_max: Number(nextProfile.age_max),
    p_intent: nextProfile.intent,
    p_surprise_topic: nextProfile.surprise_topic || 'none'
  })
  if (result.error) throw result.error
  profile = nextProfile
  randomState = result.data || { mode: 'searching' }
  setScreen(modeToScreen(randomState.mode))
}

function updateOfferStatus() {
  const status = document.querySelector('#random-consent-status')
  const button = document.querySelector('[data-action="accept"]')
  if (!status) return
  const accepted = randomState.my_accepted === true
  const otherAccepted = randomState.partner_accepted === true
  status.textContent = accepted ? (otherAccepted ? 'Obaja ste potvrdili. Otvárame chat…' : 'Tvoj záujem je potvrdený. Čakáme na druhú stranu…') : otherAccepted ? 'Druhá osoba už má záujem. Je to na tebe.' : 'Chat sa otvorí, keď budete súhlasiť obaja.'
  if (button) { button.disabled = accepted; button.innerHTML = accepted ? 'Potvrdené' : `Mám záujem ${iconArrow}` }
}

function renderMessage(message) {
  if (!message?.id || messages.some(item => item.id === message.id)) return
  const box = document.querySelector('#random-messages')
  if (!box) return
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 90
  box.querySelector('.random-chat-empty')?.remove()
  messages.push(message)
  const node = document.createElement('article')
  node.className = `random-message${message.sender_id === currentUserId ? ' mine' : ''}`
  const time = new Date(message.created_at).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })
  const meta = document.createElement('small')
  meta.textContent = message.sender_id === currentUserId ? `Ty · ${time}` : `RANDOM · ${time}`
  const text = document.createElement('p')
  text.textContent = message.body
  node.append(meta, text)
  box.append(node)
  if (nearBottom) box.scrollTop = box.scrollHeight
}

async function mountChat() {
  const matchId = randomState.match_id
  if (!matchId || !db) return
  currentMatchId = matchId
  messages = []
  const box = document.querySelector('#random-messages')
  if (!box) return
  const result = await db.from('random_messages').select('id,match_id,sender_id,body,created_at').eq('match_id', matchId).order('created_at', { ascending: true }).limit(100)
  if (result.error) { feedback(friendlyError(result.error), true); return }
  box.innerHTML = ''
  for (const message of result.data || []) renderMessage(message)
  if (!messages.length) box.innerHTML = `<div class="random-chat-empty"><strong>Rozhovor sa začína</strong>${esc(randomState.question || 'Napíš prvú správu alebo nadviaž na spoločnú otázku.')}</div>`
  const typingResult = await db.from('random_typing').select('user_id,is_typing,updated_at').eq('match_id', matchId)
  typingRows = typingResult.error ? [] : typingResult.data || []
  updateTyping(typingRows)
  const channel = db.channel(`random-chat-${matchId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'random_messages', filter: `match_id=eq.${matchId}` }, payload => renderMessage(payload.new))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'random_typing', filter: `match_id=eq.${matchId}` }, payload => {
      const row = payload.new || payload.old
      const index = typingRows.findIndex(item => item.user_id === row?.user_id)
      if (index >= 0) typingRows[index] = row
      else if (row) typingRows.push(row)
      updateTyping(typingRows)
    })
    .subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') feedback(err?.message || 'Realtime sa odpojil. Obnovujem stav…', true)
    })
  chatChannel = channel
  window.clearInterval(typingRefreshTimer)
  typingRefreshTimer = window.setInterval(() => updateTyping(typingRows), 1700)
}

function updateTyping(rows) {
  const target = document.querySelector('#random-typing')
  if (!target) return
  const partnerTyping = rows.some(row => row.user_id !== currentUserId && row.is_typing && Date.now() - new Date(row.updated_at).getTime() < 6500)
  target.textContent = partnerTyping ? `${randomState.partner?.first_name || 'Druhá strana'} píše…` : ''
}

function unmountChat() {
  window.clearTimeout(inputTimer)
  window.clearTimeout(typingTimer)
  if (chatChannel) db?.removeChannel(chatChannel)
  window.clearInterval(typingRefreshTimer)
  chatChannel = null
  currentMatchId = null
  messages = []
  typingRows = []
}

async function setTyping(value) {
  if (!currentMatchId || !db) return
  await db.rpc('random_set_typing', { p_match_id: currentMatchId, p_is_typing: value })
}

async function sendMessage(form) {
  const field = form.elements.body
  const body = field.value.trim()
  if (!body || !currentMatchId) return
  const button = form.querySelector('[type="submit"]')
  button.disabled = true
  const result = await db.rpc('random_send_message', { p_match_id: currentMatchId, p_body: body })
  button.disabled = false
  if (result.error) { feedback(friendlyError(result.error), true); return }
  field.value = ''
  await setTyping(false)
  renderMessage(result.data)
  field.focus()
}

async function respond(accept) {
  const result = await db.rpc('random_respond', { p_match_id: randomState.match_id, p_accept: accept })
  if (result.error) { feedback(friendlyError(result.error), true); return }
  randomState = result.data || { mode: 'searching' }
  if (randomState.mode === 'searching') setScreen('searching')
  else setScreen(modeToScreen(randomState.mode))
}

async function leaveChat() {
  await setTyping(false)
  const result = await db.rpc('random_leave')
  if (result.error) throw result.error
  randomState = { mode: 'ended', reason: 'ended' }
  setScreen('ended')
}

async function findNext() {
  if (!profile) { setScreen('profile'); return }
  error = ''
  const result = await db.rpc('random_next')
  if (result.error) throw result.error
  randomState = result.data || { mode: 'searching' }
  setScreen(modeToScreen(randomState.mode))
}

async function blockCurrent() {
  if (!randomState.match_id || !window.confirm('Zablokovať toto anonymné spojenie a zabrániť ďalšiemu párovaniu?')) return
  const result = await db.rpc('random_block', { p_match_id: randomState.match_id })
  if (result.error) throw result.error
  randomState = result.data || { mode: 'searching' }
  setScreen(modeToScreen(randomState.mode))
}

async function rerenderChat() {
  unmountChat()
  renderChat()
  await mountChat()
}

main.addEventListener('click', async event => {
  const control = event.target.closest('[data-action]')
  if (!control || control.disabled) return
  control.disabled = true
  const action = control.dataset.action
  try {
    if (action === 'start') {
      if (!currentUserId) { window.location.assign('/account?return_to=%2Frandom'); return }
      if (profile) await startMatching(profile)
      else setScreen('profile')
    } else if (action === 'edit-profile') setScreen('profile')
    else if (action === 'back-home' || action === 'home') { randomState = { mode: 'idle' }; setScreen('home') }
    else if (action === 'accept') { control.disabled = true; await respond(true) }
    else if (action === 'decline') await respond(false)
    else if (action === 'leave') await leaveChat()
    else if (action === 'next') await findNext()
    else if (action === 'block') await blockCurrent()
    else if (action === 'report-toggle') { reportOpen = !reportOpen; await rerenderChat() }
    else if (action === 'report-cancel') { reportOpen = false; await rerenderChat() }
    else if (action === 'retry') { screen = 'loading'; main.innerHTML = '<div class="random-loading"><span class="random-spinner"></span><p>Pripájam RANDOM…</p></div>'; await loadInitial() }
  } catch (err) { feedback(friendlyError(err), true) }
  finally { if (control.isConnected) control.disabled = false }
})

main.addEventListener('submit', async event => {
  event.preventDefault()
  const form = event.target
  try {
    if (form.id === 'random-profile-form') {
      if (!form.reportValidity()) return
      const fields = new FormData(form)
      const age = Number(fields.get('age'))
      const nextProfile = {
        first_name: String(fields.get('first_name') || '').trim(), age,
        age_min: Number(fields.get('age_min')), age_max: Number(fields.get('age_max')),
        intent: String(fields.get('intent')), surprise_topic: String(fields.get('surprise_topic') || 'none')
      }
      const button = form.querySelector('[type="submit"]')
      button.disabled = true; button.textContent = 'Hľadám…'
      await ensureClerkUser()
      await startMatching(nextProfile)
    } else if (form.id === 'random-chat-form') await sendMessage(form)
    else if (form.id === 'random-report-form') {
      const reason = new FormData(form).get('reason')
      const result = await db.rpc('random_report', { p_match_id: currentMatchId, p_reason: reason })
      if (result.error) throw result.error
      reportOpen = false
      await rerenderChat()
      feedback('Ďakujeme. Hlásenie bolo uložené.')
    }
  } catch (err) { feedback(friendlyError(err), true) }
})

main.addEventListener('input', event => {
  if (event.target.id === 'random-age') syncAgeLimits()
  if (event.target.matches('#random-chat-form textarea')) {
    window.clearTimeout(inputTimer)
    window.clearTimeout(typingTimer)
    inputTimer = window.setTimeout(() => setTyping(true), 250)
    typingTimer = window.setTimeout(() => setTyping(false), 1450)
  }
})

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { refreshState().catch(() => {}); refreshCount().catch(() => {}) }
})
window.addEventListener('pagehide', () => { if (screen === 'chat') setTyping(false).catch(() => {}) })

window.setInterval(() => {
  if (screen !== 'searching') return
  lastSearchLine = (lastSearchLine + 1) % searchLines.length
  const target = document.querySelector('#random-search-status')
  if (target) target.textContent = searchLines[lastSearchLine]
}, 3100)

loadInitial()
