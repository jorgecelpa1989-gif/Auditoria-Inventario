const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
// Equipo que es supervisor Y usuario de conteo (ej. iPhone del jefe): el stock de la nube no debe reemplazar el conteo abierto, y las lecturas se envían.
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_conteos; delete from cb_puesto");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["140101","","SACO HARINA","kg","SACO",25],["110107","","ALAMBRE","kg"]],p_stock:{"140101":[10,10]},p_origen:'t'});
 const uid=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'Jorge',p_area:'Bodega',p_permisos:['conteo'],p_activo:true}).body);const tok='tok'+uid+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:uid,p_token:tok});
 const cr=JSON.parse(rpc('cb_crear',{p_clave:ADMIN,p_nombre:'BODEGA 1 PRUEBA',p_vence:new Date(Date.now()+8*3600e3).toISOString(),p_items:[["140101","","SACO HARINA","kg","SACO",25],["110107","","ALAMBRE","kg"]],p_meta:{bodega:'1'}}).body);
 rpc('cb_conteo_asignar',{p_clave:ADMIN,p_id:cr.id,p_puesto:uid});
 const b=await chromium.launch();const c=await b.newContext({...devices['iPhone 13']});
 await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.goto(B+'#panel');
 await p.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);   // es supervisor
 await p.goto(`${B}?puesto=${uid}&t=${tok}&u=${encodeURIComponent(SBU)}&k=anon`);await p.waitForTimeout(2500);await p.fill('#puPersona','JORGE');await p.dispatchEvent('#puPersona','change');await p.waitForTimeout(500);
 await p.tap('#puMenu [data-pk="conteo"]');await p.waitForTimeout(2000);
 check(await p.evaluate(()=>!!(erp&&erp.conteo&&nubeConf())),'Abre el conteo asignado');
 await p.evaluate(async()=>{await erpDesdeNube();await catSync(true)});await p.waitForTimeout(500);
 check(await p.evaluate(()=>!!(erp&&erp.conteo&&nubeConf())),'El stock de la nube (panel de supervisor) NO reemplaza el conteo abierto');
 await p.evaluate(()=>{addScan('140101',2,'prueba');markDirty()});await p.waitForTimeout(4500);
 check(sql(`select count(*) from cb_lecturas where conteo='${cr.id}'`)==='1','La lectura llega al servidor (el panel la ve)');
 // Recuperación: si el conteo se perdió en el equipo, al reabrirlo las lecturas hechas después de crearlo se envían
 await p.evaluate(()=>{erp={file:'nube',fromServer:true,items:[],merged:0};store.set('inv_erp',erp);scans.push({code:'110107',qty:5,ubic:'',user:'JORGE',t:new Date().toISOString(),src:'x',conteo:'',lid:newLid()});saveScans()});
 await p.evaluate(()=>puAbrirConteo(puTareas.conteos[0]));await p.waitForTimeout(4500);
 check(sql(`select count(*) from cb_lecturas where conteo='${cr.id}'`)==='2'&&/recuperaron/.test(await p.textContent('#toast')),'Reabrir el conteo recupera y envía las lecturas del celular (no se borran)');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
