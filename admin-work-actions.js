// Derive outstanding human work from saved state. Viewing a page never completes work.
export function deriveWorkActions({applications=[],registrations=[],lottery=[],queue=[]},now=Date.now()) {
  const tasks=[],waiting=[],seen=new Set();
  const validAP=ap=>/^AP-[A-Z0-9]{8}$/.test(ap||'');
  const test=r=>r?.isTest===true||/^AP-TEST/i.test(r?.ap||'')||/(^|[-_])test($|[-_])/i.test(r?.source||'');
  const time=value=>Number.isFinite(Date.parse(value))?Date.parse(value):null;
  const rounds=new Map(queue.map(r=>[r.ap+':'+r.item,r.round]));
  const registered=new Map(registrations.map(r=>[r.registrationNumber,r]));
  const add=t=>{if(!seen.has(t.id)){seen.add(t.id);tasks.push(t)}};
  const itemTask=(a,i,kind,label,view='applications',deadline=null)=>({id:a.ap+':'+i.item,ap:a.ap,item:String(i.item),view,kind,label,name:i.finalName||i.name||'名称未入力',at:time(a.submittedAt),deadline});
  for(const a of applications){
    if(test(a)||!validAP(a.ap)||['cancelled','rejected'].includes(a.status))continue;
    for(const i of a.items||[]){
      if(test(i)||! /^(0[1-9]|10)$/.test(String(i.item))||i.registrationStatus==='cancelled')continue;
      const r=registered.get(i.registrationNumber),round=rounds.get(a.ap+':'+i.item);
      if(r?.status==='cancelled')continue;
      if(i.registrationNumber){if(!i.issuedDataReady&&!r?.issuedDataReady)add(itemTask(a,i,'document','登録書を作成・保存','registry'));continue;}
      if(['type1','type2','type3','special','rejected'].includes(i.reviewResult)||['closed','resolved'].includes(round?.status))continue;
      const deadline=Number.isFinite(round?.deadline)?round.deadline:null;
      if(round?.status==='expired'||round?.status==='pending'&&deadline!==null&&deadline<=now){add(itemTask(a,i,'expired','提出期限切れの対応を確認','applications',deadline));continue;}
      if(round?.status==='pending'){waiting.push(itemTask(a,i,'waiting','申請者からの提出待ち','applications',deadline));continue;}
      add(itemTask(a,i,round?.status==='submitted'?'supplement':'review',round?.status==='submitted'?'追加資料を確認して審査':'内容・画像を確認して審査','applications',deadline));
    }
  }
  const submitted=new Set(applications.map(a=>a.ap));
  for(const a of lottery){
    // A duplicate flag is not an instruction to select a winner. Keep choices neutral.
    if(test(a)||!validAP(a.ap)||a.winner||submitted.has(a.ap)||['cancelled','rejected','closed','expired'].includes(a.status))continue;
    add({id:'lottery:'+a.ap,ap:a.ap,item:'',view:'lottery',kind:'lottery',label:'申込概要と抽選対象を確認',name:a.overview||'資料概要なし',at:time(a.appliedAt||a.appliedDate),deadline:null});
  }
  tasks.sort((a,b)=>(a.deadline??Infinity)-(b.deadline??Infinity)||(a.at??Infinity)-(b.at??Infinity)||a.id.localeCompare(b.id));
  const counts={dashboard:tasks.length,lottery:0,applications:0,registry:0,numbers:0,system:0};
  for(const task of tasks)counts[task.view]++;
  return {tasks,waiting,counts,generatedAt:new Date(now).toISOString()};
}

export async function readWorkActions(request,env) {
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store, private'}});
  if(!env.ADMIN_KEY||request.headers.get('X-Admin-Key')!==env.ADMIN_KEY)return json({success:false,message:'Unauthorized.'},401);
  if(request.method!=='GET')return json({success:false,message:'Method Not Allowed'},405);
  try {
    async function readRecords(prefix,accept,project){
      const keys=[];let cursor;const cursors=new Set();
      do{const page=await env.REGISTRATION_KV.list({prefix,limit:1000,...(cursor?{cursor}:{})});keys.push(...page.keys.filter(k=>accept(k.name)));cursor=page.list_complete?null:page.cursor;if(cursor&&cursors.has(cursor))throw Error('cursor');cursors.add(cursor);if(keys.length>10000)throw Error('limit')}while(cursor);
      let position=0;const values=[];
      await Promise.all(Array.from({length:Math.min(8,keys.length)},async()=>{while(position<keys.length){const k=keys[position++],raw=await env.REGISTRATION_KV.get(k.name);if(raw)values.push(project(JSON.parse(raw),k.name))}}));return values;
    }
    const [applications,lottery]=await Promise.all([
      readRecords('REGISTRATION_APPLICATION:',()=>true,(r,key)=>({ap:r.ap||key.slice('REGISTRATION_APPLICATION:'.length),status:r.status,isTest:r.isTest,source:r.source,submittedAt:r.submittedAt,items:(r.items||[]).map(i=>({item:i.item,name:i.finalName||i.name,isTest:i.isTest,source:i.source,reviewResult:i.reviewResult,registrationNumber:i.registrationNumber,registrationStatus:i.registrationStatus,issuedDataReady:i.issuedDataReady}))})),
      readRecords('APPLICATION_',k=>/^APPLICATION_AP-[A-Z0-9]{8}$/.test(k),(r,key)=>({ap:r.ap||key.slice('APPLICATION_'.length),isTest:r.isTest,source:r.source,status:r.status,overview:r.overview,appliedAt:r.appliedAt,appliedDate:r.appliedDate,lotteryEligible:r.lotteryEligible}))
    ]);
    let position=0;await Promise.all(Array.from({length:Math.min(8,lottery.length)},async()=>{while(position<lottery.length){const a=lottery[position++];if(!/^AP-[A-Z0-9]{8}$/.test(a.ap||''))continue;const winner=await env.REGISTRATION_KV.get('WINNER_'+a.ap);a.winner=winner?JSON.parse(winner):null;}}));
    const queue=[],cursors=new Set();let cursor='';
    const stub=env.REGISTRATION_ISSUER.get(env.REGISTRATION_ISSUER.idFromName('registration-number-issuer'));
    do{const response=await stub.fetch(new Request('https://internal.invalid/admin/supplement/queue'+(cursor?'?'+new URLSearchParams({cursor}):''),{headers:{'X-Admin-Key':env.ADMIN_KEY}}));if(!response.ok)throw Error('queue');const page=await response.json();queue.push(...page.rows);cursor=page.nextCursor;if(cursor&&cursors.has(cursor))throw Error('cursor');cursors.add(cursor);if(queue.length>10000)throw Error('limit')}while(cursor);
    return json({success:true,...deriveWorkActions({applications,lottery,queue})});
  }catch{return json({success:false,message:'作業件数を確認できませんでした。「作業状況を更新」で再確認してください。'},503)}
}
