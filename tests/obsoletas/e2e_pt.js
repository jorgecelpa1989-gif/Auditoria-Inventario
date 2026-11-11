const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
async function ctx(b,dev){const c=await b.newContext(dev||{...devices['iPhone 13']});await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});const p=await c.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));return [c,p]}
async function abrir(b,pu,nom){const t='tok-'+pu+'-pt-123456789';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:pu,p_token:t});const [c,p]=await ctx(b);await p.goto(`${B}?puesto=${pu}&t=${t}&u=${encodeURIComponent(SBU)}&k=anon`);await p.waitForTimeout(1600);await p.fill('#puPersona',nom);await p.dispatchEvent('#puPersona','change');await p.waitForTimeout(600);await p.tap('#puMenu [data-pk="pt"]');await p.waitForTimeout(1200);return p}
async function pallet(p,pal,cod,q,esperaDecl){await p.fill('#ptPallet',pal);await p.press('#ptPallet','Enter');await p.waitForTimeout(900);
  if(esperaDecl){const t=await p.textContent('#ptPalletInfo');return t}
  await p.fill('#ptScan',cod);await p.press('#ptScan','Enter');await p.waitForTimeout(300);await p.fill('#ptQty',String(q));await p.tap('#ptOk');await p.waitForTimeout(1500)}
(async()=>{const b=await chromium.launch();
 const pP=await abrir(b,'produccion','ANA');check(/Entrega de producto terminado/.test(await pP.textContent('#ptTitle')),'Producción: abre "Entrega de producto terminado"');
 await pallet(pP,'PAL-9','110107',10);
 check(sql("select lado||'|'||puesto from cb_pt where pallet='PAL-9'")==='E|produccion','Producción: el pallet queda con lado E (entrega)');
 const pB=await abrir(b,'bodega','JUAN');check(/Recepción de producto terminado/.test(await pB.textContent('#ptTitle')),'Bodega: abre "Recepción de producto terminado"');
 const info=await pallet(pB,'PAL-9',null,null,true);check(/Producción declaró 10/.test(info),'Bodega: al leer el pallet ve lo que declaró producción ("'+info.slice(0,60)+'")');
 await pB.tap('#ptOk');await pB.waitForTimeout(1500);
 check(sql("select lado from cb_pt where puesto='bodega'")==='R','Bodega: su registro queda con lado R (recibe)');
 const pR=await abrir(b,'retail','LUIS');check(/retiro para despacho/.test(await pR.textContent('#ptTitle')),'Retail: abre "retiro para despacho"');
 await pallet(pR,'PAL-10','120206',2);
 check(sql("select lado from cb_pt where puesto='retail'")==='D','Retail: su registro queda con lado D (retira)');
 // supervisor: panel PT sin cambios
 const [cS,pS]=await ctx(b,{viewport:{width:1366,height:900}});await pS.goto(B+'#panel');
 await pS.evaluate(([u,a])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await pS.goto(B+'#pt');await pS.reload();await pS.waitForTimeout(2500);
 const k=await pS.textContent('#ptKpis'),sides=await pS.textContent('#ptSides'),nk=(await pS.$$('#ptKpis .kpi')).length;
 check(nk===3&&/1 \/ 2\s*Pallets · entregados \/ recibidos/.test(k)&&/2\s*SKU/.test(k)&&/Unidades \(bultos\)/.test(k),'Supervisor: 3 indicadores (pallets 1/2, SKU 2, unidades) → '+k.replace(/\s+/g,' '));
 check(/Producción entrega/.test(sides)&&/ANA/.test(sides)&&/JUAN/.test(sides)&&/LUIS/.test(sides)&&await pS.$eval('#ptSides',e=>!!e.closest('.ptLeft')),'Supervisor: tarjetas de usuarios a la izquierda, con sus operarios');
 const th=await pS.$$eval('#ptRes thead th',x=>x.map(e=>e.textContent).join('|'));
 check(th==='Pallet|Código|Descripción|Unidades|Conversión|Pallet recibido|Recibido|Diferencia|Estado|Hora de captura'&&!(await pS.$('#ptSn'))&&!(await pS.$('#ptProd')),'Supervisor: una sola tabla con las columnas pedidas');
 const fila=(await pS.$$eval('#ptRes tbody tr',r=>r.map(x=>x.innerText.replace(/\s+/g,' ')))).find(r=>/PAL-9/.test(r))||'';
 check(/PAL-9.*110107.*10.*Bodega · JUAN.*Recibido OK.*Prod\./.test(fila),'Supervisor: fila PAL-9 con unidades, recibido por Bodega, estado y hora → '+fila.slice(0,120));
 await pS.screenshot({path:S+'/pt_sup.png'});
 const errs=[pP,pB,pR,pS].flatMap(p=>p.errs);check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
