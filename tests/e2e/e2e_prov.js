const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
// Módulo 7 · Recepción de proveedores: panel (packing list desde Excel) → celular de bodega → cuadre, agregar y corregir.
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_prov; delete from cb_puesto");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["221317","7800000000017","Mos.Gal 14","m","ROLLO",90],["110107","","ALAMBRE","kg"],["140101","","SACO HARINA 25KG","kg","SACO",25]],p_stock:null,p_origen:'t'});
 const [bId,bT]=usr('Felipe','Bodega',['prov_recibir','pt_recibir']);
 const b=await chromium.launch();const errs=[];
 const cs=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago',acceptDownloads:true});await route(cs);const s=await cs.newPage();s.on('pageerror',e=>errs.push('panel: '+e.message));
 await s.goto(B+'#panel');await s.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}));
   localStorage.setItem('inv_erp',JSON.stringify({file:'stock.txt',at:new Date().toISOString(),items:[{cod:'221317',ean:'7800000000017',desc:'Mos.Gal 14',um:'m',stock:900},{cod:'110107',ean:'',desc:'ALAMBRE',um:'kg',stock:30},{cod:'140101',ean:'',desc:'SACO HARINA 25KG',um:'kg',stock:100}]}));
   localStorage.setItem('inv_fact',JSON.stringify({"221317":{ce:"ROLLO",f:90},"140101":{ce:"SACO",f:25}}))},[SBU,ADMIN]);
 await s.goto(B+'#prov');await s.reload();await s.waitForTimeout(3000);
 check(await s.isVisible('#v-prov')&&!/Pronto/.test(await s.textContent('nav.tabs button[data-v="prov"]')),'Módulo 7 visible y sin la marca "Pronto"');
 check(/Todavía no hay recepciones/.test(await s.textContent('#pvTbl')),'Sin recepciones: lo explica');
 // Nueva recepción con packing list desde Excel
 await s.click('#pvNewTog');await s.waitForTimeout(300);
 await s.selectOption('#pvTipo','importacion');await s.fill('#pvProv','Aceros del Sur');await s.fill('#pvGuia','G-901');
 const xls=await s.evaluate(()=>{const ws=XLSX.utils.aoa_to_sheet([["PACKING LIST ACEROS"],[],["REF.","Contenedor ▼","SKU","Producto","Met./Kil.","Bultos x Palle","un. En Cont.","ML/KG Co","Pallet","ABC"],
   ["36-26","ONEU9329903","221317","MALLA 14",90,5,10,900,2,"A"],["36-26","ONEU9329903","140101","HARINA SACO",25,2,4,100,2,"B"],["36-26","ONEU9329903","999999","Producto nuevo",1,1,2,2,2,"NSO"],["36-26","ONEU9329903","110107","Alambre",1,10,"x","",""]]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"PL");return XLSX.write(wb,{type:"base64",bookType:"xlsx"})});
 require('fs').writeFileSync(S+'/pl.xlsx',Buffer.from(xls,'base64'));
 await s.setInputFiles('#pvFile',S+'/pl.xlsx');await s.waitForTimeout(800);
 const pi=await s.textContent('#pvParseInfo');
 check(/3 líneas agregadas/.test(pi)&&/1 código no está/.test(pi)&&/1 fila sin cantidad/.test(pi)&&/ONEU9329903/.test(pi),'Excel del proveedor: detecta encabezado, toma "un. En Cont.", agrega 3 líneas, avisa del código nuevo y de la fila sin cantidad → '+pi);
 check((await s.inputValue('#pvRefe'))==='36-26'&&(await s.inputValue('#pvCont'))==='ONEU9329903','Llena solo el N° de referencia (36-26) y el N° de contenedor (ONEU9329903)');
 const lt=await s.textContent('#pvLines');
 check(/Mos\.Gal 14\s*A\s*10/.test(lt)&&/NSO/.test(lt)&&/Total pallets\s*6/.test(lt),'Vista previa con ABC y pallets calculados (10/5 + 4/2 + 2/1 = 6)');
 check(/10\s*ROLLOS\s*900 m/.test(await s.textContent('#pvLines')),'Packing list en bultos con su conversión: 10 rollos → 900 m');
 await s.fill('#pvPaste','110107\t30');await s.check('input[name="pvU"][value="base"]');await s.click('#pvPasteOk');await s.waitForTimeout(300);
 check((await s.$$('#pvLines [data-pvx]')).length===4,'Pegar desde Excel agrega otra línea (4 en total)');
 await s.click('#pvLines [data-pvx="2"]');await s.waitForTimeout(200);
 check((await s.$$('#pvLines [data-pvx]')).length===3&&!/999999/.test(await s.textContent('#pvLines')),'Quitar un producto del packing list');
 await s.click('#pvSave');await s.waitForTimeout(2500);
 const g=JSON.parse(sql("select json_build_object('tipo',tipo,'prov',proveedor,'guia',guia,'ref',referencia,'n',jsonb_array_length(esperado),'orig',origen)::text from cb_prov"));
 check(g.tipo==='importacion'&&g.prov==='ACEROS DEL SUR'&&g.guia==='G-901'&&g.ref==='36-26'&&g.n===3&&g.orig==='panel'&&sql("select contenedor from cb_prov")==='ONEU9329903'&&sql("select esperado->0->>'abc'||'|'||(esperado->0->>'bxp') from cb_prov")==='A|5','Guardada en Supabase: importación, guía G-901, ref. 36-26, contenedor, 3 líneas con ABC y bultos por pallet');
 check(/ACEROS DEL SUR/.test(await s.textContent('#pvTbl'))&&/Por recibir/.test(await s.textContent('#pvTbl'))&&await s.isVisible('#pvDet'),'Aparece en la lista "Por recibir" y se abre su cuadre');
 // Celular de bodega
 const cm=await b.newContext({...devices['iPhone 13'],timezoneId:'America/Santiago'});await route(cm);const m=await cm.newPage();m.on('pageerror',e=>errs.push('cel: '+e.message));
 await m.goto(`${B}?puesto=${bId}&t=${bT}&u=${encodeURIComponent(SBU)}&k=anon`);await m.waitForTimeout(2000);await m.fill('#puPersona','FELIPE');await m.dispatchEvent('#puPersona','change');await m.waitForTimeout(400);
 check(/Recepción de proveedores/.test(await m.textContent('#puMenu')),'Celular de bodega: aparece "Recepción de proveedores" en su menú');
 await m.tap('#puMenu [data-pk="prov"]');await m.waitForTimeout(2000);
 check(/ACEROS DEL SUR/.test(await m.textContent('#pcHome'))&&/3 líneas/.test(await m.textContent('#pcHome')),'Ve la recepción por recibir, con su packing list');
 await m.tap('#pcHome [data-pc]');await m.waitForTimeout(800);
 const lc=await m.textContent('#pcDecl');
 check(/0 de 3 productos recibidos/.test(lc)&&/221317/.test(lc)&&/MALLA|Mos/.test(lc)&&/Pendiente/.test(lc)&&!/esperado|10\s*rollos/i.test(lc)&&/Cont\. ONEU9329903/.test(await m.textContent('#pcDoc')),'Celular: ve los códigos del packing list como en el inventario (código, descripción, "Pendiente"), sin las cantidades esperadas; y el contenedor');
 await m.tap('#pcDecl [data-pcc="221317"]');await m.waitForTimeout(300);
 check((await m.inputValue('#pcScan'))==='221317','Tocar un producto de la lista lo carga para registrarlo');
 await m.fill('#pcQty','10');await m.tap('#pcOk');await m.waitForTimeout(300);
 check(/1 de 3 productos recibidos/.test(await m.textContent('#pcDecl'))&&/✓ 10 rollos/.test(await m.textContent('#pcDecl').catch(()=>''))||/1 de 3/.test(await m.textContent('#pcDecl')),'La lista marca el producto recibido (1 de 3)');
 await m.fill('#pcScan','140101');await m.press('#pcScan','Enter');await m.waitForTimeout(300);await m.fill('#pcQty','3');await m.tap('#pcOk');await m.waitForTimeout(300);
 await m.fill('#pcScan','7800000000017');await m.press('#pcScan','Enter');await m.waitForTimeout(300);
 check(/Mos\.Gal 14/.test(await m.textContent('#pcPending')),'Lee el código de barras y reconoce el producto');
 await m.fill('#pcQty','1');await m.tap('#pcOk');await m.waitForTimeout(2500);
 check(sql("select jsonb_array_length(rec)||'|'||(rec_inicio is not null)||'|'||rec_persona from cb_prov where guia='G-901'")==='3|true|FELIPE','Se guarda solo en Supabase mientras recibe (3 líneas, "En recepción")');
 await m.tap('#pcFin');await m.waitForTimeout(300);await m.tap('#pcConfirm #cYes');await m.waitForTimeout(2500);
 check(sql("select recibido is not null from cb_prov where guia='G-901'")==='t','Termina la recepción');
 // Panel: cuadre
 await s.click('#pvRef');await s.waitForTimeout(2000);await s.click('#pvChips [data-f="todas"]');await s.waitForTimeout(300);
 const det=await s.textContent('#pvCmp');
 check(/Pallets esperados \/ recibidos/.test(await s.textContent('#pvDetK'))&&/recibidos 2,2 · 5 x pallet/.test(det)&&/Mos\.Gal 14.*\bA\s*ROLLOS/.test(det),'Cuadre con ABC y pallets (221317: 2 esperados, 2,2 recibidos, 5 por pallet)');
 check(/Sobrante/.test(det)&&/Faltante/.test(det)&&/No llegó/.test(det),'Cuadre: 221317 sobrante (11 vs 10), harina faltante (3 vs 4), alambre no llegó');
 check(/con diferencia/.test(await s.textContent('#pvTbl')),'La lista marca la recepción "con diferencia"');
 // Agregar registro (alambre) y corregir el rollo extra a 0
 await s.click('#pvAddTog');await s.fill('#pvAdCod','110107');await s.fill('#pvAdQty','30');await s.fill('#pvAdHora','10:30');await s.click('#pvAdOk');await s.waitForTimeout(2000);
 check(sql("select jsonb_array_length(man)||'|'||(man->0->>'qty')||'|'||(man->0->>'user') from cb_prov")==='1|30|Supervisor','Agregar registro: 30 kg de alambre, a mano, a nombre de Supervisor');
 await s.click('#pvCmp [data-pvo="221317"]');await s.waitForTimeout(300);
 const lid=sql("select e->>'lid' from cb_prov, jsonb_array_elements(rec) e where e->>'k'='221317' and (e->>'qty')::numeric=1");
 let nd=0;s.on('dialog',async dl=>{nd++;if(nd===1)await dl.accept('0');else await dl.accept()});
 await s.click(`#pvCmp [data-pvc="${lid}"]`);await s.waitForTimeout(2500);
 check(sql(`select e->>'qty' from cb_prov, jsonb_array_elements(rec) e where e->>'lid'='${lid}'`)==='0','Corregir a 0 el rollo leído de más (queda en el historial)');
 const det2=await s.textContent('#pvCmp');
 check(!/Sobrante/.test(det2)&&!/No llegó/.test(det2)&&/Faltante/.test(det2),'El cuadre se recalcula: solo queda la harina faltante');
 // Editar packing list (agregar o quitar productos) y Excel
 await s.click('#pvEdTog');await s.waitForTimeout(300);
 check(await s.isVisible('#pvForm')&&(await s.inputValue('#pvGuia'))==='G-901'&&(await s.$$('#pvLines [data-pvx]')).length===3,'Editar: trae los datos y las 3 líneas del packing list');
 await s.fill('#pvCod','140101');await s.fill('#pvCant','3');await s.click('#pvLinAdd');await s.click('#pvLines [data-pvx="1"]');await s.click('#pvSave');await s.waitForTimeout(2500);
 check(!/Faltante/.test(await s.textContent('#pvCmp'))&&/Cuadra/.test(await s.textContent('#pvCmp')),'Packing list corregido (harina 4 → 3): ahora todo cuadra');
 const [dl]=await Promise.all([s.waitForEvent('download',{timeout:5000}).catch(()=>null),s.click('#pvXls')]);
 check(!!dl&&/Recepcion_ACEROS_DEL_SUR_G-901\.xlsx/.test(dl.suggestedFilename()),'Excel del cuadre: '+(dl?dl.suggestedFilename():'sin descarga'));
 // Celular: recepción propia, sin packing list
 await m.tap('#pcHome #pcNew');await m.waitForTimeout(400);
 await m.fill('#pcProv','Plasticos Norte');await m.dispatchEvent('#pcProv','change');await m.fill('#pcGuia','G-77');await m.dispatchEvent('#pcGuia','change');
 await m.fill('#pcScan','110107');await m.press('#pcScan','Enter');await m.waitForTimeout(300);await m.fill('#pcQty','12');await m.tap('#pcOk');await m.waitForTimeout(300);
 await m.fill('#pcScan','555555');await m.press('#pcScan','Enter');await m.waitForTimeout(400);
 check(await m.isVisible('#calert')&&!!(await m.$('#caKeep')),'Código que no existe: avisa, con opción de registrarlo igual (producto nuevo del proveedor)');
 await m.tap('#caKeep');await m.waitForTimeout(300);await m.fill('#pcQty','2');await m.tap('#pcOk');await m.waitForTimeout(300);if(await m.isVisible('#caKeep'))await m.tap('#caKeep');
 await m.waitForTimeout(500);await m.tap('#pcFin');await m.waitForTimeout(300);await m.tap('#pcConfirm #cYes');await m.waitForTimeout(2500);
 const pr=sql("select proveedor||'|'||guia||'|'||(origen<>'panel')||'|'||jsonb_array_length(esperado)||'|'||jsonb_array_length(rec)||'|'||(recibido is not null) from cb_prov where guia='G-77'");
 check(pr==='PLASTICOS NORTE|G-77|true|0|2|true','Recepción propia del celular: proveedor, guía, sin packing list, 2 líneas, terminada → '+pr);
 await s.click('#pvRef');await s.waitForTimeout(2000);
 check(/PLASTICOS NORTE/.test(await s.textContent('#pvTbl')),'El panel la ve al instante');
 // Validaciones del servidor
 check(/falta_documento/.test(rpc('cb_prov_guardar',{p_clave:ADMIN,p_id:null,p_doc:{fecha:'2026-11-11'},p_esperado:[]}).body),'Sin guía ni referencia: rechazado');
 check(!rpc('cb_prov_listar',{p_clave:'clave-mala-xxxx'}).ok,'Sin clave: rechazado');
 const [fId,fT]=usr('Sin permiso','Bodega',['pt_recibir']);const ses=JSON.parse(rpc('cb_puesto_vincular',{p_puesto:fId,p_token:fT,p_equipo:'x'}).body);
 check(/sin_permiso/.test(rpc('cb_prov_recibir',{p_puesto:fId,p_ses:ses,p_id:'00000000-0000-4000-8000-0000000000aa',p_doc:{},p_rec:[]}).body),'Usuario sin "Recibe proveedores": rechazado');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();