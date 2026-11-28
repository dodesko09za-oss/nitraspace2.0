import {html} from './shared.js'
import {clerkPublishableKeyExists,getClerk,signOutAccount,syncClerkSessionToSupabase} from './clerk-auth.js'
export let db
export const state={user:null,admin:false,generation:0,needsProfile:false,clerkUser:null,clerkError:null}
let navigateHost=()=>{},cleanups=[],initialised=false,signingOut=false
export function content(markup){const el=document.querySelector('#feature-content');if(el)el.innerHTML=markup}
export function notice(message){const el=document.querySelector('#feature-notice');if(el)el.textContent=message}
export function navigate(url){navigateHost(url)}
export function onCleanup(fn){cleanups.push(fn)}
export function cleanup(){state.generation++;for(const fn of cleanups.splice(0))fn()}
export async function requireUser(){if(state.user)return true;navigate('/account');return false}
async function refreshAdmin(){state.admin=false;const id=state.user?.id;if(id){const r=await db.rpc('is_admin');if(state.user?.id===id)state.admin=r.data===true}}
function announceAuth(){window.dispatchEvent(new Event('nitra-auth-change'))}
export async function signOut(destination='/news'){
  if(signingOut)return
  signingOut=true
  try{
    await signOutAccount(db)
    state.user=null;state.admin=false;state.needsProfile=false;state.clerkUser=null;state.clerkError=null
    announceAuth();navigate(typeof destination==='string'?destination:'/news')
  }catch(error){
    state.user=null;state.admin=false;state.clerkUser=null
    notice(error.message)
  }finally{
    signingOut=false
  }
}
export async function initialise(client,go){
  db=client;navigateHost=go;if(initialised||!db)return;initialised=true
  state.user=null
  if(clerkPublishableKeyExists()){
    try{
      const clerk=await getClerk()
      state.clerkUser=clerk.user||null
      if(clerk.user&&clerk.session){
        const linked=await syncClerkSessionToSupabase(db)
        state.needsProfile=linked.profileRequired
        state.clerkUser=linked.clerkUser||clerk.user
        state.user=linked.user
      }
      if(!state.user){
        // Once Clerk is enabled, an old standalone Supabase session must not
        // remain a way around the new sign-in requirement.
        const {error}=await db.auth.signOut({scope:'local'})
        if(error)throw error
      }
    }catch(error){
      state.clerkError=error?.message||'Clerk prihlásenie sa nepodarilo obnoviť.'
      try{await db.auth.signOut({scope:'local'})}catch{}
    }
  }else{
    const session=await db.auth.getSession()
    state.user=session.data.session?.user||null
  }
  await refreshAdmin(); announceAuth()
  // Auth callbacks run while the session lock is held. Database requests
  // acquire that same lock, so defer them until the callback has returned.
  db.auth.onAuthStateChange((_event,next)=>{
    if(signingOut)return
    const user=next?.user
    const linked=state.clerkUser&&user?.app_metadata?.auth_provider==='clerk'&&user.app_metadata.clerk_user_id===state.clerkUser.id
    state.user=user&&(!clerkPublishableKeyExists()||(!state.clerkError&&linked))?user:null
    if(!state.user)state.admin=false
    setTimeout(()=>{refreshAdmin().then(announceAuth).catch(()=>{state.admin=false;announceAuth()})},0)
  })
}
export async function mount(client,path,go){
  const generation=state.generation
  try{
    await initialise(client,go);if(generation!==state.generation)return
    if(!db)throw new Error('Pripojenie Supabase nie je nastavené.')
    if(path==='/board'||path==='/admin/drops'){const m=await import('./drops.js');if(generation===state.generation)await m.renderDrops()}
    else if(path.startsWith('/admin')){const m=await import('./editorial-admin.js');if(generation===state.generation)await m.renderAdmin(path)}
    else if(path.startsWith('/news')){const m=await import('./editorial-news.js');if(generation===state.generation)await m.renderNews(path)}
    else if(path==='/people'){const m=await import('./matching-deck.js');if(generation===state.generation)await m.renderMatching()}
    else if(path==='/polls'){const m=await import('./polls.js');if(generation===state.generation)await m.renderPolls()}
    else if(['/unreleased-tells','/unreleased-tells/'].includes(path)){const m=await import('./unreleased-tells.js');if(generation===state.generation)await m.renderTells()}
    else if(path==='/activity'){const m=await import('./activity.js');if(generation===state.generation)await m.renderActivity()}
    else {const m=await import('./social.js');if(generation===state.generation)await m.renderSocial(path)}
    sessionStorage.removeItem('nitra-feature-reload:'+path)
  }catch(error){
    if(generation!==state.generation)return
    const moduleError=/failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css/i.test(error?.message||'')
    if(moduleError){
      const key='nitra-feature-reload:'+path
      if(!sessionStorage.getItem(key)){
        sessionStorage.setItem(key,'1')
        location.reload()
        return
      }
      content('<section class="panel"><h2>Stránku sa nepodarilo načítať.</h2><button data-feature-retry>Obnoviť stránku</button></section>')
      document.querySelector('[data-feature-retry]')?.addEventListener('click',()=>location.reload())
      return
    }
    content(`<section class="panel"><h2>Obsah sa nepodarilo načítať.</h2><p>${html(error.message)}</p><button data-feature-retry>Skúsiť znova</button></section>`)
    document.querySelector('[data-feature-retry]')?.addEventListener('click',()=>mount(client,path,go))
  }
}
