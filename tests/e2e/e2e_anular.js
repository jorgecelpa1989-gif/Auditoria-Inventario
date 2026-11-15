const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:'Bodega',p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
// Eliminar → Anular en Recepción de proveedores y Devoluciones: nada se borra, se puede restaurar y lo anulado no se modifica.
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_prov; delete from cb_dev; delete from cb_puesto");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["221317","","Mos.Gal 14","m","ROLLO",90],["110107","","ALAMBRE","kg"]],p_stock:null,p_origen:'t'});
 const [fId,fT]=usr('Felipe',['prov_recibir','dev_recibir']);
 const x=JSON.parse(rpc('cb_prov_guardar',{p_clave:ADMIN,p_id:null,p_doc:{tipo:'nacional',proveedor:'Aceros Uno',guia:'G-1',fecha:'2026-11-15'},p_esperado:[]}).body),idP=x.id||x;
 const dd=JSON.parse(rpc('cb_dev_crear_panel',{p_clave:ADMIN,p_area:'Producción',p_doc:{guia:'D-7',factura:'',fecha:'2026-11-15'},p_lect:[{code:'110107',k:'110107',qty:5,lid:'d0',t:'2026-11-15T10:00:00Z'}]}).body),idD=dd.id||dd;
 const b=await chromium.launch();const errs=[];
 // Celular de bodega recibiendo la recepción
 const cm=await b.newContext({...devices['iPhone 13'],timezoneId:'America/Santiago'});await route(cm);const m=await cm.newPage();m.on('pageerror',e=>errs.push('cel: '+e.message));
 await m.goto(`${B}?puesto=${fId}&t=${fT}&u=${encodeURIComponent(SBU)}&k=anon`);await m.waitForTimeout(2000);await m.fill('#puPersona','FELIPE');await m.dispatchEvent('#puPersona','change');await m.waitForTimeout(300);
 await m.tap('#puMenu [data-pk="prov"]');await m.waitForTimeout(1500);await m.tap(`#pcHome [data-pc="${idP}"]`);await m.waitForTimeout(500);
 await m.fill('#pcScan','110107');await m.press('#pcScan','Enter');await m.waitForTimeout(300);await m.fill('#pcQty','4');await m.tap('#pcOk');await m.waitForTimeout(2500);
 check(sql(`select jsonb_array_length(rec) from cb_prov where id='${idP}'`)==='1','Bodega registra 1 línea en la recepción');
 // Panel: anular la recepción
 const cs=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago'});await route(cs);const s=await cs.newPage();s.on('pageerror',e=>errs.push('panel: '+e.message));
 await s.goto(B+'#panel');await s.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await s.goto(B+'#prov');await s.reload();await s.waitForTimeout(3000);
 await s.click(`#pvTbl [data-pv="${idP}"]`);await s.waitForTimeout(500);
 check(/Anular/.test(await s.textContent('#pvDel')),'Proveedores: el botón dice "Anular…"');
 await s.click('#pvDel');await s.waitForTimeout(300);check(/se puede restaurar/.test(await s.textContent('#pvConfirm')),'La confirmación explica que no se borra y se puede restaurar');
 await s.click('#pvConfirm #cYes');await s.waitForTimeout(2000);
 check(sql(`select count(*) from cb_prov where id='${idP}' and anulado is not null and jsonb_array_length(rec)=1`)==='1'&&!/ACEROS UNO/i.test(await s.textContent('#pvTbl')),'Anular: no se borra (la línea de bodega sigue guardada) y sale de la lista');
 // Celular: no puede seguir escribiendo en lo anulado
 await m.fill('#pcScan','221317');await m.press('#pcScan','Enter');await m.waitForTimeout(300);await m.fill('#pcQty','1');await m.tap('#pcOk');await m.waitForTimeout(2500);
 check(/anulado por el supervisor/.test(await m.textContent('#pcSync'))&&sql(`select jsonb_array_length(rec) from cb_prov where id='${idP}'`)==='1','Celular: al guardar en una recepción anulada avisa "anulado por el supervisor" y el servidor no la cambia');
 const ses=await m.evaluate(()=>PST.ses);
 check(/anulado/.test(rpc('cb_prov_recibir',{p_puesto:fId,p_ses:ses,p_id:idP,p_doc:{persona:'X'},p_rec:[],p_terminar:false}).body)&&sql(`select count(*) from cb_prov where id='${idP}'`)==='1','Servidor: no la vuelve a crear ni la modifica (anulado)');
 check(!/Aceros Uno/i.test(JSON.stringify(JSON.parse(rpc('cb_prov_mis',{p_puesto:fId,p_ses:ses}).body))),'La lista del celular ya no la muestra');
 // Restaurar
 await s.click('#provAnul summary');await s.waitForTimeout(1200);
 check(/Anuladas · 1/.test(await s.textContent('#provAnul summary'))&&/Aceros Uno/i.test(await s.textContent('#provAnul')),'«Anuladas» de proveedores la muestra');
 await s.click('#provAnul [data-rest]');await s.waitForTimeout(2000);
 check(sql(`select count(*) from cb_prov where id='${idP}' and anulado is null`)==='1'&&/ACEROS UNO/i.test(await s.textContent('#pvTbl')),'Restaurar: vuelve a la lista con su detalle');
 // Devoluciones: anular y restaurar desde el panel
 await s.goto(B+'#devol');await s.reload();await s.waitForTimeout(2500);await s.click(`#dvTbl [data-di="${idD}"]`).catch(async()=>{await s.click('#dvTbl [data-di]')});await s.waitForTimeout(500);
 check(/Anular/.test(await s.textContent('#dvDel')),'Devoluciones: el botón dice "Anular…"');
 await s.click('#dvDel');await s.waitForTimeout(300);await s.click('#dvConfirmS #cYes');await s.waitForTimeout(2000);
 check(sql(`select count(*) from cb_dev where id='${idD}' and anulado is not null`)==='1','Devolución anulada (no borrada)');
 await s.click('#devAnul summary');await s.waitForTimeout(1200);
 check(/D-7/.test(await s.textContent('#devAnul')),'«Anuladas» de devoluciones la muestra');
 await s.click('#devAnul [data-rest]');await s.waitForTimeout(2000);
 check(sql(`select count(*) from cb_dev where id='${idD}' and anulado is null`)==='1','Restaurar devolución');
 // La app anterior (Cloudflare) llama a "eliminar": ahora anula
 rpc('cb_dev_eliminar',{p_clave:ADMIN,p_id:idD});check(sql(`select count(*) from cb_dev where id='${idD}'`)==='1','App anterior: "Eliminar" ya no borra, anula');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 await b.close();console.log(fail?'FALLAS: '+fail:'TODO OK')})();
