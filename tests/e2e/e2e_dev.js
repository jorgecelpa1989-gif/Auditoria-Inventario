const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');const fs=require('fs');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
async function ctx(b,dev){const c=await b.newContext(dev||{...devices['iPhone 13']});await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});const p=await c.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));return [c,p]}
const link=(pu,t)=>`${B}?puesto=${pu}&t=${t}&u=${encodeURIComponent(SBU)}&k=anon`;
async function abrirPuesto(p,pu,t,nombre){await p.goto(link(pu,t));await p.waitForTimeout(1500);await p.fill('#puPersona',nombre);await p.dispatchEvent('#puPersona','change');await p.waitForTimeout(500)}
(async()=>{
 rpc('cb_configurar',{p_clave:ADMIN});
 for(const [p,t] of [['distribucion','tok-distribucion-123456'],['bodega','tok-bodega-1234567890'],['produccion','tok-produccion-123456'],['retail','tok-retail-1234567890']])rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:p,p_token:t});
 const b=await chromium.launch();
 // ---- Distribución carga ----
 const [cD,pD]=await ctx(b);await abrirPuesto(pD,'distribucion','tok-distribucion-123456','PEDRO');
 const menuD=await pD.$$eval('#puMenu .puBtn b',x=>x.map(e=>e.textContent));
 check(menuD.length===1&&/Cargar devolución · Distribución/.test(menuD[0]),'Distribución: su menú tiene solo "Cargar devolución · Distribución" → '+menuD.join(' | '));
 await pD.tap('#puMenu [data-pk="dev"]');await pD.waitForTimeout(800);
 check(await pD.isVisible('#dvNew'),'Distribución: abre la lista con "＋ Nueva devolución"');
 await pD.tap('#dvNew');await pD.waitForTimeout(300);
 check(await pD.isVisible('#dvGuia')&&await pD.inputValue('#dvFecha')!=='','Distribución: formulario con guía, factura y fecha (fecha de hoy por defecto)');
 await pD.fill('#dvScan','110107');await pD.fill('#dvQty','5');await pD.tap('#dvOk');await pD.waitForTimeout(300);
 await pD.fill('#dvScan','140101');await pD.fill('#dvQty','2');await pD.tap('#dvOk');await pD.waitForTimeout(300);
 await pD.fill('#dvScan','55555');await pD.tap('#dvQty');await pD.waitForTimeout(400);
 check(await pD.isVisible('#calert')&&!(await pD.$('#caKeep')),'Distribución: código que no existe → alerta SIN opción "Registrar igual" (bloqueado)');
 await pD.screenshot({path:S+'/dev_bloq.png'});
 await pD.tap('#caFix');await pD.fill('#dvQty','1');await pD.tap('#dvOk');await pD.waitForTimeout(400);
 check(await pD.isVisible('#calert')&&(await pD.$$('#dvList [data-dl]')).length===2,'Distribución: OK con el código malo vuelve a bloquear; quedan 2 líneas');
 await pD.tap('#caFix');await pD.fill('#dvScan','');
 await pD.tap('#dvFin');await pD.waitForTimeout(300);
 const t1=await pD.textContent('#toast').catch(()=>'' );check(/guía/i.test(t1)&&await pD.isVisible('#dvGuia'),'Distribución: sin guía no deja enviar ("'+t1+'")');
 await pD.fill('#dvGuia','g-123');await pD.dispatchEvent('#dvGuia','change');await pD.fill('#dvFact','f-456');await pD.dispatchEvent('#dvFact','change');
 await pD.waitForTimeout(2200);
 check(sql("select count(*) from cb_dev where enviado is null and jsonb_array_length(lect)=2")==='1','Distribución: el borrador se guarda solo en el servidor (2 líneas, sin enviar)');
 await pD.tap('#dvFin');await pD.waitForTimeout(300);await pD.tap('#cYes');await pD.waitForTimeout(1500);
 check(sql("select count(*) from cb_dev where enviado is not null and guia='G-123' and factura='F-456' and origen='distribucion' and persona='PEDRO'")==='1','Distribución: devolución enviada con guía G-123, factura F-456, origen y persona');
 check(await pD.isVisible('#dvNew')&&/Enviada a bodega/.test(await pD.textContent('#dvHome')),'Distribución: vuelve a la lista y la muestra "Enviada a bodega"');
 await pD.screenshot({path:S+'/dev_dist.png'});
 // ---- Producción y retail ven la opción ----
 const [cP,pP]=await ctx(b);await abrirPuesto(pP,'produccion','tok-produccion-123456','ANA');
 check((await pP.$$eval('#puMenu .puBtn b',x=>x.map(e=>e.textContent))).some(t=>/Cargar devolución · Producción/.test(t)),'Producción: su menú incluye "Cargar devolución · Producción"');
 const [cR,pR]=await ctx(b);await abrirPuesto(pR,'retail','tok-retail-1234567890','LUIS');
 check((await pR.$$eval('#puMenu .puBtn b',x=>x.map(e=>e.textContent))).some(t=>/Cargar devolución/i.test(t)),'Picking retail: su menú incluye "Cargar devolución"');
 // ---- Bodega recibe ----
 const [cB,pB]=await ctx(b);await abrirPuesto(pB,'bodega','tok-bodega-1234567890','JUAN');
 const mb=await pB.textContent('#puMenu');check(/Recepcionar devoluciones/.test(mb)&&/1 devolución por recibir/.test(mb),'Bodega: menú con "Recepcionar devoluciones · 1 por recibir"');
 check(!(await pB.$('#puMenu [data-pk="dev"]')),'Bodega: no tiene la opción de cargar devoluciones');
 await pB.tap('#puMenu [data-pk="devrec"]');await pB.waitForTimeout(800);
 check(/G-123/.test(await pB.textContent('#dvHome'))&&/Distribución/.test(await pB.textContent('#dvHome')),'Bodega: ve la devolución de Distribución guía G-123');
 await pB.tap('#dvHome [data-dv]');await pB.waitForTimeout(400);
 const doc=await pB.textContent('#dvDoc');check(/G-123/.test(doc)&&/F-456/.test(doc)&&!(await pB.$('#dvGuia')),'Bodega: ve guía y factura (solo lectura)');
 const decl=await pB.$$eval('#dvDecl .dvDeclR',rs=>rs.map(r=>r.innerText.replace(/\s+/g,' ')));
 check(decl.length===2&&decl.some(r=>/110107.*declarado: 5/.test(r))&&decl.some(r=>/140101.*declarado: 2 SACOS.*50 kg/.test(r)),'Bodega: ve lo declarado con cantidades (incluye 2 SACOS = 50 kg)');
 await pB.evaluate(()=>document.getElementById('dvDoc').scrollIntoView());await pB.screenshot({path:S+'/dev_bod_decl.png'});
 await pB.tap('#dvAccAll');await pB.waitForTimeout(200);await pB.tap('#cYes');await pB.waitForTimeout(400);
 check((await pB.$$('#dvList [data-dl]')).length===2&&/Todo aceptado/.test(await pB.textContent('#dvDecl')),'Bodega: "Aceptar todo" acepta los 2 productos');
 await pB.fill('#dvScan','77777');await pB.fill('#dvQty','3');await pB.tap('#dvOk');await pB.waitForTimeout(400);
 check(await pB.isVisible('#calert')&&!(await pB.$('#caKeep')),'Bodega: escanear un código fuera del maestro también queda bloqueado');
 await pB.tap('#caFix');await pB.waitForTimeout(200);
 await pB.tap('#dvDecl [data-edt="110107"]');await pB.waitForTimeout(300);
 check(await pB.inputValue('#dvScan')==='110107'&&!(/Todo aceptado/.test(await pB.textContent('#dvDecl'))),'Bodega: "Otra cantidad" quita lo aceptado de ese producto y deja listo el código');
 await pB.fill('#dvQty','4');await pB.tap('#dvOk');await pB.waitForTimeout(300);
 const rowFal=(await pB.$$eval('#dvDecl .dvDeclR',rs=>rs.map(r=>r.innerText.replace(/\s+/g,' ')))).find(r=>/110107/.test(r))||'';
 check(/Recibido: 4/.test(rowFal)&&/faltan 1/.test(rowFal),'Bodega: muestra "Recibido 4 · faltan 1" en 110107');
 await pB.waitForTimeout(2200);
 check(sql("select rec_inicio is not null from cb_dev")==='t','Bodega: al empezar, el servidor marca "en recepción"');
 await pB.screenshot({path:S+'/dev_bod.png'});
 await pB.tap('#dvFin');await pB.waitForTimeout(300);await pB.tap('#cYes');await pB.waitForTimeout(1500);
 check(sql("select recibido is not null and rec_persona='JUAN' and jsonb_array_length(rec)=2 from cb_dev")==='t','Bodega: recepción terminada (2 líneas, recibe JUAN)');
 // ---- Supervisor: cuadre ----
 const [cS,pS]=await ctx(b,{viewport:{width:1366,height:900},deviceScaleFactor:2,acceptDownloads:true});await pS.goto(B+'#panel');
 await pS.evaluate(([u,a])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await pS.goto(B+'#devol');await pS.reload();await pS.waitForTimeout(1500);
 await pS.click('#dvChips [data-f="rec"]');await pS.waitForTimeout(300);
 const row=await pS.textContent('#dvTbl tbody');check(/G-123/.test(row)&&/Recibida/.test(row)&&/con diferencia/.test(row),'Supervisor: lista con G-123 "Recibida · con diferencia"');
 await pS.click('#dvTbl [data-di]');await pS.waitForTimeout(400);
 const cmp=await pS.$$eval('#dvCmp tbody tr',rs=>rs.map(r=>r.innerText.replace(/\s+/g,' ')));
 check(cmp.length===2&&cmp.some(r=>/110107.*5.*4.*-1.*Faltante/.test(r))&&cmp.some(r=>/140101.*50.*50.*0.*Cuadra/.test(r)),'Supervisor: cuadre 110107 faltante 1 · 140101 cuadra (2 sacos = 50 kg)');
 await pS.screenshot({path:S+'/dev_sup.png'});
 const [dl]=await Promise.all([pS.waitForEvent('download',{timeout:5000}),pS.click('#dvXlsx')]).catch(()=>[null]);
 check(!!dl&&/Devolucion_G-123\.xlsx/.test(dl.suggestedFilename()),'Supervisor: descarga el cuadre en Excel '+(dl?dl.suggestedFilename():''));
 await pS.click('#dvCerrar');await pS.click('#cYes');await pS.waitForTimeout(1500);
 check(sql("select finalizado is not null from cb_dev")==='t','Supervisor: cerrar devolución');
 await pS.goto(B+'#permisos');await pS.reload();await pS.waitForTimeout(1500);
 check(/Celular de Distribución/.test(await pS.textContent('#puAdmBox')),'Permisos: aparece "Celular de Distribución" en celulares fijos');
 const errs=[pD,pP,pR,pB,pS].flatMap(p=>p.errs);check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
