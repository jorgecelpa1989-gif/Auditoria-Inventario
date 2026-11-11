const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
async function ctx(b,dev){const c=await b.newContext(dev||{...devices['iPhone 13']});await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});const p=await c.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));return [c,p]}
(async()=>{const b=await chromium.launch();rpc('cb_configurar',{p_clave:ADMIN});const UCONT=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'Contador T',p_area:'Bodega',p_permisos:['conteo'],p_activo:true}).body);
 const [cS,pS]=await ctx(b,{viewport:{width:1366,height:900},deviceScaleFactor:2});await pS.goto(B+'#panel');
 await pS.evaluate(([u,a])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await pS.goto(B+'#erp');await pS.reload();await pS.waitForTimeout(1200);await pS.click('#btnDemo');await pS.waitForTimeout(800);
 await pS.click('#sideNav [data-v="resultado"]');await pS.waitForTimeout(1500);
 const codes=await pS.evaluate(()=>factItems().slice(0,4).map(i=>String(i.cod)));
 await pS.evaluate(c=>{const t=document.querySelector('#rotCodes');t.value=c.join('\n');t.dispatchEvent(new Event('input',{bubbles:true}))},codes.slice(0,2));
 await pS.waitForTimeout(1500);await pS.selectOption('#cPuesto',UCONT);await pS.fill('#cNombre','Conteo pasillo 1');await pS.click('#btnCrear');await pS.waitForTimeout(2500);
 const c0=await pS.evaluate(()=>conteos[0]);check(c0&&c0.productos===2,'Conteo creado con 2 productos');
 const [cP,pP]=await ctx(b);await pP.goto(c0.link.replace(/^https?:\/\/[^/]+\/[^?]*/,B));await pP.waitForTimeout(2500);
 check(await pP.evaluate(()=>erp.items.length)===2,'Celular: abre el conteo con 2 productos');
 await pP.fill('#scan',codes[0]);await pP.fill('#qty','3');await pP.tap('#btnAdd');await pP.waitForTimeout(2500);
 check(await pP.evaluate(()=>scans.length)===1,'Celular: registra 1 lectura antes de la modificación');
 await pS.waitForTimeout(500);await pS.evaluate(()=>{renderConteos();refreshNube(true)});await pS.waitForTimeout(1500);
 check(await pS.isVisible('#edCard'),'Inventario: aparece el cuadro "Modificar conteo"');
 check((await pS.inputValue('#edNom'))==='Conteo pasillo 1','Modificar conteo: trae el nombre actual');
 await pS.fill('#edNom','Conteo pasillo 1 y 2');
 await pS.fill('#edCodes',[codes[1],codes[2],codes[3],'ZZZ999'].join('\n'));await pS.waitForTimeout(300);
 const info=await pS.textContent('#edRes');check(/2 nuevos/.test(info)&&/1 ya estaba/.test(info)&&/1 no está en el ERP: ZZZ999/.test(info),'Vista previa: '+info);
 await pS.screenshot({path:S+'/ed_card.png',clip:await pS.evaluate(()=>{const r=document.querySelector('#edCard').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height}})});
 await pS.click('#btnEd');await pS.waitForTimeout(2000);
 const db=sql(`select nombre||'|'||jsonb_array_length(items)||'|'||(editado is not null) from cb_conteos where id='${c0.id}'`);check(db==='Conteo pasillo 1 y 2|4|true','Base de datos: nombre nuevo y 4 productos ('+db+')');
 check(await pS.evaluate(id=>{const c=conteos.find(x=>x.id===id);return c.nombre==='Conteo pasillo 1 y 2'&&c.productos===4&&c.codes.length===4},c0.id),'Panel: el conteo local queda con nombre y códigos nuevos');
 // reintento con los mismos códigos: no duplica
 await pS.fill('#edCodes',codes[2]);await pS.click('#btnEd');await pS.waitForTimeout(1200);
 check(sql(`select jsonb_array_length(items) from cb_conteos where id='${c0.id}'`)==='4','Repetir un código no lo duplica');
 // celular: latido trae los cambios
 await pP.evaluate(()=>latido());await pP.waitForTimeout(1500);
 const ph=await pP.evaluate(c=>({n:erp.items.length,nom:erp.conteo.nombre,f:!!findItem(c),sc:scans.length,t:document.body.innerText}),codes[3]);
 check(ph.n===4&&ph.nom==='Conteo pasillo 1 y 2','Celular: recibe 4 productos y el nombre nuevo sin recargar');
 check(ph.f,'Celular: el código agregado ya se reconoce (sin alerta de "no existe")');
 check(ph.sc===1,'Celular: conserva la lectura que ya tenía');
 check(/actualizó el conteo: \+2 productos/.test(ph.t),'Celular: aviso "El supervisor actualizó el conteo: +2 productos"');
 await pP.screenshot({path:S+'/ed_cel.png'});
 // segundo latido sin cambios: no vuelve a pedir
 const before=await pP.evaluate(()=>erp.conteo.editado);await pP.evaluate(()=>latido());await pP.waitForTimeout(800);check(await pP.evaluate(()=>erp.conteo.editado)===before,'Celular: sin cambios nuevos no vuelve a descargar');
 // conteo finalizado no se puede editar
 rpc('cb_finalizar',{p_clave:ADMIN,p_id:c0.id});check(/finalizado/.test(rpc('cb_conteo_editar',{p_clave:ADMIN,p_id:c0.id,p_nombre:'x',p_items:[]}).body),'Servidor: un conteo finalizado no se modifica');
 check(/clave_supervisor/.test(rpc('cb_conteo_editar',{p_clave:'mala',p_id:c0.id,p_nombre:'x',p_items:[]}).body),'Servidor: sin clave de supervisor no se modifica');
 // Entrega MP vencida: extender
 const mv=JSON.parse(rpc('cb_mov_crear',{p_clave:ADMIN,p_nombre:'Entrega OT-9',p_vence:new Date(Date.now()+3600e3).toISOString(),p_items:[["140101","","SACO HARINA 25KG","KG","SACO",25]],p_meta:{sol:[["140101",4]],ref:"OT-9"}}).body);
 sql(`update cb_mov set vence=now()-interval '1 hour' where id='${mv.id}'`);
 await pS.evaluate(id=>localStorage.setItem('inv_movsel',JSON.stringify(id)),mv.id);await pS.goto(B+'#mp');await pS.reload();await pS.waitForTimeout(3000);
 check(/Vencida/.test(await pS.textContent('#mpAct'))&&await pS.isVisible('#btnExt'),'Entrega MP vencida: muestra aviso y botón "Extender vigencia"');
 await pS.screenshot({path:S+'/ext_mp.png',clip:await pS.evaluate(()=>{const r=document.querySelector('#mpCard').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:Math.min(r.height,420)}})});
 await pS.selectOption('#extVence','4');await pS.click('#btnExt');await pS.waitForTimeout(1500);
 const vh=sql(`select round(extract(epoch from vence-now())/3600) from cb_mov where id='${mv.id}'`);check(vh==='4','Extender: la entrega vence en 4 h más ('+vh+' h)');
 check(!/Vencida/.test(await pS.textContent('#mpAct')),'Extender: deja de mostrarse como vencida');
 check(/datos_invalidos/.test(rpc('cb_mov_extender',{p_clave:ADMIN,p_id:mv.id,p_vence:new Date(Date.now()-60e3).toISOString()}).body),'Servidor: no acepta una fecha pasada');
 const errs=[pP,pS].flatMap(p=>p.errs);check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
