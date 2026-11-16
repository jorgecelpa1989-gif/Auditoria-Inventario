const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:'Bodega',p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
// Devoluciones: reabrir una cerrada sin recibir, y recibir desde el panel cuando bodega no puede.
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_dev; delete from cb_puesto");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["140101","","SACO HARINA 25KG","kg","SACO",25],["110107","","ROLLO ALAMBRE","kg"]],p_stock:null,p_origen:'t'});
 const [fId,fT]=usr('Felipe',['dev_recibir']);
 const mk=g=>{const x=JSON.parse(rpc('cb_dev_crear_panel',{p_clave:ADMIN,p_area:'Picking retail',p_doc:{guia:g,factura:'',fecha:'2026-11-16'},p_lect:[{code:'140101',k:'140101',desc:'SACO HARINA 25KG',um:'kg',qty:4,f:25,ce:'SACO',lid:'a'+g,t:'2026-11-16T10:00:00Z'},{code:'110107',k:'110107',desc:'ROLLO ALAMBRE',um:'kg',qty:10,lid:'b'+g,t:'2026-11-16T10:00:00Z'}]}).body);return x.id||x};
 const d1=mk('22182'),d2=mk('5000');
 const b=await chromium.launch();const errs=[];
 const cs=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago'});await route(cs);const s=await cs.newPage();s.on('pageerror',e=>errs.push('panel: '+e.message));
 await s.goto(B+'#panel');await s.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await s.goto(B+'#devol');await s.reload();await s.waitForTimeout(2500);
 // 1) Cerrar sin recibir y reabrir
 await s.click(`#dvTbl [data-di="${d1}"]`);await s.waitForTimeout(400);
 check(await s.isVisible('#dvRecPanel')&&await s.isHidden('#dvReabrir'),'Por recibir: aparece "Recibir desde el panel"; "Reabrir" no');
 await s.click('#dvCerrar');await s.click('#dvConfirmS #cYes');await s.waitForTimeout(1500);
 check(await s.isVisible('#dvReabrir')&&await s.isHidden('#dvRecPanel')&&sql(`select finalizado is not null from cb_dev where id='${d1}'`)==='t','Cerrada sin recibir: aparece "Reabrir"');
 await s.click('#dvReabrir');await s.waitForTimeout(300);check(/bodega la ve en su celular/.test(await s.textContent('#dvConfirmS')),'Reabrir explica que vuelve a bodega');
 await s.click('#dvConfirmS #cYes');await s.waitForTimeout(1500);
 check(sql(`select finalizado is null and recibido is null from cb_dev where id='${d1}'`)==='t'&&await s.isVisible('#dvRecPanel'),'Reabierta: vuelve a "por recibir"');
 // el celular de bodega la ve de nuevo
 const cm=await b.newContext({...devices['iPhone 13'],timezoneId:'America/Santiago'});await route(cm);const m=await cm.newPage();m.on('pageerror',e=>errs.push('cel: '+e.message));
 await m.goto(`${B}?puesto=${fId}&t=${fT}&u=${encodeURIComponent(SBU)}&k=anon`);await m.waitForTimeout(2000);await m.fill('#puPersona','FELIPE');await m.dispatchEvent('#puPersona','change');await m.waitForTimeout(500);
 console.log('MENU',(await m.textContent('#puMenu')).replace(/\s+/g,' '));check(/2 devoluciones por recibir/.test(await m.textContent('#puMenu')),'Celular de bodega: "Recepcionar devoluciones" muestra las 2 por recibir (incluida la reabierta)');
 // 2) Bodega empieza a recibir en el celular mientras el panel tiene la tabla abierta
 await s.click('#dvRecPanel summary');await s.waitForTimeout(300);await s.fill('#dvRecTbl [data-rc="110107"]','7');
 await m.tap('#puMenu [data-pk="devrec"]');await m.waitForTimeout(1500);await m.tap(`#dvHome [data-dv="${d1}"]`);await m.waitForTimeout(500);
 await m.fill('#dvScan','140101');await m.press('#dvScan','Enter');await m.waitForTimeout(300);await m.fill('#dvQty','1');await m.tap('#dvOk');await m.waitForTimeout(2500);
 await s.evaluate(()=>devRefresh(false));await s.waitForTimeout(1500);
 const v0=await s.$$eval('#dvRecTbl [data-rc]',x=>x.map(i=>i.dataset.rc+'='+i.value).join(' '));
 check(/Bodega ya está recibiendo/.test(await s.textContent('#dvRecAviso'))&&/110107=7/.test(v0)&&/140101=3/.test(v0),'Panel: avisa que bodega ya está recibiendo, conserva lo escrito (7) y propone solo lo que falta (3 sacos) → '+v0);
 await s.click('#dvRecOk');await s.waitForTimeout(300);await s.click('#dvRecConfirm #cYes');await s.waitForTimeout(2000);
 const r0=JSON.parse(sql(`select rec::text from cb_dev where id='${d1}'`)),tot=c=>r0.filter(l=>l.code===c).reduce((a,l)=>a+(+l.qty),0);
 check(tot('140101')===4&&tot('110107')===7&&r0.some(l=>l.pu===fId)&&r0.filter(l=>l.pu==='panel').length===2,'Servidor: se conserva lo de bodega (1 saco) y se suma lo del panel (3 sacos + 7 kg)');
 // anulada: no se puede reabrir ni recibir
 rpc('cb_dev_cerrar',{p_clave:ADMIN,p_id:d2});rpc('cb_dev_eliminar',{p_clave:ADMIN,p_id:d2});
 check(/anulado/.test(rpc('cb_dev_reabrir',{p_clave:ADMIN,p_id:d2}).body),'Una devolución anulada no se puede reabrir');
 check(/anulado|ya_recibida|ya fue/i.test(rpc('cb_dev_recibir_panel',{p_clave:ADMIN,p_id:d1,p_rec:[]}).body),'No se puede recibir dos veces (ya_recibida)');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 await b.close();console.log(fail?'FALLAS: '+fail:'TODO OK')})();
