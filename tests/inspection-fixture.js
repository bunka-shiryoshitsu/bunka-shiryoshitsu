export function memoryStorage(records=new Map()){
  let alarm=null,failAfter=null;
  const storage={
    getAlarm:async()=>alarm,setAlarm:async n=>{alarm=n},deleteAlarm:async()=>{alarm=null},
    get:async key=>Array.isArray(key)?new Map(key.filter(k=>records.has(k)).map(k=>[k,structuredClone(records.get(k))])):structuredClone(records.get(key)),
    put:async(key,value)=>{if(failAfter!==null&&failAfter--===0){failAfter=null;throw Error('injected storage failure')}records.set(key,structuredClone(value))},
    delete:async key=>Array.isArray(key)?key.reduce((n,k)=>n+Number(records.delete(k)),0):records.delete(key),
    list:async({prefix='',startAfter='',limit=1000}={})=>new Map([...records].filter(([k])=>k.startsWith(prefix)&&k>startAfter).sort(([a],[b])=>a<b?-1:a>b?1:0).slice(0,limit).map(([k,v])=>[k,structuredClone(v)])),
    transaction:async fn=>{const snapshot=structuredClone(records);try{return await fn(storage)}catch(e){records.clear();for(const [k,v]of snapshot)records.set(k,v);throw e}},
    failAfter(n){failAfter=n}
  };return storage;
}
export function jpeg({width=1200,height=800,size=20000}={}){
  const header=new Uint8Array([255,216,255,224,0,16,74,70,73,70,0,1,1,0,0,1,0,1,0,0,255,192,0,17,8,height>>8,height&255,width>>8,width&255,3,1,17,0,2,17,1,3,17,1,255,218,0,12,3,1,0,2,17,3,17,0,63,0]);
  const bytes=new Uint8Array(Math.max(size,header.length+3));bytes.set(header);bytes[bytes.length-2]=255;bytes[bytes.length-1]=217;return bytes;
}
