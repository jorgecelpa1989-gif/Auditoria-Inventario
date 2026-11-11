const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
async function ctx(b,dev){const c=await b.newContext(dev||{...devices['iPhone 13']});await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});const p=await c.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));return [c,p]}
const menu=p=>p.$$eval('#puMenu .puBtn b',x=>x.map(e=>e.textContent));
(async()=>{const b=await chromium.launch();
 const [cS,pS]=await ctx(b,{viewport:{width:1366,height:900},deviceScaleFactor:2});await pS.goto(B+'#panel');
 const cr=JSON.parse(rpc('cb_crear',{p_clave:ADMIN,p_nombre:'Conteo pasillo 3',p_vence:new Date(Date.now()+3*3600e3).toISOString(),p_items:[["110107","","ROLLO","KG","",1]],p_meta:null}).body);
 await pS.evaluate(([u,a,id])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc',appUrl:'http://localhost:8811/index.html'}));localStorage.setItem('inv_conteos',JSON.stringify([{id,nube:true,nombre:'Conteo pasillo 3',creado:new Date().toISOString(),productos:1,link:'x'}]))},[SBU,ADMIN,cr.id]);
 await pS.goto(B+'#permisos');await pS.reload();await pS.waitForTimeout(1800);
 const lista=await pS.textContent('#puAdmBox');
 check(/Celular de Bodega/.test(lista)&&/Celular de Producción/.test(lista)&&/Celular de Distribución/.test(lista)&&/Celular de Picking retail/.test(lista),'Permisos: los 4 celulares fijos aparecen como usuarios');
 check(/Entrega MP/.test(lista)&&/Recepciona devoluciones/.test(lista),'Permisos: cada usuario muestra sus permisos');
 // crear usuario
  await pS.fill('#uNom','PEDRO SOTO');await pS.fill('#uArea','Compras');
 await pS.check('#uP_conteo');await pS.check('input[name="uPt"][value="pt_recibir"]');await pS.check('#uP_dev_recibir');
 await pS.screenshot({path:S+'/u_editor.png'});
 await pS.click('#uSave');await pS.waitForTimeout(1800);
 const uid=sql("select id from cb_puesto where nombre='PEDRO SOTO'");
 check(/^u_[0-9a-f]{10}$/.test(uid)&&sql(`select permisos::text||'|'||area from cb_puesto where id='${uid}'`)==='{conteo,dev_recibir,pt_recibir}|Compras','Crear usuario: queda en Supabase con área y permisos');
 const link=await pS.inputValue('#ul-'+uid).catch(()=> '');
 check(/\?puesto=u_/.test(link)&&await pS.isVisible(`[data-ucp="${uid}"]`),'Crear usuario: muestra su link con WhatsApp y Copiar');
 await pS.screenshot({path:S+'/u_lista.png'});
 // editar producción: quitar devoluciones
 await pS.click('[data-ued="produccion"]');await pS.waitForTimeout(200);await pS.uncheck('#uP_dev_cargar');await pS.click('#uSave');await pS.waitForTimeout(1500);
 check(sql("select permisos::text from cb_puesto where id='produccion'")==='{mp_recibir,pt_entregar}','Editar: a Producción se le quita "Carga devoluciones"');
 // asignar conteo desde el Panel
 await pS.goto(B+'#permisos');await pS.reload();await pS.waitForTimeout(2500);
 const opts=await pS.$$eval('#lbBox select[data-lba] option',o=>o.map(x=>x.textContent));
 check(opts.some(t=>/PEDRO SOTO/.test(t))&&opts.some(t=>/Celular de Bodega/.test(t))&&!opts.some(t=>/Producción/.test(t)),'Permisos: el conteo se asigna eligiendo entre los usuarios con permiso de conteo ('+opts.join(' | ')+')');
 await pS.selectOption('#lbBox select[data-lba]',uid);await pS.waitForTimeout(1500);
 check(sql(`select puesto from cb_conteos where id='${cr.id}'`)===uid,'Permisos: conteo asignado a PEDRO SOTO');
 // Pedro en su celular
 const [cP,pP]=await ctx(b);await pP.goto(link);await pP.waitForTimeout(1800);await pP.fill('#puPersona','PEDRO');await pP.dispatchEvent('#puPersona','change');await pP.waitForTimeout(800);
 let m=await menu(pP);
 check(m.length===3&&m.some(t=>/Recepción de producto terminado/.test(t))&&m.some(t=>/Conteo de inventario/.test(t))&&m.some(t=>/Recepcionar devoluciones/.test(t)),'Pedro: su menú muestra solo lo que tiene permiso → '+m.join(' | '));
 check(/1 conteo asignado/.test(await pP.textContent('#puMenu'))&&/PEDRO SOTO/.test(await pP.textContent('#puHead')),'Pedro: ve el conteo asignado y su nombre de usuario');
 await pP.screenshot({path:S+'/u_pedro.png'});
 // supervisor cambia permisos → le llega a Pedro
 await pS.goto(B+'#permisos');await pS.reload();await pS.waitForTimeout(1500);
 await pS.click(`[data-ued="${uid}"]`);await pS.waitForTimeout(200);await pS.uncheck('#uP_conteo');await pS.check('#uP_dev_cargar');await pS.click('#uSave');await pS.waitForTimeout(1500);
 await pP.evaluate(()=>puRefresh());await pP.waitForTimeout(1200);m=await menu(pP);
 check(!m.some(t=>/Conteo/.test(t))&&m.some(t=>/Cargar devolución · Compras/.test(t)),'Pedro: el cambio de permisos le llega solo → '+m.join(' | '));
 // un segundo equipo no puede usar el mismo link
 const [c2,p2]=await ctx(b);await p2.goto(link);await p2.waitForTimeout(1500);
 check(/ya se abrió en otro celular/i.test(await p2.textContent('#lockBox')),'Otro equipo con el mismo link: bloqueado (un equipo a la vez)');
 // desactivar
 await pS.click(`[data-lbk="${uid}"]`);await pS.click('#cYes');await pS.waitForTimeout(1500);
 await pP.evaluate(()=>puRefresh());await pP.waitForTimeout(1200);
 check(/desactivado/i.test(await pP.textContent('#lockBox')),'Desactivar: el celular de Pedro queda bloqueado con "Usuario desactivado"');
 await pS.click(`[data-lbk="${uid}"]`);await pS.waitForTimeout(1500);
 // nuevo acceso: el equipo anterior queda fuera; el link nuevo abre en otro equipo
 await pS.click(`[data-uln="${uid}"]`);await pS.click('#cYes');await pS.waitForTimeout(1800);
 const link2=await pS.inputValue('#ul-'+uid).catch(()=> '');
 check(link2&&link2!==link,'Nuevo acceso: se genera un link distinto');
 await p2.goto(link2);await p2.waitForTimeout(1800);
 check(await p2.isVisible('#puMenu .puBtn'),'Nuevo acceso: el link nuevo abre en el equipo nuevo');
 await pP.evaluate(()=>puRefresh());await pP.waitForTimeout(1200);
 check(/desconectado/i.test(await pP.textContent('#lockBox')),'Nuevo acceso: el equipo anterior queda desconectado');
 // producción ya no tiene devoluciones
 const sp=JSON.parse(rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:'produccion',p_token:'tok-produccion-NUEVO-123'}).body||'null');
 const [cX,pX]=await ctx(b);await pX.goto(`${B}?puesto=produccion&t=tok-produccion-NUEVO-123&u=${encodeURIComponent(SBU)}&k=anon`);await pX.waitForTimeout(1800);
 m=await menu(pX);check(m.length===2&&!m.some(t=>/devolución/i.test(t)),'Producción: su menú ya no tiene devoluciones → '+m.join(' | '));
 // eliminar
 await pS.click(`[data-udl="${uid}"]`);await pS.click('#cYes');await pS.waitForTimeout(1500);
 check(sql(`select count(*) from cb_puesto where id='${uid}'`)==='0'&&sql(`select coalesce(puesto,'-') from cb_conteos where id='${cr.id}'`)==='-','Eliminar: el usuario se borra y su conteo queda sin asignar');
 const errs=[pS,pP,p2,pX].flatMap(p=>p.errs);check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
