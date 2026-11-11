const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
(async()=>{const b=await chromium.launch();rpc('cb_configurar',{p_clave:ADMIN});
 const c=await b.newContext({viewport:{width:1366,height:900}});await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.goto(B+'#panel');
 await p.evaluate(([u,a])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 const mk=(nom,recibe,term)=>{const mv=JSON.parse(rpc('cb_mov_crear',{p_clave:ADMIN,p_nombre:nom,p_vence:new Date(Date.now()+3600e3).toISOString(),p_items:[["230125","","ROLLO","un","",1]],p_meta:{sol:[["230125",3]]}}).body);
  const e=JSON.parse(rpc('cb_mov_abrir',{p_id:mv.id,p_token:mv.token,p_device:'dE'+nom,p_rol:'E'}).body);
  rpc('cb_mov_enviar',{p_id:mv.id,p_rol:'E',p_secret:e.secret,p_persona:'FELIPE',p_lecturas:[{lid:'e1'+nom,code:'230125',k:'230125',qty:3,um:'un',t:new Date().toISOString()}]});
  if(recibe){const r=JSON.parse(rpc('cb_mov_abrir',{p_id:mv.id,p_token:mv.token,p_device:'dR'+nom,p_rol:'R'}).body);
   rpc('cb_mov_enviar',{p_id:mv.id,p_rol:'R',p_secret:r.secret,p_persona:'DAVID',p_lecturas:[{lid:'r1'+nom,code:'230125',k:'230125',qty:3,um:'un',t:new Date().toISOString()}]});
   if(term)console.log('term',rpc('cb_mov_terminar',{p_id:mv.id,p_rol:'R',p_secret:r.secret}).body)}
  sql(`delete from cb_mov_lado where mov='${mv.id}' and rol='E'`);sql(`update cb_mov set vence=now()-interval '1 hour' where id='${mv.id}'`);return mv.id};
 const ok=mk('Completa',true,true), pend=mk('Sin recibir',false,false);
 const ver=async id=>{await p.evaluate(id=>localStorage.setItem('inv_movsel',JSON.stringify(id)),id);await p.goto(B+'#mp');await p.reload();await p.waitForTimeout(3500);return p.textContent('#mpAct')};
 let t=await ver(ok);check(/Proceso completo/.test(t)&&!/Vencida/.test(t)&&!(await p.$('#btnExt')),'Entrega con solicitado = entregado = recibido y recepción terminada: muestra "✓ Proceso completo", sin alerta de vencida');
 await p.screenshot({path:S+'/mp_completa.png',clip:await p.evaluate(()=>{const r=document.querySelector('#mpCard').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:300}})});
 await p.click('#btnFinMov');await p.waitForTimeout(1500);check(sql(`select (finalizado is not null) from cb_mov where id='${ok}'`)==='t','"Cerrar entrega" la deja finalizada');
 t=await ver(pend);check(/Vencida/.test(t)&&!!(await p.$('#btnExt')),'Entrega vencida sin recibir: sigue mostrando "Vencida" con Extender vigencia');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
