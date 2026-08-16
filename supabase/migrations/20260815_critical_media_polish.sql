-- Chat Konekto: compresión, avatar respaldado por foto y visitas idempotentes.
-- Ejecutar después de 20260814_media_system.sql y 20260815_media_routes_and_feed.sql.

ALTER TABLE public.perfiles_dk
  ADD COLUMN IF NOT EXISTS avatar_foto_id uuid REFERENCES public.fotos_galeria(id) ON DELETE SET NULL;

ALTER TABLE public.perfiles_dk
  ALTER COLUMN avatar_url SET DEFAULT 'konekto://default-avatar',
  ALTER COLUMN banner_url SET DEFAULT 'konekto://default-banner';

UPDATE public.perfiles_dk
   SET avatar_url = 'konekto://default-avatar'
 WHERE avatar_url IS NULL OR btrim(avatar_url) = '';

UPDATE public.perfiles_dk
   SET banner_url = 'konekto://default-banner'
 WHERE banner_url IS NULL OR btrim(banner_url) = '';

UPDATE public.perfiles_dk p
   SET avatar_foto_id = f.id
  FROM public.fotos_galeria f
 WHERE p.avatar_foto_id IS NULL
   AND p.avatar_url = f.url
   AND f.user_id = p.id;

CREATE TABLE IF NOT EXISTS public.visitas_fotos (
  foto_id uuid NOT NULL REFERENCES public.fotos_galeria(id) ON DELETE CASCADE,
  visitante_id uuid NOT NULL REFERENCES public.perfiles_dk(id) ON DELETE CASCADE,
  visitado_en timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (foto_id, visitante_id)
);

CREATE INDEX IF NOT EXISTS visitas_fotos_visitante_idx
  ON public.visitas_fotos (visitante_id, visitado_en DESC);

ALTER TABLE public.visitas_fotos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "visitas_fotos_no_direct_access" ON public.visitas_fotos;
CREATE POLICY "visitas_fotos_no_direct_access"
  ON public.visitas_fotos FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.crear_foto_galeria_segura(
  p_session_token text, p_url text, p_storage_path text,
  p_visibilidad text DEFAULT 'public'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owner_id uuid;
  new_photo public.fotos_galeria;
  should_set_avatar boolean;
BEGIN
  owner_id := public.media_session_profile(p_session_token);
  IF owner_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION'); END IF;
  IF btrim(COALESCE(p_url, '')) = '' OR btrim(COALESCE(p_storage_path, '')) = ''
    THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MEDIA'); END IF;
  IF p_visibilidad NOT IN ('public', 'private')
    THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_VISIBILITY'); END IF;
  IF p_storage_path !~ ('^profiles/' || owner_id::text || '/gallery/')
    THEN RETURN jsonb_build_object('ok', false, 'code', 'INVALID_STORAGE_PATH'); END IF;

  INSERT INTO public.fotos_galeria (user_id, url, storage_path, visibilidad)
  VALUES (owner_id, p_url, p_storage_path, p_visibilidad)
  RETURNING * INTO new_photo;

  SELECT avatar_foto_id IS NULL OR avatar_url IS NULL
      OR avatar_url IN ('', 'konekto://default-avatar')
    INTO should_set_avatar
    FROM public.perfiles_dk
   WHERE id = owner_id;

  IF should_set_avatar THEN
    UPDATE public.perfiles_dk
       SET avatar_url = new_photo.url, avatar_foto_id = new_photo.id
     WHERE id = owner_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'photo', to_jsonb(new_photo),
    'avatar_updated', should_set_avatar,
    'avatar_url', CASE WHEN should_set_avatar THEN new_photo.url ELSE NULL END,
    'avatar_foto_id', CASE WHEN should_set_avatar THEN new_photo.id ELSE NULL END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.obtener_foto_segura(
  p_session_token text,
  p_foto_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  viewer_id uuid;
  owner_id uuid;
  visibility text;
  photo_row jsonb;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  SELECT user_id, visibilidad, to_jsonb(fotos_galeria.*)
    INTO owner_id, visibility, photo_row
    FROM public.fotos_galeria
   WHERE id = p_foto_id;
  IF owner_id IS NULL OR NOT public.media_can_view_photo(viewer_id, owner_id, visibility) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  RETURN jsonb_build_object('ok', true, 'photo', photo_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_vista_foto_segura(
  p_session_token text, p_foto_id uuid
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  viewer_id uuid;
  owner_id uuid;
  visibility text;
  next_views bigint;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  SELECT user_id, visibilidad INTO owner_id, visibility
    FROM public.fotos_galeria WHERE id = p_foto_id;
  IF viewer_id IS NULL OR NOT public.media_can_view_photo(viewer_id, owner_id, visibility) THEN RETURN 0; END IF;
  IF viewer_id = owner_id THEN
    SELECT vistas INTO next_views FROM public.fotos_galeria WHERE id = p_foto_id;
    RETURN COALESCE(next_views, 0);
  END IF;

  INSERT INTO public.visitas_fotos (foto_id, visitante_id)
  VALUES (p_foto_id, viewer_id)
  ON CONFLICT (foto_id, visitante_id) DO NOTHING;

  IF FOUND THEN
    UPDATE public.fotos_galeria SET vistas = vistas + 1 WHERE id = p_foto_id;
  END IF;

  SELECT vistas INTO next_views FROM public.fotos_galeria WHERE id = p_foto_id;
  RETURN COALESCE(next_views, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.eliminar_foto_segura(
  p_session_token text, p_foto_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  owner_id uuid;
  removed_path text;
  was_avatar boolean;
  next_avatar public.fotos_galeria;
BEGIN
  owner_id := public.media_session_profile(p_session_token);
  SELECT avatar_foto_id = p_foto_id INTO was_avatar
    FROM public.perfiles_dk WHERE id = owner_id;
  DELETE FROM public.fotos_galeria
   WHERE id = p_foto_id AND user_id = owner_id
   RETURNING storage_path INTO removed_path;
  IF removed_path IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND'); END IF;

  IF was_avatar THEN
    SELECT * INTO next_avatar
      FROM public.fotos_galeria
     WHERE user_id = owner_id
     ORDER BY fecha DESC, id DESC
     LIMIT 1;
    UPDATE public.perfiles_dk
       SET avatar_url = COALESCE(next_avatar.url, 'konekto://default-avatar'),
           avatar_foto_id = next_avatar.id
     WHERE id = owner_id;
  END IF;

  BEGIN
    DELETE FROM storage.objects
     WHERE bucket_id = 'konekto_media' AND name = removed_path;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN jsonb_build_object('ok', true, 'storage_path', removed_path);
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_visita_segura(
  p_session_token text, p_perfil_id uuid
)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  visitor_id uuid;
  is_vip boolean;
  ghost_mode boolean;
  next_visits bigint;
BEGIN
  SELECT s.profile_id,
         (COALESCE(p.is_vip, false) OR COALESCE(p.es_vip, false)),
         COALESCE(p.modo_fantasma, false)
    INTO visitor_id, is_vip, ghost_mode
    FROM public.konekto_sessions s
    JOIN public.perfiles_dk p ON p.id = s.profile_id
   WHERE s.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
     AND s.expira_en > now();

  IF visitor_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.perfiles_dk WHERE id = p_perfil_id) THEN RETURN -1; END IF;
  SELECT COALESCE(visitas, 0)::bigint INTO next_visits FROM public.perfiles_dk WHERE id = p_perfil_id;
  IF visitor_id = p_perfil_id OR (ghost_mode AND is_vip) THEN RETURN COALESCE(next_visits, 0); END IF;

  INSERT INTO public.visitas_perfil (perfil_id, visitante_id)
  VALUES (p_perfil_id, visitor_id)
  ON CONFLICT (perfil_id, visitante_id) DO NOTHING;

  IF FOUND THEN
    UPDATE public.perfiles_dk
       SET visitas = COALESCE(visitas, 0) + 1
     WHERE id = p_perfil_id
     RETURNING visitas INTO next_visits;
  END IF;
  RETURN COALESCE(next_visits, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.crear_foto_galeria_segura(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_foto_segura(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_vista_foto_segura(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_foto_segura(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_visita_segura(text, uuid) TO anon, authenticated;