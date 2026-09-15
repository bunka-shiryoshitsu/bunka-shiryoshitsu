// Public abuse counters have their own per-IP Durable Object. They never write
// registration KV and are never applied to authenticated administrative routes.
export const PUBLIC_LIMIT_PATH='/_internal/public-rate-limit';
const STATE='public-rate-limit';
const PREFIXES=new Set(['SITE','REGISTRATION','LOTTERY','APPLICATION','SUBMIT','RECEIVE_STATUS','RECEIVE_FILE','RECEIPT_AP']);
export async function publicLimit(request,env,prefix,action='consume'){
  if(String(env.PUBLIC_RATE_LIMIT_DO)!=='true')return null;
  if(!env.REGISTRATION_ISSUER||!env.ADMIN_KEY)throw Error('Public access protection is unavailable');
  const ip=request.headers.get('CF-Connecting-IP')||'unknown';
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip))),b=>b.toString(16).padStart(2,'0')).join('');
  const stub=env.REGISTRATION_ISSUER.get(env.REGISTRATION_ISSUER.idFromName('public-rate-limit:'+hash));
  const response=await stub.fetch(new Request('https://internal.invalid'+PUBLIC_LIMIT_PATH,{method:'POST',headers:{'X-Admin-Key':env.ADMIN_KEY,'Content-Type':'application/json'},body:JSON.stringify({prefix,action})}));
  if(!response.ok)throw Error('Public access protection is unavailable');
  return response.json();
}
export async function publicLimitStore(request,env,storage,now=Date.now()){
  if(!env.ADMIN_KEY||request.headers.get('X-Admin-Key')!==env.ADMIN_KEY)return Response.json({success:false},{status:401});
  if(request.method!=='POST')return Response.json({success:false},{status:405});
  let body;try{body=await request.json()}catch{return Response.json({success:false},{status:400})}
  if(!PREFIXES.has(body.prefix)||!['consume','check','failure'].includes(body.action)||body.prefix!=='RECEIPT_AP'&&body.action!=='consume')return Response.json({success:false},{status:400});
  const state=await storage.get(STATE)||{};
  for(const [key,window]of Object.entries(state))if(window.expiresAt<=now)delete state[key];
  const windows=body.prefix==='RECEIPT_AP'?[[900000,10]]:[[60000,10],[3600000,100],[86400000,500]];
  const entries=windows.map(([duration,limit])=>({key:body.prefix+':'+duration,duration,limit}));
  const limited=entries.some(w=>(state[w.key]?.count||0)>=w.limit);
  if(!limited&&body.action!=='check'){
    for(const w of entries){const record=state[w.key]||{count:0,expiresAt:now+w.duration};record.count++;state[w.key]=record;}
    // Persist the alarm and counters together; a restart must not reset limits.
    await storage.transaction(async tx=>{await tx.put(STATE,state);await tx.setAlarm(Math.max(...Object.values(state).map(w=>w.expiresAt)));});
  }
  return Response.json({success:true,limited});
}
export async function publicLimitAlarm(storage,now=Date.now()){
  const state=await storage.get(STATE);if(!state)return false;
  for(const [key,window]of Object.entries(state))if(window.expiresAt<=now)delete state[key];
  if(Object.keys(state).length){await storage.put(STATE,state);await storage.setAlarm(Math.max(...Object.values(state).map(w=>w.expiresAt)));}
  else{await storage.delete(STATE);await storage.deleteAlarm();}
  return true;
}
