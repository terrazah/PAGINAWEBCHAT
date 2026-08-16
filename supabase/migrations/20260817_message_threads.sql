-- Chat Konekto: hilos independientes por envío y contador de mensajes no leídos.
-- Ejecutar después de 20260816_messaging_phase42.sql.

ALTER TABLE public.mensajes_privados
  ADD COLUMN IF NOT EXISTS conversacion_id uuid;

UPDATE public.mensajes_privados
   SET conversacion_id = gen_random_uuid()
 WHERE conversacion_id IS NULL;

ALTER TABLE public.mensajes_privados
  ALTER COLUMN conversacion_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN conversacion_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mensajes_privados_conversacion
  ON public.mensajes_privados (conversacion_id, creado_en DESC, id DESC);

CREATE OR REPLACE FUNCTION public.obtener_bandeja_segura(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  profile_id uuid;
BEGIN
  SELECT s.profile_id
    INTO profile_id
    FROM public.konekto_sessions s
   WHERE s.token_hash = encode(extensions.digest(p_session_token, 'sha256'), 'hex')
     AND s.expira_en > now();

  IF profile_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'messages', coalesce((
      WITH conversation_messages AS (
        SELECT
          m.id, m.conversacion_id, m.remitente_id, m.receptor_id,
          m.tipo_mensaje, m.contenido, m.imagen_url, m.foto_id,
          m.creado_en, m.leido_en, g.tipo_regalo,
          sender.username AS remitente_alias,
          recipient.username AS receptor_alias,
          CASE WHEN m.receptor_id = profile_id THEN 'recibido' ELSE 'enviado' END AS direccion,
          CASE WHEN m.receptor_id = profile_id THEN m.remitente_id ELSE m.receptor_id END AS contacto_id,
          CASE WHEN m.receptor_id = profile_id THEN sender.username ELSE recipient.username END AS contacto_alias,
          CASE WHEN m.receptor_id = profile_id THEN sender.avatar_url ELSE recipient.avatar_url END AS contacto_avatar_url,
          count(*) FILTER (WHERE m.receptor_id = profile_id AND m.leido_en IS NULL)
            OVER (PARTITION BY m.conversacion_id) AS mensajes_no_leidos,
          row_number() OVER (
            PARTITION BY m.conversacion_id
            ORDER BY m.creado_en DESC, m.id DESC
          ) AS conversation_row
        FROM public.mensajes_privados m
        JOIN public.perfiles_dk sender ON sender.id = m.remitente_id
        JOIN public.perfiles_dk recipient ON recipient.id = m.receptor_id
        LEFT JOIN public.regalos_dk g ON g.id = m.regalo_id
        WHERE m.receptor_id = profile_id OR m.remitente_id = profile_id
      )
      SELECT jsonb_agg(jsonb_build_object(
        'id', latest.id,
        'conversacion_id', latest.conversacion_id,
        'remitente_alias', latest.remitente_alias,
        'receptor_alias', latest.receptor_alias,
        'direccion', latest.direccion,
        'contacto_id', latest.contacto_id,
        'contacto_alias', latest.contacto_alias,
        'contacto_avatar_url', latest.contacto_avatar_url,
        'tipo_mensaje', latest.tipo_mensaje,
        'tipo_regalo', latest.tipo_regalo,
        'mensaje', latest.contenido,
        'imagen_url', latest.imagen_url,
        'foto_id', latest.foto_id,
        'creado_en', latest.creado_en,
        'leido_en', latest.leido_en,
        'mensajes_no_leidos', latest.mensajes_no_leidos
      ) ORDER BY latest.creado_en DESC, latest.id DESC)
      FROM conversation_messages latest
      WHERE latest.conversation_row = 1
    ), '[]'::jsonb)
  );
END;
$$;

DROP FUNCTION IF EXISTS public.obtener_chat_seguro(text, bigint);

CREATE OR REPLACE FUNCTION public.obtener_chat_seguro(
  p_session_token text,
  p_mensaje_id bigint,
  p_limite integer DEFAULT 2,
  p_antes_de bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  viewer_id uuid;
  other_id uuid;
  thread_id uuid;
  safe_limit integer := least(greatest(coalesce(p_limite, 2), 1), 5);
  messages jsonb;
  oldest_id bigint;
  total_count bigint := 0;
  has_more boolean := false;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  IF viewer_id IS NULL OR p_mensaje_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;

  SELECT
    m.conversacion_id,
    CASE WHEN m.remitente_id = viewer_id THEN m.receptor_id ELSE m.remitente_id END
    INTO thread_id, other_id
    FROM public.mensajes_privados m
   WHERE m.id = p_mensaje_id
     AND (m.remitente_id = viewer_id OR m.receptor_id = viewer_id)
   LIMIT 1;

  IF other_id IS NULL OR thread_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND');
  END IF;

  WITH conversation AS (
    SELECT m.id, m.remitente_id, m.receptor_id, m.tipo_mensaje, m.contenido,
           m.imagen_url, m.foto_id, m.creado_en, m.leido_en, g.tipo_regalo,
           sender.username AS remitente_alias,
           recipient.username AS receptor_alias
      FROM public.mensajes_privados m
      JOIN public.perfiles_dk sender ON sender.id = m.remitente_id
      JOIN public.perfiles_dk recipient ON recipient.id = m.receptor_id
      LEFT JOIN public.regalos_dk g ON g.id = m.regalo_id
     WHERE m.conversacion_id = thread_id
       AND (
         (m.remitente_id = viewer_id AND m.receptor_id = other_id)
         OR (m.remitente_id = other_id AND m.receptor_id = viewer_id)
       )
  ),
  page AS (
    SELECT *
      FROM conversation
     WHERE p_antes_de IS NULL OR id < p_antes_de
     ORDER BY creado_en DESC, id DESC
     LIMIT safe_limit
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'id', page.id,
      'conversacion_id', thread_id,
      'remitente_alias', page.remitente_alias,
      'receptor_alias', page.receptor_alias,
      'tipo_mensaje', page.tipo_mensaje,
      'tipo_regalo', page.tipo_regalo,
      'mensaje', page.contenido,
      'imagen_url', page.imagen_url,
      'foto_id', page.foto_id,
      'creado_en', page.creado_en,
      'leido_en', page.leido_en
    ) ORDER BY page.creado_en ASC, page.id ASC), '[]'::jsonb),
    min(page.id)
    INTO messages, oldest_id
    FROM page;

  IF oldest_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.mensajes_privados m
       WHERE m.conversacion_id = thread_id
         AND (
           (m.remitente_id = viewer_id AND m.receptor_id = other_id)
           OR (m.remitente_id = other_id AND m.receptor_id = viewer_id)
         )
         AND m.id < oldest_id
    ) INTO has_more;
  END IF;

  SELECT count(*)
    INTO total_count
    FROM public.mensajes_privados m
   WHERE m.conversacion_id = thread_id
     AND (
       (m.remitente_id = viewer_id AND m.receptor_id = other_id)
       OR (m.remitente_id = other_id AND m.receptor_id = viewer_id)
     );

  UPDATE public.mensajes_privados AS pm
     SET leido_en = coalesce(leido_en, now())
   WHERE pm.conversacion_id = thread_id
     AND pm.receptor_id = viewer_id
     AND pm.remitente_id = other_id
     AND pm.leido_en IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'conversation_id', thread_id,
    'other_id', other_id,
    'other_username', (SELECT username FROM public.perfiles_dk WHERE id = other_id),
    'messages', messages,
    'total_count', total_count,
    'has_more', has_more,
    'oldest_id', oldest_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.enviar_mensaje_seguro(
  p_session_token text,
  p_receptor_id uuid,
  p_mensaje text,
  p_conversacion_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sender_id uuid;
  conversation_id uuid := gen_random_uuid();
  latest_sender_id uuid;
  latest_receptor_id uuid;
  message_id bigint;
  clean_message text := nullif(left(btrim(coalesce(p_mensaje, '')), 1000), '');
BEGIN
  sender_id := public.media_session_profile(p_session_token);
  IF sender_id IS NULL OR p_receptor_id IS NULL OR clean_message IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  END IF;
  IF sender_id = p_receptor_id OR NOT EXISTS (
    SELECT 1 FROM public.perfiles_dk WHERE id = p_receptor_id
  ) THEN
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

  IF p_conversacion_id IS NOT NULL THEN
    SELECT m.remitente_id, m.receptor_id
      INTO latest_sender_id, latest_receptor_id
      FROM public.mensajes_privados m
     WHERE m.conversacion_id = p_conversacion_id
       AND (
         (m.remitente_id = sender_id AND m.receptor_id = p_receptor_id)
         OR (m.remitente_id = p_receptor_id AND m.receptor_id = sender_id)
       )
     ORDER BY m.creado_en DESC, m.id DESC
     LIMIT 1;

    -- Solo la respuesta del destinatario continúa el hilo. Si el último
    -- mensaje ya lo envió quien escribe, este envío abre otro hilo.
    IF latest_receptor_id = sender_id AND latest_sender_id = p_receptor_id THEN
      conversation_id := p_conversacion_id;
    END IF;
  END IF;

  INSERT INTO public.mensajes_privados (
    remitente_id, receptor_id, conversacion_id, tipo_mensaje, contenido
  ) VALUES (
    sender_id, p_receptor_id, conversation_id, 'texto', clean_message
  )
  RETURNING id INTO message_id;

  RETURN jsonb_build_object('ok', true, 'message_id', message_id, 'conversation_id', conversation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.enviar_mensaje_seguro(
  p_session_token text,
  p_receptor_id uuid,
  p_mensaje text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.enviar_mensaje_seguro(p_session_token, p_receptor_id, p_mensaje, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.compartir_foto_segura(
  p_session_token text,
  p_receptor_id uuid,
  p_foto_id uuid,
  p_mensaje text,
  p_conversacion_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  sender_id uuid;
  owner_id uuid;
  visibility text;
  conversation_id uuid := gen_random_uuid();
  latest_sender_id uuid;
  latest_receptor_id uuid;
  message_id bigint;
  message_text text := nullif(left(btrim(coalesce(p_mensaje, '')), 240), '');
BEGIN
  sender_id := public.media_session_profile(p_session_token);
  IF sender_id IS NULL OR p_receptor_id IS NULL OR p_foto_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  END IF;
  IF sender_id = p_receptor_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'SELF_SHARE');
  END IF;
  SELECT user_id, visibilidad INTO owner_id, visibility
    FROM public.fotos_galeria WHERE id = p_foto_id;
  IF owner_id IS NULL OR NOT public.media_can_view_photo(sender_id, owner_id, visibility) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'FORBIDDEN');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.amigos
    WHERE estado = 'aceptada'
      AND ((usuario_id = sender_id AND amigo_id = p_receptor_id)
        OR (usuario_id = p_receptor_id AND amigo_id = sender_id))
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FRIEND');
  END IF;

  IF p_conversacion_id IS NOT NULL THEN
    SELECT m.remitente_id, m.receptor_id
      INTO latest_sender_id, latest_receptor_id
      FROM public.mensajes_privados m
     WHERE m.conversacion_id = p_conversacion_id
       AND (
         (m.remitente_id = sender_id AND m.receptor_id = p_receptor_id)
         OR (m.remitente_id = p_receptor_id AND m.receptor_id = sender_id)
       )
     ORDER BY m.creado_en DESC, m.id DESC
     LIMIT 1;
    IF latest_receptor_id = sender_id AND latest_sender_id = p_receptor_id THEN
      conversation_id := p_conversacion_id;
    END IF;
  END IF;

  INSERT INTO public.mensajes_privados (
    remitente_id, receptor_id, conversacion_id, tipo_mensaje, contenido, foto_id, imagen_url
  )
  SELECT sender_id, p_receptor_id, conversation_id, 'foto', message_text, p_foto_id, f.url
    FROM public.fotos_galeria f WHERE f.id = p_foto_id
  RETURNING id INTO message_id;

  RETURN jsonb_build_object('ok', true, 'message_id', message_id, 'conversation_id', conversation_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.compartir_foto_segura(
  p_session_token text,
  p_receptor_id uuid,
  p_foto_id uuid,
  p_mensaje text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN public.compartir_foto_segura(p_session_token, p_receptor_id, p_foto_id, p_mensaje, NULL);
END;
$$;

CREATE OR REPLACE FUNCTION public.eliminar_chat_seguro(
  p_session_token text,
  p_mensaje_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  viewer_id uuid;
  thread_id uuid;
  deleted_count integer;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  SELECT m.conversacion_id
    INTO thread_id
    FROM public.mensajes_privados m
   WHERE m.id = p_mensaje_id
     AND (m.remitente_id = viewer_id OR m.receptor_id = viewer_id)
   LIMIT 1;

  IF viewer_id IS NULL OR thread_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND');
  END IF;

  DELETE FROM public.mensajes_privados AS pm
   WHERE pm.conversacion_id = thread_id
     AND (pm.remitente_id = viewer_id OR pm.receptor_id = viewer_id);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'deleted', deleted_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_bandeja_segura(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.obtener_chat_seguro(text, bigint, integer, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_mensaje_seguro(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_mensaje_seguro(text, uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compartir_foto_segura(text, uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compartir_foto_segura(text, uuid, uuid, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_chat_seguro(text, bigint) TO anon, authenticated;