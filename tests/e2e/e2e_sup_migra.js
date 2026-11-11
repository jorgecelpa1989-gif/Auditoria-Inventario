const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
// Un supervisor que abrió su link con la versión anterior (v14) sigue entrando con la versión nueva, sin link nuevo.
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_sup");
 const id=JSON.parse(rpc('cb_sup_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'Supervisor Prod. 1',p_permisos:['mp_ver','mp_solicitar','pt_ver','dev_ver','dev_crear'],p_activo:true}).body);
 rpc('cb_sup_link',{p_clave:ADMIN,p_id:id,p_token:'tok-migracion-xxxxxxxxxx'});
 const v=JSON.parse(rpc('cb_sup_vincular',{p_id:id,p_token:'tok-migracion-xxxxxxxxxx',p_equipo:'PC'}).body);
 const b=await chromium.launch();const errs=[];const c=await b.newContext({viewport:{width:1366,height:900}});await route(c);const p=await c.newPage();p.on('pageerror',e=>errs.push(e.message));
 await p.goto(B);
 // así dejaba el navegador la v14:
 await p.evaluate(([u,v,id])=>{localStorage.clear();localStorage.setItem('inv_prod',JSON.stringify({url:u,key:'anon',tok:id+':tok-migracion-xxxxxxxxxx',ses:v.ses,sup:{id,nombre:v.nombre,permisos:v.permisos}}))},[SBU,v,id]);
 await p.goto(B+'#mp');await p.reload();await p.waitForTimeout(3500);
 const tabs=await p.$$eval('nav.tabs button',bs=>bs.filter(x=>x.offsetParent!==null).map(x=>x.dataset.v).join(','));
 check(tabs==='devol,mp,pt'&&/Supervisor Prod\. 1/.test(await p.textContent('#supChip')),'Sesión de la v14: entra directo con la versión nueva, mismo menú → '+tabs);
 check(await p.evaluate(()=>localStorage.inv_prod==='null'&&!!JSON.parse(localStorage.inv_sup).ses),'La sesión quedó guardada en el formato nuevo');
 check(await p.isVisible('#solCard')&&await p.isHidden('#lockBox .lockCard').catch(()=>true),'Puede seguir solicitando MP; sin pantalla de bloqueo');
 await p.reload();await p.waitForTimeout(3000);
 check((await p.$$eval('nav.tabs button',bs=>bs.filter(x=>x.offsetParent!==null).length))===3,'Al recargar sigue dentro');
 // un navegador de ADMINISTRADOR no se convierte en supervisor al abrir un link de supervisor
 rpc('cb_sup_link',{p_clave:ADMIN,p_id:id,p_token:'tok-otro-xxxxxxxxxxxxxxx'});
 const ca=await b.newContext({viewport:{width:1366,height:900}});await route(ca);const a=await ca.newPage();await a.goto(B+'#panel');
 await a.evaluate(([u,k])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:k,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await a.goto(`${B}?sup=${id}&t=tok-otro-xxxxxxxxxxxxxxx&u=${encodeURIComponent(SBU)}&k=anon`);await a.waitForTimeout(2500);
 check(/ventana privada/.test(await a.textContent('#lockBox'))&&await a.evaluate(k=>JSON.parse(localStorage.inv_sb).admin===k,ADMIN)&&sql(`select usado is null from cb_sup where id='${id}'`)==='t','Navegador de administrador + link de supervisor: avisa, NO pisa la clave del administrador y NO gasta el link');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();