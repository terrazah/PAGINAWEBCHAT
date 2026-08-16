-- Fija el destinatario de los mensajes privados en el servidor y deja la
-- carta superior dedicada exclusivamente a mensajes recibidos sin abrir.
-- Ejecutar después de 20260824_chat_moderacion_limites.sql.

DROP FUNCTION IF EXISTS public.enviar_mensaje_seguro(text, uuid, text);

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
  conversation_id uuid := gen_random_uuid();
  clean_message text := nullif(
    left(public.konekto_censurar_ofensas(btrim(coalesce(p_mensaje, ''))), 1000),
    ''
  );
BEGIN
  sender_id := public.media_session_profile(p_session_token);

  IF sender_id IS NULL OR p_receptor_id IS NULL OR clean_message IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_REQUEST');
  END IF;

  IF sender_id = p_receptor_id OR NOT EXISTS (
    SELECT 1
    FROM public.perfiles_dk
    WHERE id = p_receptor_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'RECIPIENT_NOT_FOUND');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.amigos
    WHERE estado = 'aceptada'
      AND (
        (usuario_id = sender_id AND amigo_id = p_receptor_id)
        OR (usuario_id = p_receptor_id AND amigo_id = sender_id)
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'NOT_FRIEND');
  END IF;

  INSERT INTO public.mensajes_privados (
    remitente_id,
    receptor_id,
    conversacion_id,
    tipo_mensaje,
    contenido
  )
  VALUES (
    sender_id,
    p_receptor_id,
    conversation_id,
    'texto',
    clean_message
  )
  RETURNING id INTO message_id;

  RETURN jsonb_build_object(
    'ok', true,
    'message_id', message_id,
    'conversation_id', conversation_id,
    'remitente_id', sender_id,
    'receptor_id', p_receptor_id
  );
END;
$$;

GRANT EXECUTE
ON FUNCTION public.enviar_mensaje_seguro(text, uuid, text)
TO anon, authenticated;