const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
// Entrega MP igual que Recepción PT: menú de días y "＋ Agregar registro" con Quién (bodega entrega / producción recibe).
// Entrega MP: «✎ Modificar» un registro desde el panel (0 = anular) y el celular no lo pisa al volver a enviar.
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_mov; delete from cb_puesto; delete from cb_acceso");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["221317","","Mos.Gal 14","m","ROLLO",90],["110107","","ALAMBRE","kg"]],p_stock:null,p_origen:'t'});
 const r=JSON.parse(rpc('cb_mov_crear',{p_clave:ADMIN,p_nombre:'Solicitud corregir',p_vence:new Date(Date.now()+864e5).toISOString(),p_items:[],p_meta:{sol:[["221317",900,"Mos.Gal 14","m","ROLLO",90]],por:'JEFE'}}).body),id=r.id;
 sql(`insert into cb_mov_lado(mov,rol,device,secret_hash,persona) values ('${id}','E','dE',extensions.crypt('sec-E',extensions.gen_salt('bf')),'FELIPE')`);
 const env=(arr)=>rpc('cb_mov_enviar',{p_id:id,p_rol:'E',p_secret:'sec-E',p_persona:'FELIPE',p_lecturas:arr});
 const L=[{lid:'e1',code:'221317',k:'221317',qty:10,ce:'ROLLO',f:90,um:'m',user:'FELIPE',t:new Date().toISOString()},{lid:'e2',code:'110107',k:'110107',qty:5,um:'kg',user:'FELIPE',t:new Date().toISOString()}];
 env(L);
 const b=await chromium.launch();const errs=[];const cs=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago'});await route(cs);const s=await cs.newPage();s.on('pageerror',e=>errs.push(e.message));
 await s.goto(B+'#panel');await s.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}));localStorage.setItem('inv_fact',JSON.stringify({"221317":{ce:"ROLLO",f:90}}))},[SBU,ADMIN]);
 await s.goto(B+'#mp');await s.reload();await s.waitForTimeout(3500);
 await s.click('#mpDetBox summary');await s.waitForTimeout(300);
 check((await s.$$('#mpDet [data-mped]')).length===2,'Detalle de lecturas: cada registro tiene «✎ Modificar»');
 s.once('dialog',d=>d.accept('8'));await s.click('#mpDet [data-mped="E|e1"]');await s.waitForTimeout(2500);
 const q1=sql(`select (data->>'qty')||'|'||jsonb_array_length(data->'ed') from cb_mov_lect where mov='${id}' and lid='e1'`);
 check(q1==='8|1','Modificar: 10 → 8 rollos, queda el historial → '+q1);
 check(/10 → 8/.test(await s.textContent('#mpDet')),'El detalle muestra «✎ 10 → 8»');
 s.on('dialog',d=>d.accept(d.type()==='prompt'?'0':undefined));await s.click('#mpDet [data-mped="E|e2"]');await s.waitForTimeout(2500);
 check(sql(`select data->>'qty' from cb_mov_lect where mov='${id}' and lid='e2'`)==='0','Escribir 0 anula el registro (queda en 0, no se borra)');
 env(L);   // el celular vuelve a mandar su lista original
 check(sql(`select string_agg(lid||'='||(data->>'qty'),',' order by lid) from cb_mov_lect where mov='${id}'`)==='e1=8,e2=0','El celular vuelve a enviar: lo corregido en el panel se mantiene (no se pisa)');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
