// Recepción PT: un registro antiguo "10 un" (sin conversión) no deja toda la fila en "un"; y el admin en un PC sin equivalencias usa el catálogo de Supabase.
const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_pt");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["120125","","ROMBO PLAST. 5012","ML","ROLLO",25],["120262","","ROMBO STANDARD","ML","ROLLO",25]],p_stock:{},p_origen:'STOCK'});
 const ins=(lid,pu,lado,min,data)=>sql(`insert into cb_pt(lid,puesto,pallet,data,t,lado) values ('${lid}','${pu}','SN-${lid}','${JSON.stringify(Object.assign({lid,sn:true,code:data.k,user:'X'},data))}',now()-interval '${min} minutes','${lado}')`);
 ins('r0','bodega','R',300,{k:'120125',qty:10,um:'un'});                       // registro antiguo sin conversión, el primero de la fila
 ins('e1','produccion','E',60,{k:'120125',qty:10,um:'m',ce:'ROLLO',f:25});ins('e2','produccion','E',59,{k:'120125',qty:10,um:'m',ce:'ROLLO',f:25});
 ins('r1','bodega','R',40,{k:'120125',qty:10,um:'m',ce:'ROLLO',f:25});
 ins('e3','produccion','E',30,{k:'120262',qty:4,um:'un'});ins('r3','bodega','R',20,{k:'120262',qty:4,um:'un'});   // SKU sin ningún registro con conversión: la toma de Supabase
 const b=await chromium.launch();const errs=[];const c=await b.newContext({viewport:{width:1366,height:900}});await route(c);const a=await c.newPage();a.on('pageerror',x=>errs.push(x.message));
 await a.goto(B+'#panel');await a.evaluate(([u,k])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:k,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);   // PC SIN equivalencias guardadas
 await a.goto(B+'#pt');await a.reload();await a.waitForTimeout(4500);
 const t=(await a.textContent('#ptRes')).replace(/\s+/g,' ');console.log('PT',t.slice(0,400));
 check(/20 ROLLOS/.test(t)&&/500 m/.test(t)&&/Recibido OK/.test(t)&&!/500 un/.test(t)&&!/260/.test(t),'120125: entregado 20 ROLLOS = 500 m, recibido 10 un antiguo + 10 rollos = 20 ROLLOS, cuadra (antes 500 un vs 260 un)');
 check(/4 ROLLOS/.test(t)&&/100 m/.test(t),'120262 "4 un" en un PC sin equivalencias: se lee 4 ROLLOS = 100 m con el catálogo de Supabase');
 // Entrega MP: línea de solicitud antigua "3 un" sin conversión → 3 ROLLOS = 75 m
 const sf=await a.evaluate(()=>JSON.stringify(solFix([["120125",3,"ROMBO","un","",1],["120262",50,"R","m","ROLLO",25],["120125",100]])));
 check(sf==='[["120125",75,"ROMBO","ML","ROLLO",25],["120262",50,"R","m","ROLLO",25],["120125",100]]','Solicitud MP antigua "3 un" se lee 3 ROLLOS = 75 m; las que traen conversión y las cortas (en unidad del ERP) no cambian → '+sf);
 // Celular: "Mis pallets por día" muestra el registro antiguo sin conversión en ROLLOS
 const uid=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'Felipe',p_area:'Bodega',p_permisos:['pt_recibir'],p_activo:true}).body);const tk='tok'+uid+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:uid,p_token:tk});
 ins('r9',uid,'R',10,{k:'120125',qty:10,um:'un',desc:'ROMBO PLAST. 5012'});
 const cc=await b.newContext({viewport:{width:412,height:900},timezoneId:'America/Santiago'});await route(cc);const m=await cc.newPage();m.on('pageerror',x=>errs.push(x.message));
 await m.goto(`${B}?puesto=${uid}&t=${tk}&u=${encodeURIComponent(SBU)}&k=anon`);await m.waitForTimeout(2000);await m.fill('#puPersona','FELIPE');await m.dispatchEvent('#puPersona','change');await m.waitForTimeout(300);
 await m.click('#puMenu [data-pk="pt"]');await m.waitForTimeout(2500);
 const pl=(await m.textContent('#ptPrevList')).replace(/\s+/g,' ');
 check(/ROMBO PLAST/.test(pl)&&/120125/.test(pl)&&/ROLLOS/.test(pl)&&/= 250 m/.test(pl)&&!/\bun\b/.test(pl),'Celular, Mis pallets por día: con código del producto y el "10 un" antiguo en ROLLOS = 250 m → '+pl.slice(0,120));
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
