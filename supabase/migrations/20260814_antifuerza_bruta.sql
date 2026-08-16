-- ═══════════════════════════════════════════════════════════════════════════
-- Anti-fuerza bruta: bloqueo temporal de cuenta tras 3 intentos fallidos
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Columnas de control en perfiles_dk
ALTER TABLE public.perfiles_dk
  ADD COLUMN IF NOT EXISTS intentos_fallidos int4 NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bloqueado_hasta   timestamptz;

-- 2. RPC de login server-side
--    • Nunca expone password_hash al cliente
--    • Gestiona contadores y bloqueo en el servidor
CREATE OR REPLACE FUNCTION public.intentar_login(
  p_username     text,
  p_password_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER          -- corre como postgres, evita RLS en la lectura del hash
SET search_path = public
AS $$
DECLARE
  v_row  perfiles_dk%ROWTYPE;
  v_now  timestamptz := now();
BEGIN
  -- Buscar alias (case-sensitive, igual que el cliente)
  SELECT * INTO v_row
  FROM public.perfiles_dk
  WHERE username = p_username;

  -- Alias inexistente → misma respuesta que contraseña incorrecta
  -- (evita enumerar aliases válidos)
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDENTIALS');
  END IF;

  -- Cuenta bloqueada temporalmente
  IF v_row.bloqueado_hasta IS NOT NULL AND v_row.bloqueado_hasta > v_now THEN
    RETURN jsonb_build_object(
      'ok',            false,
      'code',          'LOCKED',
      'bloqueado_hasta', v_row.bloqueado_hasta
    );
  END IF;

  -- Contraseña incorrecta
  IF v_row.password_hash IS DISTINCT FROM p_password_hash THEN
    UPDATE public.perfiles_dk
    SET
      intentos_fallidos = COALESCE(intentos_fallidos, 0) + 1,
      bloqueado_hasta = CASE
        WHEN COALESCE(intentos_fallidos, 0) + 1 >= 3
          THEN v_now + interval '30 minutes'
        ELSE bloqueado_hasta
      END
    WHERE id = v_row.id;

    RETURN jsonb_build_object('ok', false, 'code', 'INVALID_CREDENTIALS');
  END IF;

  -- Éxito: reiniciar contadores
  UPDATE public.perfiles_dk
  SET intentos_fallidos = 0,
      bloqueado_hasta   = NULL
  WHERE id = v_row.id;

  RETURN jsonb_build_object(
    'ok',      true,
    'id',      v_row.id::text,
    'username', v_row.username
  );
END;
$$;

-- 3. Permisos: accesible desde el cliente anónimo (pre-autenticación)
GRANT EXECUTE ON FUNCTION public.intentar_login(text, text) TO anon, authenticated;
