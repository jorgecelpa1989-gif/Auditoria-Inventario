// Corre las pruebas del panel usando la sesión de un SUPERVISOR con todos los permisos, en vez de la
// clave del administrador. Sirve para comprobar que un supervisor puede operar de verdad cada módulo.
//   Uso:  CC_COMO_SUP=1 bash tests/correr.sh e2e_mp e2e_devdoc ...
// Cómo funciona: antes de que cargue cada página, si el navegador tiene guardada la clave de administrador
// de las pruebas, la cambia por la sesión del supervisor (así la página nunca usa la clave real).
if(process.env.CC_COMO_SUP){
  const {execFileSync}=require('child_process');
  const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
  const ADMIN='clave-supervisor-123';
  const PERMS=(process.env.CC_SUP_PERMS||'inv_ver,inv_operar,mp_ver,mp_solicitar,mp_operar,mp_eliminar,pt_ver,pt_corregir,dev_ver,dev_crear,dev_todas,dev_cerrar,dev_eliminar,usr_admin').split(',');
  const rpc=(fn,a)=>{const o=execFileSync('psql',[...PG,'-c',`set role anon; select rpc_test($$${fn}$$, $j$${JSON.stringify(a)}$j$::jsonb)::text;`],{encoding:'utf8'}).trim();return o?JSON.parse(o):null};
  let ses=null;
  const sesion=()=>{if(ses)return ses;rpc('cb_configurar',{p_clave:ADMIN});
    const id=rpc('cb_sup_guardar',{p_clave:ADMIN,p_id:'',p_nombre:'JEFE DE PRUEBA',p_permisos:PERMS,p_activo:true});
    rpc('cb_sup_link',{p_clave:ADMIN,p_id:id,p_token:'tok-como-supervisor-xxxxxxxx'});
    const v=rpc('cb_sup_vincular',{p_id:id,p_token:'tok-como-supervisor-xxxxxxxx',p_equipo:'PC de prueba'});
    return ses={id,ses:v.ses,nombre:v.nombre,permisos:v.permisos}};
  const pw=require('playwright'),launch=pw.chromium.launch.bind(pw.chromium);
  pw.chromium.launch=async(...a)=>{const b=await launch(...a),nc=b.newContext.bind(b);
    b.newContext=async(...x)=>{const c=await nc(...x),s=sesion();
      await c.addInitScript(([adm,s])=>{try{const sb=JSON.parse(localStorage.getItem('inv_sb')||'null');
        if(sb&&sb.admin===adm){sb.admin=s.ses;localStorage.setItem('inv_sb',JSON.stringify(sb));localStorage.setItem('inv_sup',JSON.stringify(s))}}catch(e){}},[ADMIN,s]);
      return c};
    return b};
}
