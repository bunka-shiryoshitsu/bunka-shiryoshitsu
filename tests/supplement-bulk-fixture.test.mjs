import test from 'node:test';
import assert from 'node:assert/strict';

test('supplement fixture bulk KV reads preserve requested stored values',async()=>{
  const kv=new Map([['A','one'],['B','two']]);
  const get=async(k,opt)=>{
    if(Array.isArray(k))return new Map(k.filter(key=>kv.has(key)).map(key=>[key,kv.get(key)]));
    const v=kv.get(k);
    return opt?.type==='json'&&v?JSON.parse(v):v??null;
  };
  const values=await get(['A','B','C']);
  assert.equal(values.get('A'),'one');
  assert.equal(values.get('B'),'two');
  assert.equal(values.has('C'),false);
});
