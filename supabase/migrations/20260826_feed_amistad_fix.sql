-- Conserva el historial del feed al eliminar una amistad y corrige la
-- perspectiva de las actividades de amistad.
-- Ejecutar después de 20260824_chat_moderacion_limites.sql.

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
DROP POLICY IF EXISTS "amistades_historial_no_direct_access"
  ON public.amistades_historial;
CREATE POLICY "amistades_historial_no_direct_access"
  ON public.amistades_historial FOR ALL USING (false) WITH CHECK (false);

-- Reparación de filas creadas por la versión anterior, que cerraba el
-- intervalo usando OLD.fecha (la fecha de inicio) en vez de la fecha real
-- de eliminación.
UPDATE public.amistades_historial
   SET terminada_en = now()
 WHERE terminada_en IS NOT NULL
   AND terminada_en <= iniciada_en;

CREATE OR REPLACE FUNCTION public.registrar_historial_amistad()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.amistades_historial
       SET terminada_en = COALESCE(terminada_en, now())
     WHERE terminada_en IS NULL
       AND (
         (usuario_id = OLD.usuario_id AND amigo_id = OLD.amigo_id)
         OR (usuario_id = OLD.amigo_id AND amigo_id = OLD.usuario_id)
       );
    RETURN OLD;
  END IF;

  IF NEW.estado = 'aceptada'
     AND NOT EXISTS (
       SELECT 1
       FROM public.amistades_historial
       WHERE terminada_en IS NULL
         AND (
           (usuario_id = NEW.usuario_id AND amigo_id = NEW.amigo_id)
           OR (usuario_id = NEW.amigo_id AND amigo_id = NEW.usuario_id)
         )
     ) THEN
    INSERT INTO public.amistades_historial (
      usuario_id,
      amigo_id,
      iniciada_en
    )
    VALUES (
      NEW.usuario_id,
      NEW.amigo_id,
      COALESCE(NEW.fecha::timestamptz, now())
    )
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS amistades_a_historial ON public.amigos;
CREATE TRIGGER amistades_a_historial
AFTER INSERT OR UPDATE OR DELETE ON public.amigos
FOR EACH ROW
EXECUTE FUNCTION public.registrar_historial_amistad();

INSERT INTO public.amistades_historial (
  usuario_id,
  amigo_id,
  iniciada_en
)
SELECT
  a.usuario_id,
  a.amigo_id,
  COALESCE(a.fecha::timestamptz, now())
FROM public.amigos a
WHERE a.estado = 'aceptada'
ON CONFLICT DO NOTHING;

-- Mantiene las amistades iniciadas por la persona actual en su actividad,
-- pero continúa ocultando sus propios comentarios y fotos.
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
    RETURN jsonb_build_object(
      'ok',
      false,
      'code',
      'INVALID_SESSION'
    );
  END IF;

  WITH relations AS (
    SELECT
      CASE
        WHEN a.usuario_id = viewer_id THEN a.amigo_id
        ELSE a.usuario_id
      END AS friend_id,
      '-infinity'::timestamptz AS started_at,
      'infinity'::timestamptz AS ended_at
    FROM public.amigos a
    WHERE a.estado = 'aceptada'
      AND (a.usuario_id = viewer_id OR a.amigo_id = viewer_id)

    UNION

    SELECT
      CASE
        WHEN h.usuario_id = viewer_id THEN h.amigo_id
        ELSE h.usuario_id
      END AS friend_id,
      h.iniciada_en AS started_at,
      COALESCE(h.terminada_en, 'infinity'::timestamptz) AS ended_at
    FROM public.amistades_historial h
    WHERE h.usuario_id = viewer_id OR h.amigo_id = viewer_id
  ),
  eligible AS (
    SELECT DISTINCT
      e.id,
      e.tipo,
      e.actor_id,
      e.target_id,
      e.contenido,
      e.fecha
    FROM public.feed_actividad e
    JOIN relations r
      ON (e.actor_id = r.friend_id OR e.target_id = r.friend_id)
     AND e.fecha >= r.started_at
     AND e.fecha <= r.ended_at
    WHERE e.tipo IN ('comentario', 'amistad', 'foto')
      AND (
        e.tipo = 'amistad'
        OR e.actor_id <> viewer_id
      )
    ORDER BY e.fecha DESC
    LIMIT safe_limit
  )
  SELECT coalesce(
    jsonb_agg(
      to_jsonb(eligible)
      ORDER BY eligible.fecha DESC
    ),
    '[]'::jsonb
  )
  INTO activities
  FROM eligible;

  RETURN jsonb_build_object(
    'ok',
    true,
    'activities',
    activities
  );
END;
$$;

GRANT EXECUTE
ON FUNCTION public.obtener_actividad_amigos_segura(text, integer)
TO anon, authenticated;