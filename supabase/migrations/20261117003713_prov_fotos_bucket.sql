-- Bucket privado para las fotos de recepción (máx. 1,5 MB por foto, solo JPEG). Sin políticas para anon:
-- solo la Edge Function "prov-fotos" (service_role) sube y genera enlaces temporales.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('prov-fotos', 'prov-fotos', false, 1500000, array['image/jpeg'])
on conflict (id) do nothing;
