import app from "./worker-entry12.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/_dev/security-test") {
      return runSecurityTest(url.origin);
    }
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    if (typeof app.scheduled === "function") return app.scheduled(controller, env, ctx);
  }
};

class MemoryKV {
  constructor(seed={}){this.map=new Map(Object.entries(seed));}
  async get(key,options){if(!this.map.has(key))return null;const v=this.map.get(key);if(options?.type==="arrayBuffer"){if(v instanceof ArrayBuffer)return v.slice(0);if(ArrayBuffer.isView(v))return v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength);if(typeof v==="string")return new TextEncoder().encode(v).buffer;}return v;}
  async put(key,value){if(value instanceof ArrayBuffer){this.map.set(key,value.slice(0));return;}if(ArrayBuffer.isView(value)){this.map.set(key,value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength));return;}this.map.set(key,String(value));}
  async delete(key){this.map.delete(key);}
  async list(options={}){const prefix=String(options.prefix||"");const limit=Number(options.limit||1000);return{keys:[...this.map.keys()].filter(k=>k.startsWith(prefix)).sort().slice(0,limit).map(name=>({name})),list_complete:true,cursor:""};}
}

async function runSecurityTest(origin){
  const kv=new MemoryKV({"SYSTEM:APPLICATIONS_OPEN":"true","REGISTRATION_LIST":JSON.stringify(["TST00001"])});
  const env={REGISTRATION_KV:kv,ADMIN_KEY:"DEV-SECURITY-ONLY"};
  const ctx={waitUntil(){}};
  const checks=[];
  const add=async(name,fn,verify)=>{try{const r=await fn();const body=await read(r);const ok=Boolean(verify(r,body));checks.push({name,ok,status:r.status,summary:summary(body)});}catch(e){checks.push({name,ok:false,status:0,summary:String(e?.message||e)});}};

  let first=null,duplicate=null;
  await add("初回抽選申込",async()=>{
    const r=await app.fetch(new Request(origin+"/lottery-apply",{method:"POST",headers:{"Content-Type":"application/json","CF-Connecting-IP":"203.0.113.20"},body:"{}"}),env,ctx);
    const clone=r.clone();first=await clone.json().catch(()=>null);return r;
  },(r,b)=>r.ok&&b?.success===true);

  await add("同一IP二重申込も外形上は受付",async()=>{
    const r=await app.fetch(new Request(origin+"/lottery-apply",{method:"POST",headers:{"Content-Type":"application/json","CF-Connecting-IP":"203.0.113.20"},body:"{}"}),env,ctx);
    const clone=r.clone();duplicate=await clone.json().catch(()=>null);return r;
  },(r,b)=>r.ok&&b?.success===true);

  await add("重複除外APを当選設定できない",()=>app.fetch(new Request(origin+"/admin-winners/save",{method:"POST",headers:{"X-Admin-Key":env.ADMIN_KEY,"Content-Type":"application/json"},body:JSON.stringify({ap:duplicate?.ap,slots:1,applicationMonth:duplicate?.applicationMonth})}),env,ctx),(r)=>r.status===409);

  await add("管理APIは誤キーを拒否",()=>app.fetch(new Request(origin+"/admin/applications",{headers:{"X-Admin-Key":"WRONG"}}),env,ctx),(r)=>r.status===401);

  await add("不正APは当選扱いしない",()=>app.fetch(new Request(origin+"/check-application",{method:"POST",headers:{"Content-Type":"application/json","CF-Connecting-IP":"203.0.113.21"},body:JSON.stringify({ap:"AP-AAAAAAAA"})}),env,ctx),(r,b)=>r.ok&&b?.winner===false);

  await add("受取状態GETは禁止",()=>app.fetch(new Request(origin+"/receive-status",{method:"GET"}),env,ctx),(r)=>r.status===405);
  await add("登録書GET直取得は禁止",()=>app.fetch(new Request(origin+"/receive-file",{method:"GET"}),env,ctx),(r)=>r.status===405);

  await kv.put("SYSTEM:APPLICATIONS_OPEN","false");
  await add("受付停止中は画像アップロード拒否",()=>app.fetch(new Request(origin+"/image-upload?ap="+encodeURIComponent(first?.ap||"")+"&item=01&image=01",{method:"POST"}),env,ctx),(r)=>r.status===503);
  await add("受付停止中は登録申請拒否",()=>app.fetch(new Request(origin+"/registration-submit",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ap:first?.ap,items:[]})}),env,ctx),(r)=>r.status===503);

  await kv.put("SYSTEM:APPLICATIONS_OPEN","true");
  const expiredAp="AP-ABCDEFGH";
  await kv.put("WINNER_"+expiredAp,JSON.stringify({slots:1,applicationMonth:"2026-01",checkStart:"2026-01-01",expiryDate:"2026-01-02",savedAt:"2026-01-01T00:00:00.000Z"}));
  const f=new FormData();f.append("image",new Blob([new Uint8Array([0xff,0xd8,0xff,0xd9])],{type:"image/jpeg"}),"x.jpg");
  await add("期限切れ当選は画像受付拒否",()=>app.fetch(new Request(origin+"/image-upload?ap="+expiredAp+"&item=01&image=01",{method:"POST",body:f}),env,ctx),(r)=>r.status===403);

  const failed=checks.filter(x=>!x.ok);const passed=checks.length-failed.length;const title=failed.length?`FAIL ${passed}/${checks.length} ${failed[0].name} HTTP${failed[0].status}`:`PASS ${passed}/${checks.length}`;
  return new Response(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1><pre>${esc(JSON.stringify({success:!failed.length,passed,total:checks.length,checks},null,2))}</pre></body></html>`,{status:200,headers:{"Content-Type":"text/html; charset=UTF-8","Cache-Control":"no-store"}});
}
async function read(r){const ct=r.headers.get("Content-Type")||"";if(ct.includes("application/json")){try{return await r.clone().json();}catch{return null;}}try{return await r.clone().text();}catch{return null;}}
function summary(b){if(typeof b==="string")return b.slice(0,120);if(b?.message)return String(b.message);if(b?.error)return String(b.error);return b?.success===true?"成功":"応答あり";}
function esc(v){return String(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
