-- Chat Konekto: historial mínimo de visitas para "Rastros en tu red".
-- Ejecutar después de 20260814_profile_metrics_and_privacy.sql.

CREATE TABLE IF NOT EXISTS public.visitas_perfil (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil_id uuid NOT NULL REFERENCES public.perfiles_dk(id) ON DELETE CASCADE,
  visitante_id uuid NOT NULL REFERENCES public.perfiles_dk(id) ON DELETE CASCADE,
  visitado_en timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visitas_perfil_unica_por_visitante UNIQUE (perfil_id, visitante_id)
);

CREATE INDEX IF NOT EXISTS visitas_perfil_perfil_fecha_idx
  ON public.visitas_perfil (perfil_id, visitado_en DESC);

-- Incrementa el contador y actualiza el último rastro del visitante sin
-- crear filas duplicadas cuando una identidad vuelve a visitar el perfil.
CREATE OR REPLACE FUNCTION public.registrar_visita_y_rastro(
  p_perfil_id uuid,
  p_visitante_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nuevo_total bigint;
BEGIN
  IF p_perfil_id IS NULL OR p_visitante_id IS NULL OR p_perfil_id = p_visitante_id THEN
    SELECT visitas INTO nuevo_total FROM public.perfiles_dk WHERE id = p_perfil_id;
    RETURN COALESCE(nuevo_total, 0);
  END IF;

  UPDATE public.perfiles_dk
  SET visitas = visitas + 1
  WHERE id = p_perfil_id
  RETURNING visitas INTO nuevo_total;

  INSERT INTO public.visitas_perfil (perfil_id, visitante_id, visitado_en)
  VALUES (p_perfil_id, p_visitante_id, now())
  ON CONFLICT (perfil_id, visitante_id)
  DO UPDATE SET visitado_en = EXCLUDED.visitado_en;

  RETURN COALESCE(nuevo_total, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_visita_y_rastro(uuid, uuid)
TO anon, authenticated;