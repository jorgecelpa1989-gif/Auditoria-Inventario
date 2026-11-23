// Inventario → Almacenamiento: revisa un conteo por ubicación, calcula IRA, crea ubicaciones nuevas y ajusta a lo contado.
const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const hay=(u,k)=>sql(`select cb_ubic_hay('${u}','${k}')::numeric(12,2)`);
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});
 sql(`insert into cb_ubic(cod,pasillo,rack,nivel,orden,activo) values ('B0902','B','09','2',1,true),('B0903','B','09','3',2,true),('B0904','B','09','4',3,true)`);
 // Almacenamiento hoy: B0902 = 2 sacos 140101 + 5 kg 110107 ; B0903 = 4 sacos 140101 ; B0904 = 1 saco 140101 (no se contó B0904)
 sql(`insert into cb_ubic_mov(tipo,hacia,k,qty,f,ce,um,origen) values ('ingreso','B0902','140101',2,25,'SACO','KG','panel'),('ingreso','B0902','110107',5,1,null,'KG','panel'),('ingreso','B0903','140101',4,25,'SACO','KG','panel'),('ingreso','B0904','140101',1,25,'SACO','KG','panel')`);
 const it=[["140101","","SACO HARINA 25KG","KG","SACO",25],["110107","","ROLLO ALAMBRE","KG"]];
 const c=JSON.parse(rpc('cb_crear',{p_clave:ADMIN,p_nombre:'Inventario B',p_vence:new Date(Date.now()+86400000).toISOString(),p_items:it,p_meta:null}).body);
 const L=(lid,code,qty,ubic,f,ce)=>`('${c.id}','${lid}',jsonb_build_object('lid','${lid}','code','${code}','k','${code}','qty',${qty},'ubic','${ubic}','um','KG'${f?`,'f',${f},'ce','${ce}'`:''},'user','ANA','t','2026-11-24T12:00:00Z'))`;
 // Conteo: B0902 140101 = 2 sacos (cuadra) ; B 09 03 (con espacios) 140101 = 3 sacos (dif) ; B0902 110107 no se contó (faltante)
 //         C0101 (no existe) 110107 = 7 kg ; PICKING RETAIL 140101 = 1 saco ; SIN UBICACIÓN 110107 = 9 (no pasa)
 sql(`insert into cb_lecturas(conteo,lid,data) values ${[L('l1','140101',2,'B0902',25,'SACO'),L('l2','140101',3,'B 09 03',25,'SACO'),L('l3','110107',7,'C0101'),L('l4','140101',1,'PICKING RETAIL',25,'SACO'),L('l5','110107',9,'SIN UBICACIÓN')].join(',')}`);
 sql(`update cb_conteos set n_lecturas=5 where id='${c.id}'`);
 const b=await chromium.launch();const x=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago',acceptDownloads:true});
 await x.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const y=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:y.ok?200:400,contentType:'application/json',body:y.body})});
 const s=await x.newPage();const errs=[];const DQ=[];s.on('dialog',dl=>{const a=DQ.shift();a==null?dl.dismiss():dl.accept(a)});s.on('pageerror',e=>errs.push(e.message));
 await s.goto(B+'#panel');await s.evaluate(([u,a])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await s.reload();await s.waitForTimeout(1500);await s.click('nav.tabs button[data-v="ubic"]');await s.waitForTimeout(2500);
 await s.click('#ubInvTog');await s.waitForTimeout(1500);
 check(/Inventario B/.test(await s.textContent('#ubInvC')),'Lista el conteo con lecturas');
 await s.click('#ubInvVer');await s.waitForTimeout(2500);
 const t=await s.textContent('#ubInvRes');
 // comparadas (ubicaciones existentes contadas B0902, B0903): B0902/140101 ok, B0903/140101 dif, B0902/110107 faltante → IRA 1/3 = 33,3 %
 check(/33[.,]3 %/.test(t)&&/IRA por ubicación/.test(t),'IRA por ubicación = 1 de 3 líneas → 33,3 %');
 check(/C0101/.test(t)&&/PICKING RETAIL/.test(t)&&/Zona de piso/.test(t)&&/hilera C, posición 01, nivel 1/.test(t),'Propone crear C0101 (rack) y PICKING RETAIL (zona)');
 check(/1 lecturas sin ubicación no pasan/.test(t)&&!/SIN UBICACIÓN.*nueva/.test(t),'SIN UBICACIÓN no pasa');
 check(/Faltante/.test(t)&&/Diferencia/.test(t)&&!/B0904/.test(t),'Faltante en ubicación contada; B0904 (no contada) no se toca');
 check(/B0903/.test(t)&&!/B 09 03/.test(t.replace(/En el conteo.*$/s,'')),'"B 09 03" se reconoce como B0903');
 // desmarcar PICKING RETAIL: sus líneas no pasan
 await s.click('#ubInvRes [data-ubnv="PICKING RETAIL"]');await s.waitForTimeout(300);
 const bt=await s.textContent('#ubInvOk');check(/Ajustar 3 líneas/.test(bt),'Marcadas: dif + faltante + C0101 = 3 líneas → '+bt);
 const [dl]=await Promise.all([s.waitForEvent('download'),s.click('#ubInvXls')]);check(/IRA_ubicaciones_Inventario_B/.test(dl.suggestedFilename()),'Excel de revisión e IRA');
 DQ.push('');await s.click('#ubInvOk');await s.waitForTimeout(3000);
 check(hay('B0902','140101')==='50.00'&&hay('B0903','140101')==='75.00'&&hay('B0902','110107')==='0.00'&&hay('C0101','110107')==='7.00'&&hay('B0904','140101')==='25.00','Almacenamiento ajustado a lo contado (B0903 4→3 sacos, faltante a 0, C0101 = 7, B0904 igual)');
 check(sql("select count(*) from cb_ubic where cod='PICKING RETAIL'")==='0'&&sql("select pasillo||'/'||rack||'/'||nivel||'/'||tipo from cb_ubic where cod='C0101'")==='C/01/1/rack','Crea C0101 (rack); PICKING RETAIL desmarcada no se crea');
 check(sql("select string_agg(tipo||':'||coalesce(desde,hacia)||':'||k||':'||qty::numeric(10,2),' ' order by tipo,k) from cb_ubic_mov where origen='inventario'")==='ingreso:C0101:110107:7.00 salida:B0902:110107:5.00 salida:B0903:140101:1.00','Movimientos «ajuste por inventario» correctos');
 check(sql("select n||'|'||ok||'|'||ira||'|'||ingresos||'|'||salidas||'|'||nuevas from cb_ubic_inv")==='3|1|0.3333|1|2|1','Pase guardado: IRA 0,3333 · 1 ingreso · 2 salidas · 1 ubicación nueva');
 check(/IRA\s*33[.,]3 %/.test(await s.textContent('#ubInvHist')),'Historial de pases muestra el IRA');
 // segundo pase del mismo conteo: ya cuadra todo (idempotente)
 await s.click('#ubInvVer');await s.waitForTimeout(2500);
 check(/100 %/.test(await s.textContent('#ubInvRes')),'Segundo pase: IRA 100 % (ya ajustado, no duplica)');
 // permisos: supervisor solo con ubi_ver no puede aplicar
 const sv=JSON.parse(rpc('cb_sup_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'Solo ver',p_permisos:['ubi_ver','inv_ver']}).body);
 check(!rpc('cb_ubic_inv_aplicar',{p_clave:'s_x.y',p_conteo:c.id,p_nuevas:[],p_lineas:[{u:'B0902',k:'140101',obj:0}]}).ok,'Sin permiso no ajusta');
 check(errs.length===0,'Sin errores de JavaScript '+errs.join(' | '));
 await b.close();console.log(fail?'FALLAS: '+fail:'TODO OK');process.exit(fail?1:0)})();
