const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
async function ctx(b,dev){const c=await b.newContext(dev||{...devices['iPhone 13']});await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});const p=await c.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));return [c,p]}
(async()=>{const b=await chromium.launch();
 console.log('cfg',rpc('cb_configurar',{p_clave:ADMIN}).body.slice(0,60));
 const uid=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'Pedro Conteo',p_area:'Bodega',p_permisos:['conteo'],p_activo:true}).body);
 const tok='tokpedro1234567890abcdef';console.log('link',rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:uid,p_token:tok}).body);
 // celular de Pedro abierto ANTES de crear el conteo
 const [cP,pP]=await ctx(b);await pP.goto(`${B}?puesto=${encodeURIComponent(uid)}&t=${tok}&u=${encodeURIComponent(SBU)}&k=anon`);await pP.waitForTimeout(2500);
 const m0=await pP.textContent('#puMenu').catch(()=>'');check(/Sin conteos asignados/.test(m0),'Celular de Pedro: al inicio "Sin conteos asignados"');
 // PC supervisor
 const [cS,pS]=await ctx(b,{viewport:{width:1366,height:900},deviceScaleFactor:2});await pS.goto(B+'#panel');
 await pS.evaluate(([u,a])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await pS.goto(B+'#erp');await pS.reload();await pS.waitForTimeout(1200);await pS.click('#btnDemo');await pS.waitForTimeout(800);
 await pS.click('#sideNav [data-v="resultado"]');await pS.waitForTimeout(2500);
 check(!(await pS.$('#maestroCard h2'))&&!/No lleva stock ni costos/.test(await pS.textContent('#maestroCard')),'Crear conteo: se quitó el título y el texto explicativo');
 check(await pS.isVisible('#cPuWrap'),'Crear conteo: aparece "Asignar conteo a" (abriendo Inventario directo)');
 const ord=await pS.evaluate(()=>{const r=document.querySelector('#rotBox'),w=document.querySelector('#cPuWrap'),k=document.querySelector('#btnCrear');return r.getBoundingClientRect().bottom<=w.getBoundingClientRect().top&&w.getBoundingClientRect().bottom<=k.getBoundingClientRect().top});
 check(ord,'Crear conteo: el selector queda bajo "Conteo rotativo" y sobre el botón OK');
 const ops=await pS.$$eval('#cPuesto option',o=>o.map(x=>x.textContent));check(ops.some(t=>/Pedro Conteo/.test(t))&&!ops.some(t=>/A nadie/.test(t)),'Selector lista a los usuarios con permiso de conteo → '+ops.join(' | '));
 await pS.selectOption('#cPuesto',uid);await pS.fill('#cNombre','Conteo asignado prueba');
 await pS.screenshot({path:S+'/asig_form.png',clip:await pS.evaluate(()=>{const r=document.querySelector('#maestroCard').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height}})});
 await pS.click('#btnCrear');await pS.waitForTimeout(2500);
 const res=await pS.textContent('#crearRes');check(/Enviado a Pedro Conteo/.test(res)&&!/Ir a 6/.test(res),'Al crear: confirma "Asignado a Pedro Conteo"');
 const db=sql(`select puesto from cb_conteos where nombre='Conteo asignado prueba'`);check(db===uid,'Base de datos: el conteo quedó con puesto = '+db);
 await pS.screenshot({path:S+'/asig_ok.png',clip:await pS.evaluate(()=>{const r=document.querySelector('#maestroCard').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height}})});
 // el celular abierto lo recibe solo (consulta cada 20 s)
 let toastSeen=false;const t0=Date.now();while(Date.now()-t0<26000){const t=await pP.evaluate(()=>document.body.innerText);if(/tarea nueva/i.test(t)){toastSeen=true;break}await pP.waitForTimeout(500)}
 check(toastSeen,'Celular de Pedro: aviso "Tienes una tarea nueva" sin recargar ('+Math.round((Date.now()-t0)/1000)+' s)');
 await pP.waitForTimeout(800);const m1=await pP.textContent('#puMenu');check(/1 conteo asignado/.test(m1),'Celular de Pedro: el menú muestra "1 conteo asignado"');
 await pP.screenshot({path:S+'/asig_cel.png'});
 // crear sin asignar: ahora se bloquea (todo va asignado)
 await pS.selectOption('#cPuesto','');await pS.fill('#cNombre','Conteo sin asignar');await pS.click('#btnCrear');await pS.waitForTimeout(1200);
 check(sql(`select count(*) from cb_conteos where nombre='Conteo sin asignar'`)==='0','Crear sin asignar: se bloquea (hay que elegir a quién)');
 const errs=[pP,pS].flatMap(p=>p.errs);check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
