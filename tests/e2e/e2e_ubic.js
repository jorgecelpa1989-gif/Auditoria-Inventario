// Módulo 8 · Almacenamiento y ubicaciones: servidor, panel y celular de bodega.
const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
const hay=(u,k)=>sql(`select cb_ubic_hay('${u}','${k}')`);
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});
 // ---------- Servidor ----------
 const g=JSON.parse(rpc('cb_ubic_guardar',{p_clave:ADMIN,p_lista:[{cod:'a-01-1',pasillo:'A',rack:'01',nivel:'1'},{cod:'A-01-2',pasillo:'A',rack:'01',nivel:'2'},{cod:'A-02-1',pasillo:'A',rack:'02',nivel:'1'},{cod:'B-01-1',pasillo:'B',rack:'01',nivel:'1'}],p_reemplazar:true}).body);
 check(g.activas===4&&sql("select string_agg(cod,',' order by cod) from cb_ubic")==='A-01-1,A-01-2,A-02-1,B-01-1','Carga 4 ubicaciones (el código queda en mayúsculas)');
 const [uid,ut]=usr('Felipe','Bodega',['ubic_mover']);const ses=JSON.parse(rpc('cb_puesto_vincular',{p_puesto:uid,p_token:ut,p_equipo:'x'}).body);
 const mv=m=>rpc('cb_ubic_mover',{p_puesto:uid,p_ses:ses,p_mov:Object.assign({persona:'FELIPE'},m)});
 check(mv({lid:'l1',tipo:'ingreso',hacia:'A-01-1',k:'140101',qty:10,f:25,ce:'SACO',um:'kg',desc:'SACO HARINA'}).ok&&hay('A-01-1','140101')==='250','Ingreso: 10 SACOS = 250 kg en A-01-1');
 check(JSON.parse(mv({lid:'l1',tipo:'ingreso',hacia:'A-01-1',k:'140101',qty:10,f:25}).body).repetido===true&&hay('A-01-1','140101')==='250','Reenviar el mismo movimiento (sin señal) no lo duplica');
 check(mv({lid:'l2',tipo:'traslado',desde:'A-01-1',hacia:'B-01-1',k:'140101',qty:4,f:25}).ok&&hay('A-01-1','140101')==='150'&&hay('B-01-1','140101')==='100','Traslado: 4 sacos de A-01-1 a B-01-1 (quedan 6 y 4)');
 check(/sin_stock/.test(mv({lid:'l3',tipo:'salida',desde:'B-01-1',k:'140101',qty:5,f:25}).body)&&hay('B-01-1','140101')==='100','Salida de 5 sacos donde hay 4: rechazada (sin_stock)');
 check(mv({lid:'l4',tipo:'salida',desde:'B-01-1',k:'140101',qty:4,f:25}).ok&&hay('B-01-1','140101')==='0','Salida de los 4 sacos: B-01-1 queda vacía');
 check(/ubicacion_no_existe/.test(mv({lid:'l5',tipo:'ingreso',hacia:'Z-99',k:'140101',qty:1}).body),'Ubicación que no existe: rechazada');
 check(/misma_ubicacion/.test(mv({lid:'l6',tipo:'traslado',desde:'A-01-1',hacia:'A-01-1',k:'140101',qty:1,f:25}).body),'Traslado a la misma ubicación: rechazado');
 check(/cantidad_invalida/.test(mv({lid:'l7',tipo:'ingreso',hacia:'A-01-1',k:'140101',qty:0}).body),'Cantidad 0: rechazada');
 const [nid,nt]=usr('Sin permiso','Bodega',['pt_recibir']);const nses=JSON.parse(rpc('cb_puesto_vincular',{p_puesto:nid,p_token:nt,p_equipo:'y'}).body);
 check(/sin_permiso/.test(rpc('cb_ubic_mover',{p_puesto:nid,p_ses:nses,p_mov:{tipo:'ingreso',hacia:'A-01-1',k:'1',qty:1}}).body),'Usuario sin "Almacenamiento": rechazado');
 check(/ubicacion_con_stock/.test(rpc('cb_ubic_guardar',{p_clave:ADMIN,p_lista:[{cod:'B-01-1'}],p_reemplazar:true}).body),'No se puede quitar una ubicación que tiene producto (A-01-1)');
 // anular el ingreso cuando ya salió producto: no se puede; anular la salida: vuelve el stock
 const idIng=sql("select id from cb_ubic_mov where lid='l1'"),idSal=sql("select id from cb_ubic_mov where lid='l4'");
 check(/sin_stock/.test(rpc('cb_ubic_anular',{p_clave:ADMIN,p_id:idIng}).body)&&sql(`select anulado is null from cb_ubic_mov where id='${idIng}'`)==='t','Anular un ingreso del que ya se movió producto: rechazado (no deja negativo)');
 check(rpc('cb_ubic_anular',{p_clave:ADMIN,p_id:idSal}).ok&&hay('B-01-1','140101')==='100','Anular la salida: B-01-1 vuelve a tener 4 sacos');
 const d=JSON.parse(rpc('cb_ubic_datos',{p_clave:ADMIN}).body);
 check(d.ubic.length===4&&d.stock.length===2&&d.movs.length===3,'Panel: 4 ubicaciones, 2 con stock, 3 movimientos (uno anulado)');
 check(!rpc('cb_ubic_datos',{p_clave:'clave-mala-xxxx'}).ok,'Sin clave: rechazado');
 check(sql("select count(*) from information_schema.role_routine_grants where grantee='anon' and routine_name in ('cb_ubic_registrar','cb_ubic_hay','cb_ubic_stock_json')")==='0','Funciones internas cerradas para anon');
 if(process.env.SOLO_SQL){console.log(fail?'FALLAS: '+fail:'TODO OK');return}
 // ---------- Panel ----------
 sql("delete from cb_ubic_mov; delete from cb_ubic");
 const b=await chromium.launch();const errs=[];
 const ca=await b.newContext({viewport:{width:1400,height:950},timezoneId:'America/Santiago'});await route(ca);const a=await ca.newPage();a.on('pageerror',x=>errs.push('panel: '+x.message));
 await a.goto(B+'#panel');await a.evaluate(([u,k])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:k,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await a.goto(B+'#ubic');await a.reload();await a.waitForTimeout(3000);
 const menu=await a.$$eval('#sideNav > *',els=>els.filter(e=>getComputedStyle(e).display!=='none').map(e=>e.textContent.replace(/\s+/g,' ').trim()).join(' | '));
 check(/Logística \| 3Inventario \| 4Logística inversa\d* \| 5Recepción proveedores \| 8Almacenamiento \| Producción/.test(menu),'Menú: "8 Almacenamiento" dentro de LOGÍSTICA');
 check(await a.isVisible('#v-ubic')&&/Todavía no hay ubicaciones/.test(await a.textContent('#ubMapa')),'Sin ubicaciones: lo indica y ofrece cargarlas');
 await a.click('#ubCargaTog');await a.fill('#ubPaste','Ubicación\tPasillo\tRack\tNivel\nA-01-1\tA\t01\t1\nA-01-2\tA\t01\t2\nA-02-1\tA\t02\t1\nB-01-1\tB\t01\t1');await a.click('#ubPrev');await a.waitForTimeout(300);
 check(/4<\/b> ubicaciones · 2 pasillos · 4 nuevas/.test(await a.innerHTML('#ubCargaInfo')),'Revisar: 4 ubicaciones, 2 pasillos, 4 nuevas');
 await a.click('#ubCargaOk');await a.waitForTimeout(2500);
 check(sql("select count(*) from cb_ubic where activo")==='4'&&(await a.$$('#ubMapa [data-ub]')).length===4&&/Pasillo A/.test(await a.textContent('#ubMapa'))&&/Pasillo B/.test(await a.textContent('#ubMapa')),'Mapa: pasillos A y B con sus 4 ubicaciones');
 await a.click('#ubMovTog');await a.selectOption('#ubMvTipo','ingreso');await a.fill('#ubMvHacia','a-01-1');await a.fill('#ubMvCod','140101');await a.fill('#ubMvQty','10');await a.waitForTimeout(200);
 check(/SACO HARINA/.test(await a.textContent('#ubMvInfo'))&&/sacos/.test(await a.textContent('#ubMvQL')),'Registrar desde el panel: reconoce el producto y pide sacos');
 await a.click('#ubMvOk');await a.waitForTimeout(2500);
 check(hay('A-01-1','140101')==='250'&&/140101/.test(await a.textContent('#ubMapa [data-ub="A-01-1"]'))&&/10 SACOS/.test(await a.textContent('#ubMapa [data-ub="A-01-1"]')),'Ingreso desde el panel: A-01-1 muestra 140101 · 10 SACOS');
 // ---------- Celular de bodega ----------
 const [cid,ct]=usr('Bodega Ubic','Bodega',['ubic_mover']);
 const cc=await b.newContext({...devices['Pixel 7'],timezoneId:'America/Santiago'});await route(cc);const m=await cc.newPage();m.on('pageerror',x=>errs.push('cel: '+x.message));
 await m.goto(`${B}?puesto=${cid}&t=${ct}&u=${encodeURIComponent(SBU)}&k=anon`);await m.waitForTimeout(2200);await m.fill('#puPersona','JUAN');await m.dispatchEvent('#puPersona','change');await m.waitForTimeout(300);
 check(/Almacenamiento y ubicaciones/.test(await m.textContent('#puMenu')),'Celular: aparece "Almacenamiento y ubicaciones" en el menú');
 await m.click('#puMenu [data-pk="ubic"]');await m.waitForTimeout(2000);
 check(await m.isVisible('#v-ubiccel')&&await m.isHidden('#ucForm'),'Celular: pide elegir Ingreso, Traslado o Salida');
 await m.click('[data-ut="traslado"]');await m.waitForTimeout(200);
 await m.fill('#ucDesde','A-01-1');await m.press('#ucDesde','Enter');await m.waitForTimeout(300);
 check(/140101/.test(await m.textContent('#ucDesdeInfo'))&&/10 SACOS/.test(await m.textContent('#ucDesdeInfo')),'Traslado: al escanear el origen muestra lo que hay (10 SACOS)');
 await m.fill('#ucHacia','Z-99');await m.press('#ucHacia','Enter');await m.waitForTimeout(200);
 check(/no está cargada/.test(await m.textContent('#ucHaciaInfo')),'Ubicación que no existe: avisa');
 await m.fill('#ucHacia','B-01-1');await m.press('#ucHacia','Enter');await m.waitForTimeout(200);
 await m.click('#ucDesdeInfo [data-ucsku="140101"]');await m.waitForTimeout(300);
 check(/hay 10/.test(await m.textContent('#ucPending'))&&/sacos/i.test(await m.textContent('#ucQtyEb')),'Elegir el producto desde el origen: muestra cuánto hay y pide sacos');
 await m.fill('#ucQty','12');await m.click('#ucOk');await m.waitForTimeout(500);
 check(sql("select count(*) from cb_ubic_mov where origen<>'panel'")==='0','Traslado de 12 donde hay 10: el celular lo frena antes de enviar');
 await m.fill('#ucDesde','A-01-1');await m.press('#ucDesde','Enter');await m.fill('#ucHacia','B-01-1');await m.press('#ucHacia','Enter');await m.fill('#ucScan','140101');await m.press('#ucScan','Enter');await m.fill('#ucQty','4');await m.click('#ucOk');await m.waitForTimeout(2500);
 check(hay('A-01-1','140101')==='150'&&hay('B-01-1','140101')==='100'&&sql("select persona from cb_ubic_mov where tipo='traslado'")==='JUAN','Traslado de 4 sacos A-01-1 → B-01-1, a nombre de JUAN');
 check(/Traslado/.test(await m.textContent('#ucList'))&&/registrado/.test(await m.textContent('#ucList')),'Celular: aparece en "Mis movimientos" como registrado');
 await m.click('[data-ut="salida"]');await m.fill('#ucDesde','B-01-1');await m.press('#ucDesde','Enter');await m.fill('#ucScan','140101');await m.press('#ucScan','Enter');await m.fill('#ucQty','4');await m.click('#ucOk');await m.waitForTimeout(2500);
 check(hay('B-01-1','140101')==='0','Salida de los 4 sacos: B-01-1 queda vacía');
 // ---------- Panel ve todo ----------
 await a.click('#ubRef');await a.waitForTimeout(2500);
 check(/vacía/.test(await a.textContent('#ubMapa [data-ub="B-01-1"]'))&&/6 SACOS/.test(await a.textContent('#ubMapa [data-ub="A-01-1"]')),'Panel: A-01-1 con 6 SACOS y B-01-1 vacía');
 const mvT=await a.textContent('#ubMovs');check(/Ingreso/.test(mvT)&&/Traslado/.test(mvT)&&/Salida/.test(mvT)&&/JUAN/.test(mvT),'Movimientos de hoy: ingreso, traslado y salida con quién');
 await a.fill('#ubQ','harina');await a.waitForTimeout(300);
 check(/A-01-1/.test(await a.textContent('#ubDonde'))&&/Total en bodega/.test(await a.textContent('#ubDonde'))&&(await a.$$('#ubMapa .ubCell.hit')).length===1,'Buscar "harina": dice dónde está y marca la ubicación en el mapa');
 await a.fill('#ubQ','');await a.click('#ubMapa [data-ub="A-01-1"]');await a.waitForTimeout(400);
 check(await a.isVisible('#ubDet')&&/150 kg/.test(await a.textContent('#ubDetTbl'))&&(await a.$$('#ubDetMov tbody tr')).length===2,'Detalle de A-01-1: 6 SACOS = 150 kg y su historial (ingreso y traslado)');
 const [dl]=await Promise.all([a.waitForEvent('download',{timeout:5000}).catch(()=>null),a.click('#ubXls')]);
 check(!!dl&&/Almacenamiento_/.test(dl.suggestedFilename()),'Excel de stock por ubicación y movimientos');
 // anular la salida desde el panel
 a.on('dialog',d=>d.accept());await a.click('#ubMovs [data-uban]');await a.waitForTimeout(300);await a.click('#ubConfirm #cYes');await a.waitForTimeout(2500);
 check(sql("select count(*) from cb_ubic_mov where anulado is not null")==='1'&&/anulado/.test(await a.textContent('#ubMovs')),'Anular un movimiento desde el panel: queda tachado en el historial');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 await b.close();console.log(fail?'FALLAS: '+fail:'TODO OK')})();
