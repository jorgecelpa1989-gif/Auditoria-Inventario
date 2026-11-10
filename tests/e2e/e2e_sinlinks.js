const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const S=process.argv[2],B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,area,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:area,p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_mov; delete from cb_conteos; delete from cb_puesto");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["221317","","Mos.Gal 14","m","ROLLO",90],["110107","","ALAMBRE","kg"]],p_stock:null,p_origen:'t'});
 const [fId,fT]=usr('Felipe','Bodega',['conteo','dev_recibir','mp_entregar','pt_recibir']),[dId,dT]=usr('David','Producción',['mp_recibir','pt_entregar','dev_cargar']);
 const b=await chromium.launch();const errs=[];
 const cs=await b.newContext({viewport:{width:1366,height:900}});await route(cs);const s=await cs.newPage();s.on('pageerror',e=>errs.push(e.message));
 await s.goto(B+'#panel');await s.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}));
   localStorage.setItem('inv_fact',JSON.stringify({"221317":{ce:"ROLLO",f:90}}));
   localStorage.setItem('inv_erp',JSON.stringify({file:'stock.txt',at:new Date().toISOString(),items:[{cod:'221317',ean:'',desc:'Mos.Gal 14',um:'m',stock:900},{cod:'110107',ean:'',desc:'ALAMBRE',um:'kg',stock:30}]}))},[SBU,ADMIN]);
 // ---- MP: solicitud desde el panel ----
 await s.goto(B+'#mp');await s.reload();await s.waitForTimeout(3000);
 check(await s.isHidden('#mpPuWrap')&&(await s.inputValue('#mpVence'))==='hoy','Panel MP: sin casilla de "enviar a usuarios" (siempre se asigna) y vigencia por defecto hasta hoy 23:59');
 if(await s.isEnabled('#solPor'))await s.fill('#solPor','JEFE');await s.fill('#solCod','221317');await s.fill('#solQty','3');await s.click('#solAddBtn');await s.waitForTimeout(300);await s.click('#btnSolGen');await s.waitForTimeout(2500);
 const cr=await s.textContent('#mpCreated');check(/Asignada/.test(cr)&&/Felipe/.test(cr)&&/David/.test(cr)&&!/WhatsApp|Copiar link/.test(cr),'Panel MP: al generar dice "Asignada" a Felipe (entrega) y David (recibe), sin WhatsApp ni link');
 const mv=sql("select id||'|'||link_token||'|'||(meta->>'puestos') from cb_mov").split('|');check(mv[2]==='true','Servidor: la solicitud queda asignada a los usuarios');
 check(!/WhatsApp|Copiar link/.test(await s.textContent('#mpTbl'))&&!/WhatsApp|Copiar link/.test(await s.textContent('#mpAct')),'Panel MP: lista y detalle sin botones de WhatsApp ni Copiar link');
 await s.screenshot({path:S+'/sinlinks_mp.png',clip:await s.evaluate(()=>{const r=document.querySelector('#mpCreated').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height}})});
 // alguien abrió antes ese lado con el link en otro navegador
 rpc('cb_mov_abrir',{p_id:mv[0],p_token:mv[1],p_device:'navegador-whatsapp',p_rol:'E'});
 const cf=await b.newContext({...devices['iPhone 13']});await route(cf);const f=await cf.newPage();f.on('pageerror',e=>errs.push(e.message));
 await f.goto(`${B}?puesto=${fId}&t=${fT}&u=${encodeURIComponent(SBU)}&k=anon`);await f.waitForTimeout(2000);await f.fill('#puPersona','FELIPE');await f.dispatchEvent('#puPersona','change');await f.waitForTimeout(400);
 await f.tap('#puMenu [data-pk="mp"]');await f.waitForTimeout(500);await f.tap('#puList [data-pi]');await f.waitForTimeout(2500);
 check(await f.evaluate(()=>!!(om&&om.rol==='E'&&!document.querySelector('#v-opmov').hidden)),'Felipe (bodega): entra a la entrega desde su app aunque el lado lo había tomado otro navegador');
 check(sql(`select device from cb_mov_lado where mov='${mv[0]}' and rol='E'`)!=='navegador-whatsapp','Servidor: el lado pasó al equipo de Felipe');
 const cd=await b.newContext({...devices['iPhone 13']});await route(cd);const d=await cd.newPage();d.on('pageerror',e=>errs.push(e.message));
 await d.goto(`${B}?puesto=${dId}&t=${dT}&u=${encodeURIComponent(SBU)}&k=anon`);await d.waitForTimeout(2000);await d.fill('#puPersona','DAVID');await d.dispatchEvent('#puPersona','change');await d.waitForTimeout(400);
 await d.tap('#puMenu [data-pk="mp"]');await d.waitForTimeout(2500);
 check(await d.evaluate(()=>!!(om&&om.rol==='R')),'David (producción): entra a recibir desde su app');
 // ---- Conteo: asignación obligatoria ----
 await s.goto(B+'#resultado');await s.reload();await s.waitForTimeout(2500);
 check(!/A nadie/.test(await s.textContent('#cPuesto')),'Crear conteo: ya no existe "A nadie (lo mando por link)"');
 await s.fill('#cNombre','Conteo sin elegir');await s.click('#btnCrear');await s.waitForTimeout(800);
 check(sql("select count(*) from cb_conteos where nombre='Conteo sin elegir'")==='0'&&/Elige a quién/.test(await s.textContent('#toast')),'Crear conteo: si no eliges a quién, no se crea');
 await s.selectOption('#cPuesto',fId);await s.fill('#cNombre','Conteo Felipe');await s.click('#btnCrear');await s.waitForTimeout(2500);
 check(!/WhatsApp|Copiar|Permisos/.test(await s.textContent('#crearRes'))&&/Enviado a Felipe/.test(await s.textContent('#crearRes')),'Crear conteo: "Enviado a Felipe", sin link');
 // abierto antes en otro equipo con lecturas -> la app de Felipe lo toma y recupera
 const c1=sql("select id||'|'||link_token from cb_conteos where nombre='Conteo Felipe'").split('|');
 const o=JSON.parse(rpc('cb_abrir',{p_id:c1[0],p_token:c1[1],p_device:'otro-equipo'}).body);rpc('cb_enviar',{p_id:c1[0],p_secret:o.secret,p_contador:'FELIPE',p_lecturas:[{lid:'x1',code:'221317',k:'221317',qty:2,t:new Date().toISOString()}]});
 await f.evaluate(()=>puRefresh());await f.waitForTimeout(1500);await f.evaluate(()=>puestoMenu());await f.waitForTimeout(300);await f.tap('#puMenu [data-pk="conteo"]');await f.waitForTimeout(2500);
 check(await f.evaluate(()=>!!(erp&&erp.conteo&&erp.conteo.nombre==='Conteo Felipe'&&scans.length===1)),'Felipe: abre su conteo desde la app aunque estaba en otro equipo, y recupera la lectura');
 check(/sin_permiso/.test(rpc('cb_puesto_conteo_tomar',{p_puesto:dId,p_ses:'x',p_id:c1[0],p_device:'d'}).body)||/puesto_invalido/.test(rpc('cb_puesto_conteo_tomar',{p_puesto:dId,p_ses:'x',p_id:c1[0],p_device:'d'}).body),'Servidor: otro usuario no puede tomar el conteo de Felipe');
 // ---- Permisos: conteos sin links ----
 await s.goto(B+'#permisos');await s.reload();await s.waitForTimeout(3000);
 const lb=await s.textContent('#lbBox');check(/Conteos en curso/.test(lb)&&!/WhatsApp|Copiar link/.test(lb),'Permisos: "Conteos en curso" sin WhatsApp ni Copiar link');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));console.log(fail?'FALLAS: '+fail:'TODO OK');await b.close()})();
