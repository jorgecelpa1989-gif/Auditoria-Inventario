-- PT: permitir corregir una cantidad a 0 (registro anulado, queda en el historial).
create or replace function public.cb_pt_editar(p_puesto text, p_ses text, p_lid text, p_qty numeric, p_persona text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r cb_pt;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if p_qty is null or p_qty < 0 or p_qty > 1000000 then raise exception 'cantidad_invalida'; end if;
  select * into r from cb_pt where lid = p_lid and puesto = p_puesto for update;
  if not found then raise exception 'no_existe'; end if;
  if r.t < now() - interval '15 days' then raise exception 'muy_antiguo'; end if;
  update cb_pt set data = data || jsonb_build_object('qty', p_qty, 'ed', coalesce(data->'ed', '[]'::jsonb) ||
         jsonb_build_array(jsonb_build_object('de', data->'qty', 'a', p_qty, 'por', left(coalesce(p_persona, ''), 80), 't', now(), 'via', 'celular')))
   where lid = p_lid;
  return (select data from cb_pt where lid = p_lid);
end $$;

create or replace function public.cb_pt_editar_panel(p_clave text, p_lid text, p_qty numeric, p_persona text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  perform cb_check(p_clave);
  if p_qty is null or p_qty < 0 or p_qty > 1000000 then raise exception 'cantidad_invalida'; end if;
  update cb_pt set data = data || jsonb_build_object('qty', p_qty, 'ed', coalesce(data->'ed', '[]'::jsonb) ||
         jsonb_build_array(jsonb_build_object('de', data->'qty', 'a', p_qty, 'por', left(coalesce(p_persona, 'Supervisor'), 80), 't', now(), 'via', 'panel')))
   where lid = p_lid;
  if not found then raise exception 'no_existe'; end if;
  return (select data from cb_pt where lid = p_lid);
end $$;
