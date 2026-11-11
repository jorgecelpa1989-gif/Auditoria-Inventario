// Equivalencia solo en el PC del administrador (ERP traído de Supabase): se sube a la nube y el supervisor ve igual que el admin.
const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_pt");
 // nube: 120125 sin unidad ni conversión (como en producción); 120262 con conversión
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["120125","","ROMBO PLAST. 5012 2,0 X 25 MTS.HEAVY DUTY",""],["120262","","ROMBO STANDARD 1,2X25 MTS","ML","ROLLO",25]],p_stock:{"120125":[7,9]},p_origen:'STOCK 11-11.TXT'});
 sql(`insert into cb_pt(lid,puesto,pallet,data,t,lado) values ('e1','produccion','SN-e1','{"lid":"e1","sn":true,"code":"120125","k":"120125","qty":10,"um":"ML","ce":"ROLLO","f":25,"user":"Supervisor"}',now(),'E'),
   ('r1','bodega','SN-r1','{"lid":"r1","sn":true,"code":"120125","k":"120125","qty":10,"um":"un","user":"FELIPE BURGOS"}',now(),'R')`);
 const b=await chromium.launch();const errs=[];
 // 1) Admin: ERP traído de Supabase + equivalencia local del 120125
 const ca=await b.newContext({viewport:{width:1366,height:900}});await route(ca);const a=await ca.newPage();a.on('pageerror',x=>errs.push(x.message));
 await a.goto(B+'#panel');await a.evaluate(([u,k])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:k,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}));
   localStorage.setItem('inv_fact',JSON.stringify({"120125":{ce:"ROLLO",f:25},"120262":{ce:"ROLLO",f:25}}));localStorage.setItem('inv_master',JSON.stringify({"120125":{um:"ML",desc:"ROMBO"}}));
   localStorage.setItem('inv_erp',JSON.stringify({file:"ERP en Supabase",fromServer:true,items:[{cod:"120125",ean:"",desc:"ROMBO PLAST",um:""},{cod:"120262",ean:"",desc:"ROMBO STANDARD",um:"ML"}]}))},[SBU,ADMIN]);
 await a.goto(B+'#pt');await a.reload();await a.waitForTimeout(5000);
 const cat=sql(`select i::text from cb_catalogo, jsonb_array_elements(items) i where i->>0='120125'`);
 check(cat==='["120125", "", "ROMBO PLAST. 5012 2,0 X 25 MTS.HEAVY DUTY", "ML", "ROLLO", 25]','La equivalencia del 120125 (1 ROLLO = 25 m) sube a Supabase → '+cat);
 check(sql(`select (stock->'120125')::text||'|'||origen||'|'||jsonb_array_length(items) from cb_catalogo`)==='[7, 9]|STOCK 11-11.TXT|2','No toca el stock, el origen ni la cantidad de productos');
 const pa=(await a.textContent('#ptRes')).replace(/\s+/g,' ');
 // 2) Supervisor (sin equivalencias en su navegador): ve lo mismo que el admin
 const id=JSON.parse(rpc('cb_sup_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'CAMILA',p_permisos:['pt_ver','mp_ver','dev_ver'],p_activo:true}).body);
 rpc('cb_sup_link',{p_clave:ADMIN,p_id:id,p_token:'tok-camila-xxxxxxxxxxxx'});const v=JSON.parse(rpc('cb_sup_vincular',{p_id:id,p_token:'tok-camila-xxxxxxxxxxxx',p_equipo:'PC'}).body);
 const cs=await b.newContext({viewport:{width:1366,height:900}});await route(cs);const s=await cs.newPage();s.on('pageerror',x=>errs.push(x.message));
 await s.goto(B+'#panel');await s.evaluate(([u,v])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:v.ses,ok:true}));localStorage.setItem('inv_sup',JSON.stringify(v));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc2'}))},[SBU,{id,ses:v.ses,nombre:v.nombre,permisos:v.permisos}]);
 await s.goto(B+'#pt');await s.reload();await s.waitForTimeout(4000);
 const ps=(await s.textContent('#ptRes')).replace(/\s+/g,' ');console.log('ADMIN',pa.slice(0,200));console.log('SUP  ',ps.slice(0,200));
 check(/10 ROLLOS/.test(ps)&&/Recibido OK/.test(ps)&&!/0,4/.test(ps),'Supervisor: 120125 se ve 10 ROLLOS = 250 m y cuadra (antes 10 un / 0,4 rollos)');
 check(/250 m/.test(ps)&&/250 m/.test(pa),'Admin y supervisor muestran la misma conversión (250 m)');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
