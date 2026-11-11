const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
// Caso real 09-11: retail retiró 140 rollos de 221666, pero producción lo registró con otro código.
// Se agrega la entrega de producción desde el detalle de la fila y queda cuadrado. Además: columna
// "Entregado", horas de todos los registros, y el N° de pallet oculto en el celular.
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_pt");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["221666","","Hex Gal 1 BWG","m","ROLLO",3],["221673","","Hex Gal 3/4","m","ROLLO",10]],p_stock:null,p_origen:'t'});
 const ins=(lid,puesto,lado,k,qty,h,user)=>sql(`with x as (select (date_trunc('day', now() at time zone 'America/Santiago') - interval '1 day' + interval '${h} minute') at time zone 'America/Santiago' t)
   insert into cb_pt(lid,puesto,pallet,data,t,lado) select '${lid}','${puesto}','SN-${lid}',jsonb_build_object('lid','${lid}','sn',true,'k','${k}','code','${k}','desc','Prod ${k}','qty',${qty},'um','m','ce','ROLLO','f',${k==='221666'?3:10},'pallet','SN-${lid}','user','${user}','t',to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),t,'${lado}' from x`);
 ins('p1','produccion','E','221673',50,9*60,'DAVID');ins('p2','produccion','E','221673',50,10*60+30,'DAVID');ins('b1','bodega','R','221673',50,11*60,'FELIPE');ins('b2','bodega','R','221673',50,12*60+15,'FELIPE');
 ins('r1','retail','D','221666',140,11*60+2,'BARBARA');
 const b=await chromium.launch();const c=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago'});
 await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const s=await c.newPage();const errs=[];s.on('pageerror',e=>errs.push(e.message));await s.goto(B+'#panel');
 await s.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}));
   localStorage.setItem('inv_erp',JSON.stringify({file:'stock.txt',at:new Date().toISOString(),items:[{cod:'221666',ean:'',desc:'Hex Gal 1 BWG',um:'m',stock:0},{cod:'221673',ean:'',desc:'Hex Gal 3/4',um:'m',stock:0}]}));
   localStorage.setItem('inv_fact',JSON.stringify({"221666":{ce:"ROLLO",f:3},"221673":{ce:"ROLLO",f:10}}))},[SBU,ADMIN]);
 await s.goto(B+'#pt');await s.reload();await s.waitForTimeout(2500);await s.selectOption('#ptDesde','d1');await s.waitForTimeout(1500);
 check(/Entregado/.test(await s.textContent('#ptRes thead'))&&!/Unidades/.test(await s.textContent('#ptRes thead')),'Columna "Unidades" ahora dice "Entregado"');
 const k0=await s.textContent('#ptKpis');check(/^2 \/ 3/.test(k0),'Antes: 2 pallets entregados / 3 recibidos (falta la entrega de 221666) → '+k0.slice(0,8));
 const fila=async cod=>s.$eval(`#ptRes [data-ptsn="${cod}"]`,b=>b.closest('tr').innerText);
 let f73=await fila('221673');check(/Prod\. 09:00 · 10:30/.test(f73)&&/Recep\. 11:00 · 12:15/.test(f73),'Hora de captura en filas "Sin N°": todas las horas de producción y de recepción → '+f73.split('\n').filter(x=>/Prod|Recep/.test(x)).join(' | '));
 check(/Sin registro de producción/.test(await fila('221666')),'221666: "Sin registro de producción" (retail retiró 140 rollos)');
 await s.click('#ptRes [data-ptsn="221666"]');await s.waitForTimeout(400);
 check((await s.$$('#ptRes .ptSnDet [data-ptadd]')).length===3,'El detalle de la fila ofrece "＋ Agregar entrega de producción / recepción / retiro"');
 await s.click('#ptRes .ptSnDet [data-ptadd^="E|"]');await s.waitForTimeout(600);
 check(await s.isVisible('#ptAddPanel')&&(await s.inputValue('#ptAdL'))==='E'&&(await s.inputValue('#ptAdCod'))==='221666'&&/rollos/i.test(await s.textContent('#ptAdQL')),'Abre "Agregar registro" con Producción entrega, código 221666 y cantidad en rollos');
 check(/09-11|día/.test(await s.textContent('#ptAddTit')),'Indica el día en que queda: '+(await s.textContent('#ptAddTit')));
 await s.fill('#ptAdQty','140');await s.fill('#ptAdHora','10:55');await s.click('#ptAdOk');await s.waitForTimeout(2500);
 check(sql("select lado||'|'||(data->>'qty')||'|'||(data->>'sn')||'|'||to_char(t at time zone 'America/Santiago','HH24:MI')||'|'||(data->'manual'->>'via') from cb_pt where data->>'k'='221666' and lado='E'")==='E|140|true|10:55|panel','Queda guardado: entrega de producción, 140 rollos, sin número, 10:55, marcado "a mano (panel)"');
 const k1=await s.textContent('#ptKpis');check(/^3 \/ 3/.test(k1),'Después: 3 / 3 pallets → '+k1.slice(0,8));
 check(/Recibido OK/.test(await fila('221666'))&&/Prod\. 10:55/.test(await fila('221666'))&&/Recep\. 11:02/.test(await fila('221666')),'221666 queda "Recibido OK", con las dos horas');
 await s.screenshot({path:S+'/pt_agregar.png'});
 // Celular: N° de pallet oculto
 const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
 const [dId,dT]=usr('David PT','Producción',['pt_entregar']);
 const cm=await b.newContext({...devices['iPhone 13'],timezoneId:'America/Santiago'});await cm.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const m=await cm.newPage();m.on('pageerror',e=>errs.push('cel: '+e.message));
 await m.goto(`${B}?puesto=${dId}&t=${dT}&u=${encodeURIComponent(SBU)}&k=anon`);await m.waitForTimeout(2000);await m.fill('#puPersona','DAVID');await m.dispatchEvent('#puPersona','change');await m.waitForTimeout(400);
 await m.tap('#puMenu [data-pk="pt"]');await m.waitForTimeout(2000);
 check(await m.isHidden('#ptPallet')&&(await m.textContent('#ptProdEb'))==='1 · Producto'&&(await m.textContent('#ptQtyEb'))==='2 · Cantidad'&&await m.isHidden('#ptAddPal'),'Celular: sin campo "N° de pallet"; pasos "1 · Producto" y "2 · Cantidad"');
 await m.fill('#ptScan','221666');await m.press('#ptScan','Enter');await m.waitForTimeout(400);await m.fill('#ptQty','7');await m.tap('#ptOk');await m.waitForTimeout(2500);
 check(sql("select (data->>'sn')||'|'||(data->>'qty') from cb_pt where data->>'k'='221666' and lado='E' and data->>'qty'='7'")==='true|7','Celular: registra el pallet sin número (7 rollos)');
 check(await m.evaluate(()=>document.activeElement&&document.activeElement.id)==='ptScan','Después de registrar, el cursor queda en Producto (no en N° de pallet)');
 await m.screenshot({path:S+'/pt_cel_sin_pallet.png'});
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();