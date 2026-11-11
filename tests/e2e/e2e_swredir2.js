const {chromium}=require('playwright');
(async()=>{const b=await chromium.launch();
for(const [name,port] of [['ANTERIOR',8821],['NUEVA',8822]]){
 const c=await b.newContext();const p=await c.newPage();
 await p.goto(`http://localhost:${port}/`);await p.evaluate(()=>navigator.serviceWorker.register('sw.js'));await p.reload();await p.waitForFunction(()=>navigator.serviceWorker.controller,null,{timeout:15000});
 const r=await p.evaluate(async()=>{const x=await fetch('index.html',{mode:'same-origin'});
   const ks=await caches.keys();const out=[];for(const k of ks){const ca=await caches.open(k);for(const rq of await ca.keys()){const rs=await ca.match(rq);out.push(new URL(rq.url).pathname+(rs.redirected?' [REDIRIGIDA]':' [limpia]'))}}
   return {sw_redirected:x.redirected,cache:out.join(', ')}});
 console.log(name,JSON.stringify(r));await c.close()}
await b.close()})();
