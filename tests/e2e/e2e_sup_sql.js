// Supervisores con permisos: prueba de SEGURIDAD en el servidor (sin pantalla).
// Llama a TODAS las funciones que reciben p_clave con la sesión de un supervisor y exige que
// solo pasen las de su lista; el resto debe rechazar con clave_supervisor o sin_permiso.
const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
function rpc(fn,args){const s=`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(args)}$j$::jsonb)::text;`;
  try{const o=execFileSync('psql',[...PG,'-c',s],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();return {ok:true,v:o?JSON.parse(o):null}}catch(e){const m=(e.stderr||'').match(/ERROR:\s+(.*)/);return {ok:false,err:m?m[1].trim():'error'}}}
const ADMIN='clave-supervisor-123';let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};
const U='00000000-0000-4000-8000-000000000001';
rpc('cb_configurar',{p_clave:ADMIN});
sql("delete from cb_sup; delete from cb_dev; delete from cb_mov; delete from cb_acceso");
sql(`insert into cb_catalogo(id,items,stock,origen) values (1,'[["110107","","ROLLO ALAMBRE","kg","",1]]','{}','t') on conflict (id) do update set items=excluded.items`);
const nuevo=(nom,perm)=>{const id=rpc('cb_sup_guardar',{p_clave:ADMIN,p_id:'',p_nombre:nom,p_permisos:perm,p_activo:true}).v;const t='tok-'+id+'-xxxxxxxxxxxxxxxx';rpc('cb_sup_link',{p_clave:ADMIN,p_id:id,p_token:t});return {id,t}};
const A=nuevo('Supervisor Prod. 1',['mp_solicitar','pt_ver','dev_crear']),B=nuevo('Solo PT',['pt_ver']);
const lA=rpc('cb_sup_listar',{p_clave:ADMIN}).v.find(x=>x.id===A.id);
check(['mp_ver','dev_ver'].every(p=>lA.permisos.includes(p)),'Al dar "crear", se agrega solo el permiso de "ver" del mismo módulo → '+lA.permisos.sort().join(','));
check(rpc('cb_sup_vincular',{p_id:A.id,p_token:'malo',p_equipo:'PC'}).err==='acceso_produccion','Link con token incorrecto: rechazado');
const vA=rpc('cb_sup_vincular',{p_id:A.id,p_token:A.t,p_equipo:'PC A'});const sA=vA.v.ses,sB=rpc('cb_sup_vincular',{p_id:B.id,p_token:B.t,p_equipo:'PC B'}).v.ses;
check(vA.ok&&/^s_[0-9a-f]+\.[0-9a-f]{48}$/.test(sA)&&vA.v.nombre==='Supervisor Prod. 1','Abrir el link: entrega sesión, nombre y permisos');
check(rpc('cb_sup_vincular',{p_id:A.id,p_token:A.t,p_equipo:'OTRO PC'}).err==='prod_usado','El mismo link en otro equipo: rechazado (amarrado al primero)');
check(sql("select count(*) from cb_sup where sesion_hash like '$2%' and hash like '$2%'")==='2','Token y sesión guardados con bcrypt (no en texto)');

// --- Lista blanca: todas las funciones con p_clave, llamadas como supervisor A ---
const fns=sql(`select string_agg(p.proname||'|'||(select string_agg(n||':'||format_type(t,null), ',') from unnest(p.proargnames, p.proargtypes::oid[]) x(n,t)), ';' order by p.proname)
  from pg_proc p where p.pronamespace='public'::regnamespace and 'p_clave' = any(p.proargnames) and has_function_privilege('anon', p.oid, 'execute')`).split(';');
const dummy=t=>t==='uuid'?U:t==='jsonb'?[]:t==='boolean'?true:/timestamp/.test(t)?new Date().toISOString():t==='date'?'2026-01-01':t==='numeric'?1:t==='uuid[]'?[U]:'x';
const PERMITIDAS=new Set(['cb_catalogo_ver','cb_mov_listar','cb_mov_lecturas','cb_mov_crear','cb_pt_listar','cb_dev_listar','cb_dev_crear_panel','cb_sup_yo']);
const AUTH=/^(clave_supervisor|sin_permiso|acceso_produccion|usuario_inactivo)$/;let malas=[],pasaron=[];
for(const f of fns){const [name,ar]=f.split('|');const args={};for(const a of ar.split(',')){const [n,t]=a.split(':');args[n]=n==='p_clave'?sA:dummy(t)}
  const r=rpc(name,args),auth=!r.ok&&AUTH.test(r.err);
  if(PERMITIDAS.has(name)){if(auth)malas.push(name+' (debía pasar: '+r.err+')');else pasaron.push(name)}
  else if(!auth)malas.push(name+' (NO rechazó: '+(r.ok?'ok':r.err)+')')}
check(fns.length>=40,'Se probaron las '+fns.length+' funciones que reciben clave');
check(malas.length===0,'Supervisor: solo pasan '+PERMITIDAS.size+' funciones; las otras '+(fns.length-PERMITIDAS.size)+' rechazan'+(malas.length?' → '+malas.join(' · '):''));
check(sql("select count(*) from cb_mov")==='0'&&sql("select count(*) from cb_puesto where nombre='x'")==='0','Las llamadas rechazadas no dejaron datos');

// --- Entrega MP ---
const mov=rpc('cb_mov_crear',{p_clave:sA,p_nombre:'Solicitud prueba',p_vence:null,p_items:[],p_meta:{sol:[{code:'110107',qty:5}]}});
const meta=JSON.parse(sql(`select meta::text from cb_mov where id='${mov.v&&mov.v.id}'`)||'{}');
check(mov.ok&&!mov.v.token&&meta.estado==='solicitada'&&meta.creado_por==='sup'&&meta.creado_nombre==='Supervisor Prod. 1','MP: crea SOLICITUD (sin link), queda a su nombre → '+meta.estado+' / '+meta.creado_nombre);
check(rpc('cb_mov_listar',{p_clave:sA}).v.every(m=>m.token==null),'MP: ve el panel, pero nunca recibe links de entrega');
check(rpc('cb_mov_finalizar',{p_clave:sA,p_id:mov.v.id}).err==='sin_permiso'&&sql(`select finalizado is null from cb_mov where id='${mov.v.id}'`)==='t','MP: NO puede finalizar una entrega');
for(const [fn,a] of [['cb_mov_eliminar',{p_id:mov.v.id}],['cb_mov_extender',{p_id:mov.v.id,p_vence:new Date().toISOString()}],['cb_mov_activar',{p_id:mov.v.id,p_vence:new Date().toISOString()}],['cb_mov_asignar',{p_id:mov.v.id,p_si:true}],['cb_mov_bloquear',{p_id:mov.v.id,p_rol:'E',p_si:true}],['cb_mov_liberar',{p_id:mov.v.id,p_rol:'E'}]])
  check(rpc(fn,Object.assign({p_clave:sA},a)).err==='clave_supervisor','MP: NO puede '+fn.replace('cb_mov_',''));
sql(`insert into cb_mov_lado(mov,rol,device,secret_hash,terminado) values ('${mov.v.id}','E','d1','x',now()),('${mov.v.id}','R','d2','x',now())`);
check(rpc('cb_mov_finalizar',{p_clave:sA,p_id:mov.v.id}).ok,'MP: el cierre automático (ambos lados terminaron) sí funciona');

// --- Recepción PT ---
check(rpc('cb_pt_listar',{p_clave:sA,p_desde:new Date(Date.now()-864e5).toISOString()}).ok,'PT: ve la cuadratura');
check(rpc('cb_pt_editar_panel',{p_clave:sA,p_lid:'x',p_qty:0,p_persona:'x'}).err==='clave_supervisor'&&rpc('cb_pt_agregar_panel',{p_clave:sA,p_dia:'2026-01-01',p_hora:'10:00',p_lado:'E',p_data:{}}).err==='clave_supervisor','PT: NO puede corregir ni agregar registros');

// --- Devoluciones ---
sql(`insert into cb_dev(origen,area,persona,guia,fecha,lect,enviado) values ('u_x','Distribución','CHOFER','G-DIST',current_date,'[]',now()),('u_y','Producción','DAVID','G-PROD',current_date,'[]',now()),('u_z','Picking retail','BARBARA','G-RET',current_date,'[]',now())`);
const dl=rpc('cb_dev_listar',{p_clave:sA}).v;
check(dl.length===1&&dl[0].guia==='G-PROD','Devoluciones: ve solo las de Producción (no Distribución ni Retail) → '+dl.map(d=>d.guia).join(','));
check(rpc('cb_dev_listar',{p_clave:ADMIN}).v.length===3,'Devoluciones: el administrador sigue viendo las 3');
const dc=rpc('cb_dev_crear_panel',{p_clave:sA,p_area:'Distribución',p_doc:{guia:'G-NUEVA',fecha:'2026-11-10',persona:'OTRO NOMBRE'},p_lect:[{lid:'a',code:'110107',k:'110107',qty:2}]});
const dn=sql(`select area||'|'||persona from cb_dev where guia='G-NUEVA'`);
check(dc.ok&&dn==='Producción|Supervisor Prod. 1','Devoluciones: crea, y queda SIEMPRE en Producción y a su nombre (aunque mande otra cosa) → '+dn);
const did=sql("select id from cb_dev where guia='G-DIST'");
check(rpc('cb_dev_cerrar',{p_clave:sA,p_id:did}).err==='clave_supervisor'&&rpc('cb_dev_eliminar',{p_clave:sA,p_id:did}).err==='clave_supervisor'&&sql("select count(*) from cb_dev")==='4','Devoluciones: NO puede cerrar ni eliminar');

// --- Supervisor B: solo PT ---
check(rpc('cb_pt_listar',{p_clave:sB,p_desde:new Date().toISOString()}).ok&&rpc('cb_catalogo_ver',{p_clave:sB}).ok,'Supervisor "solo PT": ve PT y la lista de productos');
check(['cb_mov_listar','cb_dev_listar'].every(f=>rpc(f,{p_clave:sB}).err==='sin_permiso')&&rpc('cb_mov_crear',{p_clave:sB,p_nombre:'x',p_vence:null,p_items:[],p_meta:{sol:[{}]}}).err==='sin_permiso','Supervisor "solo PT": MP y Devoluciones rechazados (sin_permiso)');

// --- Inventario / Permisos / administración ---
check(['cb_listar','cb_u_listar','cb_sup_listar','cb_catalogo_stock','cb_puesto_estado'].every(f=>rpc(f,{p_clave:sA}).err==='clave_supervisor'),'Inventario, Permisos y lista de supervisores: rechazados');
check(rpc('cb_sup_guardar',{p_clave:sA,p_id:A.id,p_nombre:'Yo',p_permisos:['mp_ver','mp_solicitar','pt_ver','dev_ver','dev_crear'],p_activo:true}).err==='clave_supervisor','Un supervisor no puede cambiarse sus propios permisos');
check(rpc('cb_sup_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'X',p_permisos:['admin'],p_activo:true}).err==='datos_invalidos','No existe un permiso "admin" que se pueda regalar');

// --- Sesiones ---
check(rpc('cb_mov_listar',{p_clave:'s_abcdef12.'+'0'.repeat(48)}).err==='acceso_produccion'&&rpc('cb_mov_listar',{p_clave:sA.split('.')[0]+'.'+'f'.repeat(48)}).err==='acceso_produccion','Sesión inventada o con secreto falso: rechazada');
for(const f of ['cb_sup_de','cb_puede','cb_rol','cb_check']){let den=false;try{execFileSync('psql',[...PG,'-c',`set role anon; select ${f}('x'${f==='cb_puede'?",'*'":''})`],{stdio:['ignore','pipe','pipe']})}catch(e){den=/permission denied/.test(e.stderr)}check(den,'Función interna '+f+': no se puede llamar desde afuera')}
rpc('cb_sup_guardar',{p_clave:ADMIN,p_id:A.id,p_nombre:'Supervisor Prod. 1',p_permisos:lA.permisos,p_activo:false});
check(rpc('cb_mov_listar',{p_clave:sA}).err==='usuario_inactivo'&&rpc('cb_sup_yo',{p_clave:sA}).err==='usuario_inactivo','Desactivar: su sesión deja de funcionar al instante');
rpc('cb_sup_guardar',{p_clave:ADMIN,p_id:A.id,p_nombre:'Supervisor Prod. 1',p_permisos:lA.permisos,p_activo:true});
check(rpc('cb_sup_yo',{p_clave:sA}).v.nombre==='Supervisor Prod. 1','Reactivar: vuelve a funcionar');
rpc('cb_sup_link',{p_clave:ADMIN,p_id:A.id,p_token:'tok-nuevo-xxxxxxxxxxxxxxxxxx'});
check(rpc('cb_mov_listar',{p_clave:sA}).err==='acceso_produccion','Liberar (link nuevo): la sesión del equipo anterior queda inválida');
rpc('cb_sup_eliminar',{p_clave:ADMIN,p_id:B.id});
check(rpc('cb_pt_listar',{p_clave:sB,p_desde:new Date().toISOString()}).err==='acceso_produccion','Eliminar supervisor: su sesión queda inválida');

// --- Compatibilidad: administrador y acceso antiguo de producción ---
check(['cb_mov_listar','cb_dev_listar','cb_listar','cb_u_listar','cb_catalogo_ver'].every(f=>rpc(f,{p_clave:ADMIN}).ok)&&rpc('cb_pt_listar',{p_clave:ADMIN,p_desde:new Date().toISOString()}).ok,'Administrador: todo sigue funcionando con su clave');
rpc('cb_prod_clave',{p_clave:ADMIN,p_nueva:'clave-prod-antigua-123456'});const sP=rpc('cb_prod_vincular',{p_token:'clave-prod-antigua-123456',p_equipo:'PC'}).v;
const mp=rpc('cb_mov_crear',{p_clave:sP,p_nombre:'Sol antigua',p_vence:null,p_items:[],p_meta:{sol:[{code:'110107',qty:1}]}});
check(rpc('cb_mov_listar',{p_clave:sP}).ok&&mp.ok&&rpc('cb_mov_finalizar',{p_clave:sP,p_id:mp.v.id}).ok&&rpc('cb_pt_listar',{p_clave:sP,p_desde:new Date().toISOString()}).ok,'Acceso antiguo de producción: sigue igual que antes (MP y PT)');
check(rpc('cb_dev_listar',{p_clave:sP}).err==='sin_permiso'&&rpc('cb_dev_crear_panel',{p_clave:sP,p_area:'x',p_doc:{},p_lect:[]}).err==='sin_permiso','Acceso antiguo: NO gana acceso a Devoluciones');
check(rpc('cb_mov_crear',{p_clave:sP,p_nombre:'vacía',p_vence:null,p_items:[],p_meta:[]}).err==='sin_productos','Solicitud sin productos o mal formada: rechazada (antes se creaba vacía)');
check(rpc('cb_mov_listar',{p_clave:'clave-equivocada'}).err==='acceso_produccion','Clave cualquiera: rechazada');
console.log(fail?'FALLAS: '+fail:'TODO OK');process.exit(fail?1:0);
