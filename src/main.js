import { createClient } from '@supabase/supabase-js'
import '@fontsource/anton/latin-400.css'
import '@fontsource/anton/latin-ext-400.css'
import './style.css'
import './mobile-inputs.css'
import './prechat-picker.css'
import { areChatPreferencesCompatible, selectCompatiblePairs } from './chat-matching.js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  document.querySelector('#app').innerHTML = `
    <main class="fatal">
      <section class="fatal-card">
        <h1>Nitra Space Chat</h1>
        <p>Chýbajú premenné VITE_SUPABASE_URL alebo VITE_SUPABASE_ANON_KEY.</p>
        <p>Skontroluj súbor <code>.env</code> a reštartuj Vite.</p>
      </section>
    </main>`
  throw new Error('Missing Supabase environment variables.')
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { params: { eventsPerSecond: 20 } }
})

const sessionKey = 'nitra-space-chat-session'
let sessionId = sessionStorage.getItem(sessionKey)
if (!sessionId) {
  sessionId = crypto.randomUUID()
  sessionStorage.setItem(sessionKey, sessionId)
}

const genderSelectionEnabled = new URLSearchParams(window.location.search).get('match') === 'gender'
let lookingForGender = null
let roomId = null
let channel = null
let state = genderSelectionEnabled ? 'choosing' : 'searching'
let isStopping = false
let partnerPresent = false
let messages = []
let replyTo = null
const previewReactions = import.meta.env.DEV && location.search.includes('preview-reactions')
let onlineCount = 1
let onlineChannel = null
let partnerTyping = false
let localTypingSent = false
let typingStopTimer = null
let partnerTypingTimer = null
let lastTypingBroadcastAt = 0
let lobbyChannel = null
let pairingInProgress = false
let lobbyOfferSent = false
let lobbyPairTimer = null
let lobbyRetryTimer = null
let lobbyOfferTimeout = null
let roomJoinTimer = null
let pendingPairRoomId = null

const typingIdleDelay = 1200
const typingHeartbeatDelay = 800
const partnerTypingFallbackDelay = 2200

const app = document.querySelector('#app')
const embeddedChat = new URLSearchParams(window.location.search).has('embed')
if (embeddedChat) document.documentElement.classList.add('aura-embed')
const themeKey = 'nitra-space-chat-theme-black-20261122'
const requestedReturnPath = new URLSearchParams(window.location.search).get('return')
const returnPath = requestedReturnPath?.startsWith('/') && !requestedReturnPath.startsWith('//')
  ? requestedReturnPath
  : null
let viewportFrame = null
let viewportScrollTimer = null

function scheduleScrollToBottom() {
  if (state === 'home') return
  if (viewportFrame) cancelAnimationFrame(viewportFrame)

  viewportFrame = requestAnimationFrame(() => {
    viewportFrame = null
    scrollMessages()
    clearTimeout(viewportScrollTimer)
    viewportScrollTimer = setTimeout(scrollMessages, 150)
  })
}

function updateVisualViewport() {
  const viewport = window.visualViewport
  const viewportHeight = viewport?.height || window.innerHeight
  const viewportTop = viewport?.offsetTop || 0

  document.documentElement.style.setProperty('--visual-height', `${Math.round(viewportHeight)}px`)
  document.documentElement.style.setProperty('--visual-top', `${Math.round(viewportTop)}px`)

  if (document.activeElement?.id === 'message') scheduleScrollToBottom()
}

function getPreferredTheme() {
  const savedTheme = localStorage.getItem(themeKey)
  if (savedTheme === 'light' || savedTheme === 'dark') return savedTheme
  return 'dark'
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    'content',
    theme === 'dark' ? '#0a0a0a' : '#f7f7f8'
  )
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  localStorage.setItem(themeKey, nextTheme)
  applyTheme(nextTheme)
  updateThemeButtons()
}

function updateThemeButtons() {
  const isDark = document.documentElement.dataset.theme === 'dark'
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.setAttribute('aria-label', isDark ? 'Zapnúť svetlý režim' : 'Zapnúť tmavý režim')
    button.setAttribute('title', isDark ? 'Svetlý režim' : 'Tmavý režim')
    button.innerHTML = isDark
      ? '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"></path></svg>'
      : '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.8 15.1A9 9 0 1 1 8.9 3.2a7 7 0 0 0 11.9 11.9Z"></path></svg>'
  })
}

function bindThemeButtons() {
  document.querySelectorAll('[data-theme-toggle]').forEach(button => {
    button.addEventListener('click', toggleTheme)
  })
  updateThemeButtons()
}


function updateOnlineBadge() {
  document.querySelectorAll('.online-count').forEach(el => {
    el.textContent = String(onlineCount)
  })
}

async function setupOnlinePresence() {
  onlineChannel = supabase.channel('nitra-space-online', {
    config: {
      presence: { key: sessionId }
    }
  })

  onlineChannel.on('presence', { event: 'sync' }, () => {
    const presence = onlineChannel.presenceState()
    onlineCount = Object.keys(presence).length
    updateOnlineBadge()
  })

  onlineChannel.subscribe(async status => {
    if (status === 'SUBSCRIBED') {
      try {
        await onlineChannel.track({ session_id: sessionId, online_at: new Date().toISOString() })
      } catch (error) {
        console.warn('Online presence tracking failed:', error)
      }
    }
  })
}

function render() {
  const chatActive = state !== 'home'
  document.documentElement.classList.toggle('chat-active', chatActive)
  document.body.classList.toggle('chat-active', chatActive)
  if (state === 'home') renderHome()
  else renderChat()
}

function renderHome() {
  app.innerHTML = `
    <main class="home-shell">
      <header class="site-header">
        <img class="site-name-logo" src="/nitra-space-logo-optimized.webp" alt="Nitra Space">
        <div class="site-actions">
          <div class="online-badge" aria-live="polite">
            <span class="online-dot" aria-hidden="true"></span>
            <span><strong class="online-count">${onlineCount}</strong> online</span>
          </div>
          <button class="theme-toggle" type="button" data-theme-toggle></button>
        </div>
      </header>

      <section class="home-card">
        <h1>Porozprávaj sa<br class="desktop-break"> s niekým novým.</h1>
        <p class="home-lead">Anonymný textový chat. Bez účtu, bez histórie správ.</p>

        <button id="openTerms" class="start-btn" type="button">START CHAT</button>
      </section>

      <div id="termsModal" class="modal-backdrop" hidden>
        <section class="terms-sheet" role="dialog" aria-modal="true" aria-labelledby="termsTitle">
          <div class="sheet-handle" aria-hidden="true"></div>
          <header class="terms-header">
            <div>
              <span class="eyebrow">PRED VSTUPOM</span>
              <h2 id="termsTitle">Pravidlá Nitra Space Chat</h2>
            </div>
            <button id="closeTerms" class="icon-btn" type="button" aria-label="Zavrieť">×</button>
          </header>

          <div class="terms-scroll">
            <div class="terms-intro">
              <span class="shield-icon" aria-hidden="true">✓</span>
              <p>Chat je anonymný a spája ťa s náhodným človekom. Používaj ho slušne a nezdieľaj citlivé údaje.</p>
            </div>

            <section class="terms-section">
              <h3>Základné pravidlá</h3>
              <ol>
                <li>Musíš mať aspoň <strong>16 rokov</strong>.</li>
                <li>Zakázané sú vyhrážky, obťažovanie, nenávistný alebo násilný obsah a nabádanie k nezákonnej činnosti.</li>
                <li>Nezdieľaj heslá, platobné údaje, presnú adresu ani iné citlivé osobné údaje.</li>
                <li>Zakázaný je sexuálny obsah, najmä obsah zahŕňajúci osoby mladšie ako 18 rokov.</li>
                <li>Zakázané sú podvody, spam, vydávanie sa za inú osobu a úmyselné zneužívanie služby.</li>
                <li>Ak sa cítiš nepríjemne alebo ohrozene, chat okamžite ukonči.</li>
              </ol>
            </section>

            <section class="terms-section">
              <h3>Súkromie a správy</h3>
              <p>Obsah textových správ sa v aplikácii neukladá do databázy a po skončení chatu nie je dostupná história správ. Na prevádzku služby sa však môžu spracúvať nevyhnutné technické údaje poskytovateľmi infraštruktúry, napríklad Supabase alebo Vercel.</p>
            </section>

            <section class="terms-section">
              <h3>Zodpovednosť</h3>
              <p>Každý používateľ zodpovedá za obsah, ktorý odošle. Nitra Space môže pri porušovaní pravidiel obmedziť prístup k službe. Služba negarantuje identitu, vek ani správanie osoby na druhej strane.</p>
            </section>

            <p class="legal-note">Tieto pravidlá sú prevádzkové pravidlá služby, nie náhrada individuálneho právneho poradenstva.</p>
          </div>

          <footer class="terms-footer">
            <label class="consent-row" for="termsConsent">
              <input id="termsConsent" type="checkbox">
              <span>Mám aspoň 16 rokov a súhlasím s pravidlami používania a spracovaním údajov potrebným na prevádzku služby.</span>
            </label>
            <button id="acceptAndStart" class="start-btn" type="button" disabled>POKRAČOVAŤ DO CHATU</button>
          </footer>
        </section>
      </div>
    </main>`

  const modal = document.querySelector('#termsModal')
  const consent = document.querySelector('#termsConsent')
  const accept = document.querySelector('#acceptAndStart')
  bindThemeButtons()

  const openModal = () => {
    modal.hidden = false
    document.body.classList.add('modal-open')
    setTimeout(() => consent?.focus(), 0)
  }

  const closeModal = () => {
    modal.hidden = true
    document.body.classList.remove('modal-open')
  }

  document.querySelector('#openTerms').addEventListener('click', openModal)
  document.querySelector('#closeTerms').addEventListener('click', closeModal)
  modal.addEventListener('click', event => {
    if (event.target === modal) closeModal()
  })
  consent.addEventListener('change', () => {
    accept.disabled = !consent.checked
  })
  accept.addEventListener('click', async () => {
    if (!consent.checked) return
    closeModal()
    await startChat()
  })
}

function renderChat() {
  if (state !== 'connected') replyTo = null
  const statusText = state === 'searching'
    ? 'Čakám na človeka...'
    : state === 'choosing'
      ? 'Nastav si spojenie'
      : state === 'connected'
      ? 'Pripojený'
      : 'Cudzí človek odišiel.'

  app.innerHTML = `
    <main class="chat-page">
      ${embeddedChat ? '' : `<header class="chat-header">
        <button id="brandHome" class="brand-home" type="button" aria-label="Späť na úvod">
          <img class="brand-home-logo" src="/nitra-space-logo-optimized.webp" alt="Nitra Space">
        </button>
        <div class="header-right">
          <span class="online-badge online-badge-header" aria-live="polite">
            <span class="online-dot" aria-hidden="true"></span>
            <span><strong class="online-count">${onlineCount}</strong> online</span>
          </span>
          <button class="theme-toggle" type="button" data-theme-toggle></button>
        </div>
      </header>`}

      <section class="chat-window" aria-label="Anonymný chat">
        <div class="status-row ${state}">
          <span class="status-main"><span class="status-dot" aria-hidden="true"></span><span>${statusText}</span></span>
          <span class="online-badge chat-online-badge" aria-live="polite"><span class="online-dot" aria-hidden="true"></span><span><strong class="online-count">${onlineCount}</strong> online</span></span>
        </div>

        <div id="messages" class="transcript ${messages.length || partnerTyping ? '' : 'is-empty'}" aria-live="polite">
          ${transcriptTemplate()}
        </div>

        <div class="reply-preview" id="reply-preview" hidden></div><div class="controls">
          <button id="next" class="next-btn" type="button" ${genderSelectionEnabled && state === 'choosing' ? 'disabled' : ''}>${genderSelectionEnabled && state === 'choosing' ? 'HĽADAŤ' : 'ĎALŠÍ'}</button>

          <form id="composer" class="composer">
            <label class="sr-only" for="message">Správa</label>
            <textarea
              id="message"
              maxlength="1000"
              rows="1"
              autocomplete="off"
              placeholder="${state === 'connected' ? 'Napíš správu...' : state === 'choosing' ? 'Vyber si najprv možnosť...' : 'Počkaj na pripojenie...'}"
              ${state === 'connected' ? '' : 'disabled'}
            ></textarea>
            <button class="send-btn" type="submit" ${state === 'connected' ? '' : 'disabled'}>ODOSLAŤ</button>
          </form>

          <button id="leave" class="leave-btn" type="button">ODÍSŤ</button>
        </div>
      </section>
    </main>`

  document.querySelector('#leave').addEventListener('click', leaveChat)
  document.querySelector('#brandHome')?.addEventListener('click', leaveChat)
  if (genderSelectionEnabled && state === 'choosing') {
    const updateLookingChoice = () => {
      document.querySelectorAll('[data-chat-looking]').forEach(option => {
        const selected = option.dataset.chatLooking === lookingForGender
        option.setAttribute('aria-pressed', String(selected))
        option.classList.toggle('selected', selected)
      })
      const ready = Boolean(lookingForGender)
      document.querySelector('#next').disabled = !ready
      document.querySelector('[data-gender-note]').textContent = ready
        ? 'Preferencia sa použije pri párovaní. Pohlavie sa neoveruje.'
        : 'Vyber si preferenciu pre toto spojenie.'
    }
    document.querySelectorAll('[data-chat-looking]').forEach(button => {
      button.addEventListener('click', () => {
        lookingForGender = button.dataset.chatLooking
        updateLookingChoice()
        void startChat()
      })
    })
    document.querySelector('#next').addEventListener('click', startChat)
  } else {
    document.querySelector('#next').addEventListener('click', nextChat)
  }
  document.querySelector('#messages').addEventListener('click', handleMessageAction)
  document.querySelector('#reply-preview').onclick = () => { replyTo = null; updateReplyPreview() }
  updateReplyPreview()
  document.querySelector('#composer').addEventListener('submit', sendMessage)
  bindThemeButtons()

  const input = document.querySelector('#message')
  input?.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      document.querySelector('#composer').requestSubmit()
    }
  })

  input?.addEventListener('input', () => {
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
    handleTypingInput(input.value)
    scheduleScrollToBottom()
  })

  input?.addEventListener('focus', scheduleScrollToBottom)

  // Do not open the mobile keyboard as soon as a match is made. Besides
  // surprising users, focusing a control inside an iframe can scroll iOS Safari.
  if (state === 'connected' && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    setTimeout(() => input?.focus(), 0)
  }
  scrollMessages()
}

function emptyTranscript() {
  if (state === 'choosing' && genderSelectionEnabled) {
    return `
      <section class="prechat-choice" aria-label="Výber človeka do anonymného chatu">
        <span class="prechat-eyebrow">NITRA SPACE / ANONYM CHAT</span>
        <h2>Koho chceš stretnúť?</h2>
        <p class="prechat-subtitle">Vyber si a chat otvorí spojenie.</p>
        <div class="prechat-target-options" role="group" aria-label="Koho hľadáš">
          <button type="button" data-chat-looking="guy" aria-pressed="false">Chalana</button>
          <button type="button" data-chat-looking="girl" aria-pressed="false">Babu</button>
          <button type="button" data-chat-looking="random" aria-pressed="false">Náhodne</button>
        </div>
        <small class="prechat-privacy-note" data-gender-note>Vyber si preferenciu pre toto spojenie.</small>
      </section>`
  }

  if (state === 'searching') {
    return `
      <div class="system-message">
        <strong>Hľadám dostupného človeka...</strong>
        <span>Keď sa niekto pripojí, chat sa spustí automaticky.</span>
      </div>`
  }

  if (state === 'ended') {
    return `
      <div class="system-message ended-message">
        <strong>Cudzí človek odišiel.</strong>
        <span>Klikni NEXT a nájdeme ti ďalšieho.</span>
      </div>`
  }

  return `<div class="system-message"><span>Môžeš napísať prvú správu.</span></div>`
}

function messageTemplate(message) {
  const liked = message.liked || message.partnerLiked
  const id = escapeHtml(message.id)
  return `
    <div class="chat-line ${message.mine ? 'mine' : 'theirs'}">
      <span class="message-author">${message.mine ? 'Ty' : 'Cudzí'}</span>
      <div class="message-with-actions">
        <div class="message-bubble-stack">
          <div class="message-bubble">${message.quote ? `<span class="message-quote">${escapeHtml(message.quote)}</span>` : ''}${escapeHtml(message.text)}</div>
          ${liked ? '<span class="message-like-badge" role="img" aria-label="Správa má lajk">❤️</span>' : ''}
        </div>
        <div class="message-actions">
          ${message.mine ? '' : `<button type="button" data-like="${id}" aria-label="Páči sa mi správa" aria-pressed="${Boolean(message.liked)}" class="${message.liked ? 'has-like' : ''}">${message.liked ? '♥' : '♡'}</button>`}
          <button type="button" data-reply="${id}" aria-label="Odpovedať na správu">↩</button>
        </div>
      </div>
    </div>`
}

function updateReplyPreview() {
  const preview = document.querySelector('#reply-preview')
  preview.hidden = !replyTo
  preview.innerHTML = replyTo
    ? `<span>Odpoveď: ${escapeHtml(replyTo.text.slice(0, 160))}</span><button type="button" aria-label="Zrušiť odpoveď">×</button>`
    : ''
}

function handleMessageAction(event) {
  const button = event.target.closest('button')
  if (!button || state !== 'connected') return
  const message = messages.find(item => item.id === (button.dataset.like || button.dataset.reply))
  if (!message) return
  if (button.dataset.reply) {
    replyTo = message
    updateReplyPreview()
    document.querySelector('#message').focus({ preventScroll: true })
    return
  }
  if (message.mine) return
  message.liked = !message.liked
  refreshMessages(false)
  void broadcast('reaction', { message_id: message.id, liked: message.liked })
}

function typingTemplate() {
  if (!partnerTyping || state !== 'connected') return ''
  return `
    <div class="typing-indicator" role="status">
      <span>Cudzí píše…</span>
      <span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    </div>`
}

function transcriptTemplate() {
  const content = messages.length ? messages.map(messageTemplate).join('') : (partnerTyping ? '' : emptyTranscript())
  return `${content}${typingTemplate()}`
}

function clearTypingTimer() {
  if (!typingStopTimer) return
  clearTimeout(typingStopTimer)
  typingStopTimer = null
}

function clearPartnerTypingTimer() {
  if (!partnerTypingTimer) return
  clearTimeout(partnerTypingTimer)
  partnerTypingTimer = null
}

async function setLocalTyping(isTyping, force = false) {
  if (!isTyping) clearTypingTimer()
  if (!force && localTypingSent === isTyping) return
  localTypingSent = isTyping
  lastTypingBroadcastAt = isTyping ? Date.now() : 0
  if (state === 'connected' && channel) await broadcast('typing', { typing: isTyping })
}

function setPartnerTyping(isTyping) {
  clearPartnerTypingTimer()
  partnerTyping = state === 'connected' && isTyping

  if (partnerTyping) {
    partnerTypingTimer = setTimeout(() => {
      partnerTyping = false
      partnerTypingTimer = null
      refreshMessages()
    }, partnerTypingFallbackDelay)
  }

  refreshMessages()
}

function handleTypingInput(value) {
  if (state !== 'connected' || !channel) return

  if (!value.trim()) {
    clearTypingTimer()
    void setLocalTyping(false)
    return
  }

  const now = Date.now()
  if (!localTypingSent) {
    void setLocalTyping(true)
  } else if (now - lastTypingBroadcastAt >= typingHeartbeatDelay) {
    void setLocalTyping(true, true)
  }

  clearTypingTimer()
  typingStopTimer = setTimeout(() => {
    void setLocalTyping(false)
  }, typingIdleDelay)
}

function resetTypingState() {
  clearTypingTimer()
  clearPartnerTypingTimer()
  localTypingSent = false
  lastTypingBroadcastAt = 0
  partnerTyping = false
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]))
}

function setStatus(nextState) {
  state = nextState
  if (nextState !== 'searching' && roomJoinTimer) {
    clearTimeout(roomJoinTimer)
    roomJoinTimer = null
  }
  render()
}

async function startChat() {
  if (isStopping) return
  clearTimeout(roomJoinTimer)
  roomJoinTimer = null
  pairingInProgress = false
  pendingPairRoomId = null
  resetTypingState()
  state = 'searching'
  messages = []
  partnerPresent = false
  render()
  await findPartner()
}

async function findPartner() {
  clearLobbyTimers()
  if (lobbyChannel) await supabase.removeChannel(lobbyChannel)
  lobbyOfferSent = false
  pendingPairRoomId = null
  clearTimeout(lobbyPairTimer)
  lobbyPairTimer = null
  const currentLobby = supabase.channel('nitra-space-anonymous-lobby', {
    config: { presence: { key: sessionId } }
  })
  lobbyChannel = currentLobby
  const isCurrentLobby = () => lobbyChannel === currentLobby && state === 'searching' && !isStopping
  currentLobby
    .on('presence', { event: 'sync' }, () => {
      if (isCurrentLobby()) tryPairFromLobby()
    })
    .on('broadcast', { event: 'pair-offer' }, async ({ payload }) => {
      if (!isCurrentLobby() || pairingInProgress || payload?.partner !== sessionId || !payload?.initiator || !payload?.room_id) return
      const presence = currentLobby.presenceState()
      const initiatorMetaList = presence[payload.initiator] || []
      const initiatorMeta = initiatorMetaList[initiatorMetaList.length - 1] || {}
      const initiatorPreference = initiatorMeta.looking_for || payload.looking_for
      if (!areChatPreferencesCompatible(
        { looking_for: initiatorPreference },
        { looking_for: lookingForGender || 'random' }
      )) return
      if (pendingPairRoomId && pendingPairRoomId !== payload.room_id) return
      pendingPairRoomId = payload.room_id
      lobbyOfferSent = true
      armLobbyOfferTimeout(currentLobby, payload.room_id)
      const response = await currentLobby.send({
        type: 'broadcast',
        event: 'pair-accept',
        payload: { initiator: payload.initiator, partner: sessionId, room_id: payload.room_id }
      })
      if (!isCurrentLobby()) return
      if (response !== 'ok') {
        releaseLobbyOffer(currentLobby, payload.room_id)
        console.warn('Pair accept failed:', response)
      }
    })
    .on('broadcast', { event: 'pair-accept' }, async ({ payload }) => {
      if (!isCurrentLobby() || pairingInProgress || payload?.initiator !== sessionId || payload?.room_id !== pendingPairRoomId) return
      clearTimeout(lobbyOfferTimeout)
      armLobbyOfferTimeout(currentLobby, payload.room_id)
      const response = await currentLobby.send({
        type: 'broadcast',
        event: 'pair-commit',
        payload: { initiator: sessionId, partner: payload.partner, room_id: payload.room_id }
      })
      if (!isCurrentLobby()) return
      if (response !== 'ok') {
        releaseLobbyOffer(currentLobby, payload.room_id)
        console.warn('Pair commit failed:', response)
        return
      }
      scheduleLobbyPair(payload.partner, payload.room_id)
    })
    .on('broadcast', { event: 'pair-commit' }, ({ payload }) => {
      if (!isCurrentLobby() || pairingInProgress) return
      if (payload?.partner !== sessionId || !payload?.initiator || payload?.room_id !== pendingPairRoomId) return
      scheduleLobbyPair(payload.initiator, payload.room_id)
    })
    .subscribe(async status => {
      if (!isCurrentLobby()) return
      if (status === 'SUBSCRIBED') {
        try {
          await currentLobby.track({
            session_id: sessionId,
            status: 'waiting',
            looking_for: lookingForGender || 'random',
            waiting_since: new Date().toISOString()
          })
          if (isCurrentLobby()) {
            tryPairFromLobby()
            scheduleLobbyRetry(currentLobby)
          }
        } catch (error) {
          if (!isCurrentLobby()) return
          console.error('Lobby presence failed:', error)
          showFatal('Nepodarilo sa pripojiť k chatu.', error.message)
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        showFatal('Nepodarilo sa pripojiť k chatu.', `Realtime status: ${status}`)
      }
    })
}

function tryPairFromLobby() {
  if (state !== 'searching' || isStopping || pairingInProgress || lobbyOfferSent || pendingPairRoomId || !lobbyChannel) return
  const currentLobby = lobbyChannel
  const presence = currentLobby.presenceState()
  const waiting = Object.entries(presence)
    .filter(([, metas]) => metas.some(meta => meta.status === 'waiting'))
    .map(([key, metas]) => ({ key, meta: metas[metas.length - 1] || {} }))
  const pair = selectCompatiblePairs(waiting).find(([first]) => first.key === sessionId)
  if (!pair) return
  const [first, second] = pair
  lobbyOfferSent = true
  // Each attempt gets its own room topic so stale messages from a previous
  // encounter between the same two browser sessions can never leak through.
  const sharedRoomId = crypto.randomUUID()
  pendingPairRoomId = sharedRoomId
  armLobbyOfferTimeout(currentLobby, sharedRoomId)
  void currentLobby.send({
    type: 'broadcast',
    event: 'pair-offer',
    payload: { initiator: first.key, partner: second.key, room_id: sharedRoomId, looking_for: first.meta.looking_for || 'random' }
  }).then(response => {
    if (lobbyChannel !== currentLobby || pendingPairRoomId !== sharedRoomId) return
    if (response !== 'ok') {
      releaseLobbyOffer(currentLobby, sharedRoomId)
      console.warn('Pair offer failed:', response)
    }
  }).catch(error => {
    if (lobbyChannel === currentLobby && pendingPairRoomId === sharedRoomId) releaseLobbyOffer(currentLobby, sharedRoomId)
    console.warn('Pair offer failed:', error)
  })
}

function scheduleLobbyRetry(currentLobby) {
  clearTimeout(lobbyRetryTimer)
  lobbyRetryTimer = setTimeout(() => {
    lobbyRetryTimer = null
    if (lobbyChannel !== currentLobby || state !== 'searching' || isStopping) return
    tryPairFromLobby()
    scheduleLobbyRetry(currentLobby)
  }, 1000)
}

function armLobbyOfferTimeout(currentLobby, sharedRoomId) {
  clearTimeout(lobbyOfferTimeout)
  lobbyOfferTimeout = setTimeout(() => {
    lobbyOfferTimeout = null
    if (lobbyChannel !== currentLobby || pendingPairRoomId !== sharedRoomId || state !== 'searching') return
    releaseLobbyOffer(currentLobby, sharedRoomId)
  }, 5000)
}

function releaseLobbyOffer(currentLobby, sharedRoomId) {
  if (lobbyChannel !== currentLobby || pendingPairRoomId !== sharedRoomId) return
  clearTimeout(lobbyOfferTimeout)
  lobbyOfferTimeout = null
  pendingPairRoomId = null
  lobbyOfferSent = false
}

function clearLobbyTimers() {
  clearTimeout(lobbyRetryTimer)
  clearTimeout(lobbyOfferTimeout)
  lobbyRetryTimer = null
  lobbyOfferTimeout = null
}

function scheduleLobbyPair(partnerSessionId, sharedRoomId) {
  if (lobbyPairTimer || state !== 'searching' || pairingInProgress) return
  clearLobbyTimers()
  // Let both clients receive the commit before they leave lobby Presence.
  lobbyPairTimer = setTimeout(() => {
    lobbyPairTimer = null
    void pairFromLobby(partnerSessionId, sharedRoomId)
  }, 100)
}

async function pairFromLobby(partnerSessionId, sharedRoomId) {
  if (pairingInProgress || state !== 'searching' || isStopping) return
  pairingInProgress = true
  pendingPairRoomId = null
  roomId = sharedRoomId
  const oldLobby = lobbyChannel
  lobbyChannel = null
  clearLobbyTimers()
  try {
    if (oldLobby) void supabase.removeChannel(oldLobby).catch(error => console.warn('Lobby cleanup failed:', error))
    await joinRoom(partnerSessionId)
    if (state === 'searching' && roomId === sharedRoomId) {
      roomJoinTimer = setTimeout(() => {
        roomJoinTimer = null
        if (state === 'searching' && roomId === sharedRoomId && !isStopping) void recoverPairing(sharedRoomId)
      }, 5000)
    }
  } catch (error) {
    console.error(error)
    await recoverPairing(sharedRoomId)
  }
}

async function joinRoom(partnerSessionId) {
  if (channel) {
    const previousRoom = channel
    channel = null
    await supabase.removeChannel(previousRoom)
  }

  const joinedRoomId = roomId
  let partnerMissingTimer = null
  partnerPresent = false
  const currentRoom = supabase.channel(`chat:${joinedRoomId}`, {
    config: {
      broadcast: { self: false, ack: true },
      presence: { key: sessionId }
    }
  })
  channel = currentRoom

  currentRoom
    .on('broadcast', { event: 'message' }, ({ payload }) => {
      if (channel !== currentRoom || roomId !== joinedRoomId || payload?.sender === sessionId) return
      if (payload?.room_id !== joinedRoomId) return
      clearPartnerTypingTimer()
      partnerTyping = false
      messages.push({
        id: typeof payload.id === 'string' ? payload.id : crypto.randomUUID(),
        text: String(payload.text || ''),
        quote: messages.find(message => message.id === payload.reply_to)?.text.slice(0, 160),
        mine: false
      })
      refreshMessages()
    })
    .on('broadcast', { event: 'reaction' }, ({ payload }) => {
      if (channel !== currentRoom || payload?.room_id !== joinedRoomId || payload.sender === sessionId) return
      const message = messages.find(item => item.id === payload.message_id)
      if (!message) return
      if (!message.mine) return
      message.partnerLiked = payload.liked === true
      refreshMessages(false)
    })
    .on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (channel !== currentRoom || roomId !== joinedRoomId || payload?.sender === sessionId) return
      if (payload?.room_id !== joinedRoomId) return
      setPartnerTyping(payload?.typing === true)
    })
    .on('broadcast', { event: 'matched' }, ({ payload }) => {
      if (channel !== currentRoom || roomId !== joinedRoomId || payload?.room_id !== joinedRoomId) return
      clearPartnerTypingTimer()
      partnerTyping = false
      partnerPresent = true
      pairingInProgress = false
      setStatus('connected')
    })
    .on('broadcast', { event: 'left' }, ({ payload }) => {
      if (channel !== currentRoom || roomId !== joinedRoomId || payload?.room_id !== joinedRoomId || payload.sender !== partnerSessionId) return
      clearTimeout(partnerMissingTimer)
      partnerMissingTimer = null
      partnerPresent = false
      clearPartnerTypingTimer()
      partnerTyping = false
      if (!isStopping) setStatus('ended')
    })
    .on('presence', { event: 'sync' }, () => {
      if (channel !== currentRoom || roomId !== joinedRoomId) return
      const hasPartner = Boolean(currentRoom.presenceState()[partnerSessionId]?.length)
      if (hasPartner) {
        clearTimeout(partnerMissingTimer)
        partnerMissingTimer = null
        partnerPresent = true
        pairingInProgress = false
        if (state !== 'connected') setStatus('connected')
      } else if (state === 'connected' && partnerPresent && !isStopping && partnerMissingTimer === null) {
        // The match broadcast can arrive before the partner's Presence state.
        partnerMissingTimer = setTimeout(() => {
          partnerMissingTimer = null
          if (channel !== currentRoom || roomId !== joinedRoomId || isStopping || state !== 'connected') return
          if (currentRoom.presenceState()[partnerSessionId]?.length) return
          partnerPresent = false
          clearPartnerTypingTimer()
          partnerTyping = false
          setStatus('ended')
        }, 3000)
      }
    })

  await new Promise((resolve, reject) => {
    const connectionTimeout = setTimeout(() => reject(new Error('Realtime status: ROOM_JOIN_TIMEOUT')), 5500)
    const finish = () => {
      clearTimeout(connectionTimeout)
      resolve()
    }
    currentRoom.subscribe(async status => {
      if (channel !== currentRoom || roomId !== joinedRoomId) return
      if (status === 'SUBSCRIBED') {
        try {
          await currentRoom.track({ session_id: sessionId })
          if (partnerSessionId) {
            void broadcast('matched', {}).catch(error => console.warn('Match confirmation failed:', error))
          }
          finish()
        } catch (error) {
          clearTimeout(connectionTimeout)
          reject(error)
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(connectionTimeout)
        reject(new Error(`Realtime status: ${status}`))
      }
    })
  })
}

async function recoverPairing(failedRoomId) {
  if (roomId !== failedRoomId || isStopping || state !== 'searching') return
  isStopping = true
  clearTimeout(roomJoinTimer)
  roomJoinTimer = null
  const failedRoom = channel
  channel = null
  roomId = null
  partnerPresent = false
  pairingInProgress = false
  pendingPairRoomId = null
  lobbyOfferSent = false
  try {
    if (failedRoom) await supabase.removeChannel(failedRoom)
  } catch (error) {
    console.warn('Failed room cleanup:', error)
  } finally {
    isStopping = false
  }
  state = 'searching'
  messages = []
  render()
  setTimeout(() => {
    if (state === 'searching' && !isStopping && !lobbyChannel) void findPartner()
  }, 600)
}

async function broadcast(event, payload) {
  if (!channel) return
  const response = await channel.send({
    type: 'broadcast',
    event,
    payload: { ...payload, room_id: roomId, sender: sessionId }
  })
  if (response !== 'ok') console.warn('Broadcast response:', response)
}

async function sendMessage(event) {
  event.preventDefault()
  if (state !== 'connected' || (!channel && !previewReactions)) return

  const input = document.querySelector('#message')
  const text = input.value.trim()
  if (!text) return

  const id = crypto.randomUUID()
  const replyId = replyTo?.id
  messages.push({ id, text, quote: replyTo?.text.slice(0, 160), mine: true })
  replyTo = null
  updateReplyPreview()
  input.value = ''
  input.style.height = 'auto'
  await setLocalTyping(false)
  refreshMessages()
  await broadcast('message', { id, text, reply_to: replyId })
  input.focus()
}

function refreshMessages(scroll = true) {
  const list = document.querySelector('#messages')
  if (!list) return
  list.classList.toggle('is-empty', !messages.length && !partnerTyping)
  const scrollTop = list.scrollTop
  list.innerHTML = transcriptTemplate()
  if (scroll) scrollMessages()
  else list.scrollTop = scrollTop
}

function scrollMessages() {
  const list = document.querySelector('#messages')
  if (list) list.scrollTop = list.scrollHeight
}

async function closeCurrentRoom() {
  clearLobbyTimers()
  clearTimeout(roomJoinTimer)
  roomJoinTimer = null
  try {
    if (roomId) {
      await setLocalTyping(false)
      await broadcast('left', {})
    }
  } catch (error) {
    console.warn('Closing room failed:', error)
  } finally {
    if (channel) {
      await supabase.removeChannel(channel)
      channel = null
    }
    if (lobbyChannel) {
      await supabase.removeChannel(lobbyChannel)
      lobbyChannel = null
    }
    roomId = null
    partnerPresent = false
    pairingInProgress = false
    lobbyOfferSent = false
    pendingPairRoomId = null
    clearTimeout(lobbyPairTimer)
    lobbyPairTimer = null
    resetTypingState()
  }
}

async function nextChat() {
  if (isStopping) return
  isStopping = true
  await closeCurrentRoom()
  isStopping = false
  state = 'searching'
  messages = []
  partnerPresent = false
  render()
  await findPartner()
}

async function leaveChat() {
  if (isStopping) return
  isStopping = true
  await closeCurrentRoom()
  isStopping = false
  if (returnPath) {
    window.location.assign(returnPath)
    return
  }
  state = genderSelectionEnabled ? 'choosing' : 'home'
  messages = []
  partnerPresent = false
  lookingForGender = null
  render()
}

function showFatal(title, detail) {
  app.innerHTML = `
    <main class="fatal">
      <section class="fatal-card">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(detail || 'Skontroluj Supabase nastavenie a skús to znova.')}</p>
        <button id="back" class="start-btn" type="button">SPÄŤ</button>
      </section>
    </main>`

  document.querySelector('#back').addEventListener('click', () => {
    state = 'home'
    render()
  })
}

window.addEventListener('beforeunload', () => {
  if (roomId) {
    channel?.send({
      type: 'broadcast',
      event: 'left',
      payload: { room_id: roomId, sender: sessionId }
    })
  }
})

applyTheme(getPreferredTheme())
updateVisualViewport()

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', updateVisualViewport, { passive: true })
  window.visualViewport.addEventListener('scroll', updateVisualViewport, { passive: true })
} else {
  window.addEventListener('resize', updateVisualViewport, { passive: true })
}

if (previewReactions) {
  state = 'connected'
  messages = [
    { id: 'demo-1', text: 'Ahoj! Kam chodíš v Nitre na kávu?', mine: false },
    { id: 'demo-2', text: 'Najradšej niekam na pešiu zónu.', mine: true }
  ]
  render()
} else {
  render()
  if (!genderSelectionEnabled) startChat()
  setupOnlinePresence()
}
