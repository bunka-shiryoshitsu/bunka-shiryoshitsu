const encoder=new TextEncoder();
export const normalizeReceiptAP=value=>/^AP-[A-Z0-9]{8}$/.test(String(value||'').trim().toUpperCase())?String(value).trim().toUpperCase():null;
export const receiptCryptoReady=env=>/^[a-f0-9]{64}$/i.test(env.RECEIVE_KEY_ENCRYPTION_KEY||'');
export async function receiptHash(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value))),b=>b.toString(16).padStart(2,'0')).join('')}
async function encryptionKey(env){if(!receiptCryptoReady(env))throw Error('Receipt encryption is not configured');const bytes=Uint8Array.from(env.RECEIVE_KEY_ENCRYPTION_KEY.match(/../g),x=>parseInt(x,16));return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt'])}
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export async function saveRecoverableReceiveKey(env,ap,key){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode('receipt-key-v1:'+ap)},await encryptionKey(env),encoder.encode(key));
 // Authentication and the encrypted administrator copy change in one KV write.
 await env.REGISTRATION_KV.put('RECEIVE_AUTH:'+ap,JSON.stringify({hash:await receiptHash(key),format:'short4',createdAt:new Date().toISOString(),sealed:{version:1,iv:encode(iv),ciphertext:encode(ciphertext)}}));
}
export async function readRecoverableReceiveKey(env,ap){
 const raw=await env.REGISTRATION_KV.get('RECEIVE_AUTH:'+ap);if(!raw)return {available:false,reason:'missing'};
 const record=JSON.parse(raw);if(!record.sealed)return {available:false,reason:'legacy'};
 if(record.sealed.version!==1)throw Error('Unsupported receipt-key format');
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(record.sealed.iv),additionalData:encoder.encode('receipt-key-v1:'+ap)},await encryptionKey(env),decode(record.sealed.ciphertext));
 const key=new TextDecoder().decode(plain);if(!/^[A-Z0-9]{4}$/.test(key)||await receiptHash(key)!==record.hash)throw Error('Receipt-key record mismatch');
 return {available:true,receiveKey:key,createdAt:record.createdAt};
}
