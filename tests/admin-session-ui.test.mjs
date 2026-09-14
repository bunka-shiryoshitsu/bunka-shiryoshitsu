import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parseHTML} from 'linkedom';
import {adminSessionClient} from '../admin-session-ui.js';
function fixture(initial=null,legacy=''){
  const {document,Event}=parseHTML('<html><body><div class="admin-auth"><label for="adminKey">管理キー</label><input id="adminKey"><button id="login">管理情報を表示</button></div></body></html>');
  const saved=new Map(legacy?[['bunkaAdminKey',legacy]]:[]),requests=[],events=new Map();
  const window={AdminUI:{say(){}},addEventListener(name,fn){events.set(name,fn)},dispatchEvent(e){events.get(e.type)?.(e)}};
  const context=vm.createContext({window,document,Event,Date,AbortController,location:{reload(){}},sessionStorage:{getItem:k=>saved.get(k),removeItem:k=>saved.delete(k)},setTimeout:()=>1,clearTimeout(){},fetch:async(url,options)=>{requests.push({url,options});return Response.json({success:true,session:{expiresAt:Date.now()+86400000}})}});
  vm.runInContext(adminSessionClient(initial),context);return {document,saved,requests,session:window.AdminSession};
}
test('an existing tab exchanges its old key once and retains only the browser session',async()=>{
  const f=fixture(null,'legacy-test-only'),input=f.document.getElementById('adminKey');
  assert.equal(f.saved.has('bunkaAdminKey'),false);input.value=f.session.initialKey();assert.equal(f.session.initialKey(),'');
  assert.equal(await f.session.login(),true);assert.equal(f.requests.length,1);assert.equal(f.requests[0].options.headers['X-Admin-Key'],'legacy-test-only');
  assert.equal(input.value,'');assert.equal(input.hidden,true);assert.equal(f.session.credential(),'browser-session');assert.equal(await f.session.login(),true);assert.equal(f.requests.length,1);
});
test('a new page restores a valid session without a key and expiration restores the login field',()=>{
  const f=fixture({expiresAt:Date.now()+86400000}),input=f.document.getElementById('adminKey');input.value=f.session.initialKey();f.session.mount();
  assert.equal(f.session.credential(),'browser-session');assert.equal(input.hidden,true);assert.equal(f.requests.length,0);
  f.session.expire();assert.equal(f.session.credential(),'');assert.equal(input.hidden,false);assert.equal(f.document.getElementById('admin-logout').hidden,true);
});
