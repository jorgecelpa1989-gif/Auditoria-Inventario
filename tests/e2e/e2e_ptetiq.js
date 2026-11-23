// Producción PT en el PC: registra pallet con N° correlativo, imprime etiqueta 10x15 (Code128 + EAN-13 interno),
// reimprime, corrige/anula; los códigos de barra los lee el mismo lector del celular (Html5Qrcode).
const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_pt");
 const b=await chromium.launch();const c=await b.newContext({viewport:{width:1366,height:900},timezoneId:'America/Santiago'});
 await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const s=await c.newPage();const errs=[];const DQ=[];s.on('dialog',dl=>{const a=DQ.shift();a==null?dl.dismiss():dl.accept(a)});s.on('pageerror',e=>errs.push(e.message));
 await s.goto(B+'#panel');
 await s.evaluate(([u,a])=>{localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:a,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
 await s.reload();await s.waitForTimeout(1500);
 await s.click('nav.tabs button[data-v="ptprod"]');await s.waitForTimeout(2000);
 check(await s.isVisible('#v-ptprod')&&await s.isVisible('#ppOk'),'Menú: "Producción PT · etiquetas" abre el módulo');
 check(await s.$$eval('#ppList option',o=>o.length)>=2,'Lista de productos cargada para buscar por código o nombre');
 await s.fill('#ppCod','140101');await s.fill('#ppQty','4');await s.waitForTimeout(200);
 const inf=await s.textContent('#ppInfo');check(/SACO HARINA/.test(inf)&&/4 SACOS = 100 KG/i.test(inf),'Muestra producto y conversión 4 sacos = 100 kg → '+inf);
 await s.click('#ppOk');await s.waitForTimeout(2500);
 const r1=sql("select pallet||'|'||lado||'|'||puesto||'|'||(data->>'qty')||'|'||(data->>'f')||'|'||(data->>'ce')||'|'||jsonb_array_length(data->'imp') from cb_pt");
 check(r1==='P000001|E|panel_prod|4|25|SACO|1','Servidor: pallet P000001, lado producción, 4 sacos de 25, 1 impresión → '+r1);
 const fr=s.frame({url:/about:blank/})||s.frames().find(f=>f!==s.mainFrame());
 const lbl=await (await s.$('#ppFrame')).contentFrame();const tx=await lbl.textContent('body');
 check(/P000001/.test(tx)&&/140101/.test(tx)&&/2000001401019/.test(tx)&&/SACO HARINA/.test(tx)&&/4 SACOS/.test(tx)&&/100 KG/i.test(tx)&&/Impresión: \d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}/.test(tx)&&!/REIMPRESIÓN/.test(tx),'Etiqueta: pallet, código, EAN-13, descripción, bultos, conversión, fecha y hora');
 check(await lbl.$$eval('.bc svg',v=>v.length)===2&&await lbl.$$eval('.cod svg',v=>v.length===1&&/140101/.test(v[0].textContent)),'Etiqueta con 2 códigos de barra y el código numérico grande');
 // leer los códigos de barra con el lector del celular
 const leidos=await s.evaluate(async()=>{const fr=document.querySelector('#ppFrame').contentDocument;const out=[];
   for(const sv of fr.querySelectorAll('.bc svg')){const img=new Image();img.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(sv.outerHTML);await img.decode();
     const cv=document.createElement('canvas');cv.width=900;cv.height=220;const g=cv.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,900,220);g.drawImage(img,20,20,860,180);
     const blob=await new Promise(r=>cv.toBlob(r,'image/png'));let d=document.getElementById('tstRd');if(!d){d=document.createElement('div');d.id='tstRd';d.style.display='none';document.body.appendChild(d)}
     try{out.push(await new Html5Qrcode('tstRd').scanFile(new File([blob],'b.png',{type:'image/png'}),false))}catch(e){out.push('ERR:'+e)}}return out});
 check(leidos[0]==='P000001'&&leidos[1]==='2000001401019','El lector del celular lee pallet y EAN-13 → '+leidos.join(' | '));
 check(await s.evaluate(()=>eanCod('2000001401019')==='140101'&&eanInt('140101')==='2000001401019'&&eanCod('2000001401011')===''),'EAN-13 interno ⇄ código (dígito verificador)');
 // segundo pallet: correlativo
 await s.fill('#ppCod','110107');await s.fill('#ppQty','3');await s.click('#ppOk');await s.waitForTimeout(2500);
 check(sql("select string_agg(pallet,',' order by pallet) from cb_pt")==='P000001,P000002','Correlativo: P000002');
 check((await s.$$('#ppTbl tbody tr')).length===2&&/2 pallets/.test(await s.textContent('#ppRes')),'Lista del día con los 2 pallets');
 // reimprimir
 await s.click('#ppTbl [data-ppre] >> nth=1');await s.waitForTimeout(2000);
 const lbl2=await (await s.$('#ppFrame')).contentFrame();
 check(/REIMPRESIÓN/.test(await lbl2.textContent('body'))&&sql("select jsonb_array_length(data->'imp') from cb_pt where pallet='P000001'")==='2','Reimprimir: marca REIMPRESIÓN y anota la 2ª impresión');
 // corregir y anular
 DQ.push('5');await s.click('#ppTbl [data-pped] >> nth=1');await s.waitForTimeout(1800);
 check(sql("select (data->>'qty')||'|'||(data->'ed'->0->>'de')||'→'||(data->'ed'->0->>'a') from cb_pt where pallet='P000001'")==='5|4→5','Corregir: 4 → 5 con historial');
 DQ.push('0','');await s.click('#ppTbl [data-pped] >> nth=0');await s.waitForTimeout(1800);
 check(sql("select data->>'qty' from cb_pt where pallet='P000002'")==='0'&&/1 anulado/.test(await s.textContent('#ppRes')),'Anular (0): queda en 0 y se ve anulado');
 // Bodega recibe con el celular "sin número" (como hoy): Recepción PT cuadra el pallet del PC por producto
 sql(`insert into cb_pt(lid,puesto,pallet,data,t,lado) values ('bod1','u_bod','SN-BOD1',jsonb_build_object('lid','bod1','sn',true,'k','140101','code','140101','desc','SACO HARINA 25KG','qty',5,'um','KG','ce','SACO','f',25,'pallet','SN-BOD1','user','FELIPE','t',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')),now(),'R')`);
 await s.click('nav.tabs button[data-v="pt"]');await s.waitForTimeout(2500);
 const pt=await s.textContent('#ptRes');check(/140101/.test(pt)&&/Recibido OK/.test(pt)&&!/En tránsito/.test(pt)&&!/Sin registro de producción/.test(pt)&&/P000001/.test(pt),'Recepción PT: pallet del PC (5 sacos) cuadra con lo recibido sin N° → Recibido OK y se ve su N° P000001');
 // Recepción PT del panel los ve como producción
 const L=JSON.parse(rpc('cb_pt_listar',{p_clave:ADMIN,p_desde:new Date(Date.now()-86400000).toISOString()}).body);
 check(L.pallets.length===3&&L.pallets.filter(p=>p.puesto==='produccion').length===2&&true,'Recepción PT: los pallets salen como "Producción entrega"');
 // permisos
 const sv=rpc('cb_sup_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'Prod PC',p_permisos:['pt_producir']});
 check(sv.ok,'Supervisor con solo "pt_producir" se puede crear');
 const id=JSON.parse(sv.body);
 const rs=rpc('cb_pt_prod_registrar',{p_clave:'s_noexiste.x',p_data:{code:'140101',qty:1}});check(!rs.ok,'Sin sesión válida no registra');
 check(errs.length===0,'Sin errores de JavaScript '+errs.join(' | '));
 await b.close();console.log(fail?'FALLAS: '+fail:'TODO OK');process.exit(fail?1:0)})();
