const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
const sqlE=q=>{try{return {ok:true,v:sql(q)}}catch(e){const m=String(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,v:m?m[1].trim():'error'}}};
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:'Bodega',p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
// Simula la Edge Function "prov-fotos" (service_role = postgres) y el bucket privado
const BUCKET=new Map();let llamadas=0;
const route=async c=>{await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
  await c.route(SBU+'/functions/v1/prov-fotos',async r=>{llamadas++;const b=JSON.parse(r.request().postData()||'{}'),q=s=>"'"+String(s).replace(/'/g,"''")+"'";let out,st=200;
    if(b.accion==='subir'){const tp=b.tipo==='cal'?'cal':'rec',cd=b.cod?q(b.cod):'null';const ok=sqlE(`select cb_prov_foto_puede(${q(b.puesto)},${q(b.ses)},${q(b.id)},${q(tp)})`);
      if(!ok.ok){out={error:ok.v};st=400}else{const path=`${b.id}/${Date.now()}-${Math.random().toString(16).slice(2,10)}.jpg`;BUCKET.set(path,b.jpg);
        const a=sqlE(`select cb_prov_foto_agregar(${q(b.puesto)},${q(b.ses)},${q(b.id)},${q(path)},${q(b.persona||'')},${q(tp)},${cd})::text`);if(!a.ok){BUCKET.delete(path);out={error:a.v};st=400}else out={path,n:JSON.parse(a.v).n}}}
    else if(b.accion==='ver'){const f=sqlE(`select cb_prov_fotos(${q(b.clave)},${q(b.id)})::text`);if(!f.ok){out={error:f.v};st=400}else out={fotos:JSON.parse(f.v).map(x=>({...x,url:'data:image/jpeg;base64,'+BUCKET.get(x.path)}))}}
    await r.fulfill({status:st,contentType:'application/json',body:JSON.stringify(out)})})};

// Recepción de proveedores: observaciones (bodega y supervisor) + Control de calidad por código desde el celular.
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_prov; delete from cb_puesto");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["221317","","Mos.Gal 14","m","ROLLO",90],["110107","","ALAMBRE","kg"]],p_stock:null,p_origen:'t'});
 const [bId,bT]=usr('Felipe',['prov_recibir']),[qId,qT]=usr('Calidad',['prov_calidad']);
 check(/datos_invalidos/.test(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'X',p_area:'',p_permisos:['otro'],p_activo:true}).body)&&rpc('cb_u_guardar',{p_clave:ADMIN,p_id:qId,p_nombre:'Calidad',p_area:'Bodega',p_permisos:['prov_calidad'],p_activo:true}).ok,'Permiso nuevo «prov_calidad» aceptado por el servidor');
 const x=JSON.parse(rpc('cb_prov_guardar',{p_clave:ADMIN,p_id:null,p_doc:{tipo:'nacional',proveedor:'Aceros Uno',guia:'G-1',fecha:'2026-11-18'},p_esperado:[{code:'221317',k:'221317',desc:'Mos.Gal 14',qty:10,f:90,ce:'ROLLO',um:'m'}]}).body),idP=x.id||x;
 const b=await chromium.launch();const errs=[];
 const cel=async(id,tk,nom)=>{const c=await b.newContext({...devices['iPhone 13'],timezoneId:'America/Santiago'});await route(c);const m=await c.newPage();m.on('pageerror',e=>errs.push(nom+': '+e.message));
   await m.goto(`${B}?puesto=${id}&t=${tk}&u=${encodeURIComponent(SBU)}&k=anon`);await m.waitForTimeout(2000);await m.fill('#puPersona',nom);await m.dispatchEvent('#puPersona','change');await m.waitForTimeout(400);return m};
 // bodega recibe y deja observación
 const m=await cel(bId,bT,'FELIPE');await m.tap('#puMenu [data-pk="prov"]');await m.waitForTimeout(1500);await m.tap(`#pcHome [data-pc="${idP}"]`);await m.waitForTimeout(600);
 await m.fill('#pcScan','221317');await m.press('#pcScan','Enter');await m.waitForTimeout(300);await m.fill('#pcQty','10');await m.tap('#pcOk');await m.waitForTimeout(300);
 await m.fill('#pcObs','2 pallets golpeados');await m.waitForTimeout(2800);
 check(sql(`select obs_rec from cb_prov where id='${idP}'`)==='2 pallets golpeados','Observación del operario guardada');
 // calidad: menú, inspección por código
 const qc=await cel(qId,qT,'MARIA');
 check(/Control de calidad/.test(await qc.textContent('#puMenu'))&&!/Recepción de proveedores/.test(await qc.textContent('#puMenu')),'Usuario de calidad: ve «Control de calidad» (y no la recepción)');
 await qc.tap('#puMenu [data-pk="cal"]');await qc.waitForTimeout(1500);await qc.tap(`#qcHome [data-qc="${idP}"]`);await qc.waitForTimeout(600);
 const tx=await qc.textContent('#qcWork');check(/221317/.test(tx)&&/Recibido: 10 rollos = 900 m/.test(tx)&&/2 pallets golpeados/.test(tx),'Ficha con los códigos de la recepción, lo recibido (10 rollos = 900 m) y la observación de bodega');
 const C='#qcWork .qcCod[data-cod="221317"]';
 await qc.tap(`${C} [data-q="clas"][data-v="obs"]`);await qc.tap(`${C} [data-q="acc"][data-v="Reclamo a proveedor"]`);
 await qc.fill(`${C} [data-q="rev"]`,'2');await qc.tap(`${C} [data-q="emb"][data-v="Golpes"]`);await qc.tap(`${C} [data-q="emb"][data-v="Humedad"]`);await qc.tap(`${C} [data-q="pro"][data-v="OK"]`);await qc.tap(`${C} [data-q="etq"][data-v="No aplica"]`);
 await qc.fill(`${C} [data-q="com"]`,'Cajas mojadas');
 check(/\(20%\)/.test(await qc.textContent(`${C} [data-pct]`)),'Muestreo: 2 de 10 = 20%');
 await qc.setInputFiles(`${C} [data-qfoto]`,'/tmp/_foto.jpg').catch(()=>{});await qc.waitForTimeout(2500);
 await qc.tap('#qcFin');await qc.waitForTimeout(300);await qc.tap('#qcConfirm #cYes');await qc.waitForTimeout(2500);
 const cal=JSON.parse(sql(`select calidad::text from cb_prov where id='${idP}'`));const z=(cal.codigos||{})['221317']||{};
 check(cal.estado==='terminada'&&cal.resp.persona==='MARIA'&&cal.fin&&z.clas==='obs'&&z.acc==='Reclamo a proveedor'&&z.rev===2&&z.tot===10&&z.emb.join()==='Golpes,Humedad'&&z.pro.join()==='OK'&&z.etq.join()==='No aplica'&&z.com==='Cajas mojadas'&&cal.general.clas==='obs',
   'Inspección guardada a nombre de MARIA con fecha: conforme con observaciones, reclamo, 2 de 10, golpes+humedad, comentario; general = con observaciones');
 const fc=JSON.parse(sql(`select fotos::text from cb_prov where id='${idP}'`)).filter(f=>f.tipo==='cal');
 check(fc.length===1&&fc[0].cod==='221317','Foto de calidad con su código');
 check(/codigo_no_existe/.test(rpc('cb_prov_calidad_guardar',{p_puesto:qId,p_ses:await qc.evaluate(()=>PST.ses),p_id:idP,p_cal:{codigos:{'999999':{clas:'no'}}},p_terminar:false}).body),'Servidor: rechaza códigos que no son de la recepción');
 check(/sin_permiso/.test(rpc('cb_prov_calidad_guardar',{p_puesto:bId,p_ses:await m.evaluate(()=>PST.ses),p_id:idP,p_cal:{codigos:{}},p_terminar:false}).body),'Servidor: bodega (sin permiso de calidad) no puede inspeccionar');
 // panel
 const cs=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago'});await route(cs);const s=await cs.newPage();s.on('pageerror',e=>errs.push('panel: '+e.message));
 await s.goto(B+'#panel');await s.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await s.goto(B+'#prov');await s.reload();await s.waitForTimeout(3000);await s.click(`#pvTbl [data-pv="${idP}"]`);await s.waitForTimeout(600);
 check(await s.isVisible('#pvCalCard')&&await s.evaluate(()=>{const a=document.querySelector('#pvDet').getBoundingClientRect(),b=document.querySelector('#pvCalCard').getBoundingClientRect();return b.top>=a.bottom-1&&!document.querySelector('#pvDet').contains(document.querySelector('#pvCal'))}),'Control de calidad en su propia tarjeta, debajo del cuadre (no mezclado)');
 const pc=await s.textContent('#pvCal');
 check(/Inspeccionada/.test(pc)&&/Conforme con observaciones/.test(pc)&&/Reclamo a proveedor/.test(pc)&&/MARIA/.test(pc)&&/2 de 10 \(20%\)/.test(pc)&&/Golpes, Humedad/.test(pc)&&/📷 1/.test(pc),'Panel: ficha de calidad por código, responsable y fotos');
 check(/2 pallets golpeados/.test(await s.textContent('#pvObs')),'Panel: observación de bodega');
 await s.fill('#pvObsTxt','Revisar con proveedor');await s.click('#pvObsOk');await s.waitForTimeout(1500);
 check(sql(`select obs_panel from cb_prov where id='${idP}'`)==='Revisar con proveedor','Panel: observación del supervisor guardada');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 await b.close();console.log(fail?'FALLAS: '+fail:'TODO OK')})();
