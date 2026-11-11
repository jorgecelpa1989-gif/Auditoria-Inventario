const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
async function ctx(b){const c=await b.newContext({...devices['iPhone 13']});await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});const p=await c.newPage();p.errs=[];p.on('pageerror',e=>p.errs.push(e.message));return p}
const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_mov");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["230125","","M. Jardin Verde","m","ROLLO",30]],p_stock:null,p_origen:'t'});
 const [bId,bT]=usr('Felipe','Bodega',['mp_entregar']),[pId,pT]=usr('David','Producción',['mp_recibir']);
 const b=await chromium.launch();
 const pB=await ctx(b);await pB.goto(`${B}?puesto=${bId}&t=${bT}&u=${encodeURIComponent(SBU)}&k=anon`);await pB.waitForTimeout(2000);await pB.fill('#puPersona','FELIPE');await pB.dispatchEvent('#puPersona','change');await pB.waitForTimeout(500);
 const pP=await ctx(b);await pP.goto(`${B}?puesto=${pId}&t=${pT}&u=${encodeURIComponent(SBU)}&k=anon`);await pP.waitForTimeout(2000);await pP.fill('#puPersona','DAVID');await pP.dispatchEvent('#puPersona','change');await pP.waitForTimeout(500);
 check(/puedes crear una entrega directa/.test(await pB.textContent('#puMenu')),'Bodega: el menú indica que puede crear una entrega directa');
 await pB.evaluate(()=>document.querySelector('#puMenu [data-pk="mp"]').click());await pB.waitForTimeout(500);
 check(await pB.isVisible('#puMpNew'),'Bodega: sin entregas asignadas igual se abre, con "＋ Nueva entrega directa"');
 await pB.screenshot({path:S+'/mpdir_lista.png'});
 await pB.fill('#puMpRef','ot 4512');await pB.tap('#puMpNew');await pB.waitForTimeout(3000);
 const row=sql("select nombre||'|'||(link_token is not null)||'|'||(meta->>'directa')||'|'||(meta->>'puestos')||'|'||(meta->>'ref')||'|'||(meta->>'por')||'|'||(vence>now()+interval '3 hours') from cb_mov");console.log('ROW',row);
 check(/^Entrega directa · \d\d-\d\d \d\d:\d\d · OT 4512\|true\|true\|true\|OT 4512\|FELIPE\|true$/.test(row),'Servidor: entrega activa, con link, para celulares fijos, referencia y quién la creó');
 check(/Entrega de materia prima/.test(await pB.textContent('#omBarT')),'Bodega: entra directo a registrar la entrega');
 await pP.evaluate(()=>puRefresh());await pP.waitForTimeout(2000);
 const tp=await pP.evaluate(()=>puTareas.mp.map(t=>t.nombre));check(tp.length===1&&/Entrega directa/.test(tp[0]),'Producción: le aparece la entrega para recibirla → '+tp.join(','));
 check(/tarea nueva/i.test(await pP.evaluate(()=>document.body.innerText)),'Producción: recibe el aviso de tarea nueva');
 // Bodega registra y termina: la entrega queda "terminada · esperando a producción" y al tocarla NO se reabre
 await pB.fill('#omScan','110107');await pB.press('#omScan','Enter');await pB.waitForTimeout(300);await pB.fill('#omQty','3');await pB.evaluate(()=>document.querySelector('#omOk').click());await pB.waitForTimeout(2500);
 await pB.evaluate(()=>document.querySelector('#omFin').click());await pB.waitForTimeout(300);await pB.evaluate(()=>document.querySelector('#omConfirm #cYes').click());await pB.waitForTimeout(2000);
 check(sql("select terminado is not null from cb_mov_lado where rol='E'")==='t','Servidor: la parte de bodega queda terminada');
 await pB.evaluate(()=>document.querySelector('#puMenu [data-pk="mp"]').click());await pB.waitForTimeout(800);
 check(/terminada · esperando a producción/.test(await pB.textContent('#puList')),'Bodega: la lista la muestra "terminada · esperando a producción"');
 await pB.evaluate(()=>document.querySelector('#puList [data-pi="0"]').click());await pB.waitForTimeout(1200);
 check(!(await pB.isVisible('#omFin'))&&/Ya terminaste esta entrega/.test(await pB.evaluate(()=>document.body.innerText)),'Bodega: al tocarla no se reabre (antes volvía a salir "Terminar en este celular")');
 // sin permiso
 const [xId,xT]=usr('Ana','Producción',['mp_recibir']);
 check(/sin_permiso|puesto_invalido/.test(rpc('cb_puesto_mov_crear',{p_puesto:xId,p_ses:'x',p_ref:null,p_persona:null}).body),'Servidor: quien no tiene "Entrega MP" no puede crear entregas');
 const errs=[pB,pP].flatMap(x=>x.errs);check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
