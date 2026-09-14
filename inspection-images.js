// Private inspection copies. The existing Durable Object serializes every write.
// Image bytes, metadata, expiry index and accounting are committed atomically.
const DAY = 86400000;
export const INSPECTION = Object.freeze({days:180, maxBytes:200*1024*1024, imageBytes:150*1024, longest:1200, chunk:100*1024, storageCeiling:800*1024*1024});
export const inspectionPaths = new Set(['/admin/inspection-images/status','/admin/inspection-images/source','/admin/inspection-images/upload','/admin/inspection-images/image','/admin/inspection-images/ready','/admin/inspection-images/extend','/admin/inspection-images/budget']);
const AP=/^AP-[A-Z0-9]{8}$/, ITEM=/^(0[1-9]|10)$/, ID=/^(original-(0[1-9]|1[0-9]|20)|supplement-[a-f0-9-]{36})$/;
const STATE='inspection:state', RECORD='inspection:record:', EXPIRY='inspection:expiry:', BLOB='inspection:blob:';
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const recordKey=(ap,item)=>RECORD+ap+':'+item;
const expiryKey=r=>EXPIRY+String(r.expiresAt).padStart(13,'0')+':'+r.ap+':'+r.item;
const blobKey=(r,image,n)=>BLOB+r.ap+':'+r.item+':'+image.id+':'+n;
const iso=ms=>new Date(ms).toISOString();
const emptyState=()=>({bytes:0,count:0,budgetBytes:INSPECTION.maxBytes,revision:0,removedCount:0,lastRemovedAt:null});
async function stateOf(storage){return await storage.get(STATE)||emptyState()}
async function wake(storage,now){const at=await storage.getAlarm();if(at===null||at>now+60000)await storage.setAlarm(now+60000)}
async function atomic(storage,fn){if(!storage.transaction)throw Error('Transactional storage is required');return storage.transaction(fn)}

export async function inspectionBody(request,max){
  if(Number(request.headers.get('Content-Length'))>max)fail('画像・入力内容が大きすぎます。',413);
  const reader=request.body?.getReader();if(!reader)fail('送信内容がありません。');
  const parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();fail('画像・入力内容が大きすぎます。',413)}parts.push(value)}}finally{reader.releaseLock()}
  const bytes=new Uint8Array(size);let pos=0;for(const p of parts){bytes.set(p,pos);pos+=p.length}return bytes;
}

// Check actual JPEG dimensions; do not trust a filename, MIME header or URL input.
export function jpegDimensions(bytes){
  if(bytes.length<20||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)return null;
  let p=2,dimensions=null;
  while(p+3<bytes.length){if(bytes[p++]!==255)return null;while(bytes[p]===255)p++;const marker=bytes[p++];if(marker===0xda)return dimensions;if(marker===0xd9)break;
    if(marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    const size=(bytes[p]<<8)|bytes[p+1];if(size<2||p+size>bytes.length)return null;
    // Canvas copies have no EXIF/GPS/comment payloads. Refuse such payloads here too.
    if(marker===0xe1||marker===0xed||marker===0xfe)return null;
    if([0xc0,0xc1,0xc2].includes(marker)){if(size<8)return null;dimensions={height:(bytes[p+3]<<8)|bytes[p+4],width:(bytes[p+5]<<8)|bytes[p+6]};}
    p+=size;
  }return null;
}

export async function inspectionContext(env,storage,ap,item){
  if(!AP.test(ap||'')||!ITEM.test(item||''))fail('申請番号・資料番号を確認してください。');
  const raw=await env.REGISTRATION_KV.get('REGISTRATION_APPLICATION:'+ap);if(!raw)fail('申請が見つかりません。',404);
  const application=JSON.parse(raw),material=application.items?.find(x=>String(x.item)===item);if(!material)fail('資料が見つかりません。',404);
  const supplement=await storage.get('supplement:'+ap+':'+item),final=await storage.get('supplement-final:'+ap+':'+item);
  const finished=Boolean(final||material.registrationNumber||material.registrationStatus==='cancelled'||['type1','type2','type3','special','rejected'].includes(material.reviewResult)||supplement?.rounds?.at(-1)?.status==='closed');
  // Discover stored bytes, including an upload whose metadata write was interrupted.
  const keys=await env.REGISTRATION_KV.list({prefix:'IMAGE:'+ap+':'+item+':',limit:30});
  const sources=keys.keys.map(k=>k.name.split(':').at(-1)).filter(n=>/^(0[1-9]|1[0-9]|20)$/.test(n)).sort().map(n=>({id:'original-'+n,label:'申請画像 '+Number(n),source:'original',image:n}));
  for(const [roundIndex,round] of (supplement?.imageCleanup?.status==='deleted'?[]:supplement?.rounds||[]).entries())for(const image of round.uploads||[]){
    // Unsubmitted/withdrawn attachments are never retained for inspection.
    if(round.submission?.imageIds?.includes(image.id))sources.push({id:'supplement-'+image.id,label:'追加提出 '+(roundIndex+1)+'・画像 '+((round.uploads||[]).indexOf(image)+1),source:'supplement',image:image.id,size:image.size,chunks:image.chunks,type:image.type});
  }
  return {material,finished,sources,supplement,final};
}
function publicRecord(r){if(!r)return null;const {finishPending,...data}=r;return data}
function storageBytes(storage){const n=storage.sql?.databaseSize;return Number.isFinite(n)?n:null}
async function stats(storage){const s=await stateOf(storage),databaseBytes=storageBytes(storage);return {...s,databaseBytes,availableBytes:Math.max(0,Math.min(s.budgetBytes-s.bytes,databaseBytes===null?Infinity:INSPECTION.storageCeiling-databaseBytes)),warning:s.bytes>=s.budgetBytes*.8||(databaseBytes!==null&&databaseBytes>=INSPECTION.storageCeiling*.9),days:INSPECTION.days,imageBytes:INSPECTION.imageBytes,longest:INSPECTION.longest}}
async function purge(storage,r,reason,now){
  await atomic(storage,async tx=>{
    const current=await tx.get(recordKey(r.ap,r.item));if(!current?.images?.length)return;
    const s=await stateOf(tx);for(const image of current.images)for(let n=0;n<image.chunks;n++)await tx.delete(blobKey(current,image,n));
    s.bytes=Math.max(0,s.bytes-current.images.reduce((n,x)=>n+x.bytes,0));s.count=Math.max(0,s.count-current.images.length);s.removedCount+=current.images.length;s.lastRemovedAt=iso(now);s.revision++;
    await tx.delete(expiryKey(current));await tx.put(recordKey(r.ap,r.item),{...current,images:[],revision:current.revision+1,deletedAt:iso(now),deleteReason:reason,deletedCount:current.images.length,finishPending:null});await tx.put(STATE,s);
  });
}
async function makeRoom(storage,extra,exclude,now,env){
  let s=await stateOf(storage),db=storageBytes(storage);
  const enough=()=>s.bytes+extra<=s.budgetBytes&&(db===null||db+extra*1.15<INSPECTION.storageCeiling);
  if(enough())return;
  let cursor='';
  for(let page=0;page<20&&!enough();page++){
    const entries=await storage.list({prefix:EXPIRY,...(cursor?{startAfter:cursor}:{}),limit:50});if(!entries.size)break;
    for(const [key,pointer]of entries){cursor=key;if(pointer===exclude)continue;const r=await storage.get(pointer);if(!r?.images?.length)continue;
      if(!r.finalizedAt&&r.expiresAt>now)continue;
      if(!r.finalizedAt&&r.finishPending){const ctx=await inspectionContext(env,storage,r.ap,r.item);if(ctx.finished){await queueOriginalCleanup(storage,r.ap,r.item,now);await finalizeInspection(storage,r.ap,r.item,now);continue;}}
      await purge(storage,r,r.expiresAt<=now?'expired':'capacity',now);s=await stateOf(storage);db=storageBytes(storage);if(enough())break;
    }if(entries.size<50)break;
  }
  if(!enough())fail('点検画像の保存容量が不足しています。⑥設定の点検画像欄で使用量を確認してください。元画像と審査結果は変更していません。',507);
}

export async function finalizeInspection(storage,ap,item,now=Date.now()){
  const r=await storage.get(recordKey(ap,item));if(!r?.images?.length||r.finalizedAt)return;
  await wake(storage,now);
  await atomic(storage,async tx=>{const current=await tx.get(recordKey(ap,item));if(!current?.images?.length||current.finalizedAt)return;await tx.delete(expiryKey(current));const next={...current,finalizedAt:iso(current.finishPending?.at||now),expiresAt:(current.finishPending?.at||now)+INSPECTION.days*DAY,finishPending:null,revision:current.revision+1};await tx.put(recordKey(ap,item),next);await tx.put(expiryKey(next),recordKey(ap,item));});
}
export async function queueOriginalCleanup(storage,ap,item,now=Date.now()){
  if(!AP.test(ap||'')||!ITEM.test(item||''))return;
  await wake(storage,now);await storage.put('inspection:original-cleanup:'+ap+':'+item,{ap,item,at:now});
}
export async function requireInspectionReady(env,storage,ap,item,revision,now=Date.now()){
  const ctx=await inspectionContext(env,storage,ap,item),r=await storage.get(recordKey(ap,item));
  if(!ctx.sources.length)return;
  if(!r||r.expiresAt<=now||r.revision!==revision||ctx.sources.some(s=>!r.images.some(i=>i.id===s.id)))fail('点検用画像を保存してから確定してください。管理画面を再読み込みし、もう一度お試しください。',409);
  await wake(storage,now);await storage.put(recordKey(ap,item),{...r,finishPending:{at:now}});
}

export async function sweepInspectionImages(storage,env,now=Date.now()){
  const cleanups=await storage.list({prefix:'inspection:original-cleanup:',limit:10});
  for(const [key,r]of cleanups){const ctx=await inspectionContext(env,storage,r.ap,r.item);if(!ctx.finished)continue;
    for(let n=1;n<=20;n++){const id=String(n).padStart(2,'0');await env.REGISTRATION_KV.delete('IMAGE:'+r.ap+':'+r.item+':'+id);await env.REGISTRATION_KV.delete('IMAGE_META:'+r.ap+':'+r.item+':'+id)}await storage.delete(key);
  }
  const entries=await storage.list({prefix:EXPIRY,limit:30});let deleted=0;
  for(const [key,pointer]of entries){const expiry=Number(key.slice(EXPIRY.length,EXPIRY.length+13));if(expiry>now)break;const r=await storage.get(pointer);
    if(!r?.images?.length||expiryKey(r)!==key){await storage.delete(key);continue;}
    if(!r.finalizedAt&&r.finishPending){const ctx=await inspectionContext(env,storage,r.ap,r.item);if(ctx.finished){await queueOriginalCleanup(storage,r.ap,r.item,now);await finalizeInspection(storage,r.ap,r.item,now);continue;}}
    await purge(storage,r,'expired',now);deleted++;
  }
  const first=await storage.list({prefix:EXPIRY,limit:1}),key=first.keys().next().value;
  const remaining=await storage.list({prefix:'inspection:original-cleanup:',limit:1});
  return {deleted,nextAt:key?Number(key.slice(EXPIRY.length,EXPIRY.length+13)):null,more:remaining.size>0};
}

export async function inspectionService(request,env,storage,now=Date.now()){
  if(!env.ADMIN_KEY||request.headers.get('X-Admin-Key')!==env.ADMIN_KEY)return json({success:false,message:'Unauthorized.'},401);
  const u=new URL(request.url),action=u.pathname.split('/').at(-1),ap=u.searchParams.get('ap'),item=u.searchParams.get('item');
  const read=['status','source','image'].includes(action);if(request.method!==(read?'GET':'POST'))return json({success:false,message:'Method Not Allowed'},405);
  try{
    if(action==='status'&&!ap&&!item){
      const cursor=u.searchParams.get('cursor')||'';if(cursor&&!/^inspection:record:AP-[A-Z0-9]{8}:(0[1-9]|10)$/.test(cursor))fail('一覧の位置を確認してください。');
      const rows=await storage.list({prefix:RECORD,...(cursor?{startAfter:cursor}:{}),limit:30});
      return json({success:true,stats:await stats(storage),records:[...rows.values()].map(publicRecord),nextCursor:rows.size===30?[...rows.keys()].at(-1):null});
    }
    if(action==='budget'){
      const body=JSON.parse(new TextDecoder().decode(await inspectionBody(request,2000)));
      if(![50,100,150,200].includes(body.megabytes))fail('容量は50・100・150・200MBから選択してください。');
      const s=await stateOf(storage);if(body.revision!==s.revision)fail('容量情報が更新されています。再読み込みしてください。',409);
      if(s.bytes>body.megabytes*1024*1024)fail('現在の使用量より小さくできません。画像の保存期限が過ぎてから変更してください。',409);
      await storage.put(STATE,{...s,budgetBytes:body.megabytes*1024*1024,revision:s.revision+1});return json({success:true,stats:await stats(storage)});
    }
    const ctx=await inspectionContext(env,storage,ap,item),key=recordKey(ap,item);let r=await storage.get(key);
    if(r?.images?.length&&!r.finalizedAt&&ctx.finished){await finalizeInspection(storage,ap,item,now);r=await storage.get(key)}
    if(r?.images?.length&&r.expiresAt<=now){await purge(storage,r,'expired',now);r=await storage.get(key)}
    if(action==='status')return json({success:true,record:publicRecord(r),sources:ctx.sources.map(({id,label,source})=>({id,label,source})),finished:ctx.finished,stats:await stats(storage)});
    const id=u.searchParams.get('id');
    if(['source','image','upload'].includes(action)&&!ID.test(id||''))fail('画像番号を確認してください。');
    if(action==='source'){
      const source=ctx.sources.find(s=>s.id===id);if(!source)fail('元画像は残っていません。',404);
      let bytes;if(source.source==='original')bytes=await env.REGISTRATION_KV.get('IMAGE:'+ap+':'+item+':'+source.image,{type:'arrayBuffer'});
      else{bytes=new Uint8Array(source.size);for(let n=0;n<source.chunks;n++){const c=await storage.get('supplement-image:'+ap+':'+item+':'+source.image+':'+n);if(!c)fail('元画像は削除済みです。',410);bytes.set(new Uint8Array(c),n*120000)}}
      if(!bytes)fail('元画像は削除済みです。',410);
      return new Response(bytes,{headers:{'Content-Type':source.type||'image/jpeg','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
    }
    if(action==='image'){
      const image=r?.images.find(i=>i.id===id);if(!image)fail(r?.deletedAt?'保存期限または容量上限により削除済みです。':'点検用画像が見つかりません。',r?.deletedAt?410:404);
      const bytes=new Uint8Array(image.bytes);for(let n=0;n<image.chunks;n++){const b=await storage.get(blobKey(r,image,n));if(!b)fail('点検画像を読み込めませんでした。',503);bytes.set(new Uint8Array(b),n*INSPECTION.chunk)}
      return new Response(bytes,{headers:{'Content-Type':'image/jpeg','Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','Content-Disposition':'inline','Content-Security-Policy':"default-src 'none'; sandbox"}});
    }
    if(action==='upload'){
      const source=ctx.sources.find(s=>s.id===id);if(!source)fail('元画像の状態が変わりました。もう一度読み込んでください。',409);
      const bytes=await inspectionBody(request,INSPECTION.imageBytes),dimensions=jpegDimensions(bytes);
      if(!dimensions||dimensions.width<1||dimensions.height<1||Math.max(dimensions.width,dimensions.height)>INSPECTION.longest)fail('点検画像は長辺1200px以内・150KB以内のJPEGにしてください。',415);
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      const existing=r?.images?.find(x=>x.id===id);if(existing){if(existing.digest!==digest)fail('この点検画像は保存済みです。',409);return json({success:true,record:publicRecord(r),stats:await stats(storage)})}
      await wake(storage,now);await makeRoom(storage,bytes.length,key,now,env);
      r=await storage.get(key)||{ap,item,name:ctx.material.finalName||ctx.material.name||'',images:[],createdAt:iso(now),expiresAt:now+DAY,revision:0,finalizedAt:null};
      if(!r.images.length)r={...r,createdAt:iso(now),finalizedAt:ctx.finished?iso(now):null,expiresAt:now+(ctx.finished?INSPECTION.days:1)*DAY,deletedAt:null,deleteReason:null,deletedCount:0,finishPending:null};
      const image={id,label:source.label,source:source.source,bytes:bytes.length,chunks:Math.ceil(bytes.length/INSPECTION.chunk),...dimensions,digest,savedAt:iso(now)};
      await atomic(storage,async tx=>{const s=await stateOf(tx);for(let n=0;n<image.chunks;n++)await tx.put(blobKey(r,image,n),bytes.slice(n*INSPECTION.chunk,(n+1)*INSPECTION.chunk).buffer);r={...r,images:[...r.images,image],revision:r.revision+1,updatedAt:iso(now)};await tx.put(key,r);await tx.put(expiryKey(r),key);await tx.put(STATE,{...s,bytes:s.bytes+image.bytes,count:s.count+1,revision:s.revision+1})});
      return json({success:true,record:publicRecord(r),stats:await stats(storage)});
    }
    const body=JSON.parse(new TextDecoder().decode(await inspectionBody(request,4000)));
    if(action==='ready'){
      if(ctx.sources.some(s=>!r?.images?.some(i=>i.id===s.id)))fail('保存できていない点検画像があります。もう一度お試しください。',409);
      if(ctx.finished&&r?.images?.length)await queueOriginalCleanup(storage,ap,item,now);
      return json({success:true,revision:r?.revision??0,record:publicRecord(r),stats:await stats(storage)});
    }
    if(action==='extend'){
      if(!r?.images?.length||!r.finalizedAt)fail('確定後の保存中の画像だけ延長できます。',409);
      const s=await stateOf(storage);if(r.revision!==body.revision)fail('保存期限が更新されています。再読み込みしてください。',409);
      if(s.bytes>=s.budgetBytes*.9)fail('容量が90％以上のため延長できません。⑥設定で使用量をご確認ください。',409);
      const until=Date.parse(String(body.date)+'T00:00:00+09:00')+DAY;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(body.date||'')||!Number.isFinite(until)||new Date(until-DAY+9*3600000).toISOString().slice(0,10)!==body.date||until<=r.expiresAt||until>now+366*DAY)fail('現在の期限より後で、今日から1年以内の日付を選んでください。');
      await wake(storage,now);await atomic(storage,async tx=>{await tx.delete(expiryKey(r));r={...r,expiresAt:until,revision:r.revision+1,extendedAt:iso(now)};await tx.put(key,r);await tx.put(expiryKey(r),key)});
      return json({success:true,record:publicRecord(r),stats:await stats(storage)});
    }
    fail('Not Found',404);
  }catch(e){return json({success:false,message:e.status?e.message:'点検画像を保存・取得できませんでした。再試行してください。'},e.status||503)}
}
