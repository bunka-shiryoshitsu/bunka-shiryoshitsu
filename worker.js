import app from "./worker-supplement.js";
import {enhanceAdminPage} from './admin-navigation.js';
import {inspectionPaths} from './inspection-images.js';
import {adminSessionEndpoint,authorizeAdminSession} from './admin-session.js';
import {readWorkActions} from './admin-work-actions.js';
import {adminReceiptPaths,adminReceipt} from './admin-receipt.js';
export { RegistrationIssuer } from "./worker-supplement.js";
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(url.pathname.startsWith('/_internal/'))return new Response('Not Found',{status:404});
    if(url.pathname==='/admin/session')return adminSessionEndpoint(request,env);
    let session=null;
    if(url.pathname.startsWith('/admin')){const auth=await authorizeAdminSession(request,env);if(auth.response)return auth.response;request=auth.request;session=auth.session;}
    if(url.pathname==='/admin/work-actions')return readWorkActions(request,env);
    if(adminReceiptPaths.has(url.pathname))return adminReceipt(request,env,ctx,app);
    if(inspectionPaths.has(url.pathname)){
      if(!env.ADMIN_KEY||request.headers.get('X-Admin-Key')!==env.ADMIN_KEY)return Response.json({success:false,message:'Unauthorized.'},{status:401,headers:{'Cache-Control':'no-store'}});
      if(!env.REGISTRATION_ISSUER)return Response.json({success:false,message:'点検画像の保存先を利用できません。'},{status:503,headers:{'Cache-Control':'no-store'}});
      return env.REGISTRATION_ISSUER.get(env.REGISTRATION_ISSUER.idFromName('registration-number-issuer')).fetch(request);
    }
    if(request.method==='GET'&&url.pathname==='/admin-winners')return new Response(null,{status:302,headers:{Location:'/admin?view=lottery','Cache-Control':'no-store'}});
    const response=await app.fetch(request,env,ctx);
    if(request.method==='GET'&&response.ok&&['/admin','/admin/registration-numbers'].includes(url.pathname)){
      const page=enhanceAdminPage(await response.text(),url.pathname,session);
      const headers=new Headers(response.headers);headers.delete('Content-Length');headers.set('Cache-Control','no-store');
      return new Response(page,{status:response.status,headers});
    }
    return response;
  },
  async scheduled(controller,env,ctx){if(app.scheduled)await app.scheduled(controller,env,ctx);}
};
