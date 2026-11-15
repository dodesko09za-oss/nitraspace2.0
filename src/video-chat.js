import { createClient } from '@supabase/supabase-js'
import '@fontsource/anton/latin-400.css'
import './video-chat.css'
import { selectVideoPair } from './video-chat-core.js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const app = document.querySelector('#video-chat-app')
const sessionKey = 'nitra-space-video-session'
const sessionId = sessionStorage.getItem(sessionKey) || crypto.randomUUID()
sessionStorage.setItem(sessionKey, sessionId)
const db = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey, { realtime: { params: { eventsPerSecond: 30 } } }) : null

let lobby = null
let room = null
let peer = null
let localStream = null
let remoteStream = null
let roomId = null
let partnerId = null
let phase = 'idle'
let offerStarted = false
let offerSent = false
let matching = false
let incomingCandidates = []
let messages = []
let noticeTimer = null
let offerTimer = null

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const notice = (text, error = false) => { const node = document.querySelector('[data-vc-notice]'); if (!node) return; node.textContent = text; node.classList.toggle('vc-error', error); clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { node.textContent = ''; node.classList.remove('vc-error') }, 7000) }

function shell() {
  app.innerHTML = `<header class="vc-header"><a class="vc-logo" href="/space#chat"><span>NITRA</span><span>SPACE</span></a><nav class="vc-modes" aria-label="Typ chatu"><a href="/space#chat">Anonym chat</a><a class="active" aria-current="page" href="/video-chat.html">Video chat</a></nav></header>
  <main class="vc-wrap"><div class="vc-live-room"><div class="vc-stage"><video class="vc-remote" data-remote autoplay playsinline hidden></video><div class="vc-remote-empty" data-empty><div><b data-empty-title>VIDEO CHAT</b><span data-empty-copy>Zapni kameru a hľadaj človeka.</span></div></div>
  <div class="vc-local-wrap" hidden data-local-wrap><video class="vc-local" data-local autoplay muted playsinline></video><span class="vc-video-label">TY</span></div>
  <div class="vc-live-controls"><span class="vc-status"><i class="vc-dot" data-status-dot></i><strong data-status>Pripravený</strong></span><div class="vc-controls"><button class="vc-btn primary" data-start>Začať</button><button class="vc-btn" data-next hidden>Ďalší</button><button class="vc-btn" data-camera hidden>Kamera</button><button class="vc-btn" data-mic hidden>Mikrofón</button><button class="vc-btn danger" data-leave hidden>Ukončiť</button></div></div>
  <section class="vc-side vc-live-chat" aria-label="Chat"><div class="vc-messages" data-messages aria-live="polite"><div class="vc-message system">Správy sa zobrazia po spojení.</div></div><form class="vc-compose" data-form><input name="message" maxlength="500" autocomplete="off" placeholder="Napíš správu…" disabled required><button aria-label="Odoslať správu" disabled>↑</button></form></section></div>
  <p class="vc-privacy" role="status" data-vc-notice></p></main>`
  document.querySelector('[data-start]').addEventListener('click', start)
  document.querySelector('[data-next]').addEventListener('click', next)
  document.querySelector('[data-leave]').addEventListener('click', leave)
  document.querySelector('[data-camera]').addEventListener('click', toggleCamera)
  document.querySelector('[data-mic]').addEventListener('click', toggleMic)
  document.querySelector('[data-form]').addEventListener('submit', sendMessage)
}

function updateUI() {
  const labels = { idle: 'Pripravený', requesting: 'Povoľ kameru…', searching: 'Hľadám…', connected: 'Pripojený', ended: 'Odpojený' }
  const status = document.querySelector('[data-status]')
  if (!status) return
  status.textContent = labels[phase] || labels.idle
  document.querySelector('[data-status-dot]').classList.toggle('live', phase === 'connected')
  document.querySelector('[data-start]').hidden = Boolean(localStream) || !['idle', 'ended'].includes(phase)
  document.querySelector('[data-next]').hidden = !localStream || !['searching', 'connected', 'ended'].includes(phase)
  document.querySelector('[data-leave]').hidden = !['searching', 'connected', 'ended'].includes(phase)
  document.querySelector('[data-camera]').hidden = !localStream
  document.querySelector('[data-mic]').hidden = !localStream
  if (localStream) {
    document.querySelector('[data-camera]').textContent = localStream.getVideoTracks()[0]?.enabled ? 'Vypnúť kameru' : 'Zapnúť kameru'
    document.querySelector('[data-mic]').textContent = localStream.getAudioTracks()[0]?.enabled ? 'Vypnúť mikrofón' : 'Zapnúť mikrofón'
  }
  const input = document.querySelector('[data-form] input')
  const submit = document.querySelector('[data-form] button')
  input.disabled = phase !== 'connected'
  submit.disabled = phase !== 'connected'
  input.placeholder = phase === 'connected' ? 'Napíš správu…' : 'Najprv sa pripoj…'
}

function addMessage(text, mine = false, system = false) {
  messages.push({ text, mine, system })
  const list = document.querySelector('[data-messages]')
  if (!list) return
  list.innerHTML = messages.map(message => `<div class="vc-message${message.mine ? ' mine' : ''}${message.system ? ' system' : ''}">${esc(message.text)}</div>`).join('')
  list.scrollTop = list.scrollHeight
}

async function start() {
  if (!db) return notice('Chýba konfigurácia Supabase. Skús obnoviť stránku alebo kontaktuj podporu.', true)
  if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) return notice('Tento prehliadač nepodporuje videochat. Otvor stránku v aktuálnom Chrome alebo Safari cez HTTPS.', true)
  phase = 'requesting'; updateUI()
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: true })
    document.querySelector('[data-local]').srcObject = localStream
    document.querySelector('[data-local-wrap]').hidden = false
    document.querySelector('[data-empty-title]').textContent = 'HĽADÁM…'
    document.querySelector('[data-empty-copy]').textContent = 'Čakám na ďalšieho človeka.'
    await joinLobby()
  } catch (error) {
    for (const track of localStream?.getTracks() || []) track.stop()
    localStream = null
    document.querySelector('[data-local]').srcObject = null
    document.querySelector('[data-local-wrap]').hidden = true
    phase = 'idle'; updateUI()
    notice(error.name === 'NotAllowedError' ? 'Povoľ kameru a mikrofón v prehliadači a skús znova.' : error.message || 'Kameru sa nepodarilo zapnúť.', true)
  }
}

async function joinLobby() {
  if (lobby) await db.removeChannel(lobby)
  phase = 'searching'; matching = false; offerSent = false; roomId = null; partnerId = null; messages = []; updateUI()
  document.querySelector('[data-remote]').hidden = true
  document.querySelector('[data-empty]').hidden = false
  document.querySelector('[data-empty-title]').textContent = 'HĽADÁM…'
  document.querySelector('[data-empty-copy]').textContent = 'Čakám na ďalšieho človeka.'
  document.querySelector('[data-messages]').innerHTML = '<div class="vc-message system">Čakám na spojenie…</div>'
  lobby = db.channel('nitra-space-video-lobby', { config: { presence: { key: sessionId } } })
    .on('presence', { event: 'sync' }, tryPair)
    .on('broadcast', { event: 'offer' }, async ({ payload }) => {
      if (phase !== 'searching' || matching || payload?.partner !== sessionId) return
      const result = await lobby?.send({ type: 'broadcast', event: 'accept', payload: { initiator: payload.initiator, partner: sessionId, room_id: payload.room_id } })
      if (result !== 'ok') notice('Nepodarilo sa potvrdiť spojenie. Skúsime to znova.', true)
    })
    .on('broadcast', { event: 'accept' }, async ({ payload }) => {
      if (phase !== 'searching' || matching || payload?.initiator !== sessionId) return
      const result = await lobby?.send({ type: 'broadcast', event: 'commit', payload: { initiator: sessionId, partner: payload.partner, room_id: payload.room_id } })
      if (result !== 'ok') {
        offerSent = false
        notice('Spojenie sa nepotvrdilo. Hľadám ďalej…', true)
        return
      }
      clearTimeout(offerTimer)
      void connectTo(payload.partner, payload.room_id, true).catch(error => { console.error(error); notice(error.message || 'Spojenie sa nepodarilo vytvoriť.', true); void leave() })
    })
    .on('broadcast', { event: 'commit' }, ({ payload }) => {
      if (phase !== 'searching' || matching || payload?.partner !== sessionId || !payload.initiator) return
      void connectTo(payload.initiator, payload.room_id, false).catch(error => { console.error(error); notice(error.message || 'Spojenie sa nepodarilo vytvoriť.', true); void leave() })
    })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') await lobby.track({ session_id: sessionId, status: 'video-waiting', waiting_since: new Date().toISOString() })
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') notice('Realtime sa nepripojil. Skontroluj pripojenie a skús znova.', true)
    })
}

function tryPair() {
  if (phase !== 'searching' || matching || offerSent || !lobby) return
  const pair = selectVideoPair(lobby.presenceState(), sessionId)
  if (!pair) return
  offerSent = true
  void lobby.send({ type: 'broadcast', event: 'offer', payload: { initiator: pair.initiator, partner: pair.partner, room_id: pair.roomId } }).then(result => {
    if (result !== 'ok') {
      offerSent = false
      notice('Realtime nedoručil žiadosť o spojenie. Hľadám ďalej…', true)
      return
    }
    clearTimeout(offerTimer)
    offerTimer = setTimeout(() => {
      if (phase !== 'searching' || matching) return
      offerSent = false
      tryPair()
    }, 8000)
  }).catch(error => {
    offerSent = false
    console.error('Video lobby offer failed:', error)
    notice('Realtime sa prerušil. Skúsime párovanie znova.', true)
  })
}

async function connectTo(otherId, id, initiator) {
  if (matching || phase !== 'searching') return
  clearTimeout(offerTimer)
  matching = true; partnerId = otherId; roomId = id
  const oldLobby = lobby; lobby = null
  if (oldLobby) await db.removeChannel(oldLobby)
  messages = []; document.querySelector('[data-messages]').innerHTML = ''
  room = db.channel(`video:${roomId}`, { config: { broadcast: { self: false, ack: true }, presence: { key: sessionId } } })
    .on('broadcast', { event: 'signal' }, ({ payload }) => { if (payload?.sender === sessionId || payload?.room_id !== roomId) return; void handleSignal(payload.data) })
    .on('broadcast', { event: 'message' }, ({ payload }) => { if (payload?.sender !== sessionId && payload?.room_id === roomId) addMessage(String(payload.text || '').slice(0, 500)) })
    .on('broadcast', { event: 'left' }, ({ payload }) => { if (payload?.room_id === roomId && payload?.sender !== sessionId) endRoom('Druhý človek ukončil spojenie.') })
    .on('presence', { event: 'sync' }, () => { if (Object.keys(room?.presenceState() || {}).some(key => key !== sessionId)) void startOfferIfReady(initiator) })
  await new Promise((resolve, reject) => room.subscribe(async status => {
    if (status === 'SUBSCRIBED') { await room.track({ session_id: sessionId }); resolve() }
    else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('Nepodarilo sa vytvoriť signalizačný kanál.'))
  }))
  makePeer(initiator)
  addMessage('Spojené.', false, true)
  phase = 'connected'; updateUI()
  await startOfferIfReady(initiator)
}

function makePeer(initiator) {
  peer?.close()
  incomingCandidates = []
  peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] })
  remoteStream = new MediaStream()
  document.querySelector('[data-remote]').srcObject = remoteStream
  peer.ontrack = event => { for (const track of event.streams[0]?.getTracks() || [event.track]) remoteStream.addTrack(track); document.querySelector('[data-remote]').hidden = false; document.querySelector('[data-empty]').hidden = true }
  peer.onicecandidate = event => { if (event.candidate) sendSignal({ type: 'candidate', candidate: event.candidate.toJSON() }) }
  peer.onconnectionstatechange = () => {
    if (peer?.connectionState === 'connected') { document.querySelector('[data-status]').textContent = 'Videochat prebieha'; document.querySelector('[data-status-dot]').classList.add('live') }
    if (peer?.connectionState === 'failed' && phase === 'connected') endRoom('Video spojenie sa prerušilo.')
  }
  for (const track of localStream?.getTracks() || []) peer.addTrack(track, localStream)
  peer.__initiator = initiator
}

async function startOfferIfReady(initiator) {
  if (!initiator || offerStarted || !peer || !room || Object.keys(room.presenceState()).length < 2) return
  offerStarted = true
  const offer = await peer.createOffer()
  await peer.setLocalDescription(offer)
  await sendSignal({ type: 'offer', description: peer.localDescription.toJSON() })
}

async function sendSignal(data) { if (!room || !roomId) return; await room.send({ type: 'broadcast', event: 'signal', payload: { room_id: roomId, sender: sessionId, data } }) }

async function handleSignal(data) {
  if (!peer || !data) return
  try {
    if (data.type === 'offer') {
      await peer.setRemoteDescription(data.description)
      for (const candidate of incomingCandidates.splice(0)) await peer.addIceCandidate(candidate)
      const answer = await peer.createAnswer(); await peer.setLocalDescription(answer)
      await sendSignal({ type: 'answer', description: peer.localDescription.toJSON() })
    } else if (data.type === 'answer') {
      if (peer.signalingState !== 'have-local-offer') return
      await peer.setRemoteDescription(data.description)
      for (const candidate of incomingCandidates.splice(0)) await peer.addIceCandidate(candidate)
    } else if (data.type === 'candidate' && data.candidate) {
      const candidate = new RTCIceCandidate(data.candidate)
      if (peer.remoteDescription) await peer.addIceCandidate(candidate)
      else incomingCandidates.push(candidate)
    }
  } catch (error) { console.error('Video signaling failed:', error); notice('Video spojenie sa nepodarilo. Skús ďalšieho človeka.', true) }
}

async function sendMessage(event) {
  event.preventDefault()
  const form = event.currentTarget, input = form.elements.message, text = input.value.trim()
  if (!text || phase !== 'connected' || !room) return
  input.value = ''; addMessage(text, true)
  await room.send({ type: 'broadcast', event: 'message', payload: { room_id: roomId, sender: sessionId, text: text.slice(0, 500) } })
}

function toggleCamera() {
  const track = localStream?.getVideoTracks()[0]; if (!track) return
  track.enabled = !track.enabled
  document.querySelector('[data-camera]').textContent = track.enabled ? 'Vypnúť kameru' : 'Zapnúť kameru'
}
function toggleMic() {
  const track = localStream?.getAudioTracks()[0]; if (!track) return
  track.enabled = !track.enabled
  document.querySelector('[data-mic]').textContent = track.enabled ? 'Vypnúť mikrofón' : 'Zapnúť mikrofón'
}

async function clearConnection(announce = false) {
  clearTimeout(offerTimer)
  offerTimer = null
  if (announce && room && roomId) await room.send({ type: 'broadcast', event: 'left', payload: { room_id: roomId, sender: sessionId } })
  if (room) await db.removeChannel(room).catch(() => {})
  room = null; peer?.close(); peer = null; roomId = null; partnerId = null; offerStarted = false; matching = false; incomingCandidates = []
}
async function next() {
  await clearConnection(true)
  if (!localStream) { phase = 'idle'; updateUI(); return }
  phase = 'searching'; updateUI(); await joinLobby()
}
async function leave() {
  if (lobby) await db.removeChannel(lobby).catch(() => {})
  lobby = null; await clearConnection(true)
  for (const track of localStream?.getTracks() || []) track.stop()
  localStream = null; document.querySelector('[data-local]').srcObject = null; document.querySelector('[data-local-wrap]').hidden = true
  document.querySelector('[data-remote]').srcObject = null; document.querySelector('[data-remote]').hidden = true; document.querySelector('[data-empty]').hidden = false
  document.querySelector('[data-empty-title]').textContent = 'VIDEO CHAT'
  document.querySelector('[data-empty-copy]').textContent = 'Zapni kameru a hľadaj človeka.'
  phase = 'idle'; messages = []; document.querySelector('[data-messages]').innerHTML = '<div class="vc-message system">Správy sa zobrazia po spojení.</div>'; updateUI()
}
function endRoom(text) {
  if (phase !== 'connected') return
  phase = 'ended'; peer?.close(); peer = null
  document.querySelector('[data-remote]').hidden = true; document.querySelector('[data-empty]').hidden = false
  document.querySelector('[data-empty-title]').textContent = 'Spojenie sa skončilo'
  document.querySelector('[data-empty-copy]').textContent = 'Môžeš pokračovať s ďalším náhodným človekom alebo odísť.'
  addMessage(text, false, true); updateUI()
}

window.addEventListener('beforeunload', () => {
  if (room && roomId) void room.send({ type: 'broadcast', event: 'left', payload: { room_id: roomId, sender: sessionId } })
  for (const track of localStream?.getTracks() || []) track.stop()
})

shell(); updateUI()
