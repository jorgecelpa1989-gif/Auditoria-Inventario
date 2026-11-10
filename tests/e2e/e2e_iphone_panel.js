const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_conteos; delete from cb_pt");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["221317","","Mos.Gal 14","m","ROLLO",90],["110107","","ALAMBRE","kg"]],p_stock:{"221317":[900,900],"110107":[30,30]},p_origen:'stock 09-11.txt'});
 const a=JSON.parse(rpc('cb_crear',{p_clave:ADMIN,p_nombre:'Conteo iPhone',p_vence:new Date(Date.now()+3600e3).toISOString(),p_items:[["221317","","Mos.Gal 14","m","ROLLO",90],["110107","","ALAMBRE","kg"]],p_meta:null}).body);
 const o=JSON.parse(rpc('cb_abrir',{p_id:a.id,p_token:a.token,p_device:'d'}).body);rpc('cb_enviar',{p_id:a.id,p_secret:o.secret,p_contador:'FELIPE',p_lecturas:[{lid:'l1',code:'221317',k:'221317',qty:9,ce:'ROLLO',f:90,um:'m',t:new Date().toISOString()}]});
 sql(`insert into cb_pt(lid,puesto,pallet,data,t,lado) values ('p1','produccion','SN-p1','{"lid":"p1","sn":true,"code":"221317","k":"221317","qty":5,"ce":"ROLLO","f":90,"um":"m","user":"D","desc":"Mos.Gal 14 con un nombre largo de prueba"}',now(),'E')`);
 const b=await chromium.launch();const c=await b.newContext({...devices['iPhone 13']});
 await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 // iPhone recién configurado: solo la conexión (sin archivo del ERP)
 await p.goto(B+'#panel');await p.evaluate(([u,ad])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:ad,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'iph'}))},[SBU,ADMIN]);
 await p.goto(B+'#resultado');await p.reload();await p.waitForTimeout(5000);
 const e=await p.evaluate(()=>erp&&[erp.fromServer,erp.items.length,erp.items[0].stock].join('|'));check(e==='true|2|900','iPhone sin archivo: usa el ERP de Supabase (2 productos, stock 900) → '+e);
 const k=(await p.textContent('#kpis')).replace(/\s+/g,' ');check(/1 \/ 2\s*SKU/.test(k),'Inventario en iPhone: indicadores con el stock → '+k.slice(0,90));
 const res=(await p.textContent('#res')).replace(/\s+/g,' ');check(/221317/.test(res)&&/900/.test(res)&&/810/.test(res),'Resumen por producto: Sistema 900 m vs Contado 810 m (9 rollos)');
 check(sql("select origen from cb_catalogo")==='stock 09-11.txt','El iPhone no vuelve a subir el catálogo (origen intacto)');
 await p.goto(B+'#pt');await p.reload();await p.waitForTimeout(3000);
 const w=await p.evaluate(()=>{const m=document.querySelector('.ptMain');return [Math.round(m.getBoundingClientRect().right),innerWidth]});check(w[0]<=w[1],'Recepción PT en iPhone: no se sale de la pantalla ('+w.join(' ≤ ')+')');
 await p.screenshot({path:S+'/iph_pt2.png'});
 for(const v of ['erp','mp','resultado','pt','devol','permisos']){await p.goto(B+'#'+v);await p.reload();await p.waitForTimeout(1500);const o2=await p.evaluate(()=>[...document.querySelectorAll('section.view:not([hidden]) .card')].filter(x=>x.getBoundingClientRect().right>innerWidth+1).length);if(o2)console.log('  desborde en',v,o2)}
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
