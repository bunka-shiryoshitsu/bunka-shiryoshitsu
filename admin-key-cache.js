// Share complete key discovery across admin views. Record values are cached only
// for read-only views; mutations continue to read current KV values.
const PATH='/_internal/admin-key-cache',TTL=60*60*1000,CHUNK=100;
const prefixes=new Set(['REGISTRATION_LIST','PUBLIC_REGISTRATION_POOL:','PUBLIC_REGISTRATION_ISSUED:','REGISTRATION_APPLICATION:','APPLICATION_','REGISTRATION:','IMAGE:','IMAGE_META:']);
const recordPrefix='admin-record:',RECORD_TTL=5*60*1000;
const recordName=name=>typeof name==='string'&&name.length<=512&&/^(REGISTRATION_LIST(?:\d+)?$|REGISTRATION:|REGISTRATION_APPLICATION:|APPLICATION_AP-|WINNER_AP-|PUBLIC_REGISTRATION_(POOL|ISSUED):|ISSUED_DATA_META:|IMAGE_META:|SYSTEM:)/.test(name);
const enabled=env=>String(env.ADMIN_KEY_CACHE)==='true'&&env.REGISTRATION_ISSUER&&env.ADMIN_KEY;
export const isListQuota=error=>/KV list\(\) limit exceeded|free usage limit.*operation|KV_LIST_LIMIT/.test(String(error?.message||error));
export const nextListReset=(now=Date.now())=>(Math.floor(now/86400000)+1)*86400000;
export const listLimitMessage='保存先の一覧取得が本日の利用上限に達しています。日本時間の翌朝9時以降に再確認できます。';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private'}});
async function invoke(env,body){const stub=env.REGISTRATION_ISSUER.get(env.REGISTRATION_ISSUER.idFromName('admin-key-cache'));const response=await stub.fetch(new Request('https://internal.invalid'+PATH,{method:'POST',headers:{'X-Admin-Key':env.ADMIN_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)}));const data=await response.json();if(!response.ok||!data.success){const e=Error(data.message||'一覧の保存情報を確認できません。');e.code=data.code;e.retryAt=data.retryAt;throw e}return data}
async function rawKeys(env,prefix){const keys=[],seen=new Set();let cursor;do{const page=await env.REGISTRATION_KV.list({prefix,limit:1000,...(cursor?{cursor}:{})});keys.push(...page.keys);cursor=page.list_complete?null:page.cursor;if(keys.length>10000||cursor&&seen.has(cursor))throw Error('一覧の件数または続きの情報を確認してください。');seen.add(cursor)}while(cursor);return keys}
export async function adminKeys(env,prefix){if(!enabled(env))return {keys:await rawKeys(env,prefix),stale:false};const base=[...prefixes].find(p=>prefix.startsWith(p));const data=await invoke(env,{action:'list',prefix:base||prefix});const keys=data.keys.filter(k=>k.name.startsWith(prefix));if(env.__primeAdminRecords)await env.__primeAdminRecords(keys.map(k=>k.name));return {...data,keys}}
export function withAdminLists(env){
 if(!enabled(env)||env.__adminLists)return env;
 const raw=env.REGISTRATION_KV;
 const kv=new Proxy(raw,{get(target,property){
  if(property==='list')return async(options={})=>{
   const prefix=options.prefix||'';if(![...prefixes].some(p=>prefix.startsWith(p)))return target.list(options);
   const page=await adminKeys(result,prefix);
   if(page.stale)throw Object.assign(Error('KV_LIST_LIMIT'),{code:'KV_LIST_LIMIT',retryAt:page.retryAt});
   let after='';if(options.cursor){let cursor;try{cursor=JSON.parse(atob(options.cursor))}catch{throw Error('一覧の続きの情報を確認できません。')};if(cursor.prefix!==prefix)throw Error('一覧の続きが一致しません。');after=cursor.after;}
   const limit=Math.min(1000,Math.max(1,Number(options.limit)||1000)),remaining=page.keys.filter(k=>k.name>after),keys=remaining.slice(0,limit),complete=remaining.length<=limit;
   return {keys,list_complete:complete,cursor:complete?'':btoa(JSON.stringify({prefix,after:keys.at(-1).name}))};
  };const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 const result={...env,REGISTRATION_KV:kv,__adminLists:true};return result;
}
export function withAdminReads(env){
 if(!enabled(env)||String(env.ADMIN_READ_CACHE)!=='true'||env.__adminReads)return env;
 const raw=env.REGISTRATION_KV,pending=new Map();
 async function prime(names){
  const missing=[...new Set(names.flatMap(name=>name.startsWith('APPLICATION_AP-')?[name,'WINNER_'+name.slice('APPLICATION_'.length)]:[name]))].filter(name=>recordName(name)&&!pending.has(name));
  for(let i=0;i<missing.length;i+=100){const batch=missing.slice(i,i+100),job=invoke(env,{action:'records',names:batch});for(const name of batch){const value=job.then(data=>data.values[name]);value.catch(()=>{});pending.set(name,value);}try{await job}catch(e){for(const name of batch)pending.delete(name);throw e}}
 }
 const kv=new Proxy(raw,{get(target,property){
  if(property==='get')return async(name,options)=>{const type=typeof options==='string'?options:options?.type||'text';if(!recordName(name)||!['text','json'].includes(type))return target.get(name,options);await prime([name]);const value=await pending.get(name);return type==='json'&&value!==null?JSON.parse(value):value};
  const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
 }});
 return {...env,REGISTRATION_KV:kv,__primeAdminRecords:prime,__adminReads:true};
}
export async function deleteOriginalImageKeys(env,ap,item){
 if(!/^AP-[A-Z0-9]{8}$/.test(ap)||!/^(0[1-9]|10)$/.test(String(item)))throw Error('Invalid image owner');
 const pages=await Promise.all(['IMAGE:','IMAGE_META:'].map(prefix=>adminKeys(env,prefix+ap+':'+item+':')));
 if(pages.some(page=>page.stale))throw Error('画像一覧の最新状態を確認できません。削除を後で再試行します。');
 for(const name of new Set(pages.flatMap(page=>page.keys.map(key=>key.name)).filter(name=>/:(0[1-9]|1[0-9]|20)$/.test(name))))await env.REGISTRATION_KV.delete(name);
}
export async function adminImageList(request,env){
 if(!env.ADMIN_KEY||request.headers.get('X-Admin-Key')!==env.ADMIN_KEY)return json({success:false,message:'管理画面からログインしてください。'},401);
 if(request.method!=='GET')return json({success:false},405);
 const params=new URL(request.url).searchParams,ap=params.get('ap'),item=params.get('item');
 if(!/^AP-[A-Z0-9]{8}$/.test(ap||'')||!/^(0[1-9]|10)$/.test(item||''))return json({success:false,message:'申請番号・資料番号を確認してください。'},400);
 try{const page=await adminKeys(env,'IMAGE:'+ap+':'+item+':');if(page.stale)throw Error('画像一覧の最新状態を確認できません。');return json({success:true,images:page.keys.map(k=>k.name.split(':').at(-1)).filter(id=>/^(0[1-9]|1[0-9]|20)$/.test(id)).sort()});}
 catch{return json({success:false,message:'画像一覧を確認できませんでした。もう一度開いてください。'},503);}
}
export async function restoreAdminKeys(request,env){if(request.headers.get('X-Admin-Key')!==env.ADMIN_KEY||!env.ADMIN_KEY)return json({success:false},401);if(request.method!=='POST')return json({success:false},405);try{if(Number(request.headers.get('Content-Length'))>100000)return json({success:false},413);const body=await request.json();return json(await invoke(env,{...body,action:'restore'}))}catch(e){return json({success:false,message:e.message},503)}}
export function withAdminKeyCache(env){if(!enabled(env)||env.__adminKeyCache)return env;const raw=env.REGISTRATION_KV;const kv=new Proxy(raw,{get(target,property){if(property==='put'||property==='delete')return async(name,...args)=>{const result=await target[property](name,...args);if([...prefixes].some(p=>String(name).startsWith(p))||recordName(name)){try{await invoke(env,{action:property==='put'?'touch':'remove',name:String(name),value:property==='put'&&recordName(name)&&typeof args[0]==='string'&&new TextEncoder().encode(args[0]).length<90000?args[0]:undefined,expiration:args[1]?.expiration||(args[1]?.expirationTtl?Math.floor(Date.now()/1000)+args[1].expirationTtl:undefined)})}catch{console.warn('Administrative key index update will be recovered at its next refresh.')}}return result};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value}});return {...env,REGISTRATION_KV:kv,__adminKeyCache:true}}
export async function adminKeyCacheStore(request,env,storage,now=Date.now()){
 if(request.headers.get('X-Admin-Key')!==env.ADMIN_KEY||!env.ADMIN_KEY)return json({success:false},401);
 if(request.method!=='POST')return json({success:false},405);
 let body;try{body=await request.json()}catch{return json({success:false},400)}
 const metaKey=p=>'admin-index-meta:'+p,pageKey=(p,i)=>'admin-index-page:'+p+':'+i;
 async function read(prefix){const meta=await storage.get(metaKey(prefix));if(!meta)return null;const keys=[];for(let i=0;i<meta.pages;i++){const page=await storage.get(pageKey(prefix,i));if(!page)throw Error('保存済み一覧の一部を確認できません。');keys.push(...page)}return {...meta,keys}}
 async function write(prefix,keys,at){await storage.transaction(async tx=>{const old=await tx.get(metaKey(prefix)),pages=Math.ceil(keys.length/CHUNK);for(let i=0;i<pages;i++)await tx.put(pageKey(prefix,i),keys.slice(i*CHUNK,(i+1)*CHUNK));for(let i=pages;i<(old?.pages||0);i++)await tx.delete(pageKey(prefix,i));await tx.put(metaKey(prefix),{pages,at})});}
 try{
  if(body.action==='records'){
   if(String(env.ADMIN_READ_CACHE)!=='true'||!Array.isArray(body.names)||body.names.length>100||body.names.some(name=>!recordName(name)))return json({success:false},400);
   const values={},misses=[];
   for(const name of body.names){const saved=await storage.get(recordPrefix+name);if(saved&&saved.until>now)values[name]=saved.value;else misses.push(name)}
   if(misses.length){let fresh;try{fresh=await env.REGISTRATION_KV.get(misses)}catch{fresh=null}if(!(fresh instanceof Map)){fresh=new Map();for(const name of misses)fresh.set(name,await env.REGISTRATION_KV.get(name))}for(const name of misses){const value=fresh.get(name)??null;values[name]=value;if(value===null||typeof value==='string'&&new TextEncoder().encode(value).length<90000)await storage.put(recordPrefix+name,{value,until:now+(value===null?60000:RECORD_TTL)})}}
   return json({success:true,values});
  }
  if(['touch','remove'].includes(body.action)){
   if(typeof body.name!=='string'||body.name.length>512)return json({success:false},400);
   if(recordName(body.name)){
    const key=recordPrefix+body.name,saved=await storage.get(key);
    if(saved){if(body.action==='remove')await storage.put(key,{value:null,until:now+60000});
     else if(typeof body.value==='string'&&new TextEncoder().encode(body.value).length<90000)await storage.put(key,{value:body.value,until:Math.min(now+RECORD_TTL,body.expiration?body.expiration*1000:Infinity)});
     else await storage.delete(key);}
   }
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
