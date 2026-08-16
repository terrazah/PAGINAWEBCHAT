-- Chat Konekto — Fase 5.1: categorías y presencia de salas.
-- Ejecutar después de 20260820_public_chat_rooms.sql.

ALTER TABLE public.salas_chat
  ADD COLUMN IF NOT EXISTS categoria text NOT NULL DEFAULT 'General';

UPDATE public.salas_chat
SET categoria = CASE nombre
  WHEN 'Amor México' THEN 'Romance y Citas'
  WHEN 'Buscando Pareja' THEN 'Romance y Citas'
  WHEN 'Solteros 30+' THEN 'Romance y Citas'
  WHEN 'Solteros 40+' THEN 'Romance y Citas'
  WHEN 'Citas Rápidas' THEN 'Romance y Citas'
  WHEN 'Español' THEN 'Regionales'
  WHEN 'Latino' THEN 'Regionales'
  WHEN 'Planeta Latino' THEN 'Regionales'
  WHEN 'México' THEN 'Regionales'
  WHEN 'Houston' THEN 'Regionales'
  WHEN 'Colombia' THEN 'Regionales'
  WHEN 'España' THEN 'Regionales'
  WHEN 'Solo Amigos' THEN 'Desmadre y Social'
  WHEN 'Más de 20' THEN 'Desmadre y Social'
  WHEN 'Más de 30' THEN 'Desmadre y Social'
  WHEN 'Nocturnos' THEN 'Desmadre y Social'
  WHEN 'Gay' THEN 'Diversidad'
  WHEN 'LGBT' THEN 'Diversidad'
  WHEN 'Lesbianas' THEN 'Diversidad'
  ELSE COALESCE(categoria, 'General')
END;

INSERT INTO public.salas_chat (nombre, slug, categoria)
VALUES
  ('Amor México', 'amor-mexico', 'Romance y Citas'),
  ('Buscando Pareja', 'buscando-pareja', 'Romance y Citas'),
  ('Solteros 30+', 'solteros-30', 'Romance y Citas'),
  ('Solteros 40+', 'solteros-40', 'Romance y Citas'),
  ('Citas Rápidas', 'citas-rapidas', 'Romance y Citas'),
  ('Español', 'espanol', 'Regionales'),
  ('Latino', 'latino', 'Regionales'),
  ('Planeta Latino', 'planeta-latino', 'Regionales'),
  ('México', 'mexico', 'Regionales'),
  ('Houston', 'houston', 'Regionales'),
  ('Colombia', 'colombia', 'Regionales'),
  ('España', 'espana', 'Regionales'),
  ('Solo Amigos', 'solo-amigos', 'Desmadre y Social'),
  ('Más de 20', 'mas-de-20', 'Desmadre y Social'),
  ('Más de 30', 'mas-de-30', 'Desmadre y Social'),
  ('Nocturnos', 'nocturnos', 'Desmadre y Social'),
  ('Gay', 'gay', 'Diversidad'),
  ('LGBT', 'lgbt', 'Diversidad'),
  ('Lesbianas', 'lesbianas', 'Diversidad')
ON CONFLICT (nombre) DO UPDATE
SET slug = EXCLUDED.slug,
    categoria = EXCLUDED.categoria,
    activa = true;

CREATE OR REPLACE FUNCTION public.obtener_salas_chat(p_session_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer_id uuid;
  rooms jsonb;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  IF viewer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', sala.id,
      'nombre', sala.nombre,
      'slug', sala.slug,
      'categoria', sala.categoria,
      'usuarios_activos', (
        SELECT count(DISTINCT mensaje.autor_id)
        FROM public.mensajes_salas AS mensaje
        WHERE mensaje.sala_id = sala.id
          AND mensaje.creado_en >= now() - interval '10 minutes'
      ),
      'es_favorita', EXISTS (
        SELECT 1
        FROM public.favoritos_salas AS favorito
        WHERE favorito.sala_id = sala.id
          AND favorito.usuario_id = viewer_id
      )
    )
    ORDER BY sala.nombre
  ), '[]'::jsonb)
  INTO rooms
  FROM public.salas_chat AS sala
  WHERE sala.activa = true;

  RETURN jsonb_build_object('ok', true, 'rooms', rooms);
END;
$$;

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
    'categoria', sala.categoria,
    'usuarios_activos', (
      SELECT count(DISTINCT mensaje.autor_id)
      FROM public.mensajes_salas AS mensaje
      WHERE mensaje.sala_id = sala.id
        AND mensaje.creado_en >= now() - interval '10 minutes'
    ),
    'es_favorita', EXISTS (
      SELECT 1
      FROM public.favoritos_salas AS favorito
      WHERE favorito.sala_id = sala.id
        AND favorito.usuario_id = viewer_id
    )
  )
  INTO room_data
  FROM public.salas_chat AS sala
  WHERE sala.id = p_sala_id
    AND sala.activa = true;

  IF room_data IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ROOM_NOT_FOUND');
  END IF;

  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'id', mensaje.id,
      'autor_id', perfil.id,
      'autor_alias', perfil.username,
      'avatar_url', perfil.avatar_url,
      'es_vip', coalesce(perfil.is_vip, perfil.es_vip, false),
      'contenido', mensaje.contenido,
      'creado_en', mensaje.creado_en
    )
    ORDER BY mensaje.creado_en DESC, mensaje.id DESC
  ), '[]'::jsonb)
  INTO messages_data
  FROM (
    SELECT *
    FROM public.mensajes_salas
    WHERE sala_id = p_sala_id
    ORDER BY creado_en DESC, id DESC
    LIMIT 12
  ) AS mensaje
  JOIN public.perfiles_dk AS perfil
    ON perfil.id = mensaje.autor_id;

  RETURN jsonb_build_object(
    'ok', true,
    'room', room_data,
    'messages', messages_data
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.obtener_salas_chat(text)
  TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.obtener_sala_chat(text, bigint)
  TO anon, authenticated;