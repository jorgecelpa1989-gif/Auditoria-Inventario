// Foto del stock al cerrar un conteo: solo sus SKU; Resultados de un conteo cerrado no cambia al cargar stock nuevo.
const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const stock=(a,b)=>JSON.stringify({file:`stock_${a}.txt`,at:new Date().toISOString(),items:[{cod:'221317',ean:'',desc:'Mos.Gal 14',um:'m',stock:a},{cod:'110107',ean:'',desc:'ALAMBRE',um:'kg',stock:b},{cod:'999999',ean:'',desc:'OTRO',um:'un',stock:50}]});
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_conteos");
 const mk=n=>{const a=JSON.parse(rpc('cb_crear',{p_clave:ADMIN,p_nombre:n,p_vence:new Date(Date.now()+3600e3).toISOString(),p_items:[["221317","","Mos.Gal 14","m"],["110107","","ALAMBRE","kg"]],p_meta:null}).body);
   const o=JSON.parse(rpc('cb_abrir',{p_id:a.id,p_token:a.token,p_device:'d'+n}).body);rpc('cb_enviar',{p_id:a.id,p_secret:o.secret,p_contador:'X',p_lecturas:[{lid:'l'+n,code:'221317',k:'221317',qty:5,t:new Date().toISOString()}]});return a};
 const a=mk('Conteo A'),v=mk('Conteo viejo');
 sql(`update cb_conteos set finalizado=now()-interval '2 day', terminado=now()-interval '2 day' where id='${v.id}'`);   // cerrado antes de esta versión: sin foto
 const b=await chromium.launch();const c=await b.newContext({viewport:{width:1366,height:900}});
 await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const s=await c.newPage();const errs=[];s.on('pageerror',e=>errs.push(e.message));await s.goto(B+'#panel');
 await s.evaluate(([u,ad,st])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:ad,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}));localStorage.setItem('inv_erp',st)},[SBU,ADMIN,stock(9,3)]);
 await s.goto(B+'#resultado');await s.reload();await s.waitForTimeout(4000);
 // el operario termina → el panel finaliza solo y guarda la foto
 sql(`update cb_conteos set terminado=now() where id='${a.id}'`);
 await s.evaluate(()=>refreshNube(true));await s.waitForTimeout(2500);
 const f=sql(`select foto->'s'::text from cb_conteos where id='${a.id}'`);
 check(f==='{"110107": [3], "221317": [9]}','Al finalizar se guarda la foto solo de los SKU del conteo (999999 no) → '+f);
 check(sql(`select foto->>'f' from cb_conteos where id='${a.id}'`)==='stock_9.txt','La foto anota el archivo de stock usado');
 // se carga un stock nuevo: el conteo cerrado sigue con el stock de su día
 await s.evaluate(st=>{localStorage.setItem('inv_erp',st);localStorage.setItem('inv_rsel',JSON.stringify(null))},stock(100,30));await s.reload();await s.waitForTimeout(3500);
 await s.selectOption('#rSel',a.id);await s.waitForTimeout(2500);
 const r=await s.evaluate(()=>{const R=compute();const x=R.find(z=>z.cod==='221317');return {st:x&&x.stock,n:R.length}});
 check(r.st===9&&r.n===2,'Resultados del conteo cerrado usa el stock de la foto (9), no el nuevo (100) → '+JSON.stringify(r));
 check(/Stock congelado/.test(await s.textContent('#resFoto'))&&await s.isVisible('#resFoto'),'Aviso "Stock congelado" visible');
 // conteo cerrado antes de esta versión: avisa y permite guardar la foto con el stock actual
 await s.selectOption('#rSel',v.id);await s.waitForTimeout(2500);
 check(/sin foto del stock/.test(await s.textContent('#resFoto')),'Conteo viejo sin foto: avisa que compara con el stock actual');
 await s.click('#resFotoOk');await s.waitForTimeout(300);await s.click('#cYes');await s.waitForTimeout(2000);
 check(sql(`select foto->'s'->'221317'->>0 from cb_conteos where id='${v.id}'`)==='100'&&/Stock congelado/.test(await s.textContent('#resFoto')),'Guardar foto con el stock actual (manual) funciona');
 // la foto no se pisa sin forzar
 check(JSON.parse(rpc('cb_conteo_foto',{p_clave:ADMIN,p_id:a.id,p_foto:{s:{"221317":[1]}},p_forzar:false}).body)===false&&sql(`select foto->'s'->'221317'->>0 from cb_conteos where id='${a.id}'`)==='9','Una foto guardada no se pisa sin forzar');
 check(!rpc('cb_conteo_foto',{p_clave:ADMIN,p_id:a.id,p_foto:{s:{"1":[1],"2":[1],"3":[1]}},p_forzar:true}).ok,'No acepta más SKU que los del conteo');
 // conteo en curso: sigue usando el stock cargado ahora
 const e2=mk('En curso');await s.reload();await s.waitForTimeout(3500);await s.selectOption('#rSel',e2.id);await s.waitForTimeout(1500);
 check(await s.evaluate(()=>compute().find(z=>z.cod==='221317').stock)===100&&await s.isHidden('#resFoto'),'Conteo en curso: usa el stock cargado ahora');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 await b.close();console.log(fail?'FALLAS: '+fail:'TODO OK');process.exit(fail?1:0)})();
