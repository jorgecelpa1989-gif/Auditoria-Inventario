const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_sup; delete from cb_mov; delete from cb_dev; delete from cb_pt; delete from cb_pt_cierre; delete from cb_acceso; delete from cb_puesto");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["221317","","Mos.Gal 14","m","ROLLO",90],["110107","","ALAMBRE","kg"]],p_stock:null,p_origen:'t'});
 sql(`insert into cb_dev(origen,area,persona,guia,fecha,lect,enviado) values ('u_x','Distribución','CHOFER','G-DIST',current_date,'[{"lid":"a","code":"110107","k":"110107","qty":1}]',now()),('u_y','Producción','DAVID','G-PROD',current_date,'[{"lid":"b","code":"110107","k":"110107","qty":2}]',now())`);
 sql(`insert into cb_pt(lid,puesto,pallet,data,lado) values ('e1','u_p','PAL-1','{"lid":"e1","k":"110107","code":"110107","desc":"ALAMBRE","qty":10,"um":"kg","pallet":"PAL-1","user":"DAVID","t":"${new Date().toISOString()}"}','E')`);
 rpc('cb_mov_crear',{p_clave:ADMIN,p_nombre:'Entrega del admin',p_vence:new Date(Date.now()+864e5).toISOString(),p_items:[],p_meta:{sol:[{code:'110107',qty:5}]}});
 const b=await chromium.launch();const errs=[];
 const cs=await b.newContext({viewport:{width:1366,height:900}});await route(cs);const s=await cs.newPage();s.on('pageerror',e=>errs.push('admin: '+e.message));
 await s.goto(B+'#panel');await s.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 // ---- Administrador: crear el supervisor ----
 await s.goto(B+'#permisos');await s.reload();await s.waitForTimeout(2500);
 check(await s.isVisible('#supAdm')&&/Todavía no hay supervisores/.test(await s.textContent('#supBox')),'Permisos: aparece la tarjeta "Supervisores de área"');
 await s.click('#supNew');await s.fill('#supNom','Supervisor Prod. 1');
 const marc=()=>s.$$eval('#supEd [data-sp]',c=>c.filter(x=>x.checked).map(x=>x.dataset.sp).sort().join(','));
 check((await s.$$('#supEd [data-sp]')).length===17&&(await marc())==='','Nuevo supervisor: 17 permisos en 6 módulos, ninguno marcado (tú eliges)');
 await s.check('#supEd [data-sp="mp_operar"]');check((await marc())==='mp_operar,mp_solicitar,mp_ver','Marcar "operar" marca también "ver" y "solicitar" → '+(await marc()));
 await s.uncheck('#supEd [data-sp="mp_ver"]');check((await marc())==='','Quitar "ver" quita todo lo que dependía de él');
 for(const q of ['mp_solicitar','pt_ver','dev_crear'])await s.check(`#supEd [data-sp="${q}"]`);
 check((await marc())==='dev_crear,dev_ver,mp_solicitar,mp_ver,pt_ver','Perfil pedido para Supervisor Prod.: MP ver+solicitar, PT ver, Devoluciones ver+crear');
 await s.click('#supSave');await s.waitForTimeout(2500);
 const id=sql("select id from cb_sup");const link0=await s.inputValue('#sl-'+id).catch(()=>''),link=link0.replace(/^https?:\/\/[^?]+/,B);   // en local el link sale con la dirección pública
 check(/\?sup=s_[0-9a-f]+&t=/.test(link)&&/Link sin abrir/.test(await s.textContent('#supBox')),'Se crea con su link propio, estado "Link sin abrir"');
 await s.screenshot({path:S+'/sup_admin.png',clip:await s.evaluate(()=>{const r=document.querySelector('#supAdm').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:Math.min(r.height,520)}}),fullPage:true}).catch(()=>{});
 // ---- Supervisor: abre su link en su PC ----
 const cp=await b.newContext({viewport:{width:1366,height:900}});await route(cp);const p=await cp.newPage();p.on('pageerror',e=>errs.push('sup: '+e.message));
 await p.goto(link);await p.waitForTimeout(3500);
 const tabs=async()=>p.$$eval('nav.tabs button',bs=>bs.filter(x=>x.offsetParent!==null).map(x=>x.dataset.v).join(','));
 check((await tabs())==='devol,mp,pt','Supervisor: su menú muestra solo Entrega MP, Recepción PT y Devoluciones → '+(await tabs()));
 check(/Supervisor Prod\. 1/.test(await p.textContent('#supChip'))&&!/\?sup=|t=/.test(p.url()),'Se ve su nombre arriba y el link desaparece de la barra de direcciones');
 check(await p.evaluate(a=>!(localStorage.inv_sb||'').includes(a),ADMIN)&&await p.evaluate(()=>/^s_[0-9a-f]+\./.test(JSON.parse(localStorage.inv_sup).ses)),'En su navegador queda solo su sesión (ninguna clave de administrador)');
 // MP
 check(await p.isVisible('#solCard')&&await p.isDisabled('#solPor')&&(await p.inputValue('#solPor'))==='SUPERVISOR PROD. 1','MP: puede solicitar; "Solicita" viene con su nombre y no se puede cambiar');
 const mpTxt=await p.textContent('#v-mp');
 check(/Entrega del admin/.test(mpTxt)&&(await p.$$('#v-mp [data-mx], #v-mp [data-mf], #btnFinMov')).length===0,'MP: ve las entregas, sin botones Cerrar ni Eliminar');
 check(await p.isHidden('#mpAcc')&&await p.isHidden('#supAdm'),'MP: no ve accesos ni administración');
 await p.fill('#solCod','221317');await p.fill('#solQty','3');await p.click('#solAddBtn');await p.waitForTimeout(300);await p.click('#btnSolGen');await p.waitForTimeout(2500);
 const mm=sql("select (meta->>'estado')||'|'||(meta->>'creado_por')||'|'||(meta->>'creado_nombre')||'|'||(meta->>'por') from cb_mov where meta->>'creado_por'='sup'");
 check(mm==='solicitada|sup|Supervisor Prod. 1|SUPERVISOR PROD. 1','MP: envía la solicitud a bodega, a su nombre → '+mm);
 // PT
 await p.click('nav.tabs button[data-v="pt"]');await p.waitForTimeout(2500);
 check(/PAL-1/.test(await p.textContent('#ptRes'))&&(await p.$$('#ptRes [data-pted]')).length===0&&await p.isHidden('#ptAddTog')&&await p.isVisible('#ptExp'),'PT: ve la cuadratura y el botón Excel, sin "corregir" ni "agregar registro"');
 // Devoluciones
 await p.click('nav.tabs button[data-v="devol"]');await p.waitForTimeout(2500);
 const dt=await p.textContent('#dvTbl');check(/G-PROD/.test(dt)&&!/G-DIST/.test(dt),'Devoluciones: ve solo las de Producción');
 check(await p.isVisible('#dpCard')&&await p.isDisabled('#dpArea')&&(await p.inputValue('#dpArea'))==='Producción'&&await p.isDisabled('#dpPers'),'Devoluciones: puede crear; área fija "Producción" y a su nombre');
 await p.fill('#dpGuia','G-SUP');await p.fill('#dpScan','110107');await p.press('#dpScan','Enter');await p.fill('#dpQty','4');await p.click('#dpAdd');await p.click('#dpSend');await p.waitForTimeout(400);
 await p.click('#dpConfirm #cYes');await p.waitForTimeout(2500);
 const dn=sql("select area||'|'||persona||'|'||jsonb_array_length(lect) from cb_dev where guia='G-SUP'");
 check(dn==='Producción|Supervisor Prod. 1|1','Devoluciones: la crea y queda en Producción a su nombre → '+dn);
 await p.click('#dvTbl [data-di]');await p.waitForTimeout(500);
 check(await p.isVisible('#dvDet')&&await p.isHidden('#dvCerrar')&&await p.isHidden('#dvDel')&&await p.isVisible('#dvXlsx'),'Devoluciones: ve el avance y el cuadre; sin "Cerrar devolución" ni "Eliminar"');
 await p.screenshot({path:S+'/sup_panel.png'});
 // No puede ir a otros módulos
 for(const h of ['erp','resultado','permisos','contar']){await p.goto(B+'#'+h);await p.waitForTimeout(1200);
   check(await p.isHidden('#v-'+h)&&(await tabs())==='devol,mp,pt','Escribir #'+h+' en la dirección: no entra')}
 // Administrador le quita Devoluciones → se nota sin recargar
 rpc('cb_sup_guardar',{p_clave:ADMIN,p_id:id,p_nombre:'Supervisor Prod. 1',p_permisos:['mp_ver','pt_ver'],p_activo:true});
 await p.evaluate(()=>supYo());await p.waitForTimeout(1500);
 check((await tabs())==='mp,pt'&&await p.isHidden('#solCard'),'El administrador le quita permisos: desaparecen Devoluciones y "solicitar" sin recargar → '+(await tabs()));
 // Mismo link en otro equipo
 const c2=await b.newContext({viewport:{width:1366,height:900}});await route(c2);const q=await c2.newPage();await q.goto(link);await q.waitForTimeout(3000);
 check(/Link ya usado en otro equipo/.test(await q.textContent('#lockBox')),'El mismo link en otro PC: bloqueado ("Link ya usado en otro equipo")');
 // Estado en el panel del administrador
 await s.reload();await s.waitForTimeout(3000);
 check(/En línea|Vinculado/.test(await s.textContent('#supBox'))&&(await s.$$('#supBox input[readonly]')).length===0,'Administrador: lo ve vinculado a su equipo y el link ya no se muestra');
 // Desactivar
 await s.click('#supBox [data-sac]');await s.waitForTimeout(300);await s.click('#supConfirm #cYes');await s.waitForTimeout(2000);
 check(/Desactivado/.test(await s.textContent('#supBox')),'Administrador: lo desactiva');
 await p.evaluate(()=>supYo());await p.waitForTimeout(1500);
 check(/Acceso desactivado/.test(await p.textContent('#lockBox')),'Supervisor: su panel se bloquea ("Acceso desactivado")');
 // ---- El jefe cambia de perfil: el administrador le da más permisos (sin link nuevo) ----
 rpc('cb_sup_guardar',{p_clave:ADMIN,p_id:id,p_nombre:'Supervisor Prod. 1',p_permisos:['inv_ver','mp_operar','mp_eliminar','pt_corregir','dev_todas','dev_cerrar'],p_activo:true});
 await p.reload();await p.waitForTimeout(3500);
 check((await tabs())==='erp,resultado,devol,mp,pt','Con más permisos: aparecen Panel e Inventario, sin link nuevo → '+(await tabs()));
 await p.click('nav.tabs button[data-v="pt"]');await p.waitForTimeout(2500);
 check((await p.$$('#ptRes [data-pted]')).length>0&&await p.isVisible('#ptAddTog'),'PT con "corregir": aparecen "✎ corregir" y "＋ Agregar registro"');
 await p.click('nav.tabs button[data-v="mp"]');await p.waitForTimeout(2500);
 check((await p.$$('#v-mp [data-mx]')).length>0&&await p.isVisible('#btnMpSinSol'),'MP con "operar" y "eliminar": aparecen Eliminar y "Crear entrega sin solicitud"');
 await p.click('nav.tabs button[data-v="devol"]');await p.waitForTimeout(2500);
 const dt2=await p.textContent('#dvTbl');check(/G-DIST/.test(dt2)&&/G-PROD/.test(dt2)&&await p.isHidden('#dpCard'),'Devoluciones con "todas las áreas": ve también Distribución; sin "crear" no hay formulario');
 await p.click('#dvTbl [data-di]');await p.waitForTimeout(500);check(await p.isVisible('#dvCerrar')&&await p.isHidden('#dvDel'),'Devoluciones con "cerrar" pero sin "eliminar": solo aparece Cerrar');
 await p.click('nav.tabs button[data-v="resultado"]');await p.waitForTimeout(2500);
 check(await p.isVisible('#v-resultado')&&await p.isHidden('#maestroCard')&&await p.isHidden('#edCard')&&await p.isHidden('#reCard'),'Inventario solo "ver": entra, pero sin Crear conteo, Modificar ni Reconteo');
 await p.goto(B+'#permisos');await p.waitForTimeout(1200);check(await p.isHidden('#v-permisos'),'Sin permiso de usuarios: no entra a 2 · Permisos');
 await p.screenshot({path:S+'/sup_mas_permisos.png'});
 rpc('cb_sup_guardar',{p_clave:ADMIN,p_id:id,p_nombre:'Supervisor Prod. 1',p_permisos:['usr_admin'],p_activo:true});await p.reload();await p.waitForTimeout(3500);
 check((await tabs())==='permisos'&&await p.isVisible('#uEdCard')&&await p.isHidden('#sbCard')&&await p.isHidden('#supAdm')&&await p.isHidden('#mpAcc'),'Solo "Usuarios": ve 6 · Permisos con los usuarios, sin Supabase, sin supervisores ni acceso de producción');
 check(!(await p.content()).includes(ADMIN),'En ningún momento su página contiene la clave del administrador');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();