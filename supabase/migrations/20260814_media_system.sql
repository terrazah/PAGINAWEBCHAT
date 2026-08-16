-- Chat Konekto: sistema completo de imágenes, galería, comentarios y reacciones.
-- Ejecutar después de las migraciones base de perfiles y sesiones.

ALTER TABLE public.perfiles_dk
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS banner_url text;

CREATE TABLE IF NOT EXISTS public.fotos_galeria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.perfiles_dk(id) ON DELETE CASCADE,
  url text NOT NULL,
  storage_path text,
  visibilidad text NOT NULL DEFAULT 'public'
    CHECK (visibilidad IN ('public', 'private')),
  vistas bigint NOT NULL DEFAULT 0
    CHECK (vistas >= 0),
  fecha timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.comentarios_fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  foto_id uuid NOT NULL REFERENCES public.fotos_galeria(id) ON DELETE CASCADE,
  autor_id uuid NOT NULL REFERENCES public.perfiles_dk(id) ON DELETE CASCADE,
  comentario text NOT NULL CHECK (char_length(btrim(comentario)) BETWEEN 1 AND 240),
  fecha timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.reacciones_fotos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  foto_id uuid NOT NULL REFERENCES public.fotos_galeria(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.perfiles_dk(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('like', 'love', 'haha', 'wow', 'sad')),
  fecha timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reacciones_fotos_unica_por_usuario UNIQUE (foto_id, usuario_id)
);

CREATE INDEX IF NOT EXISTS fotos_galeria_user_fecha_idx
  ON public.fotos_galeria (user_id, fecha DESC);

CREATE INDEX IF NOT EXISTS fotos_galeria_public_idx
  ON public.fotos_galeria (user_id, visibilidad, fecha DESC);

CREATE INDEX IF NOT EXISTS comentarios_fotos_foto_fecha_idx
  ON public.comentarios_fotos (foto_id, fecha ASC);

CREATE INDEX IF NOT EXISTS reacciones_fotos_foto_tipo_idx
  ON public.reacciones_fotos (foto_id, tipo);

-- El bucket es público para que las URLs puedan renderizarse en <img>.
-- Las operaciones críticas sobre la galería se validan mediante RPC con sesión
-- Konekto porque la aplicación usa alias/contraseña y no auth.uid() de Supabase.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'konekto_media',
  'konekto_media',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = true,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[];

-- Las tablas se consultan únicamente mediante las funciones seguras de abajo.
ALTER TABLE public.fotos_galeria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comentarios_fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reacciones_fotos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fotos_galeria_no_direct_select" ON public.fotos_galeria;
CREATE POLICY "fotos_galeria_no_direct_select"
  ON public.fotos_galeria FOR SELECT
  USING (false);

DROP POLICY IF EXISTS "fotos_galeria_no_direct_insert" ON public.fotos_galeria;
CREATE POLICY "fotos_galeria_no_direct_insert"
  ON public.fotos_galeria FOR INSERT
  WITH CHECK (false);

DROP POLICY IF EXISTS "fotos_galeria_no_direct_update" ON public.fotos_galeria;
CREATE POLICY "fotos_galeria_no_direct_update"
  ON public.fotos_galeria FOR UPDATE
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "fotos_galeria_no_direct_delete" ON public.fotos_galeria;
CREATE POLICY "fotos_galeria_no_direct_delete"
  ON public.fotos_galeria FOR DELETE
  USING (false);

DROP POLICY IF EXISTS "comentarios_fotos_no_direct_access" ON public.comentarios_fotos;
CREATE POLICY "comentarios_fotos_no_direct_access"
  ON public.comentarios_fotos FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "reacciones_fotos_no_direct_access" ON public.reacciones_fotos;
CREATE POLICY "reacciones_fotos_no_direct_access"
  ON public.reacciones_fotos FOR ALL
  USING (false)
  WITH CHECK (false);

-- Storage: la carga se limita al namespace de perfiles y a los tipos definidos
-- en el bucket. La eliminación de fotos queda autorizada para usuarios
-- Supabase autenticados que sean dueños del namespace; la app Konekto además
-- elimina el registro por RPC y tolera que el cleanup de Storage sea opcional.
DROP POLICY IF EXISTS "konekto_media_upload" ON storage.objects;
CREATE POLICY "konekto_media_upload"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'konekto_media'
    AND name ~ '^profiles/[0-9a-fA-F-]+/(avatar|banner|gallery)/'
  );

DROP POLICY IF EXISTS "konekto_media_owner_delete" ON storage.objects;
CREATE POLICY "konekto_media_owner_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'konekto_media'
    AND auth.uid() IS NOT NULL
    AND split_part(name, '/', 2) = auth.uid()::text
  );

CREATE OR REPLACE FUNCTION public.media_session_profile(p_session_token text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT profile_id
  FROM public.konekto_sessions
  WHERE token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
    AND expira_en > now()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.media_can_view_photo(
  p_viewer_id uuid,
  p_owner_id uuid,
  p_visibility text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  owner_public boolean;
BEGIN
  IF p_viewer_id IS NULL OR p_owner_id IS NULL THEN
    RETURN false;
  END IF;

  IF p_viewer_id = p_owner_id THEN
    RETURN true;
  END IF;

  IF p_visibility = 'private' THEN
    RETURN false;
  END IF;

  SELECT es_publico INTO owner_public
  FROM public.perfiles_dk
  WHERE id = p_owner_id;

  IF COALESCE(owner_public, false) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.amigos
    WHERE estado = 'aceptada'
      AND (
        (usuario_id = p_viewer_id AND amigo_id = p_owner_id)
        OR (usuario_id = p_owner_id AND amigo_id = p_viewer_id)
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.obtener_galeria_segura(
  p_session_token text,
  p_perfil_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer_id uuid;
  photos jsonb;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  IF viewer_id IS NULL OR p_perfil_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.perfiles_dk WHERE id = p_perfil_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PROFILE_NOT_FOUND');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(photo) ORDER BY photo.fecha DESC), '[]'::jsonb)
    INTO photos
    FROM (
      SELECT id, user_id, url, storage_path, visibilidad, vistas, fecha
      FROM public.fotos_galeria
      WHERE user_id = p_perfil_id
        AND public.media_can_view_photo(viewer_id, user_id, visibilidad)
      ORDER BY fecha DESC
    ) AS photo;

  RETURN jsonb_build_object('ok', true, 'photos', photos);
END;
$$;

CREATE OR REPLACE FUNCTION public.crear_foto_galeria_segura(
  p_session_token text,
  p_url text,
  p_storage_path text,
  p_visibilidad text DEFAULT 'public'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
  new_photo public.fotos_galeria;
BEGIN
  owner_id := public.media_session_profile(p_session_token);
  IF owner_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;
  IF btrim(COALESCE(p_url, '')) = '' OR btrim(COALESCE(p_storage_path, '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_MEDIA');
  END IF;
  IF p_visibilidad NOT IN ('public', 'private') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_VISIBILITY');
  END IF;
  IF p_storage_path !~ ('^profiles/' || owner_id::text || '/gallery/') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_STORAGE_PATH');
  END IF;

  INSERT INTO public.fotos_galeria (user_id, url, storage_path, visibilidad)
  VALUES (owner_id, p_url, p_storage_path, p_visibilidad)
  RETURNING * INTO new_photo;

  RETURN jsonb_build_object('ok', true, 'photo', to_jsonb(new_photo));
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_vista_foto_segura(
  p_session_token text,
  p_foto_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer_id uuid;
  owner_id uuid;
  visibility text;
  next_views bigint;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  SELECT user_id, visibilidad INTO owner_id, visibility
  FROM public.fotos_galeria WHERE id = p_foto_id;

  IF NOT public.media_can_view_photo(viewer_id, owner_id, visibility) THEN
    RETURN 0;
  END IF;

  UPDATE public.fotos_galeria
  SET vistas = vistas + 1
  WHERE id = p_foto_id
  RETURNING vistas INTO next_views;

  RETURN COALESCE(next_views, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.obtener_interacciones_foto_seguras(
  p_session_token text,
  p_foto_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer_id uuid;
  owner_id uuid;
  visibility text;
  photo_comments jsonb;
  photo_reactions jsonb;
  viewer_reaction text;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  SELECT user_id, visibilidad INTO owner_id, visibility
  FROM public.fotos_galeria WHERE id = p_foto_id;

  IF NOT public.media_can_view_photo(viewer_id, owner_id, visibility) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(comment_row) ORDER BY comment_row.fecha ASC), '[]'::jsonb)
    INTO photo_comments
    FROM (
    SELECT c.id, c.foto_id, c.autor_id, p.username AS autor_alias, p.avatar_url AS autor_avatar_url, c.comentario, c.fecha
      FROM public.comentarios_fotos AS c
      JOIN public.perfiles_dk AS p ON p.id = c.autor_id
      WHERE c.foto_id = p_foto_id
    ) AS comment_row;

  SELECT COALESCE(jsonb_object_agg(reaction_counts.tipo, reaction_counts.total), '{}'::jsonb)
    INTO photo_reactions
    FROM (
      SELECT tipo, count(*)::integer AS total
      FROM public.reacciones_fotos
      WHERE foto_id = p_foto_id
      GROUP BY tipo
    ) AS reaction_counts;

  SELECT tipo INTO viewer_reaction
  FROM public.reacciones_fotos
  WHERE foto_id = p_foto_id AND usuario_id = viewer_id;

  RETURN jsonb_build_object(
    'ok', true,
    'comments', photo_comments,
    'reactions', photo_reactions,
    'my_reaction', viewer_reaction
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.comentar_foto_seguro(
  p_session_token text,
  p_foto_id uuid,
  p_comentario text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer_id uuid;
  owner_id uuid;
  visibility text;
  new_comment public.comentarios_fotos;
  alias text;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  SELECT user_id, visibilidad INTO owner_id, visibility
  FROM public.fotos_galeria WHERE id = p_foto_id;
  IF NOT public.media_can_view_photo(viewer_id, owner_id, visibility) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  IF char_length(btrim(COALESCE(p_comentario, ''))) NOT BETWEEN 1 AND 240 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_COMMENT');
  END IF;

  INSERT INTO public.comentarios_fotos (foto_id, autor_id, comentario)
  VALUES (p_foto_id, viewer_id, btrim(p_comentario))
  RETURNING * INTO new_comment;

  SELECT username INTO alias FROM public.perfiles_dk WHERE id = viewer_id;
  RETURN jsonb_build_object(
    'ok', true,
    'comment', jsonb_build_object(
      'id', new_comment.id,
      'foto_id', new_comment.foto_id,
      'autor_id', new_comment.autor_id,
      'autor_alias', alias,
      'comentario', new_comment.comentario,
      'fecha', new_comment.fecha
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reaccionar_foto_segura(
  p_session_token text,
  p_foto_id uuid,
  p_tipo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer_id uuid;
  owner_id uuid;
  visibility text;
  current_type text;
  reaction_counts jsonb;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  SELECT user_id, visibilidad INTO owner_id, visibility
  FROM public.fotos_galeria WHERE id = p_foto_id;
  IF NOT public.media_can_view_photo(viewer_id, owner_id, visibility) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  IF p_tipo NOT IN ('like', 'love', 'haha', 'wow', 'sad') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REACTION');
  END IF;

  SELECT tipo INTO current_type
  FROM public.reacciones_fotos
  WHERE foto_id = p_foto_id AND usuario_id = viewer_id;

  IF current_type = p_tipo THEN
    DELETE FROM public.reacciones_fotos
    WHERE foto_id = p_foto_id AND usuario_id = viewer_id;
  ELSE
    INSERT INTO public.reacciones_fotos (foto_id, usuario_id, tipo)
    VALUES (p_foto_id, viewer_id, p_tipo)
    ON CONFLICT (foto_id, usuario_id)
    DO UPDATE SET tipo = EXCLUDED.tipo, fecha = now();
  END IF;

  SELECT COALESCE(jsonb_object_agg(counts.tipo, counts.total), '{}'::jsonb)
    INTO reaction_counts
    FROM (
      SELECT tipo, count(*)::integer AS total
      FROM public.reacciones_fotos
      WHERE foto_id = p_foto_id
      GROUP BY tipo
    ) AS counts;

  SELECT tipo INTO current_type
  FROM public.reacciones_fotos
  WHERE foto_id = p_foto_id AND usuario_id = viewer_id;

  RETURN jsonb_build_object('ok', true, 'reactions', reaction_counts, 'my_reaction', current_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.cambiar_visibilidad_foto_segura(
  p_session_token text,
  p_foto_id uuid,
  p_visibilidad text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
  updated_id uuid;
BEGIN
  owner_id := public.media_session_profile(p_session_token);
  IF owner_id IS NULL OR p_visibilidad NOT IN ('public', 'private') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  END IF;

  UPDATE public.fotos_galeria
  SET visibilidad = p_visibilidad
  WHERE id = p_foto_id AND user_id = owner_id
  RETURNING id INTO updated_id;

  IF updated_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.eliminar_foto_segura(
  p_session_token text,
  p_foto_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
  removed_path text;
BEGIN
  owner_id := public.media_session_profile(p_session_token);
  DELETE FROM public.fotos_galeria
  WHERE id = p_foto_id AND user_id = owner_id
  RETURNING storage_path INTO removed_path;

  IF removed_path IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;
  IF removed_path IS NOT NULL THEN
    BEGIN
      DELETE FROM storage.objects
      WHERE bucket_id = 'konekto_media' AND name = removed_path;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN jsonb_build_object('ok', true, 'storage_path', removed_path);
END;
$$;

REVOKE ALL ON FUNCTION public.media_session_profile(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.media_can_view_photo(uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.obtener_galeria_segura(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crear_foto_galeria_segura(text, text, text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_vista_foto_segura(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_interacciones_foto_seguras(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comentar_foto_seguro(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reaccionar_foto_segura(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cambiar_visibilidad_foto_segura(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_foto_segura(text, uuid) TO anon, authenticated;