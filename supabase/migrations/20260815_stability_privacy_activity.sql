-- Estabilidad, privacidad estricta e historial de actividad de Konekto.
-- Ejecutar después de 20260815_critical_media_polish.sql.

CREATE TABLE IF NOT EXISTS public.amistades_historial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.perfiles_dk(id) ON DELETE CASCADE,
  amigo_id uuid NOT NULL REFERENCES public.perfiles_dk(id) ON DELETE CASCADE,
  iniciada_en timestamptz NOT NULL DEFAULT now(),
  terminada_en timestamptz,
  CHECK (usuario_id <> amigo_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS amistades_historial_abierta_idx
  ON public.amistades_historial (least(usuario_id, amigo_id), greatest(usuario_id, amigo_id))
  WHERE terminada_en IS NULL;

CREATE INDEX IF NOT EXISTS amistades_historial_usuario_idx
  ON public.amistades_historial (usuario_id, amigo_id, iniciada_en DESC);

ALTER TABLE public.amistades_historial ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "amistades_historial_no_direct_access" ON public.amistades_historial;
CREATE POLICY "amistades_historial_no_direct_access"
  ON public.amistades_historial FOR ALL USING (false) WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.registrar_historial_amistad()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.amistades_historial
       SET terminada_en = COALESCE(OLD.fecha::timestamptz, now())
     WHERE terminada_en IS NULL
       AND ((usuario_id = OLD.usuario_id AND amigo_id = OLD.amigo_id)
         OR (usuario_id = OLD.amigo_id AND amigo_id = OLD.usuario_id));
    RETURN OLD;
  END IF;

  IF NEW.estado = 'aceptada' AND NOT EXISTS (
    SELECT 1 FROM public.amistades_historial
     WHERE terminada_en IS NULL
       AND ((usuario_id = NEW.usuario_id AND amigo_id = NEW.amigo_id)
         OR (usuario_id = NEW.amigo_id AND amigo_id = NEW.usuario_id))
  ) THEN
    INSERT INTO public.amistades_historial (usuario_id, amigo_id, iniciada_en)
    VALUES (NEW.usuario_id, NEW.amigo_id, COALESCE(NEW.fecha::timestamptz, now()))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS amistades_a_historial ON public.amigos;
CREATE TRIGGER amistades_a_historial
AFTER INSERT OR UPDATE OR DELETE ON public.amigos
FOR EACH ROW EXECUTE FUNCTION public.registrar_historial_amistad();

INSERT INTO public.amistades_historial (usuario_id, amigo_id, iniciada_en)
SELECT a.usuario_id, a.amigo_id, COALESCE(a.fecha::timestamptz, now())
  FROM public.amigos a
 WHERE a.estado = 'aceptada'
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.obtener_actividad_amigos_segura(
  p_session_token text,
  p_limit integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  viewer_id uuid;
  safe_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  activities jsonb;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  IF viewer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;

  WITH relations AS (
    SELECT CASE WHEN a.usuario_id = viewer_id THEN a.amigo_id ELSE a.usuario_id END AS friend_id,
           '-infinity'::timestamptz AS started_at,
           'infinity'::timestamptz AS ended_at
      FROM public.amigos a
     WHERE a.estado = 'aceptada'
       AND (a.usuario_id = viewer_id OR a.amigo_id = viewer_id)
    UNION
    SELECT CASE WHEN h.usuario_id = viewer_id THEN h.amigo_id ELSE h.usuario_id END,
           h.iniciada_en,
           COALESCE(h.terminada_en, 'infinity'::timestamptz)
      FROM public.amistades_historial h
     WHERE h.usuario_id = viewer_id OR h.amigo_id = viewer_id
  ),
  eligible AS (
    SELECT DISTINCT e.id, e.tipo, e.actor_id, e.target_id, e.contenido, e.fecha
      FROM public.feed_actividad e
      JOIN relations r
        ON (e.actor_id = r.friend_id OR e.target_id = r.friend_id)
       AND e.fecha >= r.started_at
       AND e.fecha <= r.ended_at
     WHERE e.tipo IN ('comentario', 'amistad', 'foto')
     ORDER BY e.fecha DESC
     LIMIT safe_limit
  )
  SELECT COALESCE(jsonb_agg(to_jsonb(eligible) ORDER BY eligible.fecha DESC), '[]'::jsonb)
    INTO activities
    FROM eligible;
  RETURN jsonb_build_object('ok', true, 'activities', activities);
END;
$$;

CREATE OR REPLACE FUNCTION public.obtener_interacciones_foto_seguras(
  p_session_token text, p_foto_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF visibility = 'private' THEN
    RETURN jsonb_build_object('ok', true, 'comments', '[]'::jsonb, 'reactions', '{}'::jsonb, 'my_reaction', NULL);
  END IF;
  IF NOT public.media_can_view_photo(viewer_id, owner_id, visibility) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  SELECT COALESCE(jsonb_agg(to_jsonb(comment_row) ORDER BY comment_row.fecha ASC), '[]'::jsonb)
    INTO photo_comments
    FROM (
      SELECT c.id, c.foto_id, c.autor_id, p.username AS autor_alias,
             p.avatar_url AS autor_avatar_url, c.comentario, c.fecha
        FROM public.comentarios_fotos c
        JOIN public.perfiles_dk p ON p.id = c.autor_id
       WHERE c.foto_id = p_foto_id
    ) comment_row;
  SELECT COALESCE(jsonb_object_agg(counts.tipo, counts.total), '{}'::jsonb)
    INTO photo_reactions
    FROM (
      SELECT tipo, count(*)::integer AS total FROM public.reacciones_fotos
       WHERE foto_id = p_foto_id GROUP BY tipo
    ) counts;
  SELECT tipo INTO viewer_reaction FROM public.reacciones_fotos
   WHERE foto_id = p_foto_id AND usuario_id = viewer_id;
  RETURN jsonb_build_object('ok', true, 'comments', photo_comments,
                            'reactions', photo_reactions, 'my_reaction', viewer_reaction);
END;
$$;

CREATE OR REPLACE FUNCTION public.comentar_foto_seguro(
  p_session_token text, p_foto_id uuid, p_comentario text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF visibility = 'private' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PRIVATE_INTERACTION_DISABLED');
  END IF;
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
  RETURN jsonb_build_object('ok', true, 'comment', jsonb_build_object(
    'id', new_comment.id, 'foto_id', new_comment.foto_id, 'autor_id', new_comment.autor_id,
    'autor_alias', alias, 'comentario', new_comment.comentario, 'fecha', new_comment.fecha
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.reaccionar_foto_segura(
  p_session_token text, p_foto_id uuid, p_tipo text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
  IF visibility = 'private' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PRIVATE_INTERACTION_DISABLED');
  END IF;
  IF NOT public.media_can_view_photo(viewer_id, owner_id, visibility) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  IF p_tipo NOT IN ('like', 'love', 'haha', 'wow', 'sad') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REACTION');
  END IF;
  SELECT tipo INTO current_type FROM public.reacciones_fotos
   WHERE foto_id = p_foto_id AND usuario_id = viewer_id;
  IF current_type = p_tipo THEN
    DELETE FROM public.reacciones_fotos WHERE foto_id = p_foto_id AND usuario_id = viewer_id;
  ELSE
    INSERT INTO public.reacciones_fotos (foto_id, usuario_id, tipo)
    VALUES (p_foto_id, viewer_id, p_tipo)
    ON CONFLICT (foto_id, usuario_id) DO UPDATE SET tipo = EXCLUDED.tipo, fecha = now();
  END IF;
  SELECT COALESCE(jsonb_object_agg(counts.tipo, counts.total), '{}'::jsonb)
    INTO reaction_counts
    FROM (
      SELECT tipo, count(*)::integer AS total FROM public.reacciones_fotos
       WHERE foto_id = p_foto_id GROUP BY tipo
    ) counts;
  SELECT tipo INTO current_type FROM public.reacciones_fotos
   WHERE foto_id = p_foto_id AND usuario_id = viewer_id;
  RETURN jsonb_build_object('ok', true, 'reactions', reaction_counts, 'my_reaction', current_type);
END;
$$;

CREATE OR REPLACE FUNCTION public.eliminar_comentario_foto_seguro(
  p_session_token text, p_comentario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  viewer_id uuid;
  comment_author_id uuid;
  deleted_id uuid;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  IF viewer_id IS NULL OR p_comentario_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;
  SELECT autor_id INTO comment_author_id
    FROM public.comentarios_fotos
   WHERE id = p_comentario_id;
  IF comment_author_id IS NULL OR comment_author_id <> viewer_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  DELETE FROM public.comentarios_fotos
   WHERE id = p_comentario_id AND autor_id = viewer_id
   RETURNING id INTO deleted_id;
  RETURN jsonb_build_object('ok', deleted_id IS NOT NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_actividad_amigos_segura(text, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_interacciones_foto_seguras(text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comentar_foto_seguro(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reaccionar_foto_segura(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_comentario_foto_seguro(text, uuid) TO anon, authenticated;