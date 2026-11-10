const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_mov");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["221317","","Mos.Gal 14","m","ROLLO",90],["110107","","ALAMBRE","kg"]],p_stock:null,p_origen:'bueno'});
 const b=await chromium.launch();const ctxS=await b.newContext({viewport:{width:1366,height:900}});
 await ctxS.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const s=await ctxS.newPage();const errs=[];s.on('pageerror',e=>errs.push(e.message));await s.goto(B+'#panel');
 await s.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}));
   localStorage.setItem('inv_erp',JSON.stringify({file:'stock.txt',at:new Date().toISOString(),items:[{cod:'221317',ean:'',desc:'Mos.Gal 14',um:'',stock:5},{cod:'110107',ean:'',desc:'ALAMBRE',um:'',stock:3}]}))},[SBU,ADMIN]);
 await s.goto(B+'#mp');await s.reload();await s.waitForTimeout(4000);
 const f=await s.evaluate(()=>JSON.stringify(FACT));check(/"221317":\{"ce":"ROLLO","f":90\}/.test(f.replace(/\s/g,'')),'PC nuevo: recupera las equivalencias desde Supabase (221317 = ROLLO de 90) → '+f);
 const cat=sql("select (items->0)::text from cb_catalogo");check(/ROLLO/.test(cat),'El catálogo de la nube NO se pierde al abrir en un PC nuevo → '+cat);
 // eliminar entrega
 const mv=JSON.parse(rpc('cb_mov_crear',{p_clave:ADMIN,p_nombre:'Solicitud mala',p_vence:new Date(Date.now()+3600e3).toISOString(),p_items:null,p_meta:{sol:[["221317",24]],puestos:true}}).body);
 await s.evaluate(()=>{const d=document.querySelector('#mpListBox');if(d)d.open=true});await s.click('#btnMpRefresh');await s.waitForTimeout(2000);
 check(await s.isVisible('#mpTbl [data-mx]'),'Panel: cada entrega tiene "Eliminar…"');
 await s.click('#mpTbl [data-mx]');await s.waitForTimeout(300);await s.click('#cYes');await s.waitForTimeout(1500);
 check(sql(`select count(*) from cb_mov where id='${mv.id}'`)==='0','Eliminar: la entrega se borra de Supabase');
 // celular bodega: lista se actualiza sola + panel avisa entrega directa
 const [bId,bT]=usr('Felipe','Bodega',['mp_entregar']);
 const cp=await b.newContext({...devices['iPhone 13']});await cp.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const p=await cp.newPage();p.on('pageerror',e=>errs.push(e.message));await p.goto(`${B}?puesto=${bId}&t=${bT}&u=${encodeURIComponent(SBU)}&k=anon`);await p.waitForTimeout(2000);await p.fill('#puPersona','FELIPE');await p.dispatchEvent('#puPersona','change');await p.waitForTimeout(400);
 await p.tap('#puMenu [data-pk="mp"]');await p.waitForTimeout(500);await p.fill('#puMpRef','abc');
 const mv2=JSON.parse(rpc('cb_mov_crear',{p_clave:ADMIN,p_nombre:'Solicitud 09-11 nueva',p_vence:new Date(Date.now()+3600e3).toISOString(),p_items:null,p_meta:{sol:[["221317",3]]}}).body);rpc('cb_mov_asignar',{p_clave:ADMIN,p_id:mv2.id,p_si:true});
 await p.evaluate(()=>puRefresh());await p.waitForTimeout(1500);
 console.log('TAREAS',await p.evaluate(()=>JSON.stringify(puTareas.mp.map(t=>t.nombre))),await p.evaluate(()=>puVista+'|'+puMpOn));const lt=await p.textContent('#puList');console.log('LT',lt.replace(/\s+/g,' ').slice(0,400));check(/Solicitud 09-11 nueva/.test(lt)&&(await p.inputValue('#puMpRef'))==='abc','Celular: la lista de entregas se actualiza sola con la solicitud nueva (sin borrar lo escrito)');
 await p.fill('#puMpRef','OT 9');await p.tap('#puMpNew');await p.waitForTimeout(2500);
 await s.evaluate(()=>refreshMov(true));await s.waitForTimeout(1500);
 console.log('VIST',await s.evaluate(()=>JSON.stringify(solVistas.slice(-3))),await s.textContent('#toast').catch(()=>'-'));console.log('LIVE',await s.evaluate(()=>JSON.stringify([...movLive.values()].map(x=>[x.nombre,x.meta&&x.meta.directa]))));
 check(/creó una entrega directa · OT 9/.test(await s.textContent('#toast')),'Panel: avisa "FELIPE creó una entrega directa · OT 9"');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
