// Keep borders/backgrounds and semantic colours; strengthen neutral text only.
function textColours(css) {
  return css.replace(/(?<![-\w])color\s*:\s*#([\da-f]{6}|[\da-f]{3})(?![\da-f])/gi,(declaration,hex)=>{
    const full=hex.length===3?[...hex].map(x=>x+x).join(''):hex;
    const rgb=[0,2,4].map(i=>parseInt(full.slice(i,i+2),16));
    if(Math.max(...rgb)-Math.min(...rgb)>35)return declaration;
    // Light neutral lettering belongs to the site's dark panels; keep it legible.
    return 'color:'+(Math.min(...rgb)>=170?'#fff':'#111');
  });
}
export function improveTextContrast(html) {
  return html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi,(_,attrs,css)=>'<style'+attrs+'>'+textColours(css)+'\ninput::placeholder,textarea::placeholder{color:#111;opacity:1}\n</style>');
}
