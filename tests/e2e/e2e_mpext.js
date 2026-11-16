const {execFileSync}=require('child_process');
const PG=['-h','/var/lib/postgresql/cctest/sock','-p','55432','-U','postgres','-tAq','-v','ON_ERROR_STOP=1'];
const sql=q=>execFileSync('psql',[...PG,'-c',q],{encoding:'utf8'}).trim();
let fail=0;const check=(c,m)=>{console.log((c?'✅ ':'❌ ')+m);if(!c)fail++};const C="'clave-supervisor-123'";
// Extender la vigencia de una entrega MP reabre el lado "Recibe" que quedó terminado (sin tocar lecturas)
sql(`select cb_configurar(${C})`);
const r=JSON.parse(sql(`select cb_mov_crear(${C},'Ext',now()+interval '1 hour','[["110107","","ALAMBRE","kg"]]'::jsonb,'{}'::jsonb)::text`));
const sE=sql(`select cb_mov_abrir('${r.id}','${r.token}','dE','E')->>'secret'`),sR=sql(`select cb_mov_abrir('${r.id}','${r.token}','dR','R')->>'secret'`);
sql(`select cb_mov_enviar('${r.id}','E','${sE}','B','[{"lid":"a","code":"110107","qty":3}]')`);sql(`select cb_mov_terminar('${r.id}','R','${sR}')`);
check(sql(`select terminado is not null from cb_mov_lado where mov='${r.id}' and rol='R'`)==='t','Recibe quedó terminado');
const x=JSON.parse(sql(`select cb_mov_extender(${C},'${r.id}',now()+interval '1 day')::text`));
check(x.reabiertos===1&&sql(`select count(*) from cb_mov_lado where mov='${r.id}' and terminado is not null`)==='0','Extender vigencia: reabre el lado terminado');
check(sql(`select count(*) from cb_mov_lect where mov='${r.id}'`)==='1','Las lecturas no cambian');
sql(`select cb_mov_eliminar(${C},'${r.id}')`);
let e='';try{sql(`select cb_mov_extender(${C},'${r.id}',now()+interval '1 day')`)}catch(z){e=String(z.stderr||z)}
check(/anulado/.test(e),'Una entrega anulada no se puede extender');
console.log(fail?'FALLAS: '+fail:'TODO OK');
