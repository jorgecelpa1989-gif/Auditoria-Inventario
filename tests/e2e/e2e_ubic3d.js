// Módulo 6 · Almacenamiento: modelo 3D de la bodega (racks y pallets por ubicación) en el panel.
const {chromium}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,body:JSON.stringify({message:m?m[1].trim():'error'})}}}
const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const route=async c=>c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
const entrar=async(ctx,errs)=>{await route(ctx);const a=await ctx.newPage();a.on('pageerror',x=>errs.push(x.message));
  await a.goto(B+'#panel');await a.evaluate(([u,k])=>{localStorage.clear();localStorage.setItem('inv_sb',JSON.stringify({url:u,key:'anon',admin:k,ok:true}));localStorage.setItem('inv_cfg',JSON.stringify({sup:true,dev:'pc'}))},[SBU,ADMIN]);
  await a.goto(B+'#ubic');await a.reload();await a.waitForTimeout(3000);return a};
// colores distintos que quedaron dibujados en el lienzo 3D (si está en blanco, hay 1 solo)
const colores=a=>a.evaluate(()=>{ub3Pintar(performance.now());const gl=ub3.gl,w=ub3.cv.width,h=ub3.cv.height,px=new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,px);
  const s=new Set();for(let i=0;i<px.length;i+=4*7)s.add(px[i]>>3<<10|px[i+1]>>3<<5|px[i+2]>>3);return s.size});
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});
 // Hileras H e I del plano (código H0102 = hilera H, posición 01, nivel 2), una hilera que no está en el plano (Z) y una zona de piso
 const L=[];for(const h of ['H','I'])for(let r=1;r<=4;r++)for(let n=1;n<=3;n++)L.push({cod:`${h}0${r}0${n}`});
 L.push({cod:'Z0101'},{cod:'Z0201'},{cod:'MASIVO',pasillo:'PISO',rack:'MASIVO',nivel:'',tipo:'Piso'});
 check(JSON.parse(rpc('cb_ubic_guardar',{p_clave:ADMIN,p_lista:L,p_reemplazar:true}).body).activas===27,'Carga 27 ubicaciones (hileras H, I, Z y la zona de piso MASIVO)');
 const ing=(lid,u,k,q,f,ce,um,d)=>rpc('cb_ubic_mover_panel',{p_clave:ADMIN,p_mov:{lid,tipo:'ingreso',desde:'',hacia:u,k,code:k,desc:d,qty:q,f,ce,um}}).ok;
 check(ing('a','H0202','140101',10,25,'SACO','kg','SACO HARINA 25KG')&&ing('b','I0101','110107',40,1,'','kg','ROLLO ALAMBRE')&&ing('c','MASIVO','140101',6,25,'SACO','kg','SACO HARINA 25KG'),'Ingresos: harina en H0202 y en MASIVO, alambre en I0101');
 const b=await chromium.launch();const errs=[];
 const a=await entrar(await b.newContext({viewport:{width:1400,height:950},timezoneId:'America/Santiago'}),errs);
 check(await a.isVisible('#ubMapa')&&await a.isHidden('#ub3')&&await a.getAttribute('#ubVista [data-vista="2d"]','aria-pressed')==='true','Al entrar se ve el mapa de siempre; el modelo 3D es una vista aparte');
 await a.click('#ubVista [data-vista="3d"]');await a.waitForTimeout(700);
 check(await a.isVisible('#ub3C')&&await a.isHidden('#ubMapa')&&await a.evaluate(()=>ub3.slots.size)===27,'Modelo 3D: se muestra en lugar del mapa, con sus 27 ubicaciones');
 check(await colores(a)>12,'El modelo queda dibujado (piso, racks y pallets de distintos colores)');
 const g=await a.evaluate(()=>{const s=c=>ub3.slots.get(c),b=c=>s(c).box;return {h1:b('H0101'),h2:b('H0201'),h13:b('H0103'),i1:b('I0101'),z:b('Z0101'),m:b('MASIVO'),piso:!!s('MASIVO').piso,ancho:UB_PLANO.ancho}});
 check(g.i1[0]<1&&g.h1[0]>4&&g.h1[0]<6,'Plano de la bodega: la hilera I va contra el muro y la H al otro lado del pasillo');
 check(g.h2[2]<g.h1[2]&&Math.abs((g.h1[2]-g.h2[2])-1.165)<.01&&Math.abs(g.h13[1]-2.8)<.01,'Medidas de la estantería: 1,165 m por posición y 1,4 m por nivel (nivel 3 a 2,8 m)');
 check(g.z[0]>g.ancho&&g.piso&&g.m[0]>20,'Una hilera que no está en el plano (Z) se dibuja al costado; MASIVO queda en su zona de piso');
 // globo al pasar el mouse y elegir con un clic
 await a.evaluate(()=>ub3Ir('H0202'));await a.waitForTimeout(900);
 const p=await a.evaluate(()=>ub3Pantalla('H0202'));await a.mouse.move(p.x,p.y);await a.waitForTimeout(300);
 const tip=await a.textContent('#ub3Tip');
 check(await a.isVisible('#ub3Tip')&&/H0202/.test(tip)&&/140101/.test(tip)&&/10\s*SACOS/.test(tip)&&/250 kg/.test(tip),'Al pasar sobre el pallet: ubicación, producto y cantidad en bultos con su conversión (10 SACOS = 250 kg)');
 await a.mouse.click(p.x,p.y);await a.waitForTimeout(500);
 check(await a.evaluate(()=>ubSel)==='H0202'&&/Hilera H · posición 02 · nivel 2/.test(await a.textContent('#ub3Sel'))&&await a.isVisible('#ubDet')&&/250 kg/.test(await a.textContent('#ubDetTbl')),'Clic en el pallet: queda elegida H0202 y abajo aparece su detalle e historial');
 // una ubicación vacía no tapa al pallet que se ve detrás; con el filtro Vacías sí se pueden elegir
 await a.evaluate(()=>ub3Ir('H0203'));await a.waitForTimeout(900);
 await a.click('#ubChips [data-f="vac"]');await a.waitForTimeout(400);
 const p3=await a.evaluate(()=>ub3Pantalla('H0203'));await a.mouse.click(p3.x,p3.y);await a.waitForTimeout(400);
 check(await a.evaluate(()=>ubSel)==='H0203'&&/Vacía/.test(await a.textContent('#ub3Sel'))&&await a.evaluate(()=>ub3.tra.n>0),'Filtro Vacías: los espacios libres se marcan y se pueden elegir (H0203 vacía)');
 await a.click('#ubChips [data-f="todas"]');await a.click('#ub3Cer');await a.waitForTimeout(300);
 check(await a.evaluate(()=>ubSel)===null&&await a.isHidden('#ub3Sel'),'Cerrar: se quita la ubicación elegida');
 // buscar un producto: marca sus ubicaciones y el enlace lleva la cámara
 const antes=await a.evaluate(()=>ub3.din.n);await a.fill('#ubQ','harina');await a.waitForTimeout(400);
 check(/H0202/.test(await a.textContent('#ubDonde'))&&/MASIVO/.test(await a.textContent('#ubDonde'))&&await a.evaluate(n=>ub3.din.n>n&&ub3.tra.n>0,antes),'Buscar "harina": lista dónde está y la marca en el modelo (H0202 y MASIVO)');
 await a.click('#ubDonde [data-ubg="MASIVO"]');await a.waitForTimeout(900);
 check(await a.evaluate(()=>ubSel==='MASIVO'&&Math.abs(ub3.cam.x-(ub3.slots.get('MASIVO').box[0]+ub3.slots.get('MASIVO').box[3])/2)<.5)&&await a.isVisible('#ub3'),'Clic en la ubicación del resultado: la cámara va a la zona MASIVO');
 await a.fill('#ubQ','');
 // botones de vista y rueda del mouse
 await a.click('[data-v3="planta"]');await a.waitForTimeout(700);const d0=await a.evaluate(()=>ub3.cam.d);
 check(await a.evaluate(()=>ub3.cam.pitch>1.5&&ub3.cam.yaw===0),'Planta: la cámara queda mirando desde arriba, igual que el layout');
 const r=await a.evaluate(()=>{const q=ub3.caja.getBoundingClientRect();return {x:q.left+q.width/2,y:q.top+q.height/2}});await a.mouse.move(r.x,r.y);await a.mouse.wheel(0,-600);await a.waitForTimeout(300);
 check(await a.evaluate(d=>ub3.cam.d<d,d0),'La rueda del mouse acerca');
 await a.mouse.move(r.x,r.y);await a.mouse.down();await a.mouse.move(r.x+120,r.y+60,{steps:5});await a.mouse.up();await a.waitForTimeout(200);
 check(await a.evaluate(()=>ub3.cam.yaw!==0),'Arrastrar gira el modelo');
 // la vista elegida se recuerda; volver al mapa
 await a.reload();await a.waitForTimeout(3000);
 check(await a.isVisible('#ub3C')&&await a.evaluate(()=>ub3&&ub3.slots.size===27),'Al recargar sigue en el modelo 3D (se recuerda la vista)');
 await a.click('#ubVista [data-vista="2d"]');await a.waitForTimeout(300);
 check(await a.isVisible('#ubMapa')&&await a.isHidden('#ub3')&&(await a.$$('#ubMapa [data-ub]')).length===27,'Volver a "Mapa": el mapa de siempre con sus 27 ubicaciones');
 // equipo sin WebGL: avisa y muestra el mapa
 const c2=await b.newContext({viewport:{width:1400,height:950},timezoneId:'America/Santiago'});
 await c2.addInitScript(()=>{const g=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(t,...x){return /webgl/.test(t)?null:g.call(this,t,...x)}});
 const s=await entrar(c2,errs);await s.click('#ubVista [data-vista="3d"]');await s.waitForTimeout(500);
 check(await s.isVisible('#ubMapa')&&await s.isHidden('#ub3')&&/no permite el modelo 3D/.test(await s.textContent('#toast'))&&await s.evaluate(()=>ubVista)==='2d','Equipo sin WebGL: avisa y se queda en el mapa');
 check(errs.length===0,'Sin errores JS '+errs.join(' | '));
 await b.close();console.log(fail?'FALLAS: '+fail:'TODO OK')})();
