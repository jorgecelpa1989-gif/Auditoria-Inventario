const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_pt");sql("delete from cb_pt_cierre");
 const [pId,pT]=usr('David PT','Producción',['pt_entregar']);
 const ins=(lid,pal,qty,h)=>sql(`with x as (select (date_trunc('day', now() at time zone 'America/Santiago') + interval '${h} minute') at time zone 'America/Santiago' t)
   insert into cb_pt(lid,puesto,pallet,data,t,lado) select '${lid}','${pId}','${pal}',jsonb_build_object('lid','${lid}','k','110107','code','110107','desc','ROLLO ALAMBRE','qty',${qty},'um','kg','pallet','${pal}','user','DAVID','t',to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),t,'E' from x`);
 ins('h1','PAL-1',10,1);ins('h2','PAL-2',20,2);ins('y1','PAL-AYER',5,-60);
 const b=await chromium.launch();
 const c=await b.newContext({...devices['Pixel 7'],timezoneId:'America/Santiago'});await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));p.on('dialog',d=>d.accept());
 await p.goto(`${B}?puesto=${pId}&t=${pT}&u=${encodeURIComponent(SBU)}&k=anon`);await p.waitForTimeout(2000);await p.fill('#puPersona','DAVID');await p.dispatchEvent('#puPersona','change');await p.waitForTimeout(400);
 await p.tap('#puMenu [data-pk="pt"]');await p.waitForTimeout(2000);
 check(await p.isVisible('#ptPrevCard')&&/Mis pallets por día/.test(await p.textContent('#ptPrevCard')),'Producción: aparece "Mis pallets por día"');
 check(/^Hoy · /.test(await p.$eval('#ptPrevDia',s=>s.selectedOptions[0].textContent)),'Viene elegido "Hoy"');
 let L=await p.textContent('#ptPrevList');check(/PAL-1/.test(L)&&/PAL-2/.test(L),'Muestra los pallets de hoy');
 check(!/PAL-AYER/.test(L),'"Hoy" no muestra el pallet de ayer a las 23:00 (día calendario)');
 check(!(await p.isVisible('#ptList')),'Ya no aparece el cuadro "Pallets de este turno" (juntaba ayer y hoy)');
 await p.tap('#ptFin');await p.waitForTimeout(500);const cb=await p.$('#ptConfirm button.danger, #ptConfirm .btn.primary, #ptConfirm button');
 check(/quedan guardados/.test(await p.textContent('#ptConfirm')),'Al cerrar turno avisa que los pallets quedan guardados');
 const bs=await p.$$('#ptConfirm button');for(const x of bs){if(/cerrar|sí|confirm/i.test(await x.textContent())){await x.tap();break}}
 await p.waitForTimeout(2500);
 check(sql(`select count(*) from cb_pt_cierre where puesto='${pId}'`)==='1','Turno cerrado en el servidor');
 await p.tap('#puMenu [data-pk="pt"]').catch(()=>{});await p.waitForTimeout(2000);
 check(/0 pallets/.test(await p.textContent('#ptInfo')),'La lista del turno queda vacía (turno nuevo)');
 L=await p.textContent('#ptPrevList');check(/PAL-1/.test(L)&&/PAL-2/.test(L),'Pero "Mis pallets por día · Hoy" sigue mostrando PAL-1 y PAL-2');
 // nuevo pallet tras el cierre aparece en Hoy
 await p.fill('#ptProd','110107').catch(()=>{});
 await p.reload();await p.waitForTimeout(2500);
 check(await p.evaluate(()=>!!localStorage.getItem('inv_puesto')),'Al recargar, la sesión del usuario sigue guardada');
 await p.goto(B.replace('index.html','')+'#contar');await p.waitForTimeout(2500);
 check(await p.isVisible('#puMenu')||await p.isVisible('#ptPrevCard'),'Al abrir la app sin el link, entra directo con su usuario');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();