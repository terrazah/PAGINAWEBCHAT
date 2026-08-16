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
      SELECT jsonb_agg(jsonb_build_object(
        'id', m.id,
        'remitente_alias', sender.username,
        'receptor_alias', recipient.username,
        'direccion', 'recibido',
        'contacto_id', sender.id,
        'contacto_alias', sender.username,
        'contacto_avatar_url', sender.avatar_url,
        'tipo_mensaje', m.tipo_mensaje,
        'tipo_regalo', g.tipo_regalo,
        'mensaje', m.contenido,
        'imagen_url', m.imagen_url,
        'foto_id', m.foto_id,
        'creado_en', m.creado_en,
        'leido_en', m.leido_en,
        'mensajes_no_leidos', CASE WHEN m.leido_en IS NULL THEN 1 ELSE 0 END
      ) ORDER BY m.creado_en DESC, m.id DESC)
      FROM public.mensajes_privados m
      JOIN public.perfiles_dk sender ON sender.id = m.remitente_id
      JOIN public.perfiles_dk recipient ON recipient.id = m.receptor_id
      LEFT JOIN public.regalos_dk g ON g.id = m.regalo_id
      WHERE m.receptor_id = profile_id
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
  anchor_id bigint;
  next_incoming_id bigint;
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
    m.id,
    CASE WHEN m.remitente_id = viewer_id
      THEN m.receptor_id
      ELSE m.remitente_id
    END
    INTO anchor_id, other_id
    FROM public.mensajes_privados m
   WHERE m.id = p_mensaje_id
     AND (m.remitente_id = viewer_id OR m.receptor_id = viewer_id)
   LIMIT 1;

  IF anchor_id IS NULL OR other_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND');
  END IF;

  -- La siguiente entrada del contacto abre la siguiente tarjeta.
  SELECT min(m.id)
    INTO next_incoming_id
    FROM public.mensajes_privados m
   WHERE m.id > anchor_id
     AND m.remitente_id = other_id
     AND m.receptor_id = viewer_id;

  WITH turn_messages AS (
    SELECT
      m.id,
      m.tipo_mensaje,
      m.contenido,
      m.imagen_url,
      m.foto_id,
      m.creado_en,
      m.leido_en,
      g.tipo_regalo,
      sender.username AS remitente_alias,
      recipient.username AS receptor_alias
    FROM public.mensajes_privados m
    JOIN public.perfiles_dk sender
      ON sender.id = m.remitente_id
    JOIN public.perfiles_dk recipient
      ON recipient.id = m.receptor_id
    LEFT JOIN public.regalos_dk g
      ON g.id = m.regalo_id
    WHERE m.id >= anchor_id
      AND (next_incoming_id IS NULL OR m.id < next_incoming_id)
      AND (
        (m.remitente_id = viewer_id AND m.receptor_id = other_id)
        OR
        (m.remitente_id = other_id AND m.receptor_id = viewer_id)
      )
  ),
  page AS (
    SELECT *
    FROM turn_messages
    WHERE p_antes_de IS NULL OR id < p_antes_de
    ORDER BY id DESC
    LIMIT safe_limit
  )
  SELECT
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', page.id,
          'remitente_alias', page.remitente_alias,
          'receptor_alias', page.receptor_alias,
          'tipo_mensaje', page.tipo_mensaje,
          'tipo_regalo', page.tipo_regalo,
          'mensaje', page.contenido,
          'imagen_url', page.imagen_url,
          'foto_id', page.foto_id,
          'creado_en', page.creado_en,
          'leido_en', page.leido_en
        )
        ORDER BY page.id ASC
      ),
      '[]'::jsonb
    ),
    min(page.id)
    INTO messages, oldest_id
    FROM page;

  IF oldest_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.mensajes_privados m
      WHERE m.id >= anchor_id
        AND (next_incoming_id IS NULL OR m.id < next_incoming_id)
        AND (
          (m.remitente_id = viewer_id AND m.receptor_id = other_id)
          OR
          (m.remitente_id = other_id AND m.receptor_id = viewer_id)
        )
        AND m.id < oldest_id
    )
    INTO has_more;
  END IF;

  SELECT count(*)
    INTO total_count
    FROM public.mensajes_privados m
   WHERE m.id >= anchor_id
     AND (next_incoming_id IS NULL OR m.id < next_incoming_id)
     AND (
       (m.remitente_id = viewer_id AND m.receptor_id = other_id)
       OR
       (m.remitente_id = other_id AND m.receptor_id = viewer_id)
     );

  UPDATE public.mensajes_privados AS pm
     SET leido_en = coalesce(pm.leido_en, now())
   WHERE pm.id = anchor_id
     AND pm.receptor_id = viewer_id
     AND pm.remitente_id = other_id
     AND pm.leido_en IS NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'other_id', other_id,
    'other_username', (
      SELECT username
      FROM public.perfiles_dk
      WHERE id = other_id
    ),
    'messages', messages,
    'total_count', total_count,
    'has_more', has_more,
    'oldest_id', oldest_id
  );
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
  anchor_id bigint;
  next_incoming_id bigint;
  deleted_count integer;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);

  SELECT
    m.id,
    CASE WHEN m.remitente_id = viewer_id
      THEN m.receptor_id
      ELSE m.remitente_id
    END
    INTO anchor_id, other_id
    FROM public.mensajes_privados m
   WHERE m.id = p_mensaje_id
     AND (m.remitente_id = viewer_id OR m.receptor_id = viewer_id)
   LIMIT 1;

  IF viewer_id IS NULL OR anchor_id IS NULL OR other_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND');
  END IF;

  SELECT min(m.id)
    INTO next_incoming_id
    FROM public.mensajes_privados m
   WHERE m.id > anchor_id
     AND m.remitente_id = other_id
     AND m.receptor_id = viewer_id;

  DELETE FROM public.mensajes_privados AS pm
   WHERE pm.id >= anchor_id
     AND (next_incoming_id IS NULL OR pm.id < next_incoming_id)
     AND (
       (pm.remitente_id = viewer_id AND pm.receptor_id = other_id)
       OR
       (pm.remitente_id = other_id AND pm.receptor_id = viewer_id)
     );

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', deleted_count
  );
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

  DELETE FROM public.mensajes_privados AS pm
   WHERE pm.remitente_id = viewer_id
      OR pm.receptor_id = viewer_id;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted', deleted_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_bandeja_segura(text)
  TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.obtener_chat_seguro(
  text,
  bigint,
  integer,
  bigint
)
TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.eliminar_chat_seguro(text, bigint)
  TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.borrar_bandeja_segura(text)
  TO anon, authenticated;