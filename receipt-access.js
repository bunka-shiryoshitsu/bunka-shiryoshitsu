// AP numbers are the applicant's only credential under the owner's AP-only policy.
export const normalizeReceiptAP=value=>{const ap=String(value??'').trim().toUpperCase();return /^AP-[A-Z0-9]{8}$/.test(ap)?ap:null};
const normalizeAP=normalizeReceiptAP;
const normalizeNumber=value=>/^[A-Z0-9]{8}$/.test(String(value??'').trim().toUpperCase())?String(value).trim().toUpperCase():null;
const cors=()=>({'Access-Control-Allow-Origin':'https://bunka-shiryoshitsu.github.io','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-Admin-Key'});
const json=(value,status=200)=>Response.json(value,{status,headers:{...cors(),'Cache-Control':'no-store, private'}});
const FAILURE_TTL=900,MAX_FAILURES=10;
export async function authorizeReceiptAP(request,env,value){
 const ap=normalizeReceiptAP(value),ip=request.headers.get('CF-Connecting-IP')||'local';
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ip));
 const limiter='RECEIPT_AP_FAILURE:'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const now=Date.now(),raw=await env.REGISTRATION_KV.get(limiter);let failures={count:0,firstAt:now};
 if(raw){try{const saved=JSON.parse(raw);if(now-saved.firstAt<FAILURE_TTL*1000)failures=saved}catch{}}
 if(failures.count>=MAX_FAILURES)return {response:json({success:false,message:'確認の回数が上限に達しました。15分後にもう一度お試しください。'},429)};
 if(ap&&(await env.REGISTRATION_KV.get('REGISTRATION_APPLICATION:'+ap)||await env.REGISTRATION_KV.get('APPLICATION_'+ap)))return {ap};
 await env.REGISTRATION_KV.put(limiter,JSON.stringify({count:failures.count+1,firstAt:failures.firstAt}),{expirationTtl:FAILURE_TTL});
 return {response:json({success:false,message:'AP番号を確認できません。控えた番号を確認してください。'},401)};
}
export async function receiptEndpoint(request,env){
 if(request.method!=='POST')return json({success:false,message:'受取画面から操作してください。'},405);
 let body;try{body=await request.json()}catch{return json({success:false,message:'入力内容を確認してください。'},400)}
 try{const auth=await authorizeReceiptAP(request,env,body?.ap);if(auth.response)return auth.response;return new URL(request.url).pathname==='/receive-status'?await receiptStatus(env,auth.ap):await receiptFile(env,auth.ap,body?.registrationNumber)}
 catch{return json({success:false,message:'確認できませんでした。時間をおいて再度お試しください。'},503)}
}
export async function receiptStatus(env,ap){const raw=await env.REGISTRATION_KV.get("REGISTRATION_APPLICATION:"+ap);if(!raw)return json({success:true,ap,status:"not_submitted",items:[],message:"このAP番号では、登録申請データをまだ確認できません。"});let a;try{a=JSON.parse(raw)}catch{return json({success:false,message:"申請データを確認できません。"},500)}const items=[];for(const item of a.items||[]){const number=normalizeNumber(item.registrationNumber);if(!number||item.registrationStatus==="cancelled")continue;const ready=Boolean(await env.REGISTRATION_KV.get("ISSUED_DATA_META:"+number));items.push({item:item.item,registrationNumber:number,registrationType:item.registrationTypeLabel||"",name:item.finalName||item.name||"",relatedName:item.finalRelatedName||item.relatedName||"",ready})}return json({success:true,ap,status:a.status||"under_review",items,message:items.some(x=>x.ready)?"登録書が完成した資料があります。":"登録書はまだ受取可能な状態ではありません。"})}
async function getRegistration(env,n){for(const k of ["REGISTRATION:"+n,"REGISTRATION_"+n,"REGISTRATION-"+n]){const raw=await env.REGISTRATION_KV.get(k);if(raw)try{return JSON.parse(raw)}catch{return null}}return null}
export async function receiptFile(env,ap,value){const n=normalizeNumber(value);if(!n)return new Response("登録番号を確認してください。",{status:400});const reg=await getRegistration(env,n);if(!reg||reg.status==="cancelled"||normalizeAP(reg.ap)!==ap)return new Response("この登録書を受け取る権限を確認できません。",{status:403});const data=await env.REGISTRATION_KV.get("ISSUED_DATA:"+n,{type:"arrayBuffer"});if(!data)return new Response("登録書は準備中です。",{status:404});return new Response(data,{status:200,headers:{...cors(),"Content-Type":"image/jpeg","Content-Disposition":`attachment; filename="${n}.jpg"`,"Cache-Control":"no-store, private"}})}
