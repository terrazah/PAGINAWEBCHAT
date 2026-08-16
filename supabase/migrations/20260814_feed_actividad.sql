-- ═══════════════════════════════════════════════════════════════════════════
-- Feed de actividad persistente
-- Desvincula los registros de actividad de la eliminación en cascada de
-- comentarios o amistades. Los eventos permanecen incluso si se borra el
-- contenido original.
-- ═══════════════════════════════════════════════════════════════════════════

-- Tabla de eventos de actividad (append-only, sin ON DELETE CASCADE en el
-- payload para que persista aunque se borre el comentario original).
CREATE TABLE IF NOT EXISTS public.feed_actividad (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo      text        NOT NULL CHECK (tipo IN ('comentario', 'amistad')),
  actor_id  uuid        NOT NULL REFERENCES public.perfiles_dk(id) ON DELETE CASCADE,
  target_id uuid        REFERENCES public.perfiles_dk(id) ON DELETE SET NULL,
  contenido text,
  fecha     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feed_actividad_actor_fecha_idx
  ON public.feed_actividad (actor_id, fecha DESC);

CREATE INDEX IF NOT EXISTS feed_actividad_target_fecha_idx
  ON public.feed_actividad (target_id, fecha DESC);

-- ─── Trigger: registrar comentarios al feed ────────────────────────────────

CREATE OR REPLACE FUNCTION public.registrar_actividad_comentario()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.feed_actividad (tipo, actor_id, target_id, contenido, fecha)
  VALUES (
    'comentario',
    NEW.autor_id,
    NEW.perfil_id,
    NEW.comentario,
    COALESCE(NEW.fecha::timestamptz, now())
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comentarios_a_feed ON public.comentarios_perfil_fotos;
CREATE TRIGGER comentarios_a_feed
  AFTER INSERT ON public.comentarios_perfil_fotos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_actividad_comentario();

-- ─── Trigger: registrar amistades aceptadas al feed ───────────────────────

CREATE OR REPLACE FUNCTION public.registrar_actividad_amistad()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.estado = 'aceptada' AND (OLD IS NULL OR OLD.estado IS DISTINCT FROM 'aceptada') THEN
    INSERT INTO public.feed_actividad (tipo, actor_id, target_id, fecha)
    VALUES ('amistad', NEW.usuario_id, NEW.amigo_id, now());
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS amigos_a_feed ON public.amigos;
CREATE TRIGGER amigos_a_feed
  AFTER INSERT OR UPDATE ON public.amigos
  FOR EACH ROW EXECUTE FUNCTION public.registrar_actividad_amistad();

-- ─── RLS ──────────────────────────────────────────────────────────────────
-- La tabla es de solo lectura para todos los usuarios autenticados.
-- Las escritas las hacen los triggers SECURITY DEFINER.
ALTER TABLE public.feed_actividad ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feed_actividad_select" ON public.feed_actividad;
CREATE POLICY "feed_actividad_select"
  ON public.feed_actividad FOR SELECT
  USING (true);
