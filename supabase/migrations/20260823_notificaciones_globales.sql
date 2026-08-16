-- Bandeja privada de avisos para comentarios, mensajes y regalos.
-- Ejecutar después de las migraciones de bandeja, medios y comentarios.

CREATE TABLE IF NOT EXISTS public.konekto_notificaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receptor_id uuid NOT NULL REFERENCES public.perfiles_dk(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.perfiles_dk(id) ON DELETE SET NULL,
  tipo varchar(32) NOT NULL,
  referencia_id text,
  contenido text,
  tipo_regalo text,
  imagen_url text,
  foto_id uuid REFERENCES public.fotos_galeria(id) ON DELETE SET NULL,
  fecha timestamptz NOT NULL DEFAULT now(),
  leida_en timestamptz,
  CONSTRAINT konekto_notificaciones_tipo_check
    CHECK (tipo IN ('mensaje', 'comentario_perfil', 'comentario_foto', 'regalo'))
);

CREATE INDEX IF NOT EXISTS konekto_notificaciones_receptor_fecha_idx
  ON public.konekto_notificaciones (receptor_id, fecha DESC);

CREATE INDEX IF NOT EXISTS konekto_notificaciones_receptor_no_leidas_idx
  ON public.konekto_notificaciones (receptor_id, leida_en)
  WHERE leida_en IS NULL;

ALTER TABLE public.konekto_notificaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "konekto_notificaciones_no_direct_access"
  ON public.konekto_notificaciones;
CREATE POLICY "konekto_notificaciones_no_direct_access"
  ON public.konekto_notificaciones
  FOR ALL USING (false) WITH CHECK (false);

REVOKE ALL ON public.konekto_notificaciones FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.konekto_crear_notificacion_mensaje()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  gift_type text;
BEGIN
  IF NEW.receptor_id = NEW.remitente_id THEN
    RETURN NEW;
  END IF;

  IF NEW.regalo_id IS NOT NULL THEN
    SELECT g.tipo_regalo INTO gift_type
      FROM public.regalos_dk g
     WHERE g.id = NEW.regalo_id;
  END IF;

  INSERT INTO public.konekto_notificaciones (
    receptor_id, actor_id, tipo, referencia_id, contenido, tipo_regalo, imagen_url, fecha
  )
  VALUES (
    NEW.receptor_id,
    NEW.remitente_id,
    CASE WHEN NEW.tipo_mensaje = 'regalo' THEN 'regalo' ELSE 'mensaje' END,
    NEW.id::text,
    NEW.contenido,
    gift_type,
    NEW.imagen_url,
    COALESCE(NEW.creado_en, now())
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mensajes_privados_a_notificaciones
  ON public.mensajes_privados;
CREATE TRIGGER mensajes_privados_a_notificaciones
AFTER INSERT ON public.mensajes_privados
FOR EACH ROW
EXECUTE FUNCTION public.konekto_crear_notificacion_mensaje();

CREATE OR REPLACE FUNCTION public.konekto_crear_notificacion_comentario_perfil()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.perfil_id IS NULL OR NEW.autor_id = NEW.perfil_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.konekto_notificaciones (
    receptor_id, actor_id, tipo, referencia_id, contenido, fecha
  )
  VALUES (
    NEW.perfil_id,
    NEW.autor_id,
    'comentario_perfil',
    NEW.id::text,
    NEW.comentario,
    COALESCE(NEW.fecha, now())
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comentarios_perfil_a_notificaciones
  ON public.comentarios_perfil_fotos;
CREATE TRIGGER comentarios_perfil_a_notificaciones
AFTER INSERT ON public.comentarios_perfil_fotos
FOR EACH ROW
EXECUTE FUNCTION public.konekto_crear_notificacion_comentario_perfil();

CREATE OR REPLACE FUNCTION public.konekto_crear_notificacion_comentario_foto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_id uuid;
BEGIN
  SELECT f.user_id INTO owner_id
    FROM public.fotos_galeria f
   WHERE f.id = NEW.foto_id;

  IF owner_id IS NULL OR owner_id = NEW.autor_id THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.konekto_notificaciones (
    receptor_id, actor_id, tipo, referencia_id, contenido, foto_id, fecha
  )
  VALUES (
    owner_id,
    NEW.autor_id,
    'comentario_foto',
    NEW.id::text,
    NEW.comentario,
    NEW.foto_id,
    COALESCE(NEW.fecha, now())
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comentarios_fotos_a_notificaciones
  ON public.comentarios_fotos;
CREATE TRIGGER comentarios_fotos_a_notificaciones
AFTER INSERT ON public.comentarios_fotos
FOR EACH ROW
EXECUTE FUNCTION public.konekto_crear_notificacion_comentario_foto();

CREATE OR REPLACE FUNCTION public.obtener_notificaciones_seguras(
  p_session_token text,
  p_limite integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer_id uuid;
  safe_limit integer := least(greatest(coalesce(p_limite, 30), 1), 100);
  rows_json jsonb;
  unread_total integer;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  IF viewer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;

  SELECT count(*)::integer INTO unread_total
    FROM public.konekto_notificaciones n
   WHERE n.receptor_id = viewer_id
     AND n.leida_en IS NULL;

  WITH recent AS (
    SELECT n.id, n.tipo, n.referencia_id, n.contenido, n.tipo_regalo,
           n.imagen_url, n.foto_id, n.fecha, n.leida_en,
           p.username AS actor_alias, p.avatar_url AS actor_avatar_url
      FROM public.konekto_notificaciones n
      LEFT JOIN public.perfiles_dk p ON p.id = n.actor_id
     WHERE n.receptor_id = viewer_id
     ORDER BY n.fecha DESC
     LIMIT safe_limit
  )
  SELECT coalesce(jsonb_agg(to_jsonb(recent) ORDER BY recent.fecha DESC), '[]'::jsonb)
    INTO rows_json
    FROM recent;

  RETURN jsonb_build_object(
    'ok', true,
    'unread_count', unread_total,
    'notifications', rows_json
  );
END;
$$;

REVOKE ALL ON FUNCTION public.obtener_notificaciones_seguras(text, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.obtener_notificaciones_seguras(text, integer)
  TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.marcar_notificaciones_seguras(
  p_session_token text,
  p_notificacion_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  viewer_id uuid;
  marked_count integer;
BEGIN
  viewer_id := public.media_session_profile(p_session_token);
  IF viewer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;

  UPDATE public.konekto_notificaciones
     SET leida_en = COALESCE(leida_en, now())
   WHERE receptor_id = viewer_id
     AND leida_en IS NULL
     AND (p_notificacion_id IS NULL OR id = p_notificacion_id);
  GET DIAGNOSTICS marked_count = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'marked', marked_count);
END;
$$;

REVOKE ALL ON FUNCTION public.marcar_notificaciones_seguras(text, uuid)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_notificaciones_seguras(text, uuid)
  TO anon, authenticated;

-- Los mensajes que ya estaban sin leer antes de esta migración también aparecen.
INSERT INTO public.konekto_notificaciones (
  receptor_id, actor_id, tipo, referencia_id, contenido, tipo_regalo, imagen_url, fecha
)
SELECT m.receptor_id,
       m.remitente_id,
       CASE WHEN m.tipo_mensaje = 'regalo' THEN 'regalo' ELSE 'mensaje' END,
       m.id::text,
       m.contenido,
       g.tipo_regalo,
       m.imagen_url,
       m.creado_en
  FROM public.mensajes_privados m
  LEFT JOIN public.regalos_dk g ON g.id = m.regalo_id
 WHERE m.leido_en IS NULL
   AND NOT EXISTS (
     SELECT 1
       FROM public.konekto_notificaciones n
      WHERE n.tipo IN ('mensaje', 'regalo')
        AND n.referencia_id = m.id::text
   );