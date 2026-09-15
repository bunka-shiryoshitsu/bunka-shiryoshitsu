export const adminReceiptClient=String.raw`
(() => {
 const node=(tag,text,parent)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;parent?.append(e);return e};
 window.AdminReceipt={mount(ap,anchor){
  const root=node('section');root.className='detail receipt-admin';root.id='admin-receipt-'+ap;root.tabIndex=-1;root.style.scrollMarginTop='calc(var(--shell-height) + 100px)';anchor.after(root);
  const jump=node('button','受取画面を確認',anchor);jump.type='button';jump.setAttribute('aria-controls',root.id);jump.onclick=()=>{root.scrollIntoView({block:'start'});root.focus({preventScroll:true})};
  node('h3','申請者の受取画面の確認',root);node('p','申請者はAP番号だけで状況確認・追加提出・登録書の受取りができます。',root);
  const privacy=node('p','AP番号は他人に教えないでください。',root);privacy.style.cssText='font-size:22px;font-weight:800;color:#812b20';
  const preview=node('a','申請者の受取画面を確認',root);preview.className='table-action';preview.href='/admin/receive-preview?'+new URLSearchParams({ap});preview.target='_blank';preview.rel='noopener noreferrer';
 }};
})();
`;
