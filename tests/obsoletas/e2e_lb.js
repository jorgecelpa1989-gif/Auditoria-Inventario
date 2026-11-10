const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
async function ctx(b,dev){const c=await b.newContext(dev||{...devices['iPhone 13']});await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});const p=await c.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));return [c,p]}
(async()=>{const b=await chromium.launch();
 for(const p of ['bodega','produccion','retail'])rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:p,p_token:'tok-'+p+'-lb-123456789'});
 const cr=JSON.parse(rpc('cb_crear',{p_clave:ADMIN,p_nombre:'Conteo bodega A',p_vence:new Date(Date.now()+3*3600e3).toISOString(),p_items:[["110107","","ROLLO","KG","",1]],p_meta:null}).body);
 const clink=`${B}?nube=${cr.id}.${cr.token}&u=${encodeURIComponent(SBU)}&k=anon`;
 const [c1,p1]=await ctx(b);await p1.goto(clink);await p1.waitForTimeout(1500);
 const [cS,pS]=await ctx(b,{viewport:{width:1366,height:900},deviceScaleFactor:2,acceptDownloads:true});await pS.goto(B+'#panel');
 await pS.evaluate(([u,a])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc',appUrl:'http://localhost:8811/index.html'}))},[SBU,ADMIN]);
 await pS.goto(B+'#erp');await pS.reload();await pS.waitForTimeout(1500);
 check(!(await pS.$('#conteosTbl')),'Panel: ya no está el cuadro "Conteos creados"');
 await pS.goto(B+'#permisos');await pS.reload();await pS.waitForTimeout(2500);
 const ord=await pS.evaluate(()=>[...document.querySelectorAll('#v-permisos > .card, #v-permisos > details')].map(e=>e.id||(e.querySelector('h2')||{}).textContent||'').join(' > '));
 check(/uEdCard > puAdm > lbCard > sbCard > ghCard > supAdm > mpAcc/.test(ord),'Permisos: orden Crear usuario > Usuarios > Liberar/bloquear > Supabase > GitHub > Supervisores de área > Acceso producción ('+ord+')');
 check(await pS.isVisible('#uNom')&&!(await pS.$('#uNew')),'Permisos: el formulario de usuario nuevo está arriba, siempre visible');
 const lb=await pS.textContent('#lbBox');check(/Conteo bodega A/.test(lb)&&/En uso/.test(lb),'Liberar/bloquear: muestra el link de conteo "En uso"');
 await pS.screenshot({path:S+'/lb_permisos.png',fullPage:true});
 // bloquear conteo
 await pS.click(`[data-lbb="${cr.id}"]`);await pS.click('#cYes');await pS.waitForTimeout(1800);
 check(/Bloqueado/.test(await pS.textContent('#lbBox')),'Bloquear: el conteo queda "Bloqueado"');
 const [c2,p2]=await ctx(b);await p2.goto(clink);await p2.waitForTimeout(1500);
 check(/bloqueó este link/.test(await p2.textContent('#lockBox')),'Bloquear: otro celular ve "El supervisor bloqueó este link"');
 await p1.fill('#scan','110107');await p1.fill('#qty','3');await p1.tap('#btnAdd');await p1.waitForTimeout(2500);
 check(sql(`select count(*) from cb_lecturas where conteo='${cr.id}'`)==='0','Bloquear: el celular que lo tenía ya no puede enviar');
 await pS.click(`[data-lbb="${cr.id}"]`);await pS.waitForTimeout(1800);
 await p2.goto(clink);await p2.waitForTimeout(1500);
 check(await p2.isVisible('#scan')&&!(await p2.evaluate(()=>document.body.classList.contains('locked'))),'Desbloquear: el link vuelve a abrir');
 // usuario: liberar equipo
 const [c3,p3]=await ctx(b);await p3.goto(`${B}?puesto=bodega&t=tok-bodega-lb-123456789&u=${encodeURIComponent(SBU)}&k=anon`);await p3.waitForTimeout(1500);
 await pS.click('#lbRef');await pS.waitForTimeout(2000);
 await pS.click('[data-lbu="bodega"]');await pS.click('#cYes');await pS.waitForTimeout(1800);
 const [c4,p4]=await ctx(b);await p4.goto(`${B}?puesto=bodega&t=tok-bodega-lb-123456789&u=${encodeURIComponent(SBU)}&k=anon`);await p4.waitForTimeout(1800);
 check(await p4.isVisible('#puMenu .puBtn'),'Liberar equipo: el mismo link de bodega abre en un equipo nuevo');
 // usuario: bloquear
 await pS.click('#lbRef');await pS.waitForTimeout(1500);await pS.click('[data-lbk="retail"]');await pS.click('#cYes');await pS.waitForTimeout(1500);
 check(sql("select activo from cb_puesto where id='retail'")==='f','Bloquear usuario: retail queda bloqueado (desactivado)');
 // MP: bloquear un lado
 const mv=JSON.parse(rpc('cb_mov_crear',{p_clave:ADMIN,p_nombre:'Entrega OT-55',p_vence:new Date(Date.now()+3*3600e3).toISOString(),p_items:[["110107","","ROLLO","KG","",1]],p_meta:null}).body);
 await pS.click('#lbRef');await pS.waitForTimeout(2200);
 await pS.click(`[data-lbmb="${mv.id}|R|1"]`);await pS.click('#cYes');await pS.waitForTimeout(1800);
 check(rpc('cb_mov_abrir',{p_id:mv.id,p_token:mv.token,p_device:'x',p_rol:'R'}).body.includes('bloqueado'),'Entrega MP: el lado "quien recibe" queda bloqueado');
 // devolución desde el panel
 await pS.goto(B+'#devol');await pS.reload();await pS.waitForTimeout(2000);
 check(await pS.isVisible('#dpGuia'),'Logística inversa: aparece el formulario "Nueva devolución desde el panel"');
 await pS.fill('#dpArea','Clientes');await pS.fill('#dpPers','JORGE');await pS.fill('#dpGuia','gp-1');await pS.fill('#dpFact','fp-1');
 await pS.fill('#dpScan','140101');await pS.press('#dpScan','Enter');await pS.waitForTimeout(300);
 check(/SACOS/.test(await pS.textContent('#dpHint'))&&/Cantidad \(sacos\)/.test(await pS.textContent('#dpQtyL')),'Panel: al leer el producto indica que se ingresa en SACOS (1 SACO = 25)');
 await pS.fill('#dpQty','3');await pS.click('#dpAdd');await pS.waitForTimeout(200);
 check(/3\s*SACOS/.test(await pS.textContent('#dpList'))&&/= 75 kg/.test(await pS.textContent('#dpList')),'Panel: la línea muestra 3 SACOS = 75 kg');
 await pS.fill('#dpScan','77777');await pS.press('#dpScan','Enter');await pS.waitForTimeout(300);
 check(await pS.isVisible('#calert')&&!(await pS.$('#caKeep')),'Panel: código fuera del maestro bloqueado');await pS.click('#caFix');
 await pS.screenshot({path:S+'/dp_form.png'});
 await pS.click('#dpSend');await pS.click('#cYes');await pS.waitForTimeout(1800);
 check(sql("select origen||'|'||area||'|'||guia||'|'||(enviado is not null) from cb_dev")==='panel|Clientes|GP-1|true','Panel: devolución enviada a bodega (origen panel, área Clientes, guía GP-1)');
 await pS.click('#dvChips [data-f="pend"]');await pS.click('#dvTbl [data-di]');await pS.waitForTimeout(400);
 check(/3\s*SACOS/.test(await pS.textContent('#dvCmp'))&&/= 75 kg/.test(await pS.textContent('#dvCmp')),'Cuadre de devoluciones: muestra bultos y conversión (3 SACOS = 75 kg)');
 // solo en Permisos
 await pS.goto(B+'#erp');await pS.waitForTimeout(500);
 await pS.evaluate(()=>showCreated({id:'x',nube:true,nombre:'Conteo nuevo',productos:3,vence:new Date(Date.now()+3e6).toISOString(),link:'http://x'}));
 check(!(await pS.$('#crearRes a'))&&!(await pS.$('#btnCopyLink'))&&!!(await pS.$('#crearRes [data-irperm]'))&&/6 · Permisos/.test(await pS.textContent('#crearRes')),'Panel: al crear un conteo no hay WhatsApp/Copiar; indica ir a 6 · Permisos');
 await pS.evaluate(()=>document.querySelector('#crearRes [data-irperm]').click());await pS.waitForTimeout(600);
 check(await pS.isVisible('#v-permisos')&&await pS.isVisible('#lbCard'),'Panel: el botón lleva a Permisos → Liberar o bloquear');
 check(await pS.$$eval('#cPuWrap',e=>e.every(x=>x.hidden)),'Panel: ya no se asigna el conteo al crearlo (se hace en Permisos)');
 await pS.goto(B+'#mp');await pS.waitForTimeout(800);
 check(!(await pS.$('[data-ml]')),'Entrega MP: ya no tiene botón "Liberar celular" (está en Permisos)');
 await pS.goto(B+'#permisos');await pS.waitForTimeout(800);
 check(!(await pS.$('#puAdmBox [data-uac]'))&&(await pS.$$('#lbBox [data-lbk]')).length>0,'Usuarios: bloquear/desbloquear solo en "Liberar o bloquear"');
 const errs=[p1,p2,p3,p4,pS].flatMap(p=>p.errs);check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
