const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
// Entrega MP igual que Recepción PT: menú de días y "＋ Agregar registro" con Quién (bodega entrega / producción recibe).
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_mov; delete from cb_puesto; delete from cb_acceso");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["221317","","Mos.Gal 14","m","ROLLO",90],["110107","","ALAMBRE","kg"]],p_stock:null,p_origen:'t'});
 const crear=(nom,dias,h)=>{const r=JSON.parse(rpc('cb_mov_crear',{p_clave:ADMIN,p_nombre:nom,p_vence:new Date(Date.now()+864e5).toISOString(),p_items:[],p_meta:{sol:[["221317",900,"Mos.Gal 14","m","ROLLO",90]],por:'JEFE'}}).body);
   sql(`update cb_mov set creado=(date_trunc('day', now() at time zone 'America/Santiago') - interval '${dias} day' + interval '${h} minute') at time zone 'America/Santiago' where id='${r.id}'`);return r.id};
 const ayer=crear('Solicitud de ayer',1,10*60),hoy=crear('Solicitud de hoy',0,1);
 // ayer: bodega entregó 10 rollos; producción recibió 8 desde su celular (secreto 'sec-R')
 sql(`insert into cb_mov_lado(mov,rol,device,secret_hash,terminado,persona) values ('${ayer}','E','dE',extensions.crypt('sec-E',extensions.gen_salt('bf')),now(),'FELIPE'),('${ayer}','R','dR',extensions.crypt('sec-R',extensions.gen_salt('bf')),now(),'DAVID')`);
 sql(`insert into cb_mov_lect(mov,rol,lid,data) values ('${ayer}','E','e1','{"lid":"e1","code":"221317","k":"221317","qty":10,"ce":"ROLLO","f":90,"um":"m","user":"FELIPE","t":"2026-01-01T13:00:00Z"}'),('${ayer}','R','r1','{"lid":"r1","code":"221317","k":"221317","qty":8,"ce":"ROLLO","f":90,"um":"m","user":"DAVID","t":"2026-01-01T13:10:00Z"}')`);
 const b=await chromium.launch();const errs=[];const cs=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago'});await route(cs);const s=await cs.newPage();s.on('pageerror',e=>errs.push(e.message));
 await s.goto(B+'#panel');await s.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}));
   localStorage.setItem('inv_erp',JSON.stringify({file:'stock.txt',at:new Date().toISOString(),items:[{cod:'221317',ean:'',desc:'Mos.Gal 14',um:'m',stock:900},{cod:'110107',ean:'',desc:'ALAMBRE',um:'kg',stock:30}]}));localStorage.setItem('inv_fact',JSON.stringify({"221317":{ce:"ROLLO",f:90}}))},[SBU,ADMIN]);
 await s.goto(B+'#mp');await s.reload();await s.waitForTimeout(3500);
 const lista=()=>s.$$eval('#mpTbl .mpItem .mh > b',x=>x.map(e=>e.textContent.trim()).join(' | '));
 check(/^Hoy · /.test(await s.$eval('#mpDia',x=>x.selectedOptions[0].textContent))&&(await s.$$eval('#mpDia option',o=>o.length))===16,'Menú de días: viene en "Hoy", con 15 días y "Todos los días"');
 check((await lista())==='Solicitud de hoy'&&/Solicitud de hoy/.test(await s.textContent('#mpTitle')),'Hoy: la lista muestra solo la entrega de hoy, y se abre sola → '+(await lista()));
 await s.selectOption('#mpDia','d1');await s.waitForTimeout(2500);
 check((await lista())==='Solicitud de ayer'&&/Solicitud de ayer/.test(await s.textContent('#mpTitle')),'Ayer: muestra y abre la entrega de ayer');
 check(/Recibió menos/.test(await s.textContent('#mpRes')),'Ayer: 10 entregados vs 8 recibidos → "Recibió menos"');
 check(await s.isVisible('#mpAddTog'),'Aparece "＋ Agregar registro" junto a Actualizar y Excel');
 await s.click('#mpAddTog');await s.waitForTimeout(300);
 check(await s.isVisible('#mpAddPanel')&&(await s.$$eval('#mpAdL option',o=>o.map(x=>x.textContent).join('|')))==='📦 Bodega entrega|📥 Producción recibe'&&/Solicitud de ayer/.test(await s.textContent('#mpAddTit')),'Formulario: Quién (Bodega entrega / Producción recibe), código, cantidad y hora; dice a qué entrega se suma');
 await s.selectOption('#mpAdL','R');await s.fill('#mpAdCod','221317');await s.waitForTimeout(200);
 check(/rollos/i.test(await s.textContent('#mpAdQL')),'Al escribir el código pide la cantidad en rollos');
 await s.fill('#mpAdQty','2');await s.fill('#mpAdHora','16:20');await s.click('#mpAdOk');await s.waitForTimeout(2500);
 const g=sql(`select rol||'|'||(data->>'qty')||'|'||(data->'manual'->>'via')||'|'||to_char((data->>'t')::timestamptz at time zone 'America/Santiago','HH24:MI')||'|'||(((data->>'t')::timestamptz at time zone 'America/Santiago')::date=(now() at time zone 'America/Santiago')::date-1)::text from cb_mov_lect where mov='${ayer}' and lid like 'man-%'`);
 check(g==='R|2|panel|16:20|true','Guardado: producción recibe 2 rollos, a mano (panel), 16:20 del día de la entrega (ayer) → '+g);
 check(/Cuadra/.test(await s.textContent('#mpRes'))&&!/Recibió menos/.test(await s.textContent('#mpRes')),'La tabla se recalcula: 10 entregados = 8 + 2 recibidos → "Cuadra"');
 await s.click('#mpDetBox summary');await s.waitForTimeout(300);check(/a mano/.test(await s.textContent('#mpDet')),'En "Detalle de lecturas" la línea agregada dice "a mano"');
 await s.screenshot({path:S+'/mp_agregar.png'});
 // El celular de producción vuelve a enviar SUS lecturas (reemplaza las de su lado): lo agregado a mano NO se borra
 sql(`update cb_mov set finalizado=null where id='${ayer}'`);   // la app la cerró sola (los dos lados terminaron); se reabre para simular el reenvío
 const env=rpc('cb_mov_enviar',{p_id:ayer,p_rol:'R',p_secret:'sec-R',p_persona:'DAVID',p_lecturas:[{lid:'r1',code:'221317',k:'221317',qty:8,ce:'ROLLO',f:90,um:'m',user:'DAVID',t:'2026-01-01T13:10:00Z'}]});
 check(env.ok&&sql(`select count(*) from cb_mov_lect where mov='${ayer}' and rol='R'`)==='2'&&sql(`select count(*) from cb_mov_lect where mov='${ayer}' and lid like 'man-%'`)==='1','Cuando el celular reenvía sus lecturas, el registro agregado a mano se mantiene');
 const env2=rpc('cb_mov_enviar',{p_id:ayer,p_rol:'R',p_secret:'sec-R',p_persona:'DAVID',p_lecturas:[]});
 check(env2.ok&&sql(`select string_agg(lid,',') from cb_mov_lect where mov='${ayer}' and rol='R'`).startsWith('man-'),'Aunque el celular borre lo suyo, lo agregado a mano sigue');
 // Validaciones del servidor
 check(!rpc('cb_mov_agregar_panel',{p_clave:'mala-clave-xxxxxxxx',p_id:ayer,p_rol:'R',p_hora:'10:00',p_data:{code:'221317',qty:1}}).ok,'Sin clave de administrador: rechazado');
 check(/datos_invalidos/.test(rpc('cb_mov_agregar_panel',{p_clave:ADMIN,p_id:ayer,p_rol:'X',p_hora:'10:00',p_data:{code:'221317',qty:1}}).body)&&/datos_invalidos/.test(rpc('cb_mov_agregar_panel',{p_clave:ADMIN,p_id:ayer,p_rol:'R',p_hora:'10:00',p_data:{code:'221317',qty:0}}).body),'Lado inválido o cantidad 0: rechazado');
 // Una solicitud sin activar no ofrece "agregar"; elegir "Todos los días" muestra las dos
 await s.selectOption('#mpDia','all');await s.waitForTimeout(2000);
 check(/Solicitud de hoy/.test(await lista())&&/Solicitud de ayer/.test(await lista()),'"Todos los días": muestra las dos entregas');
 // Recordar el día elegido al recargar
 await s.selectOption('#mpDia','d1');await s.waitForTimeout(1500);await s.reload();await s.waitForTimeout(3500);
 check((await s.inputValue('#mpDia'))==='d1'&&(await lista())==='Solicitud de ayer','Al recargar recuerda el día elegido (Ayer)');
 // Día sin entregas
 await s.selectOption('#mpDia','d5');await s.waitForTimeout(1500);
 check(await s.isVisible('#mpEmpty')&&/No hay entregas creadas el/.test(await s.textContent('#mpEmptyTxt'))&&await s.isVisible('#mpDia2'),'Día sin entregas: lo avisa y el menú de días sigue a mano');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();