import './admin-panel.css'
import {createClient} from '@supabase/supabase-js'
import {publishBatch,cropPhoto} from './features/tell-batch.js'
const root=document.querySelector('#socialApp')
const adminUrl='/admin'
async function session(body){
 const response=await fetch('/api/admin-session',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'})
 if(!response.ok)throw Error(response.status===401?'Nesprávne heslo.':'Overenie vstupu je nedostupné.')
 return response.json()
}
async function start(){
 if(!/^\/admin\/?$/.test(location.pathname)&&!new URLSearchParams(location.search).has('admin')){await import('./social.js');return}
 document.body.classList.add('admin-page')
 if(!(await session()).open){
 root.innerHTML='<form class="admin-card" id="unlock"><h1>Vstup do administrácie</h1><label>Heslo<input name="password" type="password" required autofocus></label><button>Odomknúť</button><p role="status"></p></form>'
 root.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;try{await session({password:f.password.value});location.reload()}catch(err){f.querySelector("p").textContent=err.message}}
 return
 }
 const db=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_ANON_KEY,{
   auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false,storageKey:'nitra-admin-session'}
 })
 const tokens=await session({exchange:true})
 const login=await db.auth.setSession(tokens)
 if(login.error)throw login.error
 const sections={events:'Eventy',tells:'Unreleased Tells',users:'Používatelia',activity:'Aktivita účtov',stats:'Štatistiky'}
 const shell=document.createElement('main')
 shell.className='admin-workspace'
 shell.innerHTML=`
   <header class="admin-top">
     <div class="admin-brand"><img src="/nitra-space-logo-optimized.webp" alt=""><div><small>Nitra Space</small><strong>Administrácia</strong></div></div>
     <button id="lock" class="admin-lock-button">Zamknúť</button>
   </header>
   <nav class="admin-menu" aria-label="Sekcie administrácie">
     ${Object.entries(sections).map(([id,label])=>`<a href="#${id}">${label}</a>`).join('')}
   </nav>
   <div class="admin-main">
     <header class="admin-heading"><h1></h1></header>
     <div class="admin-content">
       <p id="admin-msg" role="status"></p>
       <section data-panel="tells">
         <form id="batch">
           <label class="admin-upload">Vybrať fotky<input type="file" name="photos" multiple accept="image/jpeg,image/png,image/webp" required></label>
           <ol></ol><button class="admin-primary">Zverejniť jednotlivo</button>
         </form>
         <details class="admin-moderation">
           <summary>Moderovať komentáre a lajky</summary>
           <p role="status"></p><div data-moderation-posts></div>
           <button type="button" data-more-tells hidden>Staršie príspevky</button>
         </details>
       </section>
       <section data-panel="users"><form id="search"><input name="q" aria-label="Hľadať účet" placeholder="Meno alebo e-mail"><button class="admin-primary">Hľadať</button></form><ul></ul></section>
       <section data-panel="activity"><ul></ul></section>
     </div>
   </div>`
 root.before(shell)
 shell.querySelector('.admin-content').append(root)
 const msg=shell.querySelector('#admin-msg'),batch=shell.querySelector('#batch'),picker=batch.elements.photos
 shell.querySelector('#lock').onclick=async()=>{await session({lock:true});await db.auth.signOut({scope:'local'});location.replace(adminUrl)}
 let pending=[]
 const paths=new WeakMap()
 const list=()=>batch.querySelector('ol').replaceChildren(...pending.map(f=>{const li=document.createElement('li');li.textContent=f.name;return li}))
 picker.onchange=()=>{pending=Array.from(picker.files);list()}
 batch.onsubmit=async e=>{e.preventDefault();const button=batch.querySelector('button');if(button.disabled||!pending.length)return;button.disabled=picker.disabled=true
 try{
 if(!(await session()).open)throw Error('Odomkni panel znova.')
 const bucket=db.storage.from('unreleased-tells')
 await publishBatch(pending,async file=>{
 const previous=paths.get(file),path=previous||crypto.randomUUID()+'.jpg'
 if(previous){
 const found=await db.from('unreleased_tells').select('id').eq('photo_path',path).maybeSingle()
 if(found.error)throw found.error
 if(found.data){pending.shift();list();return}
 }
 paths.set(file,path)
 const blob=await cropPhoto(file)
 const upload=await bucket.upload(path,blob,{contentType:'image/jpeg'})
 if(upload.error&&!(previous&&String(upload.error.statusCode)==='409'))throw upload.error
 const result=await db.from('unreleased_tells').insert({photo_path:path});if(result.error){await bucket.remove([path]);throw result.error}
 pending.shift();list()
 },(n,total,name)=>msg.textContent=n+' / '+total+' zverejnených '+name)
 picker.value=''
 }catch(err){msg.textContent='Dávka zastavená. '+err.message+' Zostáva: '+pending.length}
 finally{button.disabled=picker.disabled=false}}
 const moderation=shell.querySelector('.admin-moderation')
 const postList=moderation.querySelector('[data-moderation-posts]')
 const moreTells=moderation.querySelector('[data-more-tells]')
 const moderationStatus=moderation.querySelector('[role=status]')
 const moderationPage=20
 const checked=async query=>{const result=await query;if(result.error)throw result.error;return result.data}
 let postOffset=0
 function node(tag,text){const element=document.createElement(tag);element.textContent=text;return element}
 async function moreComments(post,list,button) {
   button.disabled=true
   try {
     const offset=list.childElementCount
     const comments=await checked(db.from('tell_comments')
       .select('id,username,body,tell_comment_likes(count)').eq('tell_id',post.id)
       .order('created_at',{ascending:false}).order('id').range(offset,offset+moderationPage))
     for(const comment of comments.slice(0,moderationPage)){
       const item=node('li','')
       const remove=node('button','Vymazať')
       item.append(node('strong','@'+comment.username),node('p',comment.body),node('small','♥ '+comment.tell_comment_likes[0].count),remove)
       remove.onclick=async()=>{
         if(!confirm('Vymazať tento komentár?'))return
         remove.disabled=true
         try{
           await checked(db.from('tell_comments').delete().eq('id',comment.id).select('id').single())
           item.remove()
           if(!button.hidden)await moreComments(post,list,button)
         }catch(error){moderationStatus.textContent=error.message}
         finally{remove.disabled=false}
       }
       list.append(item)
     }
     button.hidden=comments.length<=moderationPage
   }catch(error){moderationStatus.textContent=error.message}
   finally{button.disabled=false}
 }
 async function listModerationPosts(){
   moreTells.disabled=true
   moderationStatus.textContent=''
   try{
     const posts=await checked(db.from('unreleased_tells').select('id,body,photo_path,created_at,tell_likes(count),tell_comments(count)')
       .order('created_at',{ascending:false}).order('id').range(postOffset,postOffset+moderationPage))
     for(const post of posts.slice(0,moderationPage)){
       const details=node('details','')
       const title=post.body||new Date(post.created_at).toLocaleString('sk-SK')
       const summary=node('summary',title+' · ♥ '+post.tell_likes[0].count+' · Komentáre '+post.tell_comments[0].count)
       const list=node('ul','')
       const more=node('button','Načítať komentáre')
       more.type='button'
       details.append(summary,list,more)
       let loaded=false
       details.ontoggle=async()=>{
         if(!details.open||loaded)return
         loaded=true
         const photo=await db.storage.from('unreleased-tells').createSignedUrl(post.photo_path,3600)
         if(photo.data?.signedUrl){
           const image=node('img','');image.src=photo.data.signedUrl;image.alt=post.body||'Fotka z Tellu';details.insertBefore(image,list)
         }
         await moreComments(post,list,more)
       }
       more.onclick=()=>moreComments(post,list,more)
       postList.append(details)
     }
     postOffset+=Math.min(posts.length,moderationPage)
     moreTells.hidden=posts.length<=moderationPage
     if(!postOffset)moderationStatus.textContent='Zatiaľ tu nie sú žiadne príspevky.'
   }catch(error){moderationStatus.textContent=error.message;moreTells.hidden=false}
   finally{moreTells.disabled=false}
 }
 moderation.ontoggle=()=>{if(moderation.open&&!postOffset&&!moreTells.disabled)void listModerationPosts()}
 moreTells.onclick=listModerationPosts
 const legacy=await import('./social.js')
 async function users(section,q=''){
 const {data,error}=await db.rpc('admin_list_users',{p_query:q,p_limit:200});if(error)throw error
 const ul=shell.querySelector('[data-panel="'+section+'"] ul');ul.replaceChildren()
 const rows=section==='activity'?data.filter(x=>x.last_sign_in_at).sort((a,b)=>b.last_sign_in_at.localeCompare(a.last_sign_in_at)):data
 for(const row of rows){const li=document.createElement('li');li.textContent=(row.username||row.display_name||row.email)+' '
 if(section==='activity')li.append(' · '+new Date(row.last_sign_in_at).toLocaleString('sk-SK'))
 else if(!row.is_admin){const btn=document.createElement('button');btn.textContent=row.is_banned?'Zrušiť ban':'Zabanovať';btn.onclick=async()=>{if(!confirm(btn.textContent+' tento účet?'))return;btn.disabled=true;try{const r=await db.functions.invoke('admin-users',{body:{user_id:row.id,action:row.is_banned?'unban':'ban'}});if(r.error)throw r.error;await users(section,q)}catch(err){msg.textContent=err.message}finally{btn.disabled=false}};li.append(btn)}ul.append(li)}
 }
 shell.querySelector('#search').onsubmit=e=>{e.preventDefault();users('users',e.currentTarget.q.value).catch(err=>msg.textContent=err.message)}
 async function view(){
 const requested=location.hash.slice(1)
 const id=Object.hasOwn(sections,requested)?requested:'events'
 shell.querySelector('h1').textContent=sections[id]
 for(const link of shell.querySelectorAll('.admin-menu a')){
   if(link.hash==='#'+id)link.setAttribute('aria-current','page')
   else link.removeAttribute('aria-current')
 }
 for(const panel of shell.querySelectorAll('[data-panel]'))panel.hidden=panel.dataset.panel!==id
 root.hidden=!['events','stats'].includes(id)
 if(!root.hidden)await legacy.showAdminEvents(id==='stats',db)
 if(['users','activity'].includes(id))await users(id)}
 const refresh=()=>view().catch(err=>msg.textContent=err.message)
 window.addEventListener('hashchange',refresh);refresh()
}
start().catch(err=>{root.textContent=err.message})
