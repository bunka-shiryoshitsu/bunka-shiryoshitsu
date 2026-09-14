import test from 'node:test';
import assert from 'node:assert/strict';
import app,{RegistrationIssuer} from '../worker.js';
import {adminSessionStore,SESSION_DURATION,SESSION_COOKIE} from '../admin-session.js';
import {memoryStorage} from './inspection-fixture.js';
const origin='https://local.test',ip='192.0.2.1',adminKey='session-test-only';
function fixture(){
  const records=new Map(),storage=memoryStorage(records),entries=new Map([['REGISTRATION_LIST','[]']]);let now=Date.now();
  const env={ADMIN_KEY:adminKey,REGISTRATION_KV:{get:async key=>entries.get(key)||null,list:async()=>({keys:[],list_complete:true}),put:async(k,v)=>entries.set(k,v)}};
  const issuer=new RegistrationIssuer({storage:memoryStorage()},env);
  env.REGISTRATION_ISSUER={idFromName:name=>name,get:name=>name==='admin-browser-sessions'?{fetch:request=>adminSessionStore(request,env,storage,now)}:issuer};
  const call=(path='/admin/session',options={})=>{const {headers={},method='GET',cookie,...rest}=options;return app.fetch(new Request(origin+path,{method,...rest,headers:{'CF-Connecting-IP':ip,...(method==='GET'?{}:{Origin:origin,'X-Admin-Session-Request':'1'}),...(cookie?{Cookie:cookie}:{}),...headers}}),env,{waitUntil(){}})};
  const login=async()=>{const r=await call('/admin/session',{method:'POST',headers:{'X-Admin-Key':adminKey}});assert.equal(r.status,200);return {response:r,cookie:r.headers.get('Set-Cookie').split(';')[0]}};
  return {env,records,storage,call,login,get now(){return now},set now(value){now=value}};
}
test('login issues a private 24-hour cookie without putting the key or token in the response body or storage',async()=>{
  const f=fixture(),{response,cookie}=await f.login(),data=await response.json();
  assert.equal(data.session.expiresAt,f.now+SESSION_DURATION);assert.match(response.headers.get('Set-Cookie'),/Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400/);
  const token=cookie.slice(SESSION_COOKIE.length+1);assert.match(token,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(data),new RegExp(token+'|'+adminKey));
  const stored=JSON.stringify([...f.records]);assert.doesNotMatch(stored,new RegExp(token+'|'+adminKey+'|192\\.0\\.2\\.1'));
});
test('the cookie authorizes all admin surfaces but the same IP without the cookie does not',async()=>{
  const f=fixture(),{cookie}=await f.login();
  for(const path of ['/admin/dashboard-data','/admin/registration-numbers/data','/admin/inspection-images/status']){
    assert.equal((await f.call(path)).status,401,path);
    assert.equal((await f.call(path,{cookie,headers:{'X-Admin-Key':'browser-session'}})).status,200,path);
  }
  const html=await(await f.call('/admin?view=system',{cookie})).text();assert.ok(html.includes(String(f.now+SESSION_DURATION)));assert.ok(!html.includes(adminKey));assert.ok(!html.includes(cookie));
});
test('a changed IP, missing trusted IP, changed secret or forged token cannot use a session',async()=>{
  const f=fixture(),{cookie}=await f.login();const path='/admin/dashboard-data';
  for(const headers of [{'CF-Connecting-IP':'192.0.2.2'},{'CF-Connecting-IP':'','X-Forwarded-For':ip},{'CF-Connecting-IP':'192.0.2.2','X-Forwarded-For':ip}])assert.equal((await f.call(path,{cookie,headers})).status,401);
  assert.equal((await f.call(path,{cookie:SESSION_COOKIE+'='+'0'.repeat(64)})).status,401);
  f.env.ADMIN_KEY='changed-test-secret';assert.equal((await f.call(path,{cookie})).status,401);
});
test('expiry is fixed at login, enforced at the exact 24-hour boundary, and never extended by reads',async()=>{
  const f=fixture(),{cookie}=await f.login(),expires=f.now+SESSION_DURATION;
  f.now=expires-1;const info=await(await f.call('/admin/session',{cookie})).json();assert.equal(info.session.expiresAt,expires);
  f.now=expires;assert.equal((await f.call('/admin/dashboard-data',{cookie})).status,401);assert.equal(f.records.size,0);
});
test('logout revokes the server record and rejects replay of the old cookie',async()=>{
  const f=fixture(),{cookie}=await f.login();const result=await f.call('/admin/session',{method:'DELETE',cookie});assert.equal(result.status,200);assert.match(result.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.equal((await f.call('/admin/dashboard-data',{cookie})).status,401);assert.equal(f.records.size,0);
});
test('cross-site login, logout and mutations are rejected, including missing Origin',async()=>{
  const f=fixture(),{cookie}=await f.login();
  for(const headers of [{Origin:'https://evil.test'},{Origin:''},{'Sec-Fetch-Site':'cross-site'}]){
    assert.equal((await f.call('/admin/session',{method:'POST',headers:{'X-Admin-Key':adminKey,...headers}})).status,403);
    assert.equal((await f.call('/admin/session',{method:'DELETE',cookie,headers})).status,403);
    assert.equal((await f.call('/admin/inspection-images/budget',{method:'POST',cookie,headers,body:'{}'})).status,403);
  }
  assert.equal((await f.call('/admin/dashboard-data',{cookie})).status,200);
});
test('wrong keys and public internal routes cannot create a session, and storage failure fails closed',async()=>{
  const f=fixture();assert.equal((await f.call('/admin/session',{method:'POST',headers:{'X-Admin-Key':'wrong'}})).status,401);
  assert.equal((await f.call('/_internal/admin-session',{method:'POST',body:'{}'})).status,404);assert.equal(f.records.size,0);
  const {cookie}=await f.login();f.env.REGISTRATION_ISSUER.get=()=>({fetch(){throw Error('unavailable')}});
  assert.equal((await f.call('/admin/dashboard-data',{cookie})).status,503);
});
