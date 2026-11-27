import {createHmac,randomBytes,scryptSync,timingSafeEqual} from 'node:crypto'
function equal(a,b){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)}
export default function handler(req,res){
 res.setHeader('Cache-Control','no-store')
 const secret=process.env.NITRA_ADMIN_VERIFIER
 if(!secret)return res.status(503).json({error:'Panel ešte nie je nastavený.'})
 const sign=value=>createHmac('sha256',secret).update(value).digest('hex')
 const cookie=/(?:^|; *)nitra_admin=([\w.-]+)/.exec(req.headers.cookie||'')?.[1]||''
 const [expires,nonce,signature]=cookie.split('.')
 if(req.method==='GET')return res.status(200).json({open:Number(expires)>Date.now()&&Boolean(signature)&&equal(signature,sign(expires+'.'+nonce))})
 if(req.method!=='POST'||req.headers.origin!=='https://'+req.headers.host)return res.status(403).end()
 const attrs='; HttpOnly; Secure; SameSite=Strict; Path=/api/admin-session'
 if(req.body?.lock){res.setHeader('Set-Cookie','nitra_admin=; Max-Age=0'+attrs);return res.status(200).json({open:false})}
 const password=req.body?.password
 if(typeof password!=='string'||password.length>128||!equal(scryptSync(password,'nitra-local-admin-v1',32).toString('hex'),secret.trim()))return res.status(401).json({error:'Nesprávne heslo.'})
 const value=(Date.now()+8*3600000)+'.'+randomBytes(20).toString('hex')
 res.setHeader('Set-Cookie','nitra_admin='+value+'.'+sign(value)+'; Max-Age=28800'+attrs)
 return res.status(200).json({open:true})
}
