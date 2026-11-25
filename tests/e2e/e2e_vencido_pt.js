// Un conteo vencido guardado en el celular solo bloquea la pantalla de conteo: Recepción PT (y los demás módulos) siguen funcionando.
const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_pt");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["230183","","M.Plas.Blanco 1,25x5","m","ROLLO",5]],p_stock:{},p_origen:'STOCK'});
 const uid=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'Felipe',p_area:'Bodega',p_permisos:['conteo','pt_recibir'],p_activo:true}).body);const tk='tok'+uid+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:uid,p_token:tk});
 const b=await chromium.launch();const c=await b.newContext({viewport:{width:412,height:900},timezoneId:'America/Santiago',isMobile:true,hasTouch:true});await route(c);const m=await c.newPage();const errs=[];m.on('pageerror',x=>errs.push(x.message));
 await m.goto(`${B}?puesto=${uid}&t=${tk}&u=${encodeURIComponent(SBU)}&k=anon`);await m.waitForTimeout(2000);await m.fill('#puPersona','FELIPE BURGOS');await m.dispatchEvent('#puPersona','change');await m.waitForTimeout(300);
 // conteo vencido anoche, guardado en el celular
 await m.evaluate(()=>{const e=JSON.parse(localStorage.getItem('inv_erp')||'null')||{file:'',items:[]};e.maestro=true;e.conteo={id:'00000000-0000-0000-0000-000000000001',nombre:'MALLAS 3D',vence:new Date(Date.now()-9*3600e3).toISOString()};localStorage.setItem('inv_erp',JSON.stringify(e))});
 await m.reload();await m.waitForTimeout(2500);
 check(await m.evaluate(()=>checkExpiry()&&document.body.classList.contains('expired')),'El conteo vencido sigue marcado como vencido (pantalla de conteo bloqueada)');
 await m.evaluate(()=>puestoMenu());await m.waitForTimeout(800);await m.click('#puMenu [data-pk="pt"]');await m.waitForTimeout(2500);
 check(await m.$eval('#v-ptcel .contarCard',e=>getComputedStyle(e).pointerEvents!=='none'&&getComputedStyle(e).opacity==='1'),'Recepción PT no queda gris ni bloqueada');
 await m.waitForTimeout(21000);   // pasa un ciclo de checkExpiry
 for(const q of ['60','12']){await m.tap('#ptScan');await m.keyboard.type('230183',{delay:40});await m.keyboard.press('Enter');await m.waitForTimeout(500);
   const foco=await m.evaluate(()=>document.activeElement&&document.activeElement.id);await m.tap('#ptQty');await m.keyboard.type(q,{delay:40});await m.tap('#ptOk');await m.waitForTimeout(2500);
   check(foco==='ptQty','Tras leer el código el cursor pasa a Cantidad (no se pierde)');}
 await m.waitForTimeout(21000);
 const f2=await m.evaluate(()=>{$("#ptScan").focus();return new Promise(r=>setTimeout(()=>{checkExpiry();r(document.activeElement&&document.activeElement.id)},100))});
 check(f2==='ptScan','checkExpiry no le quita el cursor a Recepción PT');
 {const n=sql("select count(*) from cb_pt");check(n==='2','2 pallets registrados con el conteo vencido guardado → '+n)}
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 await b.close();console.log(fail?'FALLAS: '+fail:'TODO OK');process.exit(fail?1:0)})();
