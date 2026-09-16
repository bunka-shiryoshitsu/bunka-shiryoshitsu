import {adminKeys,isListQuota,listLimitMessage,nextListReset} from './admin-key-cache.js';
const REGISTRATION_CHARS = "ABCDEFGHJKLMNPQRSTUVWXY3456789";
const PUBLIC_POOL_PREFIX = "PUBLIC_REGISTRATION_POOL:";
const PUBLIC_ISSUED_PREFIX = "PUBLIC_REGISTRATION_ISSUED:";

export const REGISTRATION_NUMBER_POLICY = Object.freeze({
  length: 8,
  chars: REGISTRATION_CHARS,
  ownerPoolPrefix: "REGISTRATION_LIST",
  publicPoolPrefix: PUBLIC_POOL_PREFIX,
  publicIssuedPrefix: PUBLIC_ISSUED_PREFIX
});

export async function getNextPublicRegistrationNumber(env) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const number = generateRegistrationNumber();
    const first = await checkRegistrationNumberCollision(env, number);
    if (first.duplicate) continue;
    const generatedAt = new Date().toISOString();
    await env.REGISTRATION_KV.put(PUBLIC_POOL_PREFIX + number, JSON.stringify({number,status:"reserved",generatedAt,source:"public-random",isTest:false}));
    const final = await checkRegistrationNumberCollision(env, number, {allowOwnPublicReservation:true});
    if (final.duplicate) {
      await env.REGISTRATION_KV.put(PUBLIC_POOL_PREFIX + number, JSON.stringify({number,status:"collision",generatedAt,collisionCheckedAt:new Date().toISOString(),collisionLocations:final.locations,source:"public-random",isTest:false}));
      continue;
    }
    return number;
  }
  return null;
}

export async function markPublicRegistrationNumberIssued(env, number, metadata = {}) {
  const normalized = normalizeRegistrationNumber(number);
  if (!normalized) throw new Error("Invalid registration number");
  const ownerCollision = await findInOwnerPool(env, normalized);
  if (ownerCollision.length) throw new Error("Registration number collided with owner pool before issuance ledger update");
  const issuedAt = metadata.registeredAt || new Date().toISOString();
  const poolKey = PUBLIC_POOL_PREFIX + normalized, issuedKey = PUBLIC_ISSUED_PREFIX + normalized;
  let generated = {};
  const existingPool = await env.REGISTRATION_KV.get(poolKey);
  if (existingPool) { try { generated = JSON.parse(existingPool) || {}; } catch {} }
  const ap = metadata.ap || null;
  const source = metadata.source || generated.source || "public-random";
  const isTest = Boolean(metadata.isTest === true || generated.isTest === true || /^AP-TEST/i.test(String(ap || "")) || /(^|[-_])test($|[-_])/i.test(String(source || "")));
  const record = {...generated,number:normalized,status:"issued",generatedAt:generated.generatedAt||issuedAt,issuedAt,ap,item:metadata.item||null,source,isTest};
  await env.REGISTRATION_KV.put(poolKey, JSON.stringify(record));
  await env.REGISTRATION_KV.put(issuedKey, JSON.stringify(record));
}

export async function checkRegistrationNumberCollision(env, number, options = {}) {
  const normalized = normalizeRegistrationNumber(number);
  if (!normalized) return {duplicate:true,locations:["invalid-format"]};
  const locations = [];
  locations.push(...await findInOwnerPool(env, normalized));
  const publicPoolKey=PUBLIC_POOL_PREFIX+normalized, publicIssuedKey=PUBLIC_ISSUED_PREFIX+normalized;
  const registrationKeys=[normalized,"REGISTRATION:"+normalized,"REGISTRATION_"+normalized,"REGISTRATION-"+normalized];
  const lookupKeys=[publicPoolKey,publicIssuedKey,...registrationKeys];
  const values=await env.REGISTRATION_KV.get(lookupKeys);
  if(values.get(publicPoolKey)&&!options.allowOwnPublicReservation)locations.push(publicPoolKey);
  if(values.get(publicIssuedKey))locations.push(publicIssuedKey);
  for(const key of registrationKeys)if(values.get(key))locations.push(key);
  return {duplicate:locations.length>0,locations:[...new Set(locations)]};
}

async function readMany(env,names){
  const result=new Map();
  for(let i=0;i<names.length;i+=100){
    const batch=names.slice(i,i+100);
    if(!batch.length)continue;
    const values=await env.REGISTRATION_KV.get(batch);
    for(const name of batch)result.set(name,values.get(name)??null);
  }
  return result;
}

export async function readRegistrationNumberLedgers(env) {
  const owner=[],publicPool=[],publicIssued=[];
  const warnings=[],unavailable=[],stale=[],retryTimes=[];
  async function keys(prefix,section){try{const result=await adminKeys(env,prefix);if(result.stale){stale.push(section);warnings.push("保存済みの一覧を使用しています。最新の番号一覧は利用上限の解除後に確認します。");if(result.retryAt)retryTimes.push(result.retryAt)}return result.keys.map(k=>k.name)}catch(e){if(e.code!=="KV_LIST_LIMIT"&&!isListQuota(e))throw e;unavailable.push(section);warnings.push(listLimitMessage);retryTimes.push(e.retryAt||nextListReset());return []}}
  const ownerKeys=(await keys("REGISTRATION_LIST","owner")).filter(key=>/^REGISTRATION_LIST(?:\d+)?$/.test(key));
  const ownerValues=await readMany(env,ownerKeys);
  for(const key of ownerKeys){const value=ownerValues.get(key);if(!value)continue;let list;try{list=JSON.parse(value)}catch{continue}if(!Array.isArray(list))continue;for(const raw of list){const number=normalizeRegistrationNumber(raw);if(number)owner.push({number,location:key,purpose:"owner-reserved"})}}
  const poolKeys=await keys(PUBLIC_POOL_PREFIX,"publicPool"),poolValues=await readMany(env,poolKeys);
  for(const key of poolKeys){const value=poolValues.get(key);let data=null;try{data=value?JSON.parse(value):null}catch{}publicPool.push({number:key.slice(PUBLIC_POOL_PREFIX.length),location:key,...(data&&typeof data==="object"?data:{})})}
  const issuedKeys=await keys(PUBLIC_ISSUED_PREFIX,"publicIssued"),issuedValues=await readMany(env,issuedKeys);
  for(const key of issuedKeys){const value=issuedValues.get(key);let data=null;try{data=value?JSON.parse(value):null}catch{}publicIssued.push({number:key.slice(PUBLIC_ISSUED_PREFIX.length),location:key,...(data&&typeof data==="object"?data:{})})}
  const byNumber=list=>list.sort((a,b)=>String(a.number).localeCompare(String(b.number)));
  return {warnings:[...new Set(warnings)],unavailable,stale,retryAt:retryTimes.length?Math.max(...retryTimes):null,owner:byNumber(owner),publicPool:byNumber(publicPool),publicIssued:byNumber(publicIssued)};
}

export async function hasRegistrationNumberInLedgers(env, number) {
  const normalized=normalizeRegistrationNumber(number);
  if(!normalized)return false;
  const direct=await env.REGISTRATION_KV.get([PUBLIC_POOL_PREFIX+normalized,PUBLIC_ISSUED_PREFIX+normalized]);
  if(direct.get(PUBLIC_POOL_PREFIX+normalized)||direct.get(PUBLIC_ISSUED_PREFIX+normalized))return true;
  const {keys}=await adminKeys(env,"REGISTRATION_LIST");
  const ownerKeys=keys.map(k=>k.name).filter(name=>/^REGISTRATION_LIST(?:\d+)?$/.test(name));
  const values=await readMany(env,ownerKeys);
  for(const key of ownerKeys){const raw=values.get(key);if(!raw)continue;try{const list=JSON.parse(raw);if(Array.isArray(list)&&list.some(v=>normalizeRegistrationNumber(v)===normalized))return true}catch{}}
  return false;
}

function generateRegistrationNumber(){const bytes=new Uint32Array(8);crypto.getRandomValues(bytes);let value="";for(const n of bytes)value+=REGISTRATION_CHARS[n%REGISTRATION_CHARS.length];return value}
function normalizeRegistrationNumber(value){const number=String(value??"").trim().toUpperCase();return /^[A-Z0-9]{8}$/.test(number)?number:null}

async function findInOwnerPool(env, number) {
  const matches=[];
  // Use the shared administrative key index instead of calling KV list() on every
  // collision check. The index is updated by withAdminKeyCache on normal writes.
  const {keys}=await adminKeys(env,"REGISTRATION_LIST");
  const ownerKeys=keys.map(k=>k.name).filter(name=>/^REGISTRATION_LIST(?:\d+)?$/.test(name));
  const values=await readMany(env,ownerKeys);
  for(const key of ownerKeys){const value=values.get(key);if(!value)continue;let list;try{list=JSON.parse(value)}catch{continue}if(!Array.isArray(list))continue;if(list.some(raw=>String(raw??"").trim().toUpperCase()===number))matches.push(key)}
  return matches;
}
