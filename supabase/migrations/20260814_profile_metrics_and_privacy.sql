-- Chat Konekto: métricas del perfil y visibilidad de amigos.
-- Ejecutar una sola vez en Supabase > SQL Editor.

ALTER TABLE public.perfiles_dk
  ADD COLUMN IF NOT EXISTS ocultar_amigos boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS visitas bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS regalos integer NOT NULL DEFAULT 0;

-- Incremento atómico para que dos visitas simultáneas no sobrescriban el contador.
CREATE OR REPLACE FUNCTION public.registrar_visita_perfil(p_perfil_id uuid)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nuevo_total bigint;
BEGIN
  UPDATE public.perfiles_dk
  SET visitas = visitas + 1
  WHERE id = p_perfil_id
  RETURNING visitas INTO nuevo_total;

  RETURN COALESCE(nuevo_total, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_visita_perfil(uuid) TO anon, authenticated;