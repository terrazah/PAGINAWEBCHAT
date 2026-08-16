-- Chat Konekto: bandeja y conversaciones por rutas dedicadas.
-- Ejecutar después de 20260815_media_routes_and_feed.sql.

CREATE OR REPLACE FUNCTION public.obtener_chat_seguro(
  p_session_token text,
  p_mensaje_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  viewer_id uuid;
  other_id uuid;
  messages jsonb;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  IF viewer_id IS NULL OR p_mensaje_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;

  SELECT CASE
    WHEN m.remitente_id = viewer_id THEN m.receptor_id
    ELSE m.remitente_id
  END
  INTO other_id
  FROM public.mensajes_privados m
  WHERE m.id = p_mensaje_id
    AND (m.remitente_id = viewer_id OR m.receptor_id = viewer_id)
  LIMIT 1;

  IF other_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'remitente_alias', sender.username,
    'receptor_alias', recipient.username,
    'tipo_mensaje', m.tipo_mensaje,
    'tipo_regalo', g.tipo_regalo,
    'mensaje', m.contenido,
    'imagen_url', m.imagen_url,
    'foto_id', m.foto_id,
    'creado_en', m.creado_en,
    'leido_en', m.leido_en
  ) ORDER BY m.creado_en ASC, m.id ASC), '[]'::jsonb)
  INTO messages
  FROM public.mensajes_privados m
  JOIN public.perfiles_dk sender ON sender.id = m.remitente_id
  JOIN public.perfiles_dk recipient ON recipient.id = m.receptor_id
  LEFT JOIN public.regalos_dk g ON g.id = m.regalo_id
  WHERE (m.remitente_id = viewer_id AND m.receptor_id = other_id)
     OR (m.remitente_id = other_id AND m.receptor_id = viewer_id);

  UPDATE public.mensajes_privados
  SET leido_en = coalesce(leido_en, now())
  WHERE receptor_id = viewer_id
    AND remitente_id = other_id
    AND leido_en IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'other_id', other_id,
    'other_username', (SELECT username FROM public.perfiles_dk WHERE id = other_id),
    'messages', messages
  );
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
DECLARE
  sender_id uuid;
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

  INSERT INTO public.mensajes_privados (
    remitente_id, receptor_id, tipo_mensaje, contenido
  ) VALUES (
    sender_id, p_receptor_id, 'texto', clean_message
  )
  RETURNING id INTO message_id;

  RETURN jsonb_build_object('ok', true, 'message_id', message_id);
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
  other_id uuid;
  deleted_count integer;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  SELECT CASE WHEN remitente_id = viewer_id THEN receptor_id ELSE remitente_id END
  INTO other_id
  FROM public.mensajes_privados
  WHERE id = p_mensaje_id
    AND (remitente_id = viewer_id OR receptor_id = viewer_id)
  LIMIT 1;
  IF viewer_id IS NULL OR other_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND');
  END IF;

  DELETE FROM public.mensajes_privados
  WHERE (remitente_id = viewer_id AND receptor_id = other_id)
     OR (remitente_id = other_id AND receptor_id = viewer_id);
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'deleted', deleted_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.eliminar_mensajes_recibidos_seguro(
  p_session_token text,
  p_mensaje_ids bigint[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  viewer_id uuid;
  deleted_count integer;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  IF viewer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;
  DELETE FROM public.mensajes_privados
  WHERE receptor_id = viewer_id
    AND id = ANY(coalesce(p_mensaje_ids, '{}'::bigint[]));
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'deleted', deleted_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.borrar_bandeja_segura(
  p_session_token text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  viewer_id uuid;
  deleted_count integer;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  IF viewer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;
  DELETE FROM public.mensajes_privados WHERE receptor_id = viewer_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'deleted', deleted_count);
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_chat_seguro(text, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enviar_mensaje_seguro(text, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_chat_seguro(text, bigint) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.eliminar_mensajes_recibidos_seguro(text, bigint[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.borrar_bandeja_segura(text) TO anon, authenticated;