import {normalizeReceiptAP,receiptStatus,receiptFile} from './receipt-access.js';

export const adminReceiptPaths=new Set(['/admin/receive-key','/admin/receive-key/reset','/admin/receive-preview','/admin/receive-preview/status','/admin/receive-preview/file']);
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff'}});
export async function adminReceipt(request,env,ctx,app){
 if(!env.ADMIN_KEY||request.headers.get('X-Admin-Key')!==env.ADMIN_KEY)return json({success:false,message:'管理者としてログインしてください。'},401);
 const url=new URL(request.url),path=url.pathname;
 if(path==='/admin/receive-key'||path==='/admin/receive-key/reset')return json({success:false,message:'受取キーの利用は終了しました。AP番号だけで確認できます。'},410);
 const page=path==='/admin/receive-preview',get=page;
 if(request.method!==(get?'GET':'POST'))return json({success:false,message:'Method Not Allowed'},405);
 try{
  let body;if(!get){try{body=await request.json()}catch{return json({success:false,message:'入力内容を確認してください。'},400)}}
  const ap=normalizeReceiptAP(get?url.searchParams.get('ap'):body?.ap);if(!ap)return json({success:false,message:'AP番号を確認してください。'},400);
  const application=await env.REGISTRATION_KV.get('REGISTRATION_APPLICATION:'+ap);
  if(!application&&!await env.REGISTRATION_KV.get('APPLICATION_'+ap))return json({success:false,message:'申込みが見つかりません。'},404);
  if(path==='/admin/receive-preview/status')return receiptStatus(env,ap);
  if(path==='/admin/receive-preview/file')return receiptFile(env,ap,body?.registrationNumber);
  const response=await app.fetch(new Request(new URL('/receive',url)),env,ctx);if(!response.ok)return response;
  const html=(await response.text()).replace('<script>','<script>const RECEIPT_PREVIEW_AP='+JSON.stringify(ap)+';');
  return new Response(html,{headers:{'Content-Type':'text/html; charset=UTF-8','Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'}});
 }catch{return json({success:false,message:'受け取り情報を確認できませんでした。時間をおいて再度お試しください。'},503)}
}
