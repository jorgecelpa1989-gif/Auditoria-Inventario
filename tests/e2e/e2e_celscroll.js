// Celular (pantalla chica): cada opción del menú entra arriba, en su propia pantalla (no queda corrida ni debajo del menú)
const {chromium,devices}=require('playwright');const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;try{return {ok:true,body:execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim()||'null'}}catch(e){return {ok:false,body:'{}'}}}
let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};const B='http://localhost:8811/index.html',SBU='https://test.supabase.co',ADMIN='clave-supervisor-123';
(async()=>{rpc('cb_configurar',{p_clave:ADMIN});sql("delete from cb_dev; delete from cb_puesto; delete from cb_prov");
 rpc('cb_catalogo_subir',{p_clave:ADMIN,p_items:[["110107","","ALAMBRE","kg"]],p_stock:null,p_origen:'t'});
 const id=JSON.parse(rpc('cb_u_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'Jorge',p_area:'Bodega',p_permisos:['conteo','dev_cargar','dev_recibir','mp_entregar','prov_recibir','pt_recibir','ubic_mover'],p_activo:true}).body);const t='tok'+id+'xxxxxxxxxxxx';rpc('cb_puesto_link',{p_clave:ADMIN,p_puesto:id,p_token:t});
 for(const g of ['1','2','3'])rpc('cb_dev_crear_panel',{p_clave:ADMIN,p_area:'Picking retail',p_doc:{guia:g,factura:'',fecha:'2026-11-17'},p_lect:[{code:'110107',k:'110107',qty:5,lid:'a'+g,t:'2026-11-17T10:00:00Z'}]});
 rpc('cb_prov_guardar',{p_clave:ADMIN,p_id:null,p_doc:{tipo:'nacional',proveedor:'X',guia:'G',fecha:'2026-11-17'},p_esperado:[]});
 const b=await chromium.launch();const c=await b.newContext({...devices['iPhone SE']});
 await c.route(SBU+'/rest/v1/rpc/*',async r=>{const fn=r.request().url().split('/').pop();const x=rpc(fn,JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:x.ok?200:400,contentType:'application/json',body:x.body})});
 const m=await c.newPage();await m.goto(`${B}?puesto=${id}&t=${t}&u=${encodeURIComponent(SBU)}&k=anon`);await m.waitForTimeout(2000);await m.fill('#puPersona','JORGE');await m.dispatchEvent('#puPersona','change');await m.waitForTimeout(500);
 const pos=async(l,maxY=0)=>{const r=await m.evaluate(()=>({y:Math.round(scrollY),menu:!document.querySelector('#puMenu').hidden,vista:([...document.querySelectorAll('section.view')].find(s=>!s.hidden)||{}).id}));check(r.y<=maxY&&(r.vista!=='v-puesto'||!r.menu),l+' → parte arriba y dentro de la opción '+JSON.stringify(r));return r};
 for(const k of ['devrec','dev','prov','pt','ubic','mp']){
   await m.evaluate(()=>{document.querySelector('[data-menu]')&&0});
   await m.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));await m.waitForTimeout(200);
   const btn=await m.$(`#puMenu [data-pk="${k}"]`);if(!btn){console.log(k,'sin botón');continue}
   await btn.scrollIntoViewIfNeeded();await btn.tap();await m.waitForTimeout(1500);await pos('abrir '+k);
   if(k==='devrec'){await m.tap('#dvHome [data-dv]');await m.waitForTimeout(800);await pos('  elegir devolución',60);await m.tap('#dvBack');await m.waitForTimeout(800);await pos('  volver');}
   const back=await m.$('section.view:not([hidden]) [data-menu]');if(back){await back.tap();await m.waitForTimeout(800)}else{await m.evaluate(()=>puestoMenu&&puestoMenu());await m.waitForTimeout(800)}
 }
 await m.tap('#puMenu [data-pk="mp"]');await m.waitForTimeout(1200);check(await m.isVisible('#puList [data-pumenu]'),'Entrega MP: tiene «← Menú»');await m.tap('#puList [data-pumenu]');await m.waitForTimeout(500);check(await m.isVisible('#puMenu'),'«← Menú» vuelve al menú');
 await b.close();console.log(fail?'FALLAS: '+fail:'TODO OK')})();
