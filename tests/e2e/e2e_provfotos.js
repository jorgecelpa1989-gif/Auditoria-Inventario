const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
const sqlE=q=>{try{return {ok:true,v:sql(q)}}catch(e){const m=String(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,v:m?m[1].trim():'error'}}};
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const usr=(nom,perm)=>{const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_area:'Bodega',p_permisos:perm,p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});return [id,t]};
// Simula la Edge Function "prov-fotos" (service_role = postgres) y el bucket privado
const BUCKET=new Map();let llamadas=0;
const route=async c=>{await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
  await c.route(SBU+'/functions/v1/prov-fotos',async r=>{llamadas++;const b=JSON.parse(r.request().postData()||'{}'),q=s=>"'"+String(s).replace(/'/g,"''")+"'";let out,st=200;
    if(b.accion==='subir'){const ok=sqlE(`select cb_prov_foto_puede(${q(b.puesto)},${q(b.ses)},${q(b.id)})`);
      if(!ok.ok){out={error:ok.v};st=400}else{const path=`${b.id}/${Date.now()}-${Math.random().toString(16).slice(2,10)}.jpg`;BUCKET.set(path,b.jpg);
        const a=sqlE(`select cb_prov_foto_agregar(${q(b.puesto)},${q(b.ses)},${q(b.id)},${q(path)},${q(b.persona||'')})::text`);if(!a.ok){BUCKET.delete(path);out={error:a.v};st=400}else out={path,n:JSON.parse(a.v).n}}}
    else if(b.accion==='ver'){const f=sqlE(`select cb_prov_fotos(${q(b.clave)},${q(b.id)})::text`);if(!f.ok){out={error:f.v};st=400}else out={fotos:JSON.parse(f.v).map(x=>({...x,url:'data:image/jpeg;base64,'+BUCKET.get(x.path)}))}}
    await r.fulfill({status:st,contentType:'application/json',body:JSON.stringify(out)})})};
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_prov; delete from cb_puesto");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["221317","","Mos.Gal 14","m","ROLLO",90]],p_stock:null,p_origen:'t'});
 const [fId,fT]=usr('Felipe',['prov_recibir']);
 const x=JSON.parse(rpc('cb_prov_guardar',{p_clave:ADMIN,p_id:null,p_doc:{tipo:'nacional',proveedor:'Aceros Uno',guia:'G-1',fecha:'2026-11-17'},p_esperado:[{code:'221317',k:'221317',desc:'Mos.Gal 14',qty:10,f:90,ce:'ROLLO',um:'m'}]}).body),idP=x.id||x;
 check(!rpc('cb_prov_foto_puede',{p_puesto:fId,p_ses:'x',p_id:idP}).ok&&!rpc('cb_prov_fotos',{p_clave:ADMIN,p_id:idP}).ok,'Las funciones de fotos NO se pueden llamar con la clave pública (solo la Edge Function)');
 const b=await chromium.launch();const errs=[];
 const cm=await b.newContext({...devices['iPhone 13'],timezoneId:'America/Santiago'});await route(cm);const m=await cm.newPage();m.on('pageerror',e=>errs.push('cel: '+e.message));
 await m.goto(`${B}?puesto=${fId}&t=${fT}&u=${encodeURIComponent(SBU)}&k=anon`);await m.waitForTimeout(2000);await m.fill('#puPersona','FELIPE');await m.dispatchEvent('#puPersona','change');await m.waitForTimeout(300);
 await m.tap('#puMenu [data-pk="prov"]');await m.waitForTimeout(1500);await m.tap(`#pcHome [data-pc="${idP}"]`);await m.waitForTimeout(800);
 check(/A recibir:\s*10\s*rollos\s*=\s*900 m/i.test(await m.textContent('#pcDecl')),'Celular: el packing list muestra la cantidad a recibir (10 rollos = 900 m)');
 // foto grande (3000 px) para probar la compresión
 const big=await m.evaluate(()=>{const c=document.createElement('canvas');c.width=3000;c.height=2000;const g=c.getContext('2d');for(let i=0;i<300;i++){g.fillStyle=`hsl(${i*7},70%,50%)`;g.fillRect(Math.random()*3000,Math.random()*2000,200,200)}return c.toDataURL('image/jpeg',0.95).split(',')[1]});
 require('fs').writeFileSync('/tmp/_foto.jpg',Buffer.from(big,'base64'));
 await m.setInputFiles('#pcFoto','/tmp/_foto.jpg');await m.waitForTimeout(2500);
 const f=JSON.parse(sql(`select fotos::text from cb_prov where id='${idP}'`));
 const kb=f.length?Buffer.from(BUCKET.get(f[0].path),'base64').length/1024:0;
 check(f.length===1&&f[0].persona==='FELIPE'&&f[0].path.startsWith(idP+'/'),'Foto subida y anotada en la recepción (con quién la tomó)');
 check(kb>5&&kb<450,`Comprimida en el celular: ${Math.round(kb)} KB (original 3000 px)`);
 check(/1 subida/.test(await m.textContent('#pcFotosInfo')),'Celular: cuenta "1 subida"');
 // sin señal: queda en el celular y se sube al volver
 await cm.setOffline(true);await m.setInputFiles('#pcFoto','/tmp/_foto.jpg');await m.waitForTimeout(1500);
 check(/por subir/.test(await m.textContent('#pcFotosList'))&&JSON.parse(sql(`select fotos::text from cb_prov where id='${idP}'`)).length===1,'Sin señal: la foto queda "por subir" en el celular');
 await cm.setOffline(false);await m.evaluate(()=>window.dispatchEvent(new Event('online')));await m.waitForTimeout(2500);
 check(JSON.parse(sql(`select fotos::text from cb_prov where id='${idP}'`)).length===2&&!/por subir/.test(await m.textContent('#pcFotosList')),'Vuelve la señal: se sube sola');
 // máximo 6
 for(let i=0;i<4;i++){await m.setInputFiles('#pcFoto','/tmp/_foto.jpg');await m.waitForTimeout(1800)}
 check(JSON.parse(sql(`select fotos::text from cb_prov where id='${idP}'`)).length===6&&await m.isDisabled('#pcFoto'),'Máximo 6 fotos: el botón se desactiva');
 const ses=await m.evaluate(()=>PST.ses);check(/max_fotos/.test(sqlE(`select cb_prov_foto_puede('${fId}','${ses}','${idP}')`).v),'El servidor también frena la 7ª (max_fotos)');
 // panel: ver las fotos
 const cs=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago'});await route(cs);const s=await cs.newPage();s.on('pageerror',e=>errs.push('panel: '+e.message));
 await s.goto(B+'#panel');await s.evaluate(([u,a])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await s.goto(B+'#prov');await s.reload();await s.waitForTimeout(3000);await s.click(`#pvTbl [data-pv="${idP}"]`);await s.waitForTimeout(500);
 check(/Ver fotos de bodega · 6/.test(await s.textContent('#pvFotos')),'Panel: botón "Ver fotos de bodega · 6"');
 await s.click('#pvFotosB');await s.waitForTimeout(1500);
 const imgs=await s.$$eval('#pvFotosG img',x=>x.filter(i=>i.complete&&i.naturalWidth>0).length);
 check(imgs===6&&/FELIPE/.test(await s.textContent('#pvFotosG')),'Panel: se ven las 6 fotos con quién las tomó → '+imgs);
 // anulada: no se suben más
 rpc('cb_prov_eliminar',{p_clave:ADMIN,p_id:idP});check(/anulado/.test(sqlE(`select cb_prov_foto_puede('${fId}','${ses}','${idP}')`).v),'Anulada: no acepta fotos');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 await b.close();console.log(fail?'FALLAS: '+fail:'TODO OK')})();
