const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_pt");
 // pallets en fechas locales (America/Santiago se emula con TZ del navegador)
 const ins=(pal,lado,puesto,dias,hora)=>sql(`with x as (select (date_trunc('day', now() at time zone 'America/Santiago') - interval '${dias} day' + interval '${hora} hour') at time zone 'America/Santiago' t)
   insert into cb_pt(lid,puesto,pallet,data,t,lado) select '${pal}${lado}','${puesto}','${pal}',jsonb_build_object('k','110107','code','110107','qty',5,'um','kg','pallet','${pal}','user','X','t',to_char(t at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),t,'${lado}' from x`);
 ins('HOY-1','E','produccion',0,0.5);ins('HOY-1','R','bodega',0,1);           // hoy 00:30 / 01:00
 ins('AYER-1','E','produccion',1,23.5);ins('AYER-1','R','bodega',0,0.25);     // ayer 23:30, recibido hoy 00:15
 ins('AYER-2','E','produccion',1,8);                                           // ayer 08:00
 ins('HACE3','E','produccion',3,10);
 const b=await chromium.launch();const c=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago'});
 await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const p=await c.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.goto(B+'#panel');
 await p.evaluate(([u,a])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await p.goto(B+'#pt');await p.reload();await p.waitForTimeout(2500);
 const ops=await p.$$eval('#ptDesde option',o=>o.map(x=>x.textContent));console.log('OPS',ops.join(' | '));
 check(ops.length===8&&/^Hoy · [^ ]+ \d\d-\d\d-\d{4}$/.test(ops[0])&&/^Ayer · /.test(ops[1])&&/^[^ ]+ \d\d-\d\d-\d{4}$/.test(ops[6])&&!ops.some(o=>/horas|24|7 días/.test(o)),'Selector: Hoy, Ayer y 5 fechas más (sin "últimas N horas")');
 const pal=async()=>(await p.$$eval('#ptRes tbody tr td.code b',x=>x.map(e=>e.textContent))).sort().join(',');
 check(await pal()==='HOY-1','Hoy: solo los pallets de hoy (no mezcla el de anoche) → '+await pal());
 await p.selectOption('#ptDesde','d1');await p.waitForTimeout(1500);
 check(await pal()==='AYER-1,AYER-2','Ayer: los 2 de ayer, incluido el de 23:30 recibido hoy a las 00:15 → '+await pal());
 check(/Recibido OK/.test(await p.textContent('#ptRes')),'Ayer: AYER-1 aparece recibido (aunque la recepción fue hoy)');
 await p.selectOption('#ptDesde','d3');await p.waitForTimeout(1500);check(await pal()==='HACE3','Hace 3 días: solo ese día → '+await pal());
 check(/Día \d\d-\d\d-\d{4}, de 00:00 a 23:59/.test(await p.textContent('#ptCierres')),'Cierres: indica el día elegido de 00:00 a 23:59');
 await p.selectOption('#ptDesde','d1');await p.waitForTimeout(1200);await p.screenshot({path:S+'/ptdia.png',clip:{x:420,y:40,width:946,height:330}});
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
