const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_mov; delete from cb_pt");
 // entrega con una lectura SIN conversión (catálogo viejo) y otra con conversión
 const mv=JSON.parse(rpc('cb_mov_crear',{p_clave:ADMIN,p_nombre:'Entrega X',p_vence:new Date(Date.now()+3600e3).toISOString(),p_items:[["221602","","Hex Gal 3/4","m"]],p_meta:{puestos:true}}).body);
 const e=JSON.parse(rpc('cb_mov_abrir',{p_id:mv.id,p_token:mv.token,p_device:'dE',p_rol:'E'}).body);rpc('cb_mov_enviar',{p_id:mv.id,p_rol:'E',p_secret:e.secret,p_persona:'FELIPE',p_lecturas:[{lid:'e1',code:'221602',k:'221602',qty:96,um:'un',t:new Date().toISOString()}]});
 const r=JSON.parse(rpc('cb_mov_abrir',{p_id:mv.id,p_token:mv.token,p_device:'dR',p_rol:'R'}).body);rpc('cb_mov_enviar',{p_id:mv.id,p_rol:'R',p_secret:r.secret,p_persona:'DAVID',p_lecturas:[{lid:'r1',code:'221602',k:'221602',qty:96,ce:'ROLLO',f:50,um:'m',t:new Date().toISOString()}]});
 sql(`insert into cb_pt(lid,puesto,pallet,data,t,lado) values ('p1','produccion','SN-p1','{"lid":"p1","sn":true,"code":"120262","k":"120262","qty":20,"um":"un","user":"D"}',now(),'E'),('p2','bodega','SN-p2','{"lid":"p2","sn":true,"code":"120262","k":"120262","qty":20,"ce":"ROLLO","f":25,"um":"m","user":"F"}',now(),'R')`);
 const b=await chromium.launch();const c=await b.newContext({viewport:{width:1366,height:900}});await route(c);const s=await c.newPage();const errs=[];s.on('pageerror',x=>errs.push(x.message));
 await s.goto(B+'#panel');await s.evaluate(([u,a,id])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}));localStorage.setItem('inv_movsel',JSON.stringify(id));
   localStorage.setItem('inv_fact',JSON.stringify({"221602":{ce:"ROLLO",f:50},"120262":{ce:"ROLLO",f:25}}));localStorage.setItem('inv_master',JSON.stringify({"221602":{um:"m",desc:"Hex"},"120262":{um:"m",desc:"Rombo"}}))},[SBU,ADMIN,mv.id]);
 await s.goto(B+'#mp');await s.reload();await s.waitForTimeout(3500);
 const row=(await s.textContent('#mpRes')).replace(/\s+/g,' ');console.log('MP',row.slice(0,300));
 check(/96 ROLLOS\s*= 4.800 m/.test(row)&&!/1,92/.test(row)&&/Cuadra/.test(row),'Entrega MP: la lectura sin conversión se lee como 96 ROLLOS = 4.800 m y cuadra (antes 1,92 rollos)');
 await s.goto(B+'#pt');await s.reload();await s.waitForTimeout(3000);
 const pt=(await s.textContent('#ptRes')).replace(/\s+/g,' ');console.log('PT',pt.slice(0,260));
 check(/20 ROLLOS/.test(pt)&&/Recibido OK/.test(pt),'Recepción PT: producción "20 un" sin conversión se lee 20 ROLLOS y cuadra con bodega');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
