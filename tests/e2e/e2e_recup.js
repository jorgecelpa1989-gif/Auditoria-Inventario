const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_conteos");
 const v=new Date(Date.now()+3*3600e3).toISOString();
 const a=JSON.parse(rpc('cb_crear',{p_clave:ADMIN,p_nombre:'Conteo 05-11-2026',p_vence:v,p_items:[["000123","","PROD A","UN"],["000124","","PROD B","UN"]],p_meta:{rotativo:true}}).body);
 const o=JSON.parse(rpc('cb_abrir',{p_id:a.id,p_token:a.token,p_device:'dev1'}).body);
 rpc('cb_enviar',{p_id:a.id,p_secret:o.secret,p_contador:'FELIPE',p_lecturas:[{lid:'l1',code:'000123',k:'000123',qty:4,t:new Date().toISOString(),user:'FELIPE'}]});
 rpc('cb_finalizar',{p_clave:ADMIN,p_id:a.id});
 const r=JSON.parse(rpc('cb_crear',{p_clave:ADMIN,p_nombre:'Reconteo · Conteo 05-11-2026',p_vence:v,p_items:[["000124","","PROD B","UN"]],p_meta:{rotativo:true,reconteo_de:a.id}}).body);
 const b=await chromium.launch();const c=await b.newContext({viewport:{width:1366,height:900}});
 await c.route(SBU+'/rest/v1/rpc/*',async rr=>{const fn=rr.request().url().split('/').pop();const x=rpc(fn,JSON.parse(rr.request().postData()||'{}'));await rr.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.goto(B+'#panel');
 // PC "nuevo": sin lista local de conteos (como en la dirección nueva)
 await p.evaluate(([u,ad])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:ad,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await p.goto(B+'#panel');await p.reload();await p.waitForTimeout(1500);await p.click('#btnDemo');await p.waitForTimeout(800);
 await p.click('#sideNav [data-v="resultado"]');await p.waitForTimeout(4000);
 const loc=await p.evaluate(()=>conteos.map(c=>c.nombre+'|'+(c.codes||[]).join(',')+'|'+(c.reconteoDe?'re':'')));console.log('LOCAL',loc.join(' ; '));
 check(loc.some(x=>x==='Conteo 05-11-2026|000123,000124|')&&loc.some(x=>x==='Reconteo · Conteo 05-11-2026|000124|re'),'PC nuevo: recupera desde Supabase los 2 conteos, con sus códigos y la relación de reconteo');
 const grp=await p.$$eval('#rSel optgroup',g=>g.map(x=>x.label+':'+[...x.children].map(o=>o.textContent.split(' · ')[0]).join(',')));console.log('GRP',grp.join(' | '));
 check(grp.some(x=>/^Finalizados:Conteo 05-11-2026/.test(x)),'Ver resultados de: aparece "Conteo 05-11-2026" en Finalizados');
 await p.selectOption('#rSel',a.id);await p.waitForTimeout(2500);
 const det=await p.textContent('#det');check(/000123/.test(det)&&/FELIPE/.test(det),'Resultado del conteo recuperado: trae sus lecturas (000123 · FELIPE)');
 const k=await p.$$eval('#kpis .kpi',x=>x.map(e=>e.innerText.replace(/\s+/g,' ')));console.log('KPI',k.join(' | '));
 check(/\/ 2 SKU contados/.test(k[0])||/ 2 SKU/.test(k[0]),'Resumen: el total de SKU es el del conteo (2), no todo el ERP');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
