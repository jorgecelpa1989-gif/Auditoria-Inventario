// Fotos de la recepción de proveedores.
//  · accion "subir" (celular de bodega): valida la sesión del usuario con cb_prov_foto_puede, sube la foto
//    al bucket privado "prov-fotos" y la anota en cb_prov.fotos (cb_prov_foto_agregar).
//  · accion "ver" (panel): valida la clave del supervisor (cb_prov_fotos, permiso prov_ver) y devuelve
//    enlaces temporales (1 hora) a cada foto.
// Se despliega con verify_jwt = false porque la app usa la clave publicable; la validación la hacen las
// funciones de la base, que solo puede llamar service_role.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX = 1_500_000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "metodo" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  let b: Record<string, string>;
  try { b = await req.json(); } catch { return json({ error: "datos_invalidos" }, 400); }
  const err = (e: { message?: string } | null) => json({ error: (e && e.message) || "error" }, 400);
  if (!UUID.test(String(b.id || ""))) return json({ error: "datos_invalidos" }, 400);

  if (b.accion === "subir") {
    const ok = await sb.rpc("cb_prov_foto_puede", { p_puesto: b.puesto, p_ses: b.ses, p_id: b.id });
    if (ok.error) return err(ok.error);
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(String(b.jpg || "")), (c) => c.charCodeAt(0)); } catch { return json({ error: "datos_invalidos" }, 400); }
    if (bytes.length < 100 || bytes.length > MAX || bytes[0] !== 0xff || bytes[1] !== 0xd8) return json({ error: "foto_invalida" }, 400);
    const path = `${b.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.jpg`;
    const up = await sb.storage.from("prov-fotos").upload(path, bytes, { contentType: "image/jpeg", upsert: false });
    if (up.error) return err(up.error);
    const add = await sb.rpc("cb_prov_foto_agregar", { p_puesto: b.puesto, p_ses: b.ses, p_id: b.id, p_path: path, p_persona: b.persona || "" });
    if (add.error) { await sb.storage.from("prov-fotos").remove([path]); return err(add.error); }
    return json({ path, n: add.data?.n });
  }

  if (b.accion === "ver") {
    const r = await sb.rpc("cb_prov_fotos", { p_clave: b.clave, p_id: b.id });
    if (r.error) return err(r.error);
    const fotos = (r.data || []) as { path: string }[];
    if (!fotos.length) return json({ fotos: [] });
    const s = await sb.storage.from("prov-fotos").createSignedUrls(fotos.map((f) => f.path), 3600);
    if (s.error) return err(s.error);
    return json({ fotos: fotos.map((f, i) => ({ ...f, url: s.data?.[i]?.signedUrl || null })) });
  }
  return json({ error: "accion" }, 400);
});
