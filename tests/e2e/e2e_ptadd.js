const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});const UCONT=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'Contador T',p_area:'Bodega',p_permisos:['conteo'],p_activo:true}).body);sql("delete from cb_pt");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["221673","","Hex Gal 3/4","m","ROLLO",10],["110107","","ALAMBRE","kg"]],p_stock:null,p_origen:'t'});
 const b=await chromium.launch();const errs=[];
 // ---- 1. Crear conteo con ERP guardado ----
 const cs=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago'});await route(cs);const s=await cs.newPage();s.on('pageerror',e=>errs.push(e.message));
 await s.goto(B+'#panel');await s.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}));
   localStorage.setItem('inv_fact',JSON.stringify({"221673":{ce:"ROLLO",f:10}}));
   localStorage.setItem('inv_erp',JSON.stringify({file:'stock.txt',at:new Date().toISOString(),items:[{cod:'221673',ean:'',desc:'Hex Gal 3/4',um:'m',stock:500},{cod:'110107',ean:'',desc:'ALAMBRE',um:'kg',stock:30}]}))},[SBU,ADMIN]);
 await s.goto(B+'#resultado');await s.reload();await s.waitForTimeout(2500);
 check(await s.isVisible('#maestroCard'),'Inventario: "Crear conteo" visible al recargar la página (usa el ERP guardado)');
 await s.waitForTimeout(1500);await s.selectOption('#cPuesto',UCONT);await s.fill('#cNombre','Conteo tras recargar');await s.click('#btnCrear');await s.waitForTimeout(2500);
 check(sql("select jsonb_array_length(items) from cb_conteos where nombre='Conteo tras recargar'")==='2','Crear conteo: se crea con los 2 productos del ERP guardado');
 // ---- 2. Celular de bodega: agregar pallet en día anterior ----
 const [bId,bT]=usr('Felipe','Bodega',['pt_recibir']);
 const cp=await b.newContext({...devices['iPhone 13'],timezoneId:'America/Santiago'});await route(cp);const p=await cp.newPage();p.on('pageerror',e=>errs.push(e.message));
 await p.goto(`${B}?puesto=${bId}&t=${bT}&u=${encodeURIComponent(SBU)}&k=anon`);await p.waitForTimeout(2000);await p.fill('#puPersona','FELIPE');await p.dispatchEvent('#puPersona','change');await p.waitForTimeout(400);
 await p.tap('#puMenu [data-pk="pt"]');await p.waitForTimeout(1500);await p.selectOption('#ptPrevDia',{index:2});await p.waitForTimeout(1200);
 check(await p.isVisible('#ptAddBox'),'Celular: aparece "＋ Agregar un pallet que faltó ese día"');
 await p.evaluate(()=>document.querySelector('#ptAddBox').open=true);await p.fill('#ptAddCod','221673');await p.waitForTimeout(200);
 check(/Hex Gal 3\/4/.test(await p.textContent('#ptAddInfo'))&&/rollos/.test(await p.textContent('#ptAddInfo')),'Celular: reconoce el producto y pide la cantidad en rollos');
 await p.fill('#ptAddQty','25');await p.fill('#ptAddHora','15:30');await p.tap('#ptAddOk');await p.waitForTimeout(2000);
 const r1=sql(`select lado||'|'||(data->>'qty')||'|'||(data->'manual'->>'via')||'|'||to_char(t at time zone 'America/Santiago','HH24:MI')||'|'||((t at time zone 'America/Santiago')::date=(now() at time zone 'America/Santiago')::date-1) from cb_pt where puesto='${bId}'`);
 check(r1==='R|25|celular|15:30|true','Celular: pallet agregado AYER a las 15:30, lado bodega, marcado a mano → '+r1);
 check(/Hex Gal/.test(await p.textContent('#ptPrevList')),'Celular: aparece en la lista de ese día');
 await p.screenshot({path:S+'/ptadd_cel.png'});
 // ---- 3. Panel: agregar registro de producción ayer ----
 await s.goto(B+'#pt');await s.reload();await s.waitForTimeout(2500);await s.selectOption('#ptDesde','d1');await s.waitForTimeout(1200);
 await s.click('#ptAddTog');await s.selectOption('#ptAdL','E');await s.fill('#ptAdCod','221673');await s.fill('#ptAdQty','25');await s.fill('#ptAdHora','09:00');
 check(/rollos/.test(await s.textContent('#ptAdQL'))&&/día \d\d-\d\d-\d{4}/.test(await s.textContent('#ptAddTit')),'Panel: formulario indica el día elegido y la unidad (rollos)');
 await s.screenshot({path:S+'/ptadd_panel.png',clip:await s.evaluate(()=>{const r=document.querySelector('#ptAddPanel').getBoundingClientRect();return {x:r.x-10,y:r.y+scrollY-10,width:r.width+20,height:r.height+20}})});
 await s.click('#ptAdOk');await s.waitForTimeout(2500);
 const r2=sql(`select lado||'|'||(data->>'qty')||'|'||(data->'manual'->>'via')||'|'||to_char(t at time zone 'America/Santiago','HH24:MI') from cb_pt where puesto='panel_prod'`);
 check(r2==='E|25|panel|09:00','Panel: registro de producción agregado ayer 09:00 → '+r2);
 check(/Recibido OK/.test(await s.textContent('#ptRes')),'Panel: la fila de ayer se cuadra (25 entregados = 25 recibidos → Recibido OK)');
 check(/fecha_invalida/.test(rpc('cb_pt_agregar_panel',{p_clave:ADMIN,p_dia:'2099-01-01',p_hora:'10:00',p_lado:'R',p_data:{code:'x',qty:1}}).body),'Servidor: no acepta fechas futuras');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
