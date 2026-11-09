
-- =====================================================================
--  Actualización 12 · Entrega directa de MP desde el celular de bodega
--  El usuario con permiso "Entrega MP" puede abrir una entrega él mismo (cuando producción
--  le pide algo en el momento), sin esperar que el supervisor la genere. Queda visible para
--  quien recibe en producción y en el panel, como cualquier entrega. Solo agrega una función.
-- =====================================================================

create or replace function public.cb_puesto_mov_crear(p_puesto text, p_ses text, p_ref text default null, p_persona text default null) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := encode(extensions.gen_random_bytes(12), 'hex'); v_id uuid; v_items jsonb; v_vence timestamptz; v_nom text;
        v_hoy timestamptz := date_trunc('day', now() at time zone 'America/Santiago') at time zone 'America/Santiago';
begin
  perform cb_puesto_ok(p_puesto, p_ses);
  if not cb_u_tiene(p_puesto, 'mp_entregar') then raise exception 'sin_permiso'; end if;
  if (select count(*) from cb_mov where meta->>'origen' = p_puesto and creado >= v_hoy) >= 40 then raise exception 'limite_diario'; end if;
  select items into v_items from cb_catalogo where id = 1;
  if v_items is null or jsonb_array_length(v_items) = 0 then raise exception 'sin_productos'; end if;
  v_vence := greatest(v_hoy + interval '23 hours 59 minutes', now() + interval '4 hours');
  v_nom := 'Entrega directa · ' || to_char(now() at time zone 'America/Santiago', 'DD-MM HH24:MI')
           || coalesce(' · ' || nullif(left(trim(p_ref), 60), ''), '');
  insert into cb_mov(nombre, vence, token_hash, link_token, items, meta)
  values (v_nom, v_vence, extensions.crypt(v_token, extensions.gen_salt('bf')), v_token, v_items,
          jsonb_build_object('estado', 'activa', 'activada', now(), 'puestos', true, 'directa', true, 'creado_por', 'puesto',
                             'origen', p_puesto, 'ref', nullif(left(trim(coalesce(p_ref, '')), 60), ''), 'por', nullif(left(trim(coalesce(p_persona, '')), 80), '')))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'token', v_token, 'nombre', v_nom, 'vence', v_vence);
end $$;

revoke all on function public.cb_puesto_mov_crear(text, text, text, text) from public;
grant execute on function public.cb_puesto_mov_crear(text, text, text, text) to anon, authenticated;
