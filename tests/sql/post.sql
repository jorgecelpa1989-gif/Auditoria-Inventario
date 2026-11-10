create or replace function public.rpc_test(fn text, a jsonb) returns jsonb language plpgsql set search_path = public, extensions as $$
declare p record; args text; r jsonb;
begin
  select pr.oid, pr.prorettype into p from pg_proc pr join pg_namespace n on n.oid=pr.pronamespace
   where n.nspname='public' and pr.proname=fn
     and (select coalesce(bool_and(k = any(pr.proargnames)),true) from jsonb_object_keys(a) k)
   order by pr.pronargs limit 1;
  if p.oid is null then raise exception 'PGRST202 no fn %', fn; end if;
  select string_agg(format('%I => %L::%s', x.n,
     case when jsonb_typeof(a->x.n)='null' then null
          when t.typcategory='A' then (select array_agg(e)::text from jsonb_array_elements_text(a->x.n) e)
          when jsonb_typeof(a->x.n) in ('object','array') then (a->x.n)::text else a->>x.n end,
     format_type(x.t,null)), ', ')
   into args
   from pg_proc pr, unnest(pr.proargnames, pr.proargtypes::oid[]) x(n,t) join pg_type t on t.oid=x.t
   where pr.oid=p.oid and a ? x.n;
  if p.prorettype='void'::regtype then execute format('select %I(%s)', fn, coalesce(args,'')); return null; end if;
  execute format('select to_jsonb(%I(%s))', fn, coalesce(args,'')) into r; return r;
end $$;
grant execute on function public.rpc_test(text,jsonb) to anon;
grant usage on schema public to anon;
