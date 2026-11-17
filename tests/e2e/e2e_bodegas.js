const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
// Panel 1: stock de hasta 3 bodegas; el conteo elige bodega y contador; Resultados compara contra su bodega; Entrega MP usa el stock de la Bodega 3.
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_conteos");
 const uid=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'Pedro Conteo',p_area:'Bodega',p_permisos:['conteo'],p_activo:true}).body);
 const b=await chromium.launch();const c=await b.newContext({viewport:{width:1366,height:900}});
 await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.goto(B+'#panel');
 await p.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await p.goto(B+'#erp');await p.reload();await p.waitForTimeout(1500);
 check((await p.$$('#bodBar [data-bod]')).length===3,'Panel 1: 3 botones de bodega');
 // Bodega 1: informe de ejemplo
 await p.click('#bodBar [data-bod="1"]');await p.setInputFiles('#fileErp',__dirname+'/../datos/Ejemplo_informe_ERP.xlsx');await p.waitForTimeout(1000);
 // Bodega 3: otro informe con 2 productos y otro stock
 const x3=await p.evaluate(()=>{const ws=XLSX.utils.aoa_to_sheet([["Código","Descripción","Saldo","U.M."],["000123","ACEITE VEGETAL 1LT",7,"UN"],["999001","PRODUCTO SOLO B3",5,"UN"]]);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Stock");return XLSX.write(wb,{type:'base64',bookType:'xlsx'})});
 require('fs').writeFileSync(S+'/b3.xlsx',Buffer.from(x3,'base64'));
 await p.click('#bodBar [data-bod="3"]');await p.setInputFiles('#fileErp',S+'/b3.xlsx');await p.waitForTimeout(1000);
 const eb=await p.evaluate(()=>({b1:(erpB["1"]||{}).items&&erpB["1"].items.length,b3:(erpB["3"]||{}).items&&erpB["3"].items.length,b2:!!erpB["2"],act:erp.bod,s123:findItem("000123").stock}));
 check(eb.b1>10&&eb.b3===2&&!eb.b2&&eb.act==="3"&&eb.s123===7,'Cada informe queda en su bodega (B1 '+eb.b1+' productos, B3 2) y el activo es la B3 (000123 = 7)');
 check(/✓/.test(await p.textContent('#bodBar [data-bod="1"]'))&&/✓/.test(await p.textContent('#bodBar [data-bod="3"]'))&&!/✓/.test(await p.textContent('#bodBar [data-bod="2"]')),'Los botones marcan ✓ las bodegas cargadas');
 // catálogo en Supabase: productos de todas; stock solo de la Bodega 3
 await p.evaluate(()=>catSync(true));await p.waitForTimeout(1500);
 const cat=JSON.parse(sql("select json_build_object('n',jsonb_array_length(items),'st',stock,'or',origen)::text from cb_catalogo where id=1"));
 check(cat.n>eb.b1&&Object.keys(cat.st||{}).length===2&&cat.st['000123'][1]===7&&/Bodega 3/.test(cat.or),'Supabase: catálogo con productos de todas las bodegas; stock de Entrega MP = Bodega 3 ('+JSON.stringify(cat.st)+')');
 // crear conteo de la Bodega 1 para Pedro
 await p.click('#sideNav [data-v="resultado"]');await p.waitForTimeout(2000);
 await p.selectOption('#cBod','1');await p.waitForTimeout(500);
 check(await p.evaluate(()=>erp.bod==="1"&&findItem("000123").stock!==7),'Elegir «Bodega a contar: 1» activa el stock de la Bodega 1');
 await p.selectOption('#cPuesto',uid);await p.fill('#cNombre','Inventario B1');await p.click('#btnCrear');await p.waitForTimeout(2500);
 const meta=sql("select meta->>'bodega' from cb_conteos where nombre='Inventario B1'");
 check(meta==='1'&&sql("select puesto from cb_conteos where nombre='Inventario B1'")===uid,'El conteo guarda bodega 1 y contador Pedro');
 // Resultados de ese conteo: si el activo es la B3, vuelve solo a la B1
 await p.evaluate(()=>bodUsar("3",true));const id=sql("select id from cb_conteos where nombre='Inventario B1'");
 await p.evaluate(i=>{rSel=i;renderResult()},id);await p.waitForTimeout(500);
 check(await p.evaluate(()=>erp.bod==="1"),'Resultados del conteo de la Bodega 1 comparan contra el stock de la Bodega 1 (aunque el activo fuera la 3)');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
