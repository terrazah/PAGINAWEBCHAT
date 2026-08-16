-- Las fotos privadas compartidas permanecen dentro de la conversación para
-- quien las recibe. El dueño conserva su acceso a la página de la foto.
-- Ejecutar después de 20260819_inbox_received_turns.sql.

CREATE OR REPLACE FUNCTION public.obtener_chat_seguro(
  p_session_token text,
  p_mensaje_id bigint,
  p_limite integer DEFAULT 2,
  p_antes_de bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
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

  SELECT m.id,
         CASE WHEN m.remitente_id = viewer_id THEN m.receptor_id ELSE m.remitente_id END
    INTO anchor_id, other_id
    FROM public.mensajes_privados m
   WHERE m.id = p_mensaje_id
     AND (m.remitente_id = viewer_id OR m.receptor_id = viewer_id)
   LIMIT 1;

  IF anchor_id IS NULL OR other_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'MESSAGE_NOT_FOUND');
  END IF;

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
      photo.visibilidad AS foto_visibilidad,
      m.creado_en,
      m.leido_en,
      g.tipo_regalo,
      sender.username AS remitente_alias,
      recipient.username AS receptor_alias
    FROM public.mensajes_privados m
    JOIN public.perfiles_dk sender ON sender.id = m.remitente_id
    JOIN public.perfiles_dk recipient ON recipient.id = m.receptor_id
    LEFT JOIN public.regalos_dk g ON g.id = m.regalo_id
    LEFT JOIN public.fotos_galeria photo ON photo.id = m.foto_id
    WHERE m.id >= anchor_id
      AND (next_incoming_id IS NULL OR m.id < next_incoming_id)
      AND (
        (m.remitente_id = viewer_id AND m.receptor_id = other_id)
        OR (m.remitente_id = other_id AND m.receptor_id = viewer_id)
      )
  ),
  page AS (
    SELECT *
    FROM turn_messages
    WHERE p_antes_de IS NULL OR id < p_antes_de
    ORDER BY id DESC
    LIMIT safe_limit
  )
  SELECT coalesce(
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
               'foto_visibilidad', page.foto_visibilidad,
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
          OR (m.remitente_id = other_id AND m.receptor_id = viewer_id)
        )
        AND m.id < oldest_id
    ) INTO has_more;
  END IF;

  SELECT count(*)
    INTO total_count
    FROM public.mensajes_privados m
   WHERE m.id >= anchor_id
     AND (next_incoming_id IS NULL OR m.id < next_incoming_id)
     AND (
       (m.remitente_id = viewer_id AND m.receptor_id = other_id)
       OR (m.remitente_id = other_id AND m.receptor_id = viewer_id)
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
    'other_username', (SELECT username FROM public.perfiles_dk WHERE id = other_id),
    'messages', messages,
    'total_count', total_count,
    'has_more', has_more,
    'oldest_id', oldest_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_chat_seguro(text, bigint, integer, bigint)
  TO anon, authenticated;