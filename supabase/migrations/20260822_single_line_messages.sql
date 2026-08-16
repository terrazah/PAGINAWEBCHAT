-- Chat Konekto — Fase 5.2: mensajes y comentarios de una sola línea.
-- Ejecutar después de 20260821_public_chat_rooms_ux.sql.
--
-- La normalización vive en triggers para proteger también las escrituras
-- realizadas por RPCs antiguas o por clientes externos.

CREATE OR REPLACE FUNCTION public.konekto_normalizar_sala()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.contenido := btrim(regexp_replace(coalesce(NEW.contenido, ''), E'[\\r\\n]+', ' ', 'g'));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.konekto_normalizar_mensaje_privado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.contenido := btrim(regexp_replace(coalesce(NEW.contenido, ''), E'[\\r\\n]+', ' ', 'g'));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.konekto_normalizar_comentario_foto()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.comentario := btrim(regexp_replace(coalesce(NEW.comentario, ''), E'[\\r\\n]+', ' ', 'g'));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.konekto_normalizar_comentario_muro()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.comentario := btrim(regexp_replace(coalesce(NEW.comentario, ''), E'[\\r\\n]+', ' ', 'g'));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mensajes_salas_single_line
  ON public.mensajes_salas;
CREATE TRIGGER mensajes_salas_single_line
BEFORE INSERT OR UPDATE OF contenido ON public.mensajes_salas
FOR EACH ROW
EXECUTE FUNCTION public.konekto_normalizar_sala();

DROP TRIGGER IF EXISTS mensajes_privados_single_line
  ON public.mensajes_privados;
CREATE TRIGGER mensajes_privados_single_line
BEFORE INSERT OR UPDATE OF contenido ON public.mensajes_privados
FOR EACH ROW
EXECUTE FUNCTION public.konekto_normalizar_mensaje_privado();

DROP TRIGGER IF EXISTS comentarios_fotos_single_line
  ON public.comentarios_fotos;
CREATE TRIGGER comentarios_fotos_single_line
BEFORE INSERT OR UPDATE OF comentario ON public.comentarios_fotos
FOR EACH ROW
EXECUTE FUNCTION public.konekto_normalizar_comentario_foto();

DROP TRIGGER IF EXISTS comentarios_perfil_fotos_single_line
  ON public.comentarios_perfil_fotos;
CREATE TRIGGER comentarios_perfil_fotos_single_line
BEFORE INSERT OR UPDATE OF comentario ON public.comentarios_perfil_fotos
FOR EACH ROW
EXECUTE FUNCTION public.konekto_normalizar_comentario_muro();

UPDATE public.mensajes_salas
SET contenido = btrim(regexp_replace(contenido, E'[\\r\\n]+', ' ', 'g'))
WHERE contenido ~ E'[\\r\\n]';

UPDATE public.mensajes_privados
SET contenido = btrim(regexp_replace(contenido, E'[\\r\\n]+', ' ', 'g'))
WHERE contenido ~ E'[\\r\\n]';

UPDATE public.comentarios_fotos
SET comentario = btrim(regexp_replace(comentario, E'[\\r\\n]+', ' ', 'g'))
WHERE comentario ~ E'[\\r\\n]';

UPDATE public.comentarios_perfil_fotos
SET comentario = btrim(regexp_replace(comentario, E'[\\r\\n]+', ' ', 'g'))
WHERE comentario ~ E'[\\r\\n]';