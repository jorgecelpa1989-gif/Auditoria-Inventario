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
const den=r=>!r.ok&&/^(clave_supervisor|sin_permiso)$/.test(r.err);   // rechazo por permisos
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
const dummy=t=>t==='uuid'?U:t==='jsonb'?[]:t==='boolean'?true:/timestamp/.test(t)?new Date().toISOString():t==='date'?'2026-01-01':t==='numeric'||t==='integer'?1:t==='uuid[]'?[U]:'x';
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
  check(den(rpc(fn,Object.assign({p_clave:sA},a))),'MP: NO puede '+fn.replace('cb_mov_',''));
sql(`insert into cb_mov_lado(mov,rol,device,secret_hash,terminado) values ('${mov.v.id}','E','d1','x',now()),('${mov.v.id}','R','d2','x',now())`);
check(rpc('cb_mov_finalizar',{p_clave:sA,p_id:mov.v.id}).ok,'MP: el cierre automático (ambos lados terminaron) sí funciona');

// --- Recepción PT ---
check(rpc('cb_pt_listar',{p_clave:sA,p_desde:new Date(Date.now()-864e5).toISOString()}).ok,'PT: ve la cuadratura');
check(den(rpc('cb_pt_editar_panel',{p_clave:sA,p_lid:'x',p_qty:0,p_persona:'x'}))&&den(rpc('cb_pt_agregar_panel',{p_clave:sA,p_dia:'2026-01-01',p_hora:'10:00',p_lado:'E',p_data:{}})),'PT: NO puede corregir ni agregar registros');

// --- Devoluciones ---
sql(`insert into cb_dev(origen,area,persona,guia,fecha,lect,enviado) values ('u_x','Distribución','CHOFER','G-DIST',current_date,'[]',now()),('u_y','Producción','DAVID','G-PROD',current_date,'[]',now()),('u_z','Picking retail','BARBARA','G-RET',current_date,'[]',now())`);
const dl=rpc('cb_dev_listar',{p_clave:sA}).v;
check(dl.length===1&&dl[0].guia==='G-PROD','Devoluciones: ve solo las de Producción (no Distribución ni Retail) → '+dl.map(d=>d.guia).join(','));
check(rpc('cb_dev_listar',{p_clave:ADMIN}).v.length===3,'Devoluciones: el administrador sigue viendo las 3');
const dc=rpc('cb_dev_crear_panel',{p_clave:sA,p_area:'Distribución',p_doc:{guia:'G-NUEVA',fecha:'2026-11-10',persona:'OTRO NOMBRE'},p_lect:[{lid:'a',code:'110107',k:'110107',qty:2}]});
const dn=sql(`select area||'|'||persona from cb_dev where guia='G-NUEVA'`);
check(dc.ok&&dn==='Producción|Supervisor Prod. 1','Devoluciones: crea, y queda SIEMPRE en Producción y a su nombre (aunque mande otra cosa) → '+dn);
const did=sql("select id from cb_dev where guia='G-DIST'");
check(den(rpc('cb_dev_cerrar',{p_clave:sA,p_id:did}))&&den(rpc('cb_dev_eliminar',{p_clave:sA,p_id:did}))&&sql("select count(*) from cb_dev")==='4','Devoluciones: NO puede cerrar ni eliminar');

// --- Supervisor B: solo PT ---
check(rpc('cb_pt_listar',{p_clave:sB,p_desde:new Date().toISOString()}).ok&&rpc('cb_catalogo_ver',{p_clave:sB}).ok,'Supervisor "solo PT": ve PT y la lista de productos');
check(['cb_mov_listar','cb_dev_listar'].every(f=>rpc(f,{p_clave:sB}).err==='sin_permiso')&&rpc('cb_mov_crear',{p_clave:sB,p_nombre:'x',p_vence:null,p_items:[],p_meta:{sol:[{}]}}).err==='sin_permiso','Supervisor "solo PT": MP y Devoluciones rechazados (sin_permiso)');

// --- Inventario / Permisos / administración ---
check(['cb_listar','cb_u_listar','cb_sup_listar','cb_catalogo_stock','cb_puesto_estado'].every(f=>den(rpc(f,{p_clave:sA}))),'Inventario, Permisos y lista de supervisores: rechazados');
check(den(rpc('cb_sup_guardar',{p_clave:sA,p_id:A.id,p_nombre:'Yo',p_permisos:['mp_ver','mp_solicitar','pt_ver','dev_ver','dev_crear'],p_activo:true})),'Un supervisor no puede cambiarse sus propios permisos');
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


// --- Matriz completa: un supervisor con UN solo permiso (más los que ese permiso exige) ---
const FN={cb_listar:'inv_ver',cb_lecturas_de:'inv_ver',cb_conteo_codigos:'inv_ver',cb_catalogo_stock:'inv_ver',
  cb_crear:'inv_operar',cb_conteo_editar:'inv_operar',cb_conteo_asignar:'inv_operar',cb_finalizar:'inv_operar',cb_bloquear:'inv_operar',cb_liberar:'inv_operar',cb_catalogo_subir:'inv_operar',
  cb_mov_listar:'mp_ver',cb_mov_lecturas:'mp_ver',cb_mov_crear:'mp_solicitar',cb_mov_agregar_panel:'mp_operar',cb_mov_activar:'mp_operar',cb_mov_extender:'mp_operar',cb_mov_asignar:'mp_operar',cb_mov_bloquear:'mp_operar',cb_mov_liberar:'mp_operar',cb_mov_eliminar:'mp_eliminar',
  cb_pt_listar:'pt_ver',cb_pt_editar_panel:'pt_corregir',cb_pt_agregar_panel:'pt_corregir',
  cb_dev_listar:'dev_ver',cb_dev_crear_panel:'dev_crear',cb_dev_cerrar:'dev_cerrar',cb_dev_eliminar:'dev_eliminar',
  cb_u_listar:'usr_admin|inv_operar|mp_operar',cb_puesto_estado:'usr_admin|inv_operar|mp_operar',cb_u_guardar:'usr_admin',cb_u_liberar:'usr_admin',cb_u_eliminar:'usr_admin',cb_puesto_link:'usr_admin',
  cb_prov_listar:'prov_ver',cb_prov_guardar:'prov_operar',cb_prov_agregar_panel:'prov_operar',cb_prov_corregir:'prov_operar',cb_prov_cerrar:'prov_operar',cb_prov_eliminar:'prov_eliminar',cb_ubic_datos:'ubi_ver',cb_ubic_guardar:'ubi_operar',cb_ubic_mover_panel:'ubi_operar',cb_ubic_anular:'ubi_operar',
  cb_catalogo_ver:'*',cb_sup_yo:'*',cb_mov_finalizar:'mp_operar'};   // finalizar una entrega cualquiera exige "operar" (sin él, solo el cierre automático)
const FIJOS={cb_conteo_asignar:{p_puesto:''}};   // argumentos que evitan errores de negocio ajenos a los permisos
const SOLO_ADMIN=['cb_eliminar','cb_configurar','cb_prod_clave','cb_prod_estado','cb_prod_eliminar','cb_sup_listar','cb_sup_guardar','cb_sup_link','cb_sup_eliminar'];
const PERMS=['inv_ver','inv_operar','mp_ver','mp_solicitar','mp_operar','mp_eliminar','pt_ver','pt_corregir','dev_ver','dev_crear','dev_todas','dev_cerrar','dev_eliminar','prov_ver','prov_operar','prov_eliminar','usr_admin'];
const fns2=sql(`select string_agg(p.proname||'|'||(select string_agg(n||':'||format_type(t,null), ',') from unnest(p.proargnames, p.proargtypes::oid[]) x(n,t)), ';' order by p.proname)
  from pg_proc p where p.pronamespace='public'::regnamespace and 'p_clave' = any(p.proargnames) and has_function_privilege('anon', p.oid, 'execute')`).split(';').map(f=>{const [name,ar]=f.split('|');return {name,ar:ar.split(',').map(a=>a.split(':'))}});
const sinMapa=fns2.map(f=>f.name).filter(n=>!FN[n]&&!SOLO_ADMIN.includes(n));
check(sinMapa.length===0,'Toda función con clave está clasificada (permiso o solo-administrador)'+(sinMapa.length?' → FALTAN: '+sinMapa.join(', '):' · '+fns2.length+' funciones'));
let errM=[];
for(const P of PERMS){const x=nuevo('Solo '+P,[P]);const ses=rpc('cb_sup_vincular',{p_id:x.id,p_token:x.t,p_equipo:'PC'}).v.ses;
  const tiene=rpc('cb_sup_listar',{p_clave:ADMIN}).v.find(u=>u.id===x.id).permisos;
  for(const f of fns2){const args={};for(const [n,t] of f.ar)args[n]=n==='p_clave'?ses:dummy(t);Object.assign(args,FIJOS[f.name]||{});
    const r=rpc(f.name,args),rech=!r.ok&&AUTH.test(r.err);
    const debe=!SOLO_ADMIN.includes(f.name)&&(FN[f.name]==='*'||FN[f.name].split('|').some(q=>tiene.includes(q)));
    if(debe&&rech)errM.push(P+': '+f.name+' debía pasar ('+r.err+')');if(!debe&&!rech)errM.push(P+': '+f.name+' NO rechazó ('+(r.ok?'ok':r.err)+')')}
  rpc('cb_sup_eliminar',{p_clave:ADMIN,p_id:x.id})}
check(errM.length===0,'Matriz '+PERMS.length+' permisos × '+fns2.length+' funciones: cada permiso abre solo lo suyo'+(errM.length?' → '+errM.slice(0,8).join(' · '):''));
sql("delete from cb_mov where nombre='x'; delete from cb_conteos where nombre='x'; delete from cb_puesto where nombre='x'; delete from cb_dev where guia is null or guia='' or guia='x'");
// supervisor con TODO: pasa todo menos lo que es solo del administrador
const T=nuevo('Jefe total',PERMS),sT=rpc('cb_sup_vincular',{p_id:T.id,p_token:T.t,p_equipo:'PC'}).v.ses;
check(SOLO_ADMIN.every(f=>{const d=fns2.find(z=>z.name===f);const a={};for(const [n,t] of d.ar)a[n]=n==='p_clave'?sT:dummy(t);const r=rpc(f,a);return !r.ok&&AUTH.test(r.err)}),'Supervisor con TODOS los permisos: igual no puede tocar supervisores, clave ni acceso de producción');
const mT=rpc('cb_mov_crear',{p_clave:sT,p_nombre:'Entrega del jefe',p_vence:new Date(Date.now()+864e5).toISOString(),p_items:[],p_meta:{sol:[{code:'110107',qty:1}]}});
const mTm=JSON.parse(sql(`select meta::text from cb_mov where id='${mT.v.id}'`));
check(mT.ok&&mTm.estado==='activa'&&mTm.creado_nombre==='Jefe total','MP con "operar": crea la entrega ACTIVA (como el administrador), a su nombre');
check(rpc('cb_mov_finalizar',{p_clave:sT,p_id:mT.v.id}).ok,'MP con "operar": puede cerrar una entrega');
check(rpc('cb_dev_listar',{p_clave:sT}).v.length>=3,'Devoluciones con "todas las áreas": ve también Distribución y Retail');
rpc('cb_dev_crear_panel',{p_clave:sT,p_area:'Distribución',p_doc:{guia:'G-JEFE',fecha:'2026-11-10',persona:'OTRO'},p_lect:[{lid:'a',code:'110107',k:'110107',qty:2}]});
check(sql("select area||'|'||persona from cb_dev where guia='G-JEFE'")==='Distribución|Jefe total','Devoluciones con "todas las áreas": elige el área; queda a su nombre');
sql(`insert into cb_pt(lid,puesto,pallet,data,lado) values ('zz1','u_p','PAL-9','{"lid":"zz1","qty":10}','E')`);rpc('cb_pt_editar_panel',{p_clave:sT,p_lid:'zz1',p_qty:8,p_persona:'Supervisor'});
check(sql("select data->'ed'->0->>'por' from cb_pt where lid='zz1'")==='Jefe total','PT con "corregir": la corrección queda anotada con SU nombre (no "Supervisor")');
// acceso antiguo: eliminar
// --- Compatibilidad: administrador y acceso antiguo de producción ---
check(['cb_mov_listar','cb_dev_listar','cb_listar','cb_u_listar','cb_catalogo_ver'].every(f=>rpc(f,{p_clave:ADMIN}).ok)&&rpc('cb_pt_listar',{p_clave:ADMIN,p_desde:new Date().toISOString()}).ok,'Administrador: todo sigue funcionando con su clave');
rpc('cb_prod_clave',{p_clave:ADMIN,p_nueva:'clave-prod-antigua-123456'});const sP=rpc('cb_prod_vincular',{p_token:'clave-prod-antigua-123456',p_equipo:'PC'}).v;
const mp=rpc('cb_mov_crear',{p_clave:sP,p_nombre:'Sol antigua',p_vence:null,p_items:[],p_meta:{sol:[{code:'110107',qty:1}]}});
check(rpc('cb_mov_listar',{p_clave:sP}).ok&&mp.ok&&rpc('cb_mov_finalizar',{p_clave:sP,p_id:mp.v.id}).ok&&rpc('cb_pt_listar',{p_clave:sP,p_desde:new Date().toISOString()}).ok,'Acceso antiguo de producción: sigue igual que antes (MP y PT)');
check(rpc('cb_dev_listar',{p_clave:sP}).err==='sin_permiso'&&rpc('cb_dev_crear_panel',{p_clave:sP,p_area:'x',p_doc:{},p_lect:[]}).err==='sin_permiso','Acceso antiguo: NO gana acceso a Devoluciones');
check(rpc('cb_mov_crear',{p_clave:sP,p_nombre:'vacía',p_vence:null,p_items:[],p_meta:[]}).err==='sin_productos','Solicitud sin productos o mal formada: rechazada (antes se creaba vacía)');
check(rpc('cb_prod_eliminar',{p_clave:sP}).err==='clave_supervisor'&&rpc('cb_prod_eliminar',{p_clave:ADMIN}).ok&&rpc('cb_mov_listar',{p_clave:sP}).err==='acceso_produccion'&&rpc('cb_prod_estado',{p_clave:ADMIN}).v===null,'Eliminar el acceso antiguo de producción: solo el administrador; el link deja de funcionar al instante');
check(rpc('cb_mov_listar',{p_clave:'clave-equivocada'}).err==='acceso_produccion','Clave cualquiera: rechazada');
console.log(fail?'FALLAS: '+fail:'TODO OK');process.exit(fail?1:0);
