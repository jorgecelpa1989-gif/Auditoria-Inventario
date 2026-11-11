const {chromium,devices}=require('playwright');
(async()=>{const b=await chromium.launch();
for(const [name,port] of [['ANTERIOR',8821],['NUEVA',8822]]){
 const c=await b.newContext({...devices['iPhone 13']});const p=await c.newPage();
 await p.goto(`http://localhost:${port}/#contar`);await p.evaluate(()=>navigator.serviceWorker.register('sw.js'));await p.reload();await p.waitForFunction(()=>navigator.serviceWorker.controller,null,{timeout:15000}).catch(()=>{});
 await p.waitForTimeout(1500);
 let r1,r2,r3;
 try{const resp=await p.goto(`http://localhost:${port}/index.html#contar`);r1='OK '+(await p.title())}catch(e){r1='ERROR '+e.message.split('\n')[0]}
 try{await p.goto(`http://localhost:${port}/?puesto=x&t=y`);r2='OK '+(await p.title())}catch(e){r2='ERROR '+e.message.split('\n')[0]}
 await c.setOffline(true);
 try{await p.goto(`http://localhost:${port}/index.html#contar`);r3='OK '+(await p.title())}catch(e){r3='ERROR '+e.message.split('\n')[0]}
 console.log(name,'\n  ícono (/index.html):',r1,'\n  link usuario (/?puesto=):',r2,'\n  sin señal (/index.html):',r3);await c.close()}
await b.close()})();
