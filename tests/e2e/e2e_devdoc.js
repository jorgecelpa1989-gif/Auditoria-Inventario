const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
async function ctx(b,dev){const c=await b.newContext(dev||{...devices['iPhone 13']});await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});const p=await c.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));return [c,p]}
(async()=>{const b=await chromium.launch();rpc('cb_configurar',{p_clave:ADMIN});
 console.log('cat',rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["130101","","MALLA 1G 1,85 X 3 MTS","un"],["110107","","ROLLO ALAMBRE","kg"]],p_stock:null,p_origen:'test'}).body);
 const uid=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'Barbara',p_area:'Distribución',p_permisos:['dev_cargar'],p_activo:true}).body);const tok='tokbarbara1234567890ab';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:uid,p_token:tok});
 const [cD,p]=await ctx(b);await p.goto(`${B}?puesto=${encodeURIComponent(uid)}&t=${tok}&u=${encodeURIComponent(SBU)}&k=anon`);await p.waitForTimeout(2000);
 await p.fill('#puPersona','BARBARA');await p.dispatchEvent('#puPersona','change');await p.waitForTimeout(500);
 const nueva=async()=>{await p.tap('#puMenu [data-pk="dev"]').catch(()=>{});await p.waitForTimeout(800);await p.tap('#dvNew');await p.waitForTimeout(300);await p.fill('#dvScan','130101');await p.fill('#dvQty','1');await p.tap('#dvOk');await p.waitForTimeout(400)};
 const enviar=async()=>{await p.tap('#dvFin');await p.waitForTimeout(400);const y=await p.$('#cYes');if(y){await y.tap();await p.waitForTimeout(1800)}return !!y};
 // 1) sin guía ni factura: bloquea
 await nueva();const y0=await enviar();const t0=await p.textContent('#toast').catch(()=>'');
 check(!y0&&/guía o el N° de factura/.test(t0),'Sin guía ni factura: no deja enviar ("'+t0+'")');
 check(/basta con uno/.test(await p.textContent('#dvDoc')),'Formulario: aviso "N° de guía o N° de factura: basta con uno"');
 await p.screenshot({path:S+'/devdoc_form.png'});
 // 2) solo factura
 await p.fill('#dvFact','83533');await p.dispatchEvent('#dvFact','change');await p.waitForTimeout(300);
 check(await enviar(),'Solo factura: aparece la confirmación de envío');
 check(sql("select count(*) from cb_dev where enviado is not null and coalesce(guia,'')='' and factura='83533'")==='1','Solo factura: queda ENVIADA a bodega (guía vacía, factura 83533)');
 // 3) solo guía
 await nueva();await p.fill('#dvGuia','g-77');await p.dispatchEvent('#dvGuia','change');await p.waitForTimeout(300);await enviar();
 check(sql("select count(*) from cb_dev where enviado is not null and guia='G-77' and coalesce(factura,'')=''")==='1','Solo guía: queda ENVIADA a bodega (guía G-77, factura vacía)');
 // servidor
 const sesBad=rpc('cb_dev_crear_panel',{p_clave:ADMIN,p_area:'Clientes',p_doc:{guia:'',factura:'',fecha:'2026-11-06'},p_lect:[{code:'130101',k:'130101',qty:1}]}).body;check(/falta_documento/.test(sesBad),'Servidor: sin guía ni factura rechaza (falta_documento)');
 check(!/message/.test(rpc('cb_dev_crear_panel',{p_clave:ADMIN,p_area:'Clientes',p_doc:{guia:'',factura:'F-9',fecha:'2026-11-06'},p_lect:[{code:'130101',k:'130101',qty:1}]}).body),'Servidor (panel): solo factura se acepta');
 // panel
 const [cS,pS]=await ctx(b,{viewport:{width:1366,height:900}});await pS.goto(B+'#panel');
 await pS.evaluate(([u,a])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await pS.goto(B+'#devol');await pS.reload();await pS.waitForTimeout(2500);
 await pS.evaluate(()=>{const d=document.querySelector('#dpArea').closest('details');if(d)d.open=true});
 await pS.fill('#dpArea','Distribución');await pS.fill('#dpGuia','G-55');await pS.fill('#dpFact','');
 await pS.fill('#dpScan','130101').catch(()=>{});await pS.press('#dpScan','Enter').catch(()=>{});await pS.waitForTimeout(300);await pS.fill('#dpQty','2').catch(()=>{});await pS.click('#dpAdd').catch(()=>{});await pS.waitForTimeout(400);
 await pS.click('#dpSend');await pS.waitForTimeout(400);const yy=await pS.$('#cYes');if(yy){await yy.click();await pS.waitForTimeout(1800)}
 check(sql("select count(*) from cb_dev where origen='panel' and guia='G-55' and coalesce(factura,'')=''")==='1','Panel: devolución con solo guía se envía');
 const errs=[p,pS].flatMap(x=>x.errs);check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
