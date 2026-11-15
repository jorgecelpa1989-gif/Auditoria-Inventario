const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:'Bodega',p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
// Recepción de proveedores y devoluciones con DOS personas en el mismo documento, y celular sin señal.
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_prov; delete from cb_dev; delete from cb_puesto");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["221317","","Mos.Gal 14","m","ROLLO",90],["110107","","ALAMBRE","kg"],["140101","","SACO HARINA 25KG","kg","SACO",25]],p_stock:null,p_origen:'t'});
 const [fId,fT]=usr('Felipe',['prov_recibir','dev_recibir']),[jId,jT]=usr('Jorge',['prov_recibir','dev_recibir']);
 const nueva=(prov,g)=>{const x=JSON.parse(rpc('cb_prov_guardar',{p_clave:ADMIN,p_id:null,p_doc:{tipo:'nacional',proveedor:prov,guia:g,fecha:'2026-11-15'},p_esperado:[{code:'221317',k:'221317',desc:'Mos.Gal 14',qty:10,f:90,ce:'ROLLO',um:'m'}]}).body);return x.id||x};
 const idA=nueva('Aceros Uno','G-1'),idB=nueva('Aceros Dos','G-2');
 const rec=id=>JSON.parse(sql(`select coalesce(rec,'[]')::text from cb_prov where id='${id}'`));
 const b=await chromium.launch();const errs=[];
 const cel=async(id,t,nom)=>{const c=await b.newContext({...devices['iPhone 13'],timezoneId:'America/Santiago'});await route(c);const m=await c.newPage();m.on('pageerror',e=>errs.push(nom+': '+e.message));
   await m.goto(`${B}?puesto=${id}&t=${t}&u=${encodeURIComponent(SBU)}&k=anon`);await m.waitForTimeout(2000);await m.fill('#puPersona',nom);await m.dispatchEvent('#puPersona','change');await m.waitForTimeout(300);
   await m.tap('#puMenu [data-pk="prov"]');await m.waitForTimeout(1500);return [c,m]};
 const leer=async(m,cod,q)=>{await m.fill('#pcScan',cod);await m.press('#pcScan','Enter');await m.waitForTimeout(300);await m.fill('#pcQty',String(q));await m.tap('#pcOk');await m.waitForTimeout(300)};
 const [cF,F]=await cel(fId,fT,'FELIPE'),[cJ,J]=await cel(jId,jT,'JORGE');
 await F.tap(`#pcHome [data-pc="${idA}"]`);await F.waitForTimeout(500);await J.tap(`#pcHome [data-pc="${idA}"]`);await J.waitForTimeout(500);
 await leer(F,'221317',2);await F.waitForTimeout(2500);
 await leer(J,'140101',3);await J.waitForTimeout(2500);
 let r=rec(idA);
 check(r.length===2&&r.some(l=>l.code==='221317'&&l.pu===fId)&&r.some(l=>l.code==='140101'&&l.pu===jId),'Dos personas en la misma recepción: el servidor guarda las líneas de las dos (antes el último borraba al otro) → '+r.map(l=>l.code).join(','));
 const tj=(await J.textContent('#pcList')).replace(/\s+/g,' ');
 check(/221317 · Mos\.Gal 14/.test(tj)&&/registró FELIPE/.test(tj)&&(await J.$$('#pcList [data-pcdl]')).length===1,'El celular de Jorge ve lo que registró Felipe (con su nombre) y solo puede quitar lo suyo');
 check(/140101 · SACO HARINA 25KG/.test(tj)&&/3 SACOS/.test(tj)&&/= 75 kg/.test(tj),'Fila del celular: código primero, bulto y conversión (3 SACOS = 75 kg)');
 await leer(F,'110107',5);await F.waitForTimeout(2500);r=rec(idA);
 check(r.length===3&&r.filter(l=>l.pu===fId).length===2,'Felipe agrega otra línea: quedan 3 (2 de Felipe, 1 de Jorge)');
 const lid=r.find(l=>l.code==='110107').lid;await F.tap(`#pcList [data-pcdl="${lid}"]`);await F.waitForTimeout(300);await F.tap('#pcConfirm #cYes');await F.waitForTimeout(2500);
 r=rec(idA);check(r.length===2&&!r.some(l=>l.code==='110107')&&r.some(l=>l.pu===jId),'Felipe quita su línea: se borra solo esa; la de Jorge sigue → '+r.map(l=>l.code).join(','));
 // Sin señal: Jorge registra, vuelve a la lista e intenta abrir otra recepción → no se pierde nada
 await cJ.setOffline(true);await leer(J,'110107',7);await J.waitForTimeout(1800);
 await J.tap('#pcBack');await J.waitForTimeout(800);
 if(await J.isVisible(`#pcHome [data-pc="${idB}"]`)){await J.tap(`#pcHome [data-pc="${idB}"]`);await J.waitForTimeout(800)}
 check(await J.isVisible('#pcWork')&&/sin guardar/.test(await J.textContent('#toast'))&&/110107/.test(await J.textContent('#pcList'))&&await J.evaluate(()=>pc.id)===idA,'Sin señal: al intentar abrir otra recepción, avisa y vuelve a la que tiene lecturas sin guardar (no las pierde)');
 check(!rec(idA).some(l=>l.code==='110107'),'Mientras no hay señal, el servidor aún no tiene la línea');
 await cJ.setOffline(false);await J.evaluate(()=>window.dispatchEvent(new Event('online')));await J.waitForTimeout(500);
 if(await J.isVisible('#pcGo'))await J.tap('#pcGo');await J.waitForTimeout(2500);
 r=rec(idA);check(r.length===3&&r.some(l=>l.code==='110107'&&l.pu===jId&&+l.qty===7),'Vuelve la señal: se guarda la lectura de Jorge (7 kg) y siguen las de Felipe → '+r.map(l=>l.code+':'+l.qty).join(','));
 // Terminar: el que termina incluye todo; el otro celular recibe "ya recibida"
 await F.waitForTimeout(500);
 // Devoluciones: la misma regla en el servidor (dos personas reciben la misma devolución)
 const did=JSON.parse(rpc('cb_dev_crear_panel',{p_clave:ADMIN,p_area:'Clientes',p_doc:{guia:'D-1',factura:'',fecha:'2026-11-15'},p_lect:[{code:'110107',k:'110107',qty:5,lid:'d0',t:'2026-11-15T10:00:00Z'}]}).body);const dId=did.id||did;
 const ses=(id,t)=>JSON.parse(rpc('cb_puesto_vincular',{p_puesto:id,p_token:t,p_equipo:'x'+id}).body);
 const sF=await F.evaluate(()=>PST.ses),sJ=await J.evaluate(()=>PST.ses);
 const r1=rpc('cb_dev_recibir',{p_puesto:fId,p_ses:sF,p_id:dId,p_persona:'FELIPE',p_rec:[{lid:'f1',code:'110107',k:'110107',qty:2,t:'2026-11-15T10:01:00Z'}],p_terminar:false});
 const r2=rpc('cb_dev_recibir',{p_puesto:jId,p_ses:sJ,p_id:dId,p_persona:'JORGE',p_rec:[{lid:'j1',code:'110107',k:'110107',qty:3,t:'2026-11-15T10:02:00Z'}],p_terminar:false});
 const dr=JSON.parse(sql(`select rec::text from cb_dev where id='${dId}'`));
 check(r1.ok&&r2.ok&&dr.length===2&&JSON.parse(r2.body).rec.length===2,'Devoluciones: dos personas reciben la misma devolución y quedan las 2 líneas (la respuesta trae la lista unida) '+(r1.ok?'':r1.body)+(r2.ok?'':r2.body));
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 await b.close();console.log(fail?'FALLAS: '+fail:'TODO OK')})();
