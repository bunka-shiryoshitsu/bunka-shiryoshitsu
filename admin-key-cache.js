// Cache only administrative key discovery. Allocation/collision checks keep using KV.list.
const PATH='/_internal/admin-key-cache',TTL=60*60*1000,CHUNK=100;
const prefixes=new Set(['REGISTRATION_LIST','PUBLIC_REGISTRATION_POOL:','PUBLIC_REGISTRATION_ISSUED:','REGISTRATION_APPLICATION:','APPLICATION_']);
const enabled=env=>String(env.ADMIN_KEY_CACHE)==='true'&&env.REGISTRATION_ISSUER&&env.ADMIN_KEY;
export const isListQuota=error=>/KV list\(\) limit exceeded|free usage limit.*operation|KV_LIST_LIMIT/.test(String(error?.message||error));
export const nextListReset=(now=Date.now())=>(Math.floor(now/86400000)+1)*86400000;
export const listLimitMessage='保存先の一覧取得が本日の利用上限に達しています。日本時間の翌朝9時以降に再確認できます。';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private'}});
async function invoke(env,body){const stub=env.REGISTRATION_ISSUER.get(env.REGISTRATION_ISSUER.idFromName('admin-key-cache'));const response=await stub.fetch(new Request('https://internal.invalid'+PATH,{method:'POST',headers:{'X-Admin-Key':env.ADMIN_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)}));const data=await response.json();if(!response.ok||!data.success){const e=Error(data.message||'一覧の保存情報を確認できません。');e.code=data.code;e.retryAt=data.retryAt;throw e}return data}
async function rawKeys(env,prefix){const keys=[],seen=new Set();let cursor;do{const page=await env.REGISTRATION_KV.list({prefix,limit:1000,...(cursor?{cursor}:{})});keys.push(...page.keys);cursor=page.list_complete?null:page.cursor;if(keys.length>10000||cursor&&seen.has(cursor))throw Error('一覧の件数または続きの情報を確認してください。');seen.add(cursor)}while(cursor);return keys}
export async function adminKeys(env,prefix){if(!enabled(env))return {keys:await rawKeys(env,prefix),stale:false};return invoke(env,{action:'list',prefix})}
export async function restoreAdminKeys(request,env){if(request.headers.get('X-Admin-Key')!==env.ADMIN_KEY||!env.ADMIN_KEY)return json({success:false},401);if(request.method!=='POST')return json({success:false},405);try{if(Number(request.headers.get('Content-Length'))>100000)return json({success:false},413);const body=await request.json();return json(await invoke(env,{...body,action:'restore'}))}catch(e){return json({success:false,message:e.message},503)}}
export function withAdminKeyCache(env){if(!enabled(env)||env.__adminKeyCache)return env;const raw=env.REGISTRATION_KV;const kv=new Proxy(raw,{get(target,property){if(property==='put'||property==='delete')return async(name,...args)=>{const result=await target[property](name,...args);if([...prefixes].some(p=>String(name).startsWith(p))){try{await invoke(env,{action:property==='put'?'touch':'remove',name:String(name),expiration:args[1]?.expiration||(args[1]?.expirationTtl?Math.floor(Date.now()/1000)+args[1].expirationTtl:undefined)})}catch{console.warn('Administrative key index update will be recovered at its next refresh.')}}return result};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value}});return {...env,REGISTRATION_KV:kv,__adminKeyCache:true}}
export async function adminKeyCacheStore(request,env,storage,now=Date.now()){
 if(request.headers.get('X-Admin-Key')!==env.ADMIN_KEY||!env.ADMIN_KEY)return json({success:false},401);
 if(request.method!=='POST')return json({success:false},405);
 let body;try{body=await request.json()}catch{return json({success:false},400)}
 const metaKey=p=>'admin-index-meta:'+p,pageKey=(p,i)=>'admin-index-page:'+p+':'+i;
 async function read(prefix){const meta=await storage.get(metaKey(prefix));if(!meta)return null;const keys=[];for(let i=0;i<meta.pages;i++){const page=await storage.get(pageKey(prefix,i));if(!page)throw Error('保存済み一覧の一部を確認できません。');keys.push(...page)}return {...meta,keys}}
 async function write(prefix,keys,at){await storage.transaction(async tx=>{const old=await tx.get(metaKey(prefix)),pages=Math.ceil(keys.length/CHUNK);for(let i=0;i<pages;i++)await tx.put(pageKey(prefix,i),keys.slice(i*CHUNK,(i+1)*CHUNK));for(let i=pages;i<(old?.pages||0);i++)await tx.delete(pageKey(prefix,i));await tx.put(metaKey(prefix),{pages,at})});}
 try{
  if(['touch','remove'].includes(body.action)){
   if(typeof body.name!=='string'||body.name.length>512)return json({success:false},400);
   for(const prefix of prefixes){if(!body.name.startsWith(prefix))continue;const record=await read(prefix);if(!record)continue;const i=record.keys.findIndex(k=>k.name===body.name);if(body.action==='remove'){if(i<0)continue;record.keys.splice(i,1)}else{const key={name:body.name,...(body.expiration?{expiration:body.expiration}:{})};if(i>=0){if(record.keys[i].expiration===key.expiration)continue;record.keys[i]=key}else record.keys.push(key)}record.keys.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);await write(prefix,record.keys,record.at)}return json({success:true});
  }
  if(!prefixes.has(body.prefix))return json({success:false,message:'この一覧は対象外です。'},400);
  if(body.action==='restore'){
   if(!Array.isArray(body.keys)||body.keys.length>1000||body.keys.some(k=>typeof k!=='string'||!k.startsWith(body.prefix)||k.length>512)||!Number.isFinite(body.at)||body.at>now)return json({success:false},400);
   if(await read(body.prefix))return json({success:false,message:'保存済みの一覧があります。上書きしません。'},409);
   await write(body.prefix,[...new Set(body.keys)].sort().map(name=>({name})),body.at);return json({success:true});
  }
  if(body.action!=='list')return json({success:false},400);
  let record=await read(body.prefix),blockedUntil=await storage.get('admin-index-blocked-until')||0;
  if(!record||record.at+TTL<=now){if(blockedUntil<=now){try{const keys=await rawKeys(env,body.prefix);await write(body.prefix,keys,now);record={keys,at:now};}catch(e){if(!isListQuota(e))throw e;blockedUntil=nextListReset(now);await storage.put('admin-index-blocked-until',blockedUntil)}}}
  if(!record)return json({success:false,code:'KV_LIST_LIMIT',retryAt:blockedUntil,message:listLimitMessage},503);
  return json({success:true,keys:record.keys.filter(k=>!k.expiration||k.expiration*1000>now),at:record.at,stale:record.at+TTL<=now,retryAt:blockedUntil>now?blockedUntil:null});
 }catch{return json({success:false,message:'一覧の保存情報を確認できません。入力を残したまま再確認してください。'},503)}
}
