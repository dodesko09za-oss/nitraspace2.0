import './admin-panel.css'
import {createClient} from '@supabase/supabase-js'
import {publishBatch,cropPhoto} from './features/tell-batch.js'
const root=document.querySelector('#socialApp')
const adminUrl='/social.html?admin=1'
async function session(body){
 const response=await fetch('/api/admin-session',body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'})
 if(!response.ok)throw Error(response.status===401?'Nesprávne heslo.':'Overenie vstupu je nedostupné.')
 return response.json()
}
async function start(){
 if(!new URLSearchParams(location.search).has('admin')){await import('./social.js');return}
 document.body.classList.add('admin-page')
 if(!(await session()).open){
 root.innerHTML='<form class="admin-card" id="unlock"><h1>Vstup do administrácie</h1><label>Heslo<input name="password" type="password" required autofocus></label><button>Odomknúť</button><p role="status"></p></form>'
 root.querySelector('form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;try{await session({password:f.password.value});location.reload()}catch(err){f.querySelector("p").textContent=err.message}}
 return
 }
 const db=createClient(import.meta.env.VITE_SUPABASE_URL,import.meta.env.VITE_SUPABASE_ANON_KEY)
 const {data:allowed,error}=await db.rpc('is_admin')
 if(error||!allowed){root.innerHTML='<main class="admin-card"><h1>Admin účet</h1><p>Prihlás sa účtom správcu Nitra Space.</p><a href="/account?return_to=/social.html%3Fadmin%3D1">Otvoriť prihlásenie</a></main>';return}
 const shell=document.createElement('main');shell.className='admin-card'
 shell.innerHTML='<header><img src="/nitra-space-logo-optimized.webp" alt="Nitra Space"><button id="lock">Zamknúť</button></header><h1>Administrácia</h1><nav><a href="#events">Eventy</a><a href="#tells">Tells</a><a href="#users">Používatelia</a><a href="#activity">Aktivita</a><a href="#stats">Štatistiky</a></nav><section data-panel="tells"><h2>Unreleased Tells</h2><form id="batch"><label>Vybrať viac fotiek<input type="file" name="photos" multiple accept="image/jpeg,image/png,image/webp" required></label><ol></ol><button>Zverejniť jednotlivo</button></form></section><section data-panel="users"><h2>Používatelia</h2><form id="search"><input name="q" aria-label="Hľadať účet"><button>Hľadať</button></form><ul></ul></section><section data-panel="activity"><h2>Aktivita účtov</h2><ul></ul></section><p id="admin-msg" role="status"></p>'
 root.before(shell)
 const msg=shell.querySelector('#admin-msg'),batch=shell.querySelector('#batch'),picker=batch.elements.photos
 shell.querySelector('#lock').onclick=async()=>{await session({lock:true});location.replace(adminUrl)}
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
 async function view(){const id=location.hash.slice(1)||'events';for(const p of shell.querySelectorAll('[data-panel]'))p.hidden=p.dataset.panel!==id
 root.hidden=!['events','stats'].includes(id)
 if(!root.hidden)await legacy.showAdminEvents(id==='stats')
 if(['users','activity'].includes(id))await users(id)}
 const refresh=()=>view().catch(err=>msg.textContent=err.message)
 window.addEventListener('hashchange',refresh);refresh()
}
start().catch(err=>{root.textContent=err.message})
