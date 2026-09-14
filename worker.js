import app from "./worker-supplement.js";
import {enhanceAdminPage} from './admin-navigation.js';
export { RegistrationIssuer } from "./worker-supplement.js";
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    if(request.method==='GET'&&url.pathname==='/admin-winners')return new Response(null,{status:302,headers:{Location:'/admin?view=lottery','Cache-Control':'no-store'}});
    const response=await app.fetch(request,env,ctx);
    if(request.method==='GET'&&response.ok&&['/admin','/admin/registration-numbers'].includes(url.pathname)){
      const page=enhanceAdminPage(await response.text(),url.pathname);
      const headers=new Headers(response.headers);headers.delete('Content-Length');headers.set('Cache-Control','no-store');
      return new Response(page,{status:response.status,headers});
    }
    return response;
  },
  async scheduled(controller,env,ctx){if(app.scheduled)await app.scheduled(controller,env,ctx);}
};
