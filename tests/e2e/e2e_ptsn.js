const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_pt");
 const ins=(lid,puesto,lado,qty,h,user)=>sql(`with x as (select (date_trunc('day', now() at time zone 'America/Santiago') - interval '1 day' + interval '${h} hour') at time zone 'America/Santiago' t)
   insert into cb_pt(lid,puesto,pallet,data,t,lado) select '${lid}','${puesto}','SN-${lid}',jsonb_build_object('lid','${lid}','sn',true,'k','221673','code','221673','desc','Hex Gal 3/4','qty',${qty},'um','m','ce','ROLLO','f',10,'pallet','SN-${lid}','user','${user}','t',to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),t,'${lado}' from x`);
 ins('p1','produccion','E',50,9,'DAVID');ins('p2','produccion','E',50,10,'DAVID');ins('b1','bodega','R',50,11,'FELIPE');ins('b2','bodega','R',35,12,'FELIPE');
 const b=await chromium.launch();const c=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago',deviceScaleFactor:2});
 await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const s=await c.newPage();const errs=[];s.on('pageerror',e=>errs.push(e.message));await s.goto(B+'#panel');
 await s.evaluate(([u,a])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await s.goto(B+'#pt');await s.reload();await s.waitForTimeout(2500);await s.selectOption('#ptDesde','d1');await s.waitForTimeout(1500);
 check(/Sin N° · 2 pallets/.test(await s.textContent('#ptRes'))&&await s.isVisible('#ptRes [data-ptsn]'),'Fila "Sin N°": muestra "✎ ver y corregir pallets"');
 await s.click('#ptRes [data-ptsn]');await s.waitForTimeout(400);
 const det=await s.textContent('#ptRes .ptSnDet');console.log('DET',det.replace(/\s+/g,' '));
 check((await s.$$('#ptRes .ptSnDet [data-pted]')).length===4&&/Producción entrega/.test(det)&&/Bodega recibe/.test(det)&&/FELIPE/.test(det),'Se abre el detalle con los 4 pallets (2 producción, 2 bodega) y su botón corregir');
 await s.screenshot({path:S+'/ptsn.png',clip:await s.evaluate(()=>{const r=document.querySelector('#ptRes').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:Math.min(r.height,300)}})});
 s.once('dialog',dl=>dl.accept('50'));await s.click('#ptRes .ptSnDet [data-pted="b2"]');await s.waitForTimeout(2000);
 check(sql("select (data->>'qty')||'|'||(data->'ed'->0->>'de')||'|'||(data->'ed'->0->>'via') from cb_pt where lid='b2'")==='50|35|panel','Corregir pallet sin número: 35 → 50 rollos, anotado (panel)');
 check(/Recibido OK/.test(await s.textContent('#ptRes'))&&await s.isVisible('#ptRes .ptSnDet'),'La fila se recalcula (Recibido OK) y el detalle sigue abierto');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
