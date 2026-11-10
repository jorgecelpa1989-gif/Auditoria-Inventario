const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
// Caso real 09-11: retail retiró 140 rollos de 221666, pero producción lo registró con otro código.
// Se agrega la entrega de producción desde el detalle de la fila y queda cuadrado. Además: columna
// "Entregado", horas de todos los registros, y el N° de pallet oculto en el celular.
// Tarjeta "Usuarios" de Recepción PT: el cierre de turno de AYER no debe aparecer como si fuera de hoy.
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_pt; delete from cb_pt_cierre; delete from cb_puesto");
 const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);sql(`update cb_puesto set usado=now(), visto=now()-interval '20 minutes', persona=upper('${nom}') where id='${id}'`);return id};
 const dav=usr('David','Producción',['pt_entregar']),fel=usr('Felipe','Bodega',['pt_recibir']),bar=usr('Barbara','Picking retail',['pt_retirar']);
 const cie=(id,lado,dias,h)=>sql(`insert into cb_pt_cierre(puesto,lado,persona,t) values ('${id}','${lado}','X',(date_trunc('day', now() at time zone 'America/Santiago') - interval '${dias} day' + interval '${h} minute') at time zone 'America/Santiago')`);
 cie(dav,'E',1,15*60+40);cie(fel,'R',1,15*60+35);cie(bar,'D',0,1);   // David y Felipe: ayer · Bárbara: hoy 00:01
 const b=await chromium.launch();const c=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago'});
 await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const s=await c.newPage();const errs=[];s.on('pageerror',e=>errs.push(e.message));await s.goto(B+'#panel');
 await s.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await s.goto(B+'#pt');await s.reload();await s.waitForTimeout(3000);
 const u=async n=>s.$eval('#ptSides',(el,n)=>[...el.querySelectorAll('.ptU')].map(x=>x.innerText.replace(/\s+/g,' ')).find(t=>t.includes(n))||'',n);
 check(!/cerró turno|cierre/.test(await u('DAVID'))&&!/cerró turno|cierre/.test(await u('FELIPE')),'Hoy: David y Felipe NO muestran cierre (sus cierres son de ayer) → '+(await u('DAVID'))+' | '+(await u('FELIPE')));
 check(/cerró turno 00:01/.test(await u('BARBARA')),'Hoy: Bárbara muestra "cerró turno 00:01" (su cierre sí es de hoy) → '+(await u('BARBARA')));
 await s.selectOption('#ptDesde','d1');await s.waitForTimeout(1500);
 check(/cerró turno \d\d-\d\d 15:40/.test(await u('DAVID'))&&/cerró turno \d\d-\d\d 15:35/.test(await u('FELIPE'))&&!/cerró turno/.test(await u('BARBARA')),'Ayer: David 15:40 y Felipe 15:35, con fecha; Bárbara sin cierre ese día → '+(await u('DAVID')));
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();