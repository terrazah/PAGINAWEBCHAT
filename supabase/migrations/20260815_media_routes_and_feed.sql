-- Chat Konekto: rutas reales de fotos, compartir en bandeja y actividad de galería.
-- Ejecutar después de media_system, feed_actividad y regalos_bandeja.

CREATE OR REPLACE FUNCTION public.obtener_galeria_segura(
  p_session_token text,
  p_perfil_id uuid,
  p_offset integer,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  viewer_id uuid;
  safe_offset integer := greatest(coalesce(p_offset, 0), 0);
  safe_limit integer := least(greatest(coalesce(p_limit, 8), 1), 32);
  photos jsonb;
  has_more boolean := false;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  IF viewer_id IS NULL OR p_perfil_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.perfiles_dk WHERE id = p_perfil_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  END IF;
  WITH page AS (
    SELECT id, user_id, url, storage_path, visibilidad, vistas, fecha,
           row_number() OVER (ORDER BY fecha DESC, id DESC) AS row_number
    FROM public.fotos_galeria
    WHERE user_id = p_perfil_id
      AND public.media_can_view_photo(viewer_id, user_id, visibilidad)
    ORDER BY fecha DESC, id DESC
    OFFSET safe_offset
    LIMIT safe_limit + 1
  )
  SELECT coalesce(jsonb_agg(to_jsonb(page) - 'row_number' ORDER BY page.row_number)
      FILTER (WHERE page.row_number <= safe_limit), '[]'::jsonb),
    coalesce(bool_or(page.row_number > safe_limit), false)
  INTO photos, has_more
  FROM page;
  RETURN jsonb_build_object('ok', true, 'photos', photos, 'offset', safe_offset, 'limit', safe_limit, 'has_more', has_more);
END;
$$;

CREATE OR REPLACE FUNCTION public.obtener_foto_segura(p_session_token text, p_foto_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE viewer_id uuid; owner_id uuid; visibility text; photo_row jsonb;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  SELECT user_id, visibilidad INTO owner_id, visibility FROM public.fotos_galeria WHERE id = p_foto_id;
  IF owner_id IS NULL OR NOT public.media_can_view_photo(viewer_id, owner_id, visibility) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  UPDATE public.fotos_galeria SET vistas = vistas + 1 WHERE id = p_foto_id
  RETURNING to_jsonb(fotos_galeria.*) INTO photo_row;
  RETURN jsonb_build_object('ok', true, 'photo', photo_row);
END;
$$;

ALTER TABLE public.mensajes_privados ADD COLUMN IF NOT EXISTS foto_id uuid REFERENCES public.fotos_galeria(id) ON DELETE SET NULL;
ALTER TABLE public.mensajes_privados DROP CONSTRAINT IF EXISTS chk_mensaje_privado_tipo;
ALTER TABLE public.mensajes_privados ADD CONSTRAINT chk_mensaje_privado_tipo CHECK (tipo_mensaje IN ('texto', 'regalo', 'foto'));
CREATE INDEX IF NOT EXISTS idx_mensajes_privados_foto ON public.mensajes_privados (foto_id) WHERE foto_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.obtener_bandeja_segura(p_session_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE profile_id uuid;
BEGIN
  SELECT s.profile_id INTO profile_id FROM public.konekto_sessions s
  WHERE s.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex') AND s.expira_en > now();
  IF profile_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION'); END IF;
  RETURN jsonb_build_object('ok', true, 'messages', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'id', m.id, 'remitente_alias', sender.username, 'receptor_alias', recipient.username,
      'tipo_mensaje', m.tipo_mensaje, 'tipo_regalo', g.tipo_regalo, 'mensaje', m.contenido,
      'imagen_url', m.imagen_url, 'foto_id', m.foto_id, 'creado_en', m.creado_en, 'leido_en', m.leido_en
    ) ORDER BY m.creado_en DESC)
    FROM public.mensajes_privados m
    JOIN public.perfiles_dk sender ON sender.id = m.remitente_id
    JOIN public.perfiles_dk recipient ON recipient.id = m.receptor_id
    LEFT JOIN public.regalos_dk g ON g.id = m.regalo_id
    WHERE m.receptor_id = profile_id
  ), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.compartir_foto_segura(
  p_session_token text, p_receptor_id uuid, p_foto_id uuid, p_mensaje text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE sender_id uuid; owner_id uuid; visibility text; message_id bigint;
  message_text text := nullif(left(btrim(coalesce(p_mensaje, '')), 240), '');
BEGIN
  sender_id := public.media_session_profile(p_session_token);
  IF sender_id IS NULL OR p_receptor_id IS NULL OR p_foto_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST'); END IF;
  IF sender_id = p_receptor_id THEN RETURN jsonb_build_object('ok', false, 'code', 'SELF_SHARE'); END IF;
  SELECT user_id, visibilidad INTO owner_id, visibility FROM public.fotos_galeria WHERE id = p_foto_id;
  IF owner_id IS NULL OR NOT public.media_can_view_photo(sender_id, owner_id, visibility) THEN RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.amigos WHERE estado = 'aceptada' AND ((usuario_id = sender_id AND amigo_id = p_receptor_id) OR (usuario_id = p_receptor_id AND amigo_id = sender_id))) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FRIEND');
  END IF;
  INSERT INTO public.mensajes_privados (remitente_id, receptor_id, tipo_mensaje, contenido, foto_id, imagen_url)
  SELECT sender_id, p_receptor_id, 'foto', message_text, p_foto_id, f.url FROM public.fotos_galeria f WHERE f.id = p_foto_id
  RETURNING id INTO message_id;
  RETURN jsonb_build_object('ok', true, 'message_id', message_id);
END;
$$;

CREATE TABLE IF NOT EXISTS public.feed_actividad (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tipo text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.perfiles_dk(id) ON DELETE CASCADE,
  target_id uuid REFERENCES public.perfiles_dk(id) ON DELETE SET NULL,
  contenido text, fecha timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.feed_actividad DROP CONSTRAINT IF EXISTS feed_actividad_tipo_check;
ALTER TABLE public.feed_actividad ADD CONSTRAINT feed_actividad_tipo_check CHECK (tipo IN ('comentario', 'amistad', 'foto'));
ALTER TABLE public.feed_actividad ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "feed_actividad_select" ON public.feed_actividad;
CREATE POLICY "feed_actividad_select" ON public.feed_actividad FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.registrar_actividad_foto()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.visibilidad = 'public' AND (TG_OP = 'INSERT' OR OLD.visibilidad IS DISTINCT FROM 'public') THEN
    INSERT INTO public.feed_actividad (tipo, actor_id, target_id, contenido, fecha)
    VALUES ('foto', NEW.user_id, NEW.user_id, NEW.id::text, coalesce(NEW.fecha, now()));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS fotos_publicas_a_feed ON public.fotos_galeria;
CREATE TRIGGER fotos_publicas_a_feed AFTER INSERT OR UPDATE OF visibilidad ON public.fotos_galeria
FOR EACH ROW EXECUTE FUNCTION public.registrar_actividad_foto();

GRANT EXECUTE ON FUNCTION public.obtener_galeria_segura(text, uuid, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_foto_segura(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compartir_foto_segura(text, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_bandeja_segura(text) TO anon, authenticated;