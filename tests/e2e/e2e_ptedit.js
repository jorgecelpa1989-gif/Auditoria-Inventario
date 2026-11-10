const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_pt");
 const [bId,bT]=usr('Felipe PT','Bodega',['pt_recibir']),[pId]=usr('David PT','Producción',['pt_entregar']);
 const ins=(lid,puesto,lado,pal,qty,dias)=>sql(`with x as (select (date_trunc('day', now() at time zone 'America/Santiago') - interval '${dias} day' + interval '10 hour') at time zone 'America/Santiago' t)
   insert into cb_pt(lid,puesto,pallet,data,t,lado) select '${lid}','${puesto}','${pal}',jsonb_build_object('lid','${lid}','k','110107','code','110107','desc','ROLLO ALAMBRE','qty',${qty},'um','kg','pallet','${pal}','user','X','t',to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),t,'${lado}' from x`);
 ins('e1',pId,'E','PAL-50',10,1);ins('r1',bId,'R','PAL-50',8,1);ins('r0',bId,'R','PAL-60',5,0);
 const b=await chromium.launch();
 const c=await b.newContext({...devices['iPhone 13'],timezoneId:'America/Santiago'});await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
 await p.goto(`${B}?puesto=${bId}&t=${bT}&u=${encodeURIComponent(SBU)}&k=anon`);await p.waitForTimeout(2000);await p.fill('#puPersona','FELIPE');await p.dispatchEvent('#puPersona','change');await p.waitForTimeout(400);
 await p.tap('#puMenu [data-pk="pt"]');await p.waitForTimeout(1500);
 check(await p.isVisible('#ptPrevCard'),'Bodega (PT): aparece "Días anteriores"');
 const ops=await p.$$eval('#ptPrevDia option',o=>o.map(x=>x.textContent));check(ops.length===16&&/^Hoy · /.test(ops[1])&&/^Ayer · /.test(ops[2]),'Selector: Hoy, Ayer y 13 días más → '+ops.slice(0,3).join(' | '));
 await p.selectOption('#ptPrevDia',{index:2});await p.waitForTimeout(1500);
 const t=await p.textContent('#ptPrevList');check(/PAL-50/.test(t)&&!/PAL-60/.test(t),'Ayer: muestra solo su pallet de ayer (PAL-50), no el de hoy');
 await p.fill('#ptPrevList input[data-pq="r1"]','10');await p.tap('#ptPrevList [data-ps="r1"]');await p.waitForTimeout(1500);
 const d=sql("select (data->>'qty')||'|'||(data->'ed'->0->>'de')||'|'||(data->'ed'->0->>'a')||'|'||(data->'ed'->0->>'por')||'|'||(data->'ed'->0->>'via')||'|'||(t::date = (now() at time zone 'America/Santiago')::date - 1) from cb_pt where lid='r1'");
 check(d==='10|8|10|FELIPE|celular|true','Celular: corrige 8 → 10, queda anotado (FELIPE, celular) y conserva la fecha de ayer → '+d);
 check(/corregido/.test(await p.textContent('#ptPrevList')),'Celular: la línea queda marcada "corregido"');
 await p.screenshot({path:S+'/ptedit_cel.png'});
 check(/no_existe/.test(rpc('cb_pt_editar',{p_puesto:bId,p_ses:'x',p_lid:'e1',p_qty:3,p_persona:'X'}).body)||/puesto_invalido/.test(rpc('cb_pt_editar',{p_puesto:bId,p_ses:'x',p_lid:'e1',p_qty:3,p_persona:'X'}).body),'Servidor: no puede corregir registros de otro usuario');
 // Panel
 const cs=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago'});await cs.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const s=await cs.newPage();s.on('pageerror',e=>errs.push(e.message));await s.goto(B+'#panel');
 await s.evaluate(([u,a])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await s.goto(B+'#pt');await s.reload();await s.waitForTimeout(2500);await s.selectOption('#ptDesde','d1');await s.waitForTimeout(1500);
 check((await s.$$('#ptRes [data-pted]')).length===2&&/corregido/.test(await s.textContent('#ptRes')),'Panel (Ayer): botones "✎ corregir" en entregado y recibido, y marca "corregido"');
 s.once('dialog',dl=>dl.accept('12'));await s.click('#ptRes [data-pted="e1"]');await s.waitForTimeout(2000);
 check(sql("select (data->>'qty')||'|'||(data->'ed'->0->>'via') from cb_pt where lid='e1'")==='12|panel','Panel: corrige la cantidad de producción 10 → 12 (anotado como panel)');
 check(/Diferencia|Recibido OK|Diferencia de cantidad/.test(await s.textContent('#ptRes')),'Panel: la tabla se recalcula');
 await s.screenshot({path:S+'/ptedit_panel.png',clip:{x:420,y:300,width:946,height:200}});
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
