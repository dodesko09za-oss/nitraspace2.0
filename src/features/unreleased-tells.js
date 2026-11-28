import { content, db, navigate, notice, onCleanup, state } from './runtime.js'
import { html } from './shared.js'
import './unreleased-tells.css'

const pageSize = 12
const login = '/account?return_to=/unreleased-tells'
const date = new Intl.DateTimeFormat('sk-SK', { day: 'numeric', month: 'short', year: 'numeric' })
const heart = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.4 5.4 0 0 0-7.6 0L12 5.8l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.8a5.4 5.4 0 0 0 0-7.6Z"/></svg>'
const bubble = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a9 9 0 0 1-13 8L3 21l1.5-5A9 9 0 1 1 21 11.5Z"/></svg>'

function member() {
  return state.user?.app_metadata?.auth_provider === 'clerk' && state.user.app_metadata.clerk_user_id
}

function form(kind) {
  const post = kind === 'publish'
  if (post) return `<details class="tell-composer"><summary>Pridať fotku</summary><form data-kind="publish">
    <label>Fotka <input type="file" name="photo" accept="image/jpeg,image/png,image/webp" required></label>
    <div class="tell-frame" hidden><img data-preview alt="Náhľad orezu 4 : 5"></div>
    <label data-crop hidden>Posun orezu <input type="range" name="crop" min="0" max="100" value="50"></label>
    <textarea name="body" aria-label="Voliteľný popis" placeholder="Pridaj popis (voliteľné)…" maxlength="1200"></textarea>
    <button type="submit">Zverejniť tell</button></form></details>`
  return `<form data-kind="comment"><textarea name="body" aria-label="Tvoj komentár" placeholder="Pridaj komentár…" maxlength="500" required></textarea><button type="submit">Odoslať</button></form>`
}

async function renderCrop(image, position) {
  await image.decode()
  const width = Math.min(image.naturalWidth, image.naturalHeight * 4 / 5)
  const height = width * 5 / 4
  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1350
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#111'
  ctx.fillRect(0,0,canvas.width,canvas.height)
  ctx.drawImage(image,(image.naturalWidth-width)*position,(image.naturalHeight-height)*position,
    width,height,0,0,canvas.width,canvas.height)
  return new Promise((resolve,reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Fotku sa nepodarilo spracovať.')), 'image/jpeg', .9))
}

function card(post, liked) {
  return `<article class="tell" data-id="${html(post.id)}">
    <div class="tell-byline"><img class="tell-avatar" src="/nitra-space-logo-optimized.webp" alt="" width="40" height="40"><strong>Nitra Space</strong><time datetime="${html(post.created_at)}">${date.format(new Date(post.created_at))}</time></div>
    <div class="tell-frame" data-photo="${html(post.photo_path)}"><img alt="${html(post.body || 'Fotka z Unreleased Tells')}" hidden><button type="button" data-retry-photo hidden>Načítať fotku znova</button></div>
    ${post.body ? `<p class="tell-text">${html(post.body)}</p>` : ''}
    <div class="tell-actions"><button data-like aria-pressed="${liked}" aria-label="Páči sa mi">${heart}<span>${post.tell_likes[0].count}</span></button>
    <button data-comments aria-expanded="false" aria-label="Komentáre">${bubble}<span>${post.tell_comments[0].count}</span></button></div>
    <section class="tell-thread" hidden><ul></ul><button data-more-comments hidden>Ďalšie komentáre</button>${form('comment')}</section></article>`
}

export async function renderTells() {
  if (!member()) {
    content(`<section class="tell-exclusive" aria-labelledby="tell-exclusive-title">
      <span>Unreleased Tells</span>
      <h1 id="tell-exclusive-title">EXCLUSIVE</h1>
      <p>Príspevky sú dostupné iba pre prihlásených.</p>
      <div class="tell-exclusive-actions">
        <a href="${login}">Prihlásiť sa</a>
        <a href="${login}#signup">Registrovať sa</a>
      </div>
    </section>`)
    return
  }
  const userId = state.user.id
  content(`<section class="tells-feed"><h1>Unreleased <em>Tells</em></h1>
    <div data-posts></div>
    <p data-status role="status">Načítavam telly…</p><button data-more hidden>Staršie telly</button></section>`)
  const root = document.querySelector('.tells-feed')
  const posts = root.querySelector('[data-posts]')
  const more = root.querySelector('[data-more]')
  const status = root.querySelector('[data-status]')
  const bucket = db.storage.from('unreleased-tells')
  const objectUrls = new Set()
  let previewUrl
  async function showPhoto(frame) {
    const retry = frame.querySelector('button')
    retry.hidden = true
    const {data,error} = await bucket.download(frame.dataset.photo).catch(() => ({error:true}))
    if (!frame.isConnected) return
    if (error) { retry.hidden = false; return }
    const url = URL.createObjectURL(data)
    objectUrls.add(url)
    const image = frame.querySelector('img')
    image.src = url
    image.hidden = false
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target)
      void showPhoto(entry.target)
    }
  },{rootMargin:'400px'})
  function watch(card) { observer.observe(card.querySelector('[data-photo]')) }
  onCleanup(() => {
    observer.disconnect()
    objectUrls.forEach(url => URL.revokeObjectURL(url))
    if (previewUrl) URL.revokeObjectURL(previewUrl)
  })
  const publisher = root.querySelector('[data-kind="publish"]')
  if (publisher) {
    const image = publisher.querySelector('[data-preview]')
    publisher.elements.photo.onchange = () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
      const file = publisher.elements.photo.files[0]
      previewUrl = file ? URL.createObjectURL(file) : null
      image.parentElement.hidden = !file
      publisher.querySelector('[data-crop]').hidden = !file
      publisher.elements.crop.value = 50
      image.style.objectPosition = '50% 50%'
      if (file) image.src = previewUrl
      else image.removeAttribute('src')
    }
    publisher.elements.crop.oninput = () => {
      const pct = publisher.elements.crop.value + '%'
      image.style.objectPosition = pct + ' ' + pct
    }
  }
  const authChanged = () => { if (!member() || state.user.id !== userId) navigate(login) }
  window.addEventListener('nitra-auth-change', authChanged)
  onCleanup(() => window.removeEventListener('nitra-auth-change', authChanged))
  const checked = async query => {
    const { data, error } = await query
    if (error) throw error
    return data
  }
  async function loadPosts() {
    more.disabled = true
    try {
      const offset = posts.childElementCount
      const rows = await checked(db.from('unreleased_tells')
        .select('id,photo_path,body,created_at,tell_likes(count),tell_comments(count)')
        .order('created_at', { ascending: false }).order('id', { ascending: false }).range(offset, offset + pageSize))
      const page = rows.slice(0, pageSize)
      const likes = page.length ? await checked(db.from('tell_likes').select('tell_id')
        .eq('user_id', userId).in('tell_id', page.map(row => row.id))) : []
      const mine = new Set(likes.map(row => row.tell_id))
      for (const row of page) {
        if (posts.querySelector(`[data-id="${row.id}"]`)) continue
        posts.insertAdjacentHTML('beforeend', card(row, mine.has(row.id)))
        if (root.isConnected) watch(posts.lastElementChild)
      }
      more.hidden = rows.length <= pageSize
      status.textContent = !posts.childElementCount ? 'Zatiaľ tu nie sú žiadne telly.' : ''
    } catch {
      status.textContent = 'Telly sa nepodarilo načítať.'
      more.textContent = 'Skúsiť znova'
      more.hidden = false
    } finally { more.disabled = false }
  }
  async function loadComments(article, parent = null) {
    const list = parent ? parent.querySelector('[data-reply-list]') : article.querySelector('.tell-thread > ul')
    const offset = list.childElementCount
    const query = db.from('tell_comments').select('id,user_id,username,body,tell_comment_likes(count)').eq('tell_id',article.dataset.id)
    const rows = await checked((parent ? query.eq('reply_to',parent.dataset.comment) : query.is('reply_to',null))
      .order('created_at').order('id').range(offset, offset + pageSize))
    const page = rows.slice(0,pageSize)
    const likes = page.length ? await checked(db.from('tell_comment_likes').select('comment_id')
      .eq('user_id',userId).in('comment_id',page.map(row => row.id))) : []
    const liked = new Set(likes.map(row => row.comment_id))
    list.insertAdjacentHTML('beforeend',page.map(row =>
      `<li data-comment="${html(row.id)}"><span class="tell-comment-avatar" aria-hidden="true">${html(row.username?.[0]?.toUpperCase()||"•")}</span><div class="tell-comment-copy"><strong>@${html(row.username)}</strong><p>${html(row.body)}</p>${row.user_id===userId ? '<button type="button" data-comment-delete>Vymazať</button>' : ''}${parent?'':'<button type="button" data-reply>Odpovedať</button>'}</div>
      <button type="button" data-comment-like aria-label="Páči sa mi komentár" aria-pressed="${liked.has(row.id)}">${heart}<span>${row.tell_comment_likes[0].count}</span></button>${parent?'':`<div class="tell-replies"><button type="button" data-show-replies aria-expanded="false">Zobraziť odpovede</button><div data-reply-thread hidden><ul data-reply-list></ul><p data-reply-empty hidden>Zatiaľ bez odpovedí</p><button type="button" data-more-replies hidden>Ďalšie odpovede</button></div></div>`}</li>`).join(''))
    if(parent){
      parent.querySelector('[data-more-replies]').hidden=rows.length<=pageSize
      parent.querySelector('[data-reply-empty]').hidden=Boolean(list.childElementCount)
    }else article.querySelector('[data-more-comments]').hidden=rows.length<=pageSize
  }
  async function refreshCommentCount(article) {
    const result = await db.from('tell_comments').select('id',{count:'exact',head:true}).eq('tell_id',article.dataset.id)
    if (!result.error) article.querySelector('[data-comments] span').textContent = result.count
  }
  more.onclick = loadPosts
  root.addEventListener('click', async event => {
    const btn = event.target.closest('button')
    const article = btn?.closest('article')
    if (!article || btn.type === 'submit' && btn.closest('form')) return
    btn.disabled = true
    try {
      if (btn.hasAttribute('data-retry-photo')) {
        await showPhoto(btn.closest('[data-photo]'))
      } else if (btn.hasAttribute('data-like')) {
        const wasLiked = btn.getAttribute('aria-pressed') === 'true'
        const query = db.from('tell_likes')
        const mutation = wasLiked ? query.delete().eq('tell_id', article.dataset.id).eq('user_id', userId) : query.insert({tell_id: article.dataset.id})
        const { error } = await mutation
        if (error && error.code !== '23505') throw error
        btn.setAttribute('aria-pressed', String(!wasLiked))
        const count = await db.from('tell_likes').select('tell_id',{count:'exact',head:true}).eq('tell_id',article.dataset.id)
        if (count.error) throw count.error
        btn.querySelector('span').textContent = count.count
      } else if (btn.hasAttribute('data-comment-like')) {
        const id = btn.closest('[data-comment]').dataset.comment
        const liked = btn.getAttribute('aria-pressed') === 'true'
        const table = db.from('tell_comment_likes')
        const mutation = liked ? table.delete().eq('comment_id',id).eq('user_id',userId) : table.insert({comment_id:id})
        const {error} = await mutation
        if (error && error.code !== '23505') throw error
        btn.setAttribute('aria-pressed',String(!liked))
        const count = await db.from('tell_comment_likes').select('comment_id',{count:'exact',head:true}).eq('comment_id',id)
        if (count.error) throw count.error
        btn.querySelector('span').textContent = count.count
      } else if (btn.hasAttribute('data-show-replies') || btn.hasAttribute('data-reply') || btn.hasAttribute('data-more-replies')) {
        const parent = btn.closest('[data-comment]')
        const thread = parent.querySelector('[data-reply-thread]')
        const toggle = parent.querySelector('[data-show-replies]')
        if (btn.hasAttribute('data-more-replies')) {
          await loadComments(article,parent)
        } else if (!thread.hidden && btn===toggle) {
          thread.hidden=true
          toggle.setAttribute('aria-expanded','false')
          toggle.textContent='Zobraziť odpovede'
        } else {
          if(thread.hidden){
            parent.querySelector('[data-reply-list]').replaceChildren()
            await loadComments(article,parent)
            thread.hidden=false
            toggle.setAttribute('aria-expanded','true')
            toggle.textContent='Skryť odpovede'
          }
          if(btn.hasAttribute('data-reply')){
            if(!thread.querySelector('form')){
              thread.insertAdjacentHTML('beforeend',form('comment'))
              const replyForm=thread.querySelector('form')
              replyForm.dataset.replyTo=parent.dataset.comment
              replyForm.elements.body.placeholder='Napíš odpoveď…'
              replyForm.elements.body.setAttribute('aria-label','Tvoja odpoveď')
            }
            thread.querySelector('textarea').focus()
          }
        }
      } else if (btn.hasAttribute('data-comment-delete')) {
        if (!confirm('Vymazať tvoj komentár?')) return
        const item = btn.closest('[data-comment]')
        await checked(db.from('tell_comments').delete().eq('id',item.dataset.comment).eq('user_id',userId).select('id').single())
        article.querySelector('.tell-thread ul').replaceChildren()
        await Promise.all([loadComments(article),refreshCommentCount(article)])
      } else if (btn.hasAttribute('data-comments')) {
        const thread = article.querySelector('.tell-thread')
        if (thread.hidden) {
          article.querySelector('ul').replaceChildren()
          await loadComments(article)
        }
        thread.hidden = !thread.hidden
        btn.setAttribute('aria-expanded', String(!thread.hidden))
      } else if (btn.hasAttribute('data-more-comments')) {
        await loadComments(article)
      }
    } catch { if (root.isConnected) notice('Akcia sa nepodarila. Skús to znova.') }
    finally { btn.disabled = false }
  })
  root.addEventListener('submit', async event => {
    event.preventDefault()
    const editor = event.target
    const body = editor.elements.body.value.trim()
    const submit = editor.querySelector('button')
    if ((!body && editor.dataset.kind==='comment') || submit.disabled) return
    submit.disabled = true
    try {
      const article = editor.closest('article')
      if (article) {
        const replyTo=editor.dataset.replyTo
        await checked(db.from('tell_comments').insert({tell_id:article.dataset.id,body,...(replyTo?{reply_to:replyTo}:{})}))
        editor.reset()
        const parent=replyTo?editor.closest('[data-comment]'):null
        const list=parent?parent.querySelector('[data-reply-list]'):article.querySelector('.tell-thread > ul')
        list.replaceChildren()
        await loadComments(article,parent)
        await refreshCommentCount(article)
      } else {
        const photo = await renderCrop(editor.querySelector('[data-preview]'),Number(editor.elements.crop.value)/100)
        const path = crypto.randomUUID()+'.jpg'
        await checked(bucket.upload(path,photo,{contentType:'image/jpeg',cacheControl:'0'}))
        let post
        try {
          post = await checked(db.from('unreleased_tells').insert({body,photo_path:path}).select('id,photo_path,body,created_at').single())
        } catch (error) {
          await bucket.remove([path])
          throw error
        }
        if (!root.isConnected) return
        posts.insertAdjacentHTML('afterbegin', card({...post,tell_likes:[{count:0}],tell_comments:[{count:0}]},false))
        watch(posts.firstElementChild)
        status.textContent = ''
        editor.reset()
        editor.elements.photo.onchange()
        publisher.closest('details').open = false
      }
    } catch { if(root.isConnected) notice('Príspevok sa nepodarilo zobraziť. Skontroluj pripojenie a obnov stránku.') }
    finally { submit.disabled = false }
  })
  await loadPosts()
}
