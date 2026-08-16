-- Aviso automático de aceptación enviado desde la identidad de soporte.
-- Ejecutar después de las migraciones de bandeja y notificaciones.

-- Identidad interna: no aparece en búsquedas ni puede iniciar sesión desde la UI.
INSERT INTO public.perfiles_dk (id, username, password_hash, pin, es_publico)
VALUES (
  '00000000-0000-0000-0000-000000000009'::uuid,
  'Soporte Konekto',
  repeat('0', 64),
  '0000',
  false
)
ON CONFLICT (id) DO UPDATE
SET username = EXCLUDED.username,
    es_publico = false;

CREATE OR REPLACE FUNCTION public.notificar_aceptacion_amistad_segura(
  p_session_token text,
  p_invitacion_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  accepter_id uuid;
  inviter_id uuid;
  accepter_alias text;
  support_id uuid := '00000000-0000-0000-0000-000000000009'::uuid;
  message_id bigint;
  message_text text;
BEGIN
  accepter_id := public.media_session_profile(p_session_token);
  IF accepter_id IS NULL OR NULLIF(btrim(p_invitacion_id), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_SESSION');
  END IF;

  SELECT a.usuario_id, accepter.username
    INTO inviter_id, accepter_alias
    FROM public.amigos a
    JOIN public.perfiles_dk accepter ON accepter.id = a.amigo_id
   WHERE a.id::text = btrim(p_invitacion_id)
     AND a.amigo_id = accepter_id
     AND a.estado = 'aceptada'
   LIMIT 1;

  IF inviter_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVITATION_NOT_FOUND');
  END IF;

  message_text := left(
    format('%s aceptó tu invitación de amistad. ¡Ahora están conectados!', accepter_alias),
    240
  );

  -- Evita duplicados si la aceptación se confirma desde dos vistas.
  SELECT m.id
    INTO message_id
    FROM public.mensajes_privados m
   WHERE m.remitente_id = support_id
     AND m.receptor_id = inviter_id
     AND m.tipo_mensaje = 'texto'
     AND m.contenido = message_text
     AND m.creado_en > now() - interval '2 minutes'
   ORDER BY m.creado_en DESC, m.id DESC
   LIMIT 1;

  IF message_id IS NULL THEN
    INSERT INTO public.mensajes_privados (
      remitente_id, receptor_id, tipo_mensaje, contenido
    )
    VALUES (support_id, inviter_id, 'texto', message_text)
    RETURNING id INTO message_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'message_id', message_id);
END;
$$;

REVOKE ALL ON FUNCTION public.notificar_aceptacion_amistad_segura(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notificar_aceptacion_amistad_segura(text, text) TO anon, authenticated;