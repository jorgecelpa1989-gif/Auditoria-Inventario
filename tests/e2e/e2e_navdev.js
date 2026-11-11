// Menú agrupado (LOGÍSTICA / PRODUCCIÓN) y aviso de devoluciones nuevas en el panel.
const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
const dev=(g,area)=>sql(`insert into cb_dev(origen,persona,guia,fecha,enviado,area,lect) values ('produccion','DAVID','${g}',current_date,now(),'${area}','[{"lid":"x","code":"110107","k":"110107","qty":1}]')`);
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_dev");dev('G-VIEJA','Producción');
 const b=await chromium.launch();const errs=[];
 const ca=await b.newContext({viewport:{width:1366,height:900}});await route(ca);const a=await ca.newPage();a.on('pageerror',x=>errs.push(x.message));
 await a.goto(B+'#panel');await a.evaluate(([u,k])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:k,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await a.goto(B+'#erp');await a.reload();await a.waitForTimeout(6000);
 const menu=await a.$$eval('#sideNav > *',els=>els.filter(e=>getComputedStyle(e).display!=='none').map(e=>e.textContent.replace(/\s+/g,' ').trim()).join(' | '));console.log('MENÚ',menu);
 check(/^Secciones \| 1Panel \| 2Permisos \| Logística \| 3Inventario \| 4Logística inversa\d* \| 5Recepción proveedores \| Producción \| 6Entrega MP\d* \| 7Recepción PT$/.test(menu),'Menú: Panel, Permisos, LOGÍSTICA (Inventario, Logística inversa, Proveedores), PRODUCCIÓN (Entrega MP, Recepción PT)');
 check(await a.isVisible('#nDev')&&(await a.textContent('#nDev'))==='1','Número rojo en Logística inversa: 1 devolución por recibir');
 const toasts=[];await a.exposeFunction('__t',t=>toasts.push(t));await a.evaluate(()=>{const o=window.toast;window.toast=(m,...x)=>{window.__t(String(m));return o(m,...x)}});
 dev('G-555','Producción');await a.waitForTimeout(33000);
 console.log('TOASTS',toasts);
 check(toasts.some(t=>/Nueva devolución de Producción \(DAVID\) · guía G-555/.test(t))&&!toasts.some(t=>/G-VIEJA/.test(t)),'Llega el aviso de la devolución nueva estando en otra sección (no avisa la antigua)');
 check((await a.textContent('#nDev'))==='2','El número sube a 2');
 // Supervisor solo de producción: no ve el título LOGÍSTICA vacío
 const id=JSON.parse(rpc('cb_sup_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'JEFE PROD',p_permisos:['mp_ver','pt_ver'],p_activo:true}).body);
 rpc('cb_sup_link',{p_clave:ADMIN,p_id:id,p_token:'tok-jefe-prod-xxxxxxxxxx'});const v=JSON.parse(rpc('cb_sup_vincular',{p_id:id,p_token:'tok-jefe-prod-xxxxxxxxxx',p_equipo:'PC'}).body);
 const cs=await b.newContext({viewport:{width:1366,height:900}});await route(cs);const s=await cs.newPage();s.on('pageerror',x=>errs.push(x.message));
 await s.goto(B+'#panel');await s.evaluate(([u,v])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:v.ses,ok:true}));localStorage.setItem('inv_sup',JSON.stringify(v));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc2'}))},[SBU,{id,ses:v.ses,nombre:v.nombre,permisos:v.permisos}]);
 await s.goto(B+'#mp');await s.reload();await s.waitForTimeout(4000);
 const ms=await s.$$eval('#sideNav > *',els=>els.filter(e=>getComputedStyle(e).display!=='none').map(e=>e.textContent.replace(/\s+/g,' ').trim()).join(' | '));console.log('MENÚ SUP',ms);
 check(/^Secciones \| Producción \| 6Entrega MP\d* \| 7Recepción PT$/.test(ms),'Supervisor de producción: solo PRODUCCIÓN, sin título LOGÍSTICA vacío');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
