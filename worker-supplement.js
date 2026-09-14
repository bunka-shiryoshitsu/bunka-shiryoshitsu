import app from './worker-dashboard15.js';
import {supplementPaths,json} from './supplement-service.js';
import {portalScript,adminSupplementScript} from './supplement-ui.js';
export {RegistrationIssuer} from './worker-dashboard15.js';

export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url),path=url.pathname;
    if(supplementPaths.has(path)){
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'https://bunka-shiryoshitsu.github.io','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-Admin-Key,X-Receive-Key'}});
      if(path.startsWith('/admin/')){
        if(!env.ADMIN_KEY||request.headers.get('X-Admin-Key')!==env.ADMIN_KEY)return json({success:false,message:'Unauthorized.'},401);
      }else{
        const auth=await app.fetch(new Request(new URL('/receive-status',url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ap:url.searchParams.get('ap'),receiveKey:request.headers.get('X-Receive-Key')})}),env,ctx);
        if(!auth.ok)return auth;
        const data=await auth.json();if(!data.success)return json({success:false,message:'認証できませんでした。'},401);
      }
      if(!env.REGISTRATION_ISSUER)return json({success:false,message:'ただいま利用できません。'},503);
      return env.REGISTRATION_ISSUER.get(env.REGISTRATION_ISSUER.idFromName('registration-number-issuer')).fetch(request);
    }
    // All review decisions share the same queue as supplement submissions.
    if(path==='/admin/review'&&request.method==='POST'){
      if(!env.ADMIN_KEY||request.headers.get('X-Admin-Key')!==env.ADMIN_KEY)return json({success:false,message:'Unauthorized.'},401);
      return env.REGISTRATION_ISSUER.get(env.REGISTRATION_ISSUER.idFromName('registration-number-issuer')).fetch(request);
    }
    const response=await app.fetch(request,env,ctx);
    if(request.method==='GET'&&response.ok&&(path==='/receive'||path==='/admin')){
      let page=await response.text();
      if(path==='/receive'){
        page=page.replace(/<title>.*?<\/title>/,'<title>申請状況・追加提出・登録書受取｜文化資料登録室</title>')
          .replace(/<h1>.*?<\/h1>/,'<h1>申請状況の確認・追加提出・登録書の受取り</h1>')
          .replace(/<button id="check"[^>]*>.*?<\/button>/,'<button id="check" type="button">申請状況・追加依頼を確認</button>')
          .replace('<div id="result"','<p>初回申請後は週に一度、この画面をご確認ください。追加提出の依頼や結果はメールでは通知されません。</p><div id="result"')
          .replace(/button\.addEventListener\('click', async \(\) => \{[\s\S]*?\n\}\);/,"button.addEventListener('click', loadPortal);")
          .replace('</script>',portalScript+'\n</script>');
      }else{
        page=page.replace('void loadItemImages(ap,n,images);','void loadItemImages(ap,n,images);void loadSupplementAdmin(ap,n,wrap);')
          .replace("['追加確認','additional_check','warn'],",'')
          .replace('</script>',adminSupplementScript+'\n</script>');
      }
      const headers=new Headers(response.headers);headers.delete('Content-Length');headers.set('Cache-Control','no-store');return new Response(page,{status:response.status,headers});
    }
    return response;
  },
  async scheduled(controller,env,ctx){if(app.scheduled)return app.scheduled(controller,env,ctx);}
};
