const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_pt");
 const ins=(lid,puesto,lado,qty,h,user)=>sql(`with x as (select (date_trunc('day', now() at time zone 'America/Santiago') - interval '1 day' + interval '${h} hour') at time zone 'America/Santiago' t)
   insert into cb_pt(lid,puesto,pallet,data,t,lado) select '${lid}','${puesto}','SN-${lid}',jsonb_build_object('lid','${lid}','sn',true,'k','221673','code','221673','desc','Hex Gal 3/4','qty',${qty},'um','m','ce','ROLLO','f',10,'pallet','SN-${lid}','user','${user}','t',to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),t,'${lado}' from x`);
 ins('p1','produccion','E',60,9,'DAVID');ins('p3','produccion','E',1,10,'DAVID');ins('b1','bodega','R',60,11,'FELIPE');
 const b=await chromium.launch();const c=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago',deviceScaleFactor:2});
 await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const s=await c.newPage();const errs=[];const DQ=[];const msgs=[];s.on('dialog',dl=>{msgs.push(dl.message());const a=DQ.shift();a==null?dl.dismiss():dl.accept(a)});s.on('pageerror',e=>errs.push(e.message));await s.goto(B+'#panel');
 await s.evaluate(([u,a])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await s.goto(B+'#pt');await s.reload();await s.waitForTimeout(2500);await s.selectOption('#ptDesde','d1');await s.waitForTimeout(1500);
 
 check(/Sin N° · 2 pallets/.test(await s.textContent('#ptRes'))&&/Diferencia de cantidad/.test(await s.textContent('#ptRes')),'Antes: 2 pallets producción (60+1) vs 60 → diferencia');
 await s.click('#ptRes [data-ptsn]');await s.waitForTimeout(400);
 DQ.push('0','');
 await s.click('#ptRes .ptSnDet [data-pted="p3"]');await s.waitForTimeout(2000);
 check(/Queda anulado/.test(msgs.join()),'Pide confirmación al dejar en 0');check(sql("select (data->>'qty')||'|'||(data->'ed'->0->>'de') from cb_pt where lid='p3'")==='0|1','Servidor acepta 0 y deja historial 1 → 0');
 const t=await s.textContent('#ptRes');
 check(/Sin N° · 1 pallet/.test(t)&&/Recibido OK/.test(t),'Después: 1 pallet producción vs 1 recibido → Recibido OK');
 check(/anulado/.test(await s.textContent('#ptRes .ptSnDet')),'La línea en 0 se ve tachada como "anulado" y se puede volver a corregir');
 check(/^1 \/ 1/.test(await s.textContent('#ptKpis')),'KPI pallets: 1 / 1 (el anulado no cuenta) → '+(await s.textContent('#ptKpis')).slice(0,20));
 // retail solo, en 0 → fila "Anulado"
 ins('r1','retail','R',1,13,'BARBARA');sql("update cb_pt set data=data||'{\"k\":\"221666\",\"code\":\"221666\",\"desc\":\"Hex Gal 1\"}' where lid='r1'");
 await s.reload();await s.waitForTimeout(2500);await s.selectOption('#ptDesde','d1');await s.waitForTimeout(1500);
 await s.click('#ptRes [data-ptsn="221666"]');await s.waitForTimeout(400);
 DQ.push('0','');await s.click('#ptRes [data-pted="r1"]');await s.waitForTimeout(2000);
 check(/Anulado \(en 0\)/.test(await s.textContent('#ptRes')),'Retail en 0 sin producción → estado "Anulado (en 0)", no "Sin registro de producción"');
 DQ.push('-1');await s.click('#ptRes [data-pted="r1"]');await s.waitForTimeout(800);
 check(sql("select data->>'qty' from cb_pt where lid='r1'")==='0','Negativos siguen rechazados');
 check(rpc('cb_pt_editar_panel',{p_clave:'x',p_lid:'r1',p_qty:0}).ok===false,'Sin clave de supervisor no se puede');
 await s.screenshot({path:S+'/pt_cero.png',fullPage:false});
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();