-- Moderación silenciosa, límite de tres comentarios consecutivos en fotos
-- y redacción de la actividad propia.
-- Ejecutar después de 20260823_notificaciones_globales.sql.

CREATE OR REPLACE FUNCTION public.konekto_censurar_ofensas(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  result text := coalesce(p_text, '');
  pattern text;
  patterns text[] := ARRAY[
    'a[sz]shole', 'b[i1]tch', 'bullsh[i1]t', 'c[oó]ck', 'crap', 'c[uú]nt',
    'd[i1]ck(?:head)?', 'dumb[a4]ss', 'f+u+c+k+', 'motherf+u+c+k+', 'p[i1]ss',
    'p[uú]ssy', 'sh[i1]t', 'sl[uú]t', 'stf[uú]', 'wh[oó]re', 'w[tf]',
    'b[a4]st[a4]rd', 'n[i1]gg(?:e|a|@)r?', 'sp[i1]c', 'wetb[a4]ck',
    'c[a4]br[oó]n[a4]?', 'ch[i1]ng(?:a|ada|ado|ar|as|ue|uen)', 'coj[oó]nes',
    'c[uú]l(?:o|era|ero|eros)', 'j[oó]t(?:o|os)', 'm[a4]m(?:a|ada|adas|[oó]n)',
    'm[a4]r[i1]c(?:a|as|[oó]n)', 'm[i1]erd[a4]', 'n[a4]c(?:o|os)',
    'p[a4]j(?:er|er[oa4])', 'p[e3]nd[e3]j[oa4]s?', 'p[e3]rr[a4]s?',
    'p[i1]nch[e3](s)?', 'p[uú]t[oa4]s?', 'verg[a4]', 'zorr[a4]s?'
  ];
BEGIN
  FOREACH pattern IN ARRAY patterns LOOP
    result := regexp_replace(
      result,
      '(^|[^[:alnum:]_])(' || pattern || ')([^[:alnum:]_]|$)',
      E'\\1****\\3',
      'gi'
    );
  END LOOP;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.konekto_moderar_contenido()
RETURNS trigger
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'comentarios_fotos' THEN
    NEW.comentario := public.konekto_censurar_ofensas(NEW.comentario);
  ELSE
    NEW.contenido := public.konekto_censurar_ofensas(NEW.contenido);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comentarios_fotos_moderacion ON public.comentarios_fotos;
CREATE TRIGGER comentarios_fotos_moderacion
BEFORE INSERT OR UPDATE OF comentario ON public.comentarios_fotos
FOR EACH ROW EXECUTE FUNCTION public.konekto_moderar_contenido();

DROP TRIGGER IF EXISTS comentarios_perfil_moderacion ON public.comentarios_perfil_fotos;
CREATE TRIGGER comentarios_perfil_moderacion
BEFORE INSERT OR UPDATE OF comentario ON public.comentarios_perfil_fotos
FOR EACH ROW EXECUTE FUNCTION public.konekto_moderar_contenido();

DROP TRIGGER IF EXISTS mensajes_salas_moderacion ON public.mensajes_salas;
CREATE TRIGGER mensajes_salas_moderacion
BEFORE INSERT OR UPDATE OF contenido ON public.mensajes_salas
FOR EACH ROW EXECUTE FUNCTION public.konekto_moderar_contenido();

DROP TRIGGER IF EXISTS mensajes_privados_moderacion ON public.mensajes_privados;
CREATE TRIGGER mensajes_privados_moderacion
BEFORE INSERT OR UPDATE OF contenido ON public.mensajes_privados
FOR EACH ROW EXECUTE FUNCTION public.konekto_moderar_contenido();

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
  recent_own_comments integer;
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
  IF char_length(btrim(coalesce(p_comentario, ''))) NOT BETWEEN 1 AND 240 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_COMMENT');
  END IF;

  SELECT count(*)::integer INTO recent_own_comments
    FROM (
      SELECT autor_id
        FROM public.comentarios_fotos
       WHERE foto_id = p_foto_id
       ORDER BY fecha DESC, id DESC
       LIMIT 3
    ) AS latest
   WHERE latest.autor_id = viewer_id;

  IF recent_own_comments >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'COMMENT_STREAK_LIMIT');
  END IF;

  INSERT INTO public.comentarios_fotos (foto_id, autor_id, comentario)
  VALUES (p_foto_id, viewer_id, public.konekto_censurar_ofensas(btrim(p_comentario)))
  RETURNING * INTO new_comment;

  SELECT username INTO alias FROM public.perfiles_dk WHERE id = viewer_id;
  RETURN jsonb_build_object('ok', true, 'comment', jsonb_build_object(
    'id', new_comment.id,
    'foto_id', new_comment.foto_id,
    'autor_id', new_comment.autor_id,
    'autor_alias', alias,
    'comentario', new_comment.comentario,
    'fecha', new_comment.fecha
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.enviar_mensaje_sala_seguro(
  p_session_token text,
  p_sala_id bigint,
  p_contenido text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender_id uuid;
  clean_content text;
  last_sent_at timestamptz;
  inserted_message public.mensajes_salas;
BEGIN
  sender_id := public.media_session_profile(p_session_token);
  IF sender_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.salas_chat WHERE id = p_sala_id AND activa = true) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROOM_NOT_FOUND');
  END IF;

  clean_content := nullif(btrim(public.konekto_censurar_ofensas(coalesce(p_contenido, ''))), '');
  IF clean_content IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'EMPTY_MESSAGE');
  END IF;
  IF char_length(clean_content) > 250 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MESSAGE_TOO_LONG');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('konekto:sala-spam:' || sender_id::text));
  SELECT ultimo_envio_en INTO last_sent_at
    FROM public.control_mensajes_salas
   WHERE usuario_id = sender_id
   FOR UPDATE;
  IF last_sent_at IS NOT NULL AND last_sent_at >= now() - interval '5 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'code', 'TOO_FAST');
  END IF;

  INSERT INTO public.mensajes_salas (sala_id, autor_id, contenido)
  VALUES (p_sala_id, sender_id, clean_content)
  RETURNING * INTO inserted_message;

  INSERT INTO public.control_mensajes_salas (usuario_id, ultimo_envio_en)
  VALUES (sender_id, inserted_message.creado_en)
  ON CONFLICT (usuario_id) DO UPDATE SET ultimo_envio_en = EXCLUDED.ultimo_envio_en;

  RETURN jsonb_build_object('ok', true, 'message', jsonb_build_object(
    'id', inserted_message.id, 'creado_en', inserted_message.creado_en
  ));
END;
$$;

CREATE OR REPLACE FUNCTION public.enviar_mensaje_seguro(
  p_session_token text,
  p_receptor_id uuid,
  p_mensaje text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender_id uuid;
  message_id bigint;
  clean_message text := nullif(left(public.konekto_censurar_ofensas(btrim(coalesce(p_mensaje, ''))), 1000), '');
BEGIN
  sender_id := public.media_session_profile(p_session_token);
  IF sender_id IS NULL OR p_receptor_id IS NULL OR clean_message IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  END IF;
  IF sender_id = p_receptor_id OR NOT EXISTS (SELECT 1 FROM public.perfiles_dk WHERE id = p_receptor_id) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RECIPIENT_NOT_FOUND');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.amigos
     WHERE estado = 'aceptada'
       AND ((usuario_id = sender_id AND amigo_id = p_receptor_id)
         OR (usuario_id = p_receptor_id AND amigo_id = sender_id))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FRIEND');
  END IF;

  INSERT INTO public.mensajes_privados (remitente_id, receptor_id, tipo_mensaje, contenido)
  VALUES (sender_id, p_receptor_id, 'texto', clean_message)
  RETURNING id INTO message_id;
  RETURN jsonb_build_object('ok', true, 'message_id', message_id);
END;
$$;

-- El feed deja de incluir comentarios creados por la propia persona aunque
-- el comentario apunte al perfil de uno de sus amigos.
CREATE OR REPLACE FUNCTION public.obtener_actividad_amigos_segura(
  p_session_token text,
  p_limit integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
     WHERE a.estado = 'aceptada' AND (a.usuario_id = viewer_id OR a.amigo_id = viewer_id)
    UNION
    SELECT CASE WHEN h.usuario_id = viewer_id THEN h.amigo_id ELSE h.usuario_id END,
           h.iniciada_en, COALESCE(h.terminada_en, 'infinity'::timestamptz)
      FROM public.amistades_historial h
     WHERE h.usuario_id = viewer_id OR h.amigo_id = viewer_id
  ),
  eligible AS (
    SELECT DISTINCT e.id, e.tipo, e.actor_id, e.target_id, e.contenido, e.fecha
      FROM public.feed_actividad e
      JOIN relations r
        ON (e.actor_id = r.friend_id OR e.target_id = r.friend_id)
       AND e.fecha >= r.started_at AND e.fecha <= r.ended_at
     WHERE e.tipo IN ('comentario', 'amistad', 'foto')
       AND e.actor_id <> viewer_id
     ORDER BY e.fecha DESC
     LIMIT safe_limit
  )
  SELECT coalesce(jsonb_agg(to_jsonb(eligible) ORDER BY eligible.fecha DESC), '[]'::jsonb)
    INTO activities
    FROM eligible;
  RETURN jsonb_build_object('ok', true, 'activities', activities);
END;
$$;

GRANT EXECUTE ON FUNCTION public.konekto_censurar_ofensas(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.comentar_foto_seguro(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_mensaje_sala_seguro(text, bigint, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_mensaje_seguro(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_actividad_amigos_segura(text, integer) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.obtener_sala_chat(
  p_session_token text,
  p_sala_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer_id uuid;
  room_data jsonb;
  messages_data jsonb;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  IF viewer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;

  SELECT jsonb_build_object(
    'id', sala.id,
    'nombre', sala.nombre,
    'slug', sala.slug,
    'usuarios_activos', (
      SELECT count(DISTINCT mensaje.autor_id)
        FROM public.mensajes_salas AS mensaje
       WHERE mensaje.sala_id = sala.id
         AND mensaje.creado_en >= now() - interval '10 minutes'
    ),
    'es_favorita', EXISTS (
      SELECT 1 FROM public.favoritos_salas AS favorito
       WHERE favorito.sala_id = sala.id AND favorito.usuario_id = viewer_id
    )
  )
  INTO room_data
  FROM public.salas_chat AS sala
  WHERE sala.id = p_sala_id AND sala.activa = true;

  IF room_data IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROOM_NOT_FOUND');
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', mensaje.id,
      'autor_id', perfil.id,
      'autor_alias', perfil.username,
      'avatar_url', perfil.avatar_url,
      'fecha_nacimiento', perfil.fecha_nacimiento,
      'es_vip', coalesce(perfil.is_vip, perfil.es_vip, false),
      'contenido', mensaje.contenido,
      'creado_en', mensaje.creado_en
    )
    ORDER BY mensaje.creado_en DESC, mensaje.id DESC
  ), '[]'::jsonb)
  INTO messages_data
  FROM (
    SELECT * FROM public.mensajes_salas
     WHERE sala_id = p_sala_id
     ORDER BY creado_en DESC, id DESC
     LIMIT 12
  ) AS mensaje
  JOIN public.perfiles_dk AS perfil ON perfil.id = mensaje.autor_id;

  RETURN jsonb_build_object('ok', true, 'room', room_data, 'messages', messages_data);
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_sala_chat(text, bigint) TO anon, authenticated;