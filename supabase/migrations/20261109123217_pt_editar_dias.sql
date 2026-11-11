
-- =====================================================================
--  Actualización 13 · PT: ver y corregir cantidades de días anteriores
--  · Celular (quien recibe PT): ve sus pallets de un día de los últimos 14 y corrige la cantidad.
--  · Panel del supervisor: corrige la cantidad de cualquier registro de PT.
--  Cada corrección queda anotada en el registro (de → a, quién, cuándo, desde dónde).
--  Solo agrega funciones: la app anterior sigue funcionando igual.
-- =====================================================================

create or replace function public.cb_pt_dia(p_puesto text, p_ses text, p_dia date) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_ini timestamptz; v_hoy date := (now() at time zone 'America/Santiago')::date;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if p_dia is null or p_dia > v_hoy or p_dia < v_hoy - 14 then raise exception 'fecha_invalida'; end if;
  v_ini := p_dia::timestamp at time zone 'America/Santiago';
  return coalesce((select jsonb_agg(data || jsonb_build_object('rt', t) order by t) from cb_pt
                    where puesto = p_puesto and t >= v_ini and t < v_ini + interval '1 day'), '[]'::jsonb);
end $$;

create or replace function public.cb_pt_editar(p_puesto text, p_ses text, p_lid text, p_qty numeric, p_persona text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare r cb_pt;
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if p_qty is null or p_qty <= 0 or p_qty > 1000000 then raise exception 'cantidad_invalida'; end if;
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
  if p_qty is null or p_qty <= 0 or p_qty > 1000000 then raise exception 'cantidad_invalida'; end if;
  update cb_pt set data = data || jsonb_build_object('qty', p_qty, 'ed', coalesce(data->'ed', '[]'::jsonb) ||
         jsonb_build_array(jsonb_build_object('de', data->'qty', 'a', p_qty, 'por', left(coalesce(p_persona, 'Supervisor'), 80), 't', now(), 'via', 'panel')))
   where lid = p_lid;
  if not found then raise exception 'no_existe'; end if;
  return (select data from cb_pt where lid = p_lid);
end $$;

revoke all on function public.cb_pt_dia(text, text, date), public.cb_pt_editar(text, text, text, numeric, text),
  public.cb_pt_editar_panel(text, text, numeric, text) from public;
grant execute on function public.cb_pt_dia(text, text, date), public.cb_pt_editar(text, text, text, numeric, text),
  public.cb_pt_editar_panel(text, text, numeric, text) to anon, authenticated;
