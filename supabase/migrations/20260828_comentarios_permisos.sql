-- Corrige la moderación de comentarios de perfil y habilita la moderación
-- de comentarios de fotos por parte del dueño de la foto.

CREATE OR REPLACE FUNCTION public.konekto_moderar_contenido()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME IN ('comentarios_fotos', 'comentarios_perfil_fotos') THEN
    NEW.comentario := public.konekto_censurar_ofensas(NEW.comentario);
  ELSE
    NEW.contenido := public.konekto_censurar_ofensas(NEW.contenido);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.eliminar_comentario_foto_seguro(
  p_session_token text,
  p_comentario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer_id uuid;
  comment_author_id uuid;
  photo_owner_id uuid;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);

  IF viewer_id IS NULL OR p_comentario_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;

  SELECT c.autor_id, f.user_id
    INTO comment_author_id, photo_owner_id
    FROM public.comentarios_fotos AS c
    JOIN public.fotos_galeria AS f ON f.id = c.foto_id
   WHERE c.id = p_comentario_id;

  IF comment_author_id IS NULL OR photo_owner_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  END IF;

  IF viewer_id <> comment_author_id AND viewer_id <> photo_owner_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;

  DELETE FROM public.comentarios_fotos
   WHERE id = p_comentario_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.eliminar_comentario_foto_seguro(text, uuid)
  TO anon, authenticated;