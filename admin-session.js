export const SESSION_COOKIE='__Host-bunka_admin';
export const SESSION_DURATION=24*60*60*1000;
const INTERNAL='/_internal/admin-session';
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const digest=async text=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
const hash=async text=>hex(await digest(text));
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private',...headers}});
const expired=()=>json({success:false,message:'ログインの有効期限が切れたか、接続回線が変わりました。管理キーでログインし直してください。'},401);
const cookie=(token,age)=>SESSION_COOKIE+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+age;
function tokenOf(request){const values=(request.headers.get('Cookie')||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(SESSION_COOKIE+'='));if(values.length!==1)return '';const token=values[0].slice(SESSION_COOKIE.length+1);return /^[a-f0-9]{64}$/.test(token)?token:''}
function sameOrigin(request){const origin=request.headers.get('Origin'),site=request.headers.get('Sec-Fetch-Site');return (!origin||origin===new URL(request.url).origin)&&(!site||site==='same-origin'||site==='none')}
function connectionIP(request){return request.headers.get('CF-Connecting-IP')||(['localhost','127.0.0.1','[::1]'].includes(new URL(request.url).hostname)?'local-development':'')}
async function secretMatches(candidate,secret){if(!candidate||!secret)return false;const [a,b]=await Promise.all([digest(candidate),digest(secret)]);if(crypto.subtle.timingSafeEqual)return crypto.subtle.timingSafeEqual(a,b);let diff=0;const aa=new Uint8Array(a),bb=new Uint8Array(b);for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];return diff===0}
async function identity(request,env){const ip=connectionIP(request);if(!ip||!env.ADMIN_KEY)return null;return hash(JSON.stringify(['admin-session-ip-v1',env.ADMIN_KEY,ip,new URL(request.url).origin]))}
async function store(env,body){if(!env.REGISTRATION_ISSUER)throw Error('session storage unavailable');const stub=env.REGISTRATION_ISSUER.get(env.REGISTRATION_ISSUER.idFromName('admin-browser-sessions'));const response=await stub.fetch(new Request('https://internal.invalid'+INTERNAL,{method:'POST',headers:{'Content-Type':'application/json','X-Admin-Key':env.ADMIN_KEY},body:JSON.stringify(body)}));if(!response.ok)throw Error('session storage unavailable');return response.json()}
export async function readAdminSession(request,env){const token=tokenOf(request);if(!token||!sameOrigin(request))return null;const fingerprint=await identity(request,env);if(!fingerprint)return null;const result=await store(env,{action:'read',id:await hash(token),fingerprint});return result.session||null}
export async function adminSessionEndpoint(request,env){
  if(!['GET','POST','DELETE'].includes(request.method))return json({success:false},405,{Allow:'GET, POST, DELETE'});
  if(!sameOrigin(request)||request.method!=='GET'&&(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Admin-Session-Request')!=='1'))return json({success:false,message:'管理画面から操作してください。'},403);
  try{
    if(request.method==='GET'){const session=await readAdminSession(request,env);return json({success:true,session})}
    if(request.method==='DELETE'){const token=tokenOf(request);if(token)await store(env,{action:'delete',id:await hash(token)});return json({success:true},200,{'Set-Cookie':cookie('',0)});}
    if(!await secretMatches(request.headers.get('X-Admin-Key'),env.ADMIN_KEY))return json({success:false,message:'管理キーを確認できませんでした。入力し直してください。'},401);
    const fingerprint=await identity(request,env);if(!fingerprint)return json({success:false,message:'接続回線を確認できませんでした。管理画面を開き直してください。'},503);
    const token=hex(crypto.getRandomValues(new Uint8Array(32))),previous=tokenOf(request);
    const result=await store(env,{action:'create',id:await hash(token),fingerprint,previous:previous?await hash(previous):''});
    if(!result.session)throw Error('Session could not be saved');
    return json({success:true,session:result.session},200,{'Set-Cookie':cookie(token,SESSION_DURATION/1000)});
  }catch{return json({success:false,message:'ログイン状態を確認できませんでした。しばらくして再試行してください。'},503)}
}
export async function authorizeAdminSession(request,env){
  const supplied=request.headers.get('X-Admin-Key');
  if(supplied&&supplied!=='browser-session')return {request,session:null};
  const token=tokenOf(request);if(!token)return {request,session:null};
  if(!sameOrigin(request)||!['GET','HEAD','OPTIONS'].includes(request.method)&&request.headers.get('Origin')!==new URL(request.url).origin)return {response:json({success:false,message:'管理画面から操作してください。'},403)};
  try{const session=await readAdminSession(request,env);if(!session)return {request,session:null};const headers=new Headers(request.headers);headers.set('X-Admin-Key',env.ADMIN_KEY);return {request:new Request(request,{headers}),session}}
  catch{return {response:json({success:false,message:'ログイン状態を確認できませんでした。再試行してください。'},503)}}
}
// This endpoint is exposed only to the existing Durable Object binding.
export async function adminSessionStore(request,env,storage,now=Date.now()){
  if(!await secretMatches(request.headers.get('X-Admin-Key'),env.ADMIN_KEY))return expired();
  let body;try{body=await request.json()}catch{return json({success:false},400)}
  if(!/^[a-f0-9]{64}$/.test(body.id||''))return json({success:false},400);
  const key='admin-session:'+body.id;
  if(body.action==='delete'){await storage.delete(key);return json({success:true})}
  if(!/^[a-f0-9]{64}$/.test(body.fingerprint||''))return json({success:false},400);
  if(body.action==='read'){const session=await storage.get(key);if(!session||session.expiresAt<=now){if(session)await storage.delete(key);return json({success:true,session:null})}return json({success:true,session:session.fingerprint===body.fingerprint?{expiresAt:session.expiresAt}:null})}
  if(body.action==='create'){
    // Authentication already succeeded. Other valid sessions must never block login.
    if(/^[a-f0-9]{64}$/.test(body.previous||''))await storage.delete('admin-session:'+body.previous);
    let cursor='';
    do{const records=await storage.list({prefix:'admin-session:',limit:200,...(cursor?{startAfter:cursor}:{})});
      for(const [id,r]of records)if(r.expiresAt<=now)await storage.delete(id);
      cursor=records.size===200?[...records.keys()].at(-1):'';
    }while(cursor);
    const expiresAt=now+SESSION_DURATION;await storage.put(key,{fingerprint:body.fingerprint,expiresAt});return json({success:true,session:{expiresAt}});
  }
  return json({success:false},400);
}
