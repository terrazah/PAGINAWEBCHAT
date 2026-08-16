-- Chat Konekto: reglas críticas de muro, visitas y consistencia social.
-- Ejecutar después de las migraciones de métricas y privacidad.

-- El muro conserva únicamente las 200 entradas más recientes por perfil.
-- El bloqueo advisory serializa inserciones simultáneas del mismo perfil.
CREATE OR REPLACE FUNCTION public.limitar_comentarios_por_perfil()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.perfil_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.perfil_id::text));

  DELETE FROM public.comentarios_perfil_fotos AS comentario
  WHERE comentario.id IN (
    SELECT id
    FROM public.comentarios_perfil_fotos
    WHERE perfil_id = NEW.perfil_id
    ORDER BY fecha DESC NULLS LAST, id DESC
    OFFSET 200
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS comentarios_perfil_max_200
  ON public.comentarios_perfil_fotos;

CREATE TRIGGER comentarios_perfil_max_200
AFTER INSERT ON public.comentarios_perfil_fotos
FOR EACH ROW
EXECUTE FUNCTION public.limitar_comentarios_por_perfil();

-- Limpieza única de perfiles que ya superaban el límite antes de instalar
-- el trigger. Se conservan las 200 entradas más recientes de cada perfil.
WITH ordenados AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY perfil_id
      ORDER BY fecha DESC NULLS LAST, id DESC
    ) AS posicion
  FROM public.comentarios_perfil_fotos
  WHERE perfil_id IS NOT NULL
)
DELETE FROM public.comentarios_perfil_fotos AS comentario
USING ordenados
WHERE comentario.id = ordenados.id
  AND ordenados.posicion > 200;

-- La función antigua aceptaba únicamente el perfil y podía incrementar
-- accidentalmente una auto-visita. Se reemplaza por una RPC que recibe
-- explícitamente viewer y perfil y rechaza viewer_id = profile_id.
DROP FUNCTION IF EXISTS public.registrar_visita_perfil(uuid);

CREATE OR REPLACE FUNCTION public.registrar_visita_perfil(
  p_viewer_id uuid,
  p_perfil_id uuid
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nuevo_total bigint;
BEGIN
  SELECT visitas
  INTO nuevo_total
  FROM public.perfiles_dk
  WHERE id = p_perfil_id;

  IF p_viewer_id IS NULL
     OR p_perfil_id IS NULL
     OR p_viewer_id = p_perfil_id THEN
    RETURN COALESCE(nuevo_total, 0);
  END IF;

  UPDATE public.perfiles_dk
  SET visitas = visitas + 1
  WHERE id = p_perfil_id
  RETURNING visitas INTO nuevo_total;

  RETURN COALESCE(nuevo_total, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_visita_perfil(uuid, uuid)
  TO anon, authenticated;