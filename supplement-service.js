// Supplement records and image chunks live in the existing SQLite Durable Object.
// They never overwrite the original application or its images.
import {supplementFinished, ensureRetentionAlarm, tryPurgeSupplementImages} from './supplement-retention.js';
import {requireInspectionReady,finalizeInspection,queueOriginalCleanup} from './inspection-images.js';
export const supplementPaths = new Set(['/supplement/status','/supplement/upload','/supplement/remove','/supplement/submit','/supplement/image','/admin/supplement/request','/admin/supplement/status','/admin/supplement/queue','/admin/supplement/extend','/admin/supplement/close','/admin/supplement/image']);
const DAY = 86400000;
const CHUNK = 120000;
export function initialWindow(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('Invalid application month');
  const [year,m]=month.split('-').map(Number),first=Date.UTC(year,m+1,1);
  return {checkStart:new Date(first).toISOString().slice(0,10),expiryDate:new Date(first+59*DAY).toISOString().slice(0,10)};
}
export function deadlineAfter(now, days = 30) {
  const day = new Date(now + 9 * 3600000).toISOString().slice(0,10);
  return Date.parse(day + 'T00:00:00+09:00') + (days + 1) * DAY;
}
export function deadlineLabel(exclusive) {
  return new Date(exclusive - 1 + 9 * 3600000).toISOString().slice(0,10) + ' 23:59（日本時間）';
}
export function json(data, status=200) {
  return new Response(JSON.stringify(data), {status,headers:{'Content-Type':'application/json; charset=UTF-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://bunka-shiryoshitsu.github.io','X-Content-Type-Options':'nosniff'}});
}
function fail(message,status=400){ throw Object.assign(new Error(message),{status}); }
export async function boundedBody(request, limit) {
  if(Number(request.headers.get('Content-Length'))>limit)fail('送信データが大きすぎます。',413);
  const reader=request.body?.getReader(); if(!reader)return new Uint8Array();
  const chunks=[];let size=0;
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail('送信データが大きすぎます。',413);}chunks.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
function currentStatus(round,now){return round.status==='pending'&&now>=round.deadline?'expired':round.status;}
function publicRound(round,now,finished=false,cleanup){return {...round,status:currentStatus(round,now),deadlineLabel:deadlineLabel(round.deadline),imagesUnavailable:finished,imagesDeletedAt:cleanup?.deletedAt||null};}
function imageType(b){
  if(b[0]===255&&b[1]===216&&b[2]===255)return 'image/jpeg';
  if([137,80,78,71,13,10,26,10].every((x,i)=>b[i]===x))return 'image/png';
  if(new TextDecoder().decode(b.slice(0,4))==='RIFF'&&new TextDecoder().decode(b.slice(8,12))==='WEBP')return 'image/webp';
  return null;
}
export async function supplementService(request,env,storage,now=Date.now()) {
  try {
    const url=new URL(request.url), path=url.pathname;
    const admin=path.startsWith('/admin/');
    if(admin&&(!env.ADMIN_KEY||request.headers.get('X-Admin-Key')!==env.ADMIN_KEY))fail('Unauthorized.',401);
    if(path==='/admin/supplement/queue'){
      if(request.method!=='GET')fail('Method Not Allowed',405);
      const cursor=url.searchParams.get('cursor')||'';
      if(cursor&&!/^supplement:AP-[A-Z0-9]{8}:(0[1-9]|10)$/.test(cursor))fail('一覧の位置を確認してください。');
      const records=await storage.list({prefix:'supplement:',limit:100,...(cursor?{startAfter:cursor}:{})});
      const rows=[...records].map(([key,value])=>{const parts=key.split(':');return {ap:parts[1],item:parts[2],round:publicRound(value.rounds.at(-1),now)};});
      return json({success:true,rows,nextCursor:records.size===100?[...records.keys()].at(-1):null});
    }
    const ap=(url.searchParams.get('ap')||'').trim().toUpperCase();
    if(!/^AP-[A-Z0-9]{8}$/.test(ap))fail('AP番号を確認してください。');
    const raw=await env.REGISTRATION_KV.get('REGISTRATION_APPLICATION:'+ap);
    if(!raw)fail('登録申請はまだ受け付けられていません。初回申請後にご確認ください。',404);
    const application=JSON.parse(raw);
    if(path.endsWith('/status')) {
      if(request.method!=='GET')fail('Method Not Allowed',405);
      const items=[];
      for(const item of application.items||[]) {
        const record=await storage.get('supplement:'+ap+':'+item.item);
        const final=await storage.get('supplement-final:'+ap+':'+item.item);
        const finished=supplementFinished(item,record,final);
        if(finished&&record)await tryPurgeSupplementImages(storage,ap,String(item.item),record,now);
        const rounds=record?.rounds||[];
        items.push({item:item.item,name:item.finalName||item.name||'',reviewResult:final?.result||item.reviewResult||'',registrationStatus:item.registrationStatus||'',rounds:rounds.map(r=>publicRound(r,now,finished,record?.imageCleanup)),revision:record?.revision||0});
      }
      return json({success:true,ap,items,serverTime:new Date(now).toISOString()});
    }
    const itemNo=url.searchParams.get('item');
    const item=application.items?.find(x=>String(x.item)===itemNo);
    if(!item)fail('対象の資料が見つかりません。',404);
    const key='supplement:'+ap+':'+itemNo;
    const record=await storage.get(key)||{rounds:[],revision:0};
    let round=record.rounds.at(-1);
    const final=await storage.get('supplement-final:'+ap+':'+itemNo);
    const finalized=supplementFinished(item,record,final);
    if(path.endsWith('/image')) {
      if(request.method!=='GET')fail('Method Not Allowed',405);
      if(finalized){await tryPurgeSupplementImages(storage,ap,itemNo,record,now);fail('確認・手続終了のため、追加提出画像は閲覧できません。',410);}
      const id=url.searchParams.get('id');
      const image=record.rounds.flatMap(r=>r.uploads||[]).find(x=>x.id===id);
      if(!image)fail('画像が見つかりません。',404);
      const bytes=new Uint8Array(image.size);
      for(let n=0;n<image.chunks;n++){const chunk=await storage.get('supplement-image:'+ap+':'+itemNo+':'+id+':'+n);if(!chunk)fail('画像を読み込めませんでした。',503);bytes.set(new Uint8Array(chunk),n*CHUNK);}
      return new Response(bytes,{headers:{'Content-Type':image.type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
    }
    if(request.method!=='POST')fail('Method Not Allowed',405);
    if(finalized)fail('この資料の確認は終了しています。',409);
    if(path.endsWith('/upload')) {
      if(!round||round.id!==url.searchParams.get('round')||currentStatus(round,now)!=='pending')fail('提出期限または依頼の状態が変わりました。画面を再確認してください。',409);
      if(!round.needImages)fail('この依頼では画像の提出を求めていません。');
      const id=url.searchParams.get('id');if(!/^[a-f0-9-]{36}$/.test(id||''))fail('画像番号が正しくありません。');
      if(round.uploads.some(x=>x.id===id))return json({success:true,id});
      if(round.uploads.length>=10)fail('画像は1回の依頼につき10枚までです。');
      const bytes=await boundedBody(request,3*1024*1024);const type=imageType(bytes);
      if(!type)fail('JPEG・PNG・WebP形式の画像を指定してください。');
      // Write immutable chunks before adding their reference. Incomplete retries use the same ID.
      const chunks=Math.ceil(bytes.length/CHUNK);
      for(let n=0;n<chunks;n++)await storage.put('supplement-image:'+ap+':'+itemNo+':'+id+':'+n,bytes.slice(n*CHUNK,(n+1)*CHUNK).buffer);
      round.uploads.push({id,type,size:bytes.length,chunks,uploadedAt:new Date(now).toISOString()});
      await storage.put(key,record);return json({success:true,id});
    }
    let body;try{body=JSON.parse(new TextDecoder().decode(await boundedBody(request,50000)));}catch(e){if(e.status)throw e;fail('入力内容を確認してください。');}
    if(path.endsWith('/submit')&&body.token&&round?.submission?.token===body.token&&round.id===body.round)return json({success:true,message:'追加資料は提出済みです。',submittedAt:round.submission.at});
    if(path.endsWith('/request')) {
      if(record.revision!==body.revision)fail('依頼が更新されています。画面を再読込してください。',409);
      if(round&&['pending','expired'].includes(currentStatus(round,now)))fail('既存の依頼を延長するか、提出後に新しい依頼を作成してください。',409);
      if(record.rounds.length>=20)fail('依頼回数の上限です。現在の資料をもとに判断してください。',409);
      const instruction=String(body.instruction||'').trim();
      if(!instruction||instruction.length>2000||(body.needText!==true&&body.needImages!==true))fail('必要な文章・画像を選び、依頼内容を2000文字以内で記入してください。');
      round={id:crypto.randomUUID(),instruction,needText:body.needText===true,needImages:body.needImages===true,requestedAt:new Date(now).toISOString(),deadline:deadlineAfter(now),status:'pending',uploads:[],extensions:[]};
      record.rounds.push(round);record.revision++;
    } else {
      if(!round||round.id!==body.round)fail('依頼が更新されています。画面を再確認してください。',409);
      if(path.endsWith('/remove')) {
        if(currentStatus(round,now)!=='pending')fail('提出前の画像だけ取り消せます。',409);
        const image=round.uploads.find(x=>x.id===body.id);if(!image)fail('画像が見つかりません。',404);
        round.uploads=round.uploads.filter(x=>x.id!==image.id);
        await storage.put(key,record);
        for(let n=0;n<image.chunks;n++)await storage.delete('supplement-image:'+ap+':'+itemNo+':'+image.id+':'+n);
        return json({success:true,message:'添付画像を取り消しました。'});
      } else if(path.endsWith('/submit')) {
        if(currentStatus(round,now)!=='pending')fail('提出期限を過ぎたか、既に提出されています。画面を再確認してください。',409);
        const text=String(body.text||'').trim();
        if(text.length>5000||(round.needText&&!text))fail('求められた追加情報を5000文字以内で入力してください。');
        if(!/^[a-f0-9-]{36}$/.test(body.token||''))fail('提出番号が正しくありません。');
        if(round.needImages&&!round.uploads.length)fail('追加画像を添付してください。');
        round.submission={text,at:new Date(now).toISOString(),token:body.token,imageIds:round.uploads.map(x=>x.id)};
        round.status='submitted';record.revision++;
      } else if(path.endsWith('/extend')) {
        if(record.revision!==body.revision||!['pending','expired'].includes(currentStatus(round,now)))fail('延長できる依頼ではありません。',409);
        const date=String(body.date||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date))fail('新しい期限を指定してください。');
        const deadline=Date.parse(date+'T00:00:00+09:00')+DAY;
        if(!Number.isFinite(deadline)||new Date(deadline-DAY+9*3600000).toISOString().slice(0,10)!==date||deadline<=Math.max(now,round.deadline))fail('現在の期限より後の日付を指定してください。');
        round.extensions.push({at:new Date(now).toISOString(),previousDeadline:round.deadline,deadline});round.deadline=deadline;record.revision++;
      } else if(path.endsWith('/close')) {
        if(record.revision!==body.revision||currentStatus(round,now)!=='expired')fail('期限切れの未提出依頼だけ手続終了にできます。',409);
        await requireInspectionReady(env,storage,ap,itemNo,body.inspectionRevision,now);
        await ensureRetentionAlarm(storage,now);
        round.status='closed';round.closedAt=new Date(now).toISOString();record.revision++;
      } else fail('Not Found',404);
    }
    await storage.put(key,record);
    if(round.status==='closed'){await queueOriginalCleanup(storage,ap,itemNo,now);await finalizeInspection(storage,ap,itemNo,now);await tryPurgeSupplementImages(storage,ap,itemNo,record,now);}
    return json({success:true,message:round.status==='submitted'?'追加資料を受け付けました。週に一度、この画面をご確認ください。':'保存しました。',round:publicRound(round,now,round.status==='closed',record.imageCleanup)});
  } catch(e){return json({success:false,message:e.status?e.message:'保存・読込に失敗しました。再試行してください。'},e.status||500);}
}
