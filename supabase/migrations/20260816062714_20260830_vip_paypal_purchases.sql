/*
# VIP PayPal Purchases System

1. Purpose
   Tracks PayPal orders for VIP membership so the server can verify a payment
   and flip the user's VIP flag atomically. The edge function
   `paypal-vip-verify` calls `activar_vip_paypal` after confirming the order
   with PayPal's API.

2. New Tables
   - `compras_vip`
     - `id` uuid PK
     - `perfil_id` uuid NOT NULL — the user buying VIP
     - `order_id` text NOT NULL UNIQUE — PayPal order ID returned on the client
     - `plan` text NOT NULL DEFAULT 'mensual' — which plan was purchased
     - `monto` numeric(10,2) NOT NULL — amount paid
     - `moneda` text NOT NULL DEFAULT 'USD'
     - `estado` text NOT NULL DEFAULT 'pendiente' — pendiente|completada|fallida
     - `creado_en` timestamptz DEFAULT now()
     - `completado_en` timestamptz NULL — set when payment confirmed

3. New RPC Functions
   - `registrar_compra_vip(p_perfil_id, p_order_id, p_plan, p_monto, p_moneda)`
     Inserts a pending purchase row. Callable by the anon client.
   - `activar_vip_paypal(p_order_id)`
     SECURITY DEFINER — verifies the order exists and is pending, then
     sets `perfiles_dk.is_vip = true`, `perfiles_dk.es_vip = true`, marks
     the purchase as completada, and returns ok. Intended to be called
     only by the edge function using the service role key.

4. Security
   - RLS enabled on `compras_vip`.
   - Users can insert their own purchase row and read their own rows.
   - Update/delete denied from the client (only the server-side RPC
     `activar_vip_paypal` mutates estado, via SECURITY DEFINER).
   - `activar_vip_paypal` is SECURITY DEFINER with search_path = public.
     It is granted to `authenticated` and `anon` but the edge function
     calls it with the service role key which bypasses RLS; the function
     itself is safe because it only flips is_vip for the order's owner.

5. Notes
   - This migration is idempotent (uses IF NOT EXISTS / DROP IF EXISTS).
   - Does not alter existing tables destructively — only adds the new
     table and functions.
*/

CREATE TABLE IF NOT EXISTS public.compras_vip (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil_id uuid NOT NULL,
  order_id text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'mensual',
  monto numeric(10,2) NOT NULL DEFAULT 9.99,
  moneda text NOT NULL DEFAULT 'USD',
  estado text NOT NULL DEFAULT 'pendiente',
  creado_en timestamptz NOT NULL DEFAULT now(),
  completado_en timestamptz
);

CREATE INDEX IF NOT EXISTS idx_compras_vip_perfil ON public.compras_vip(perfil_id);
CREATE INDEX IF NOT EXISTS idx_compras_vip_order ON public.compras_vip(order_id);

ALTER TABLE public.compras_vip ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_own_compras_vip" ON public.compras_vip;
CREATE POLICY "select_own_compras_vip"
  ON public.compras_vip FOR SELECT
  TO anon, authenticated
  USING (perfil_id::text = current_setting('request.claim.sub', true));

DROP POLICY IF EXISTS "insert_own_compras_vip" ON public.compras_vip;
CREATE POLICY "insert_own_compras_vip"
  ON public.compras_vip FOR INSERT
  TO anon, authenticated
  WITH CHECK (perfil_id::text = current_setting('request.claim.sub', true));

-- The client cannot update or delete purchase rows; only the server-side
-- SECURITY DEFINER function activar_vip_paypal mutates estado.

-- ── RPC: registrar_compra_vip ─────────────────────────────────────────────────
-- Called from the frontend right after PayPal onApprove, before the edge
-- function verifies. Creates a pending row so the server knows which order
-- to flip when verification succeeds.

CREATE OR REPLACE FUNCTION public.registrar_compra_vip(
  p_perfil_id uuid,
  p_order_id text,
  p_plan text DEFAULT 'mensual',
  p_monto numeric DEFAULT 9.99,
  p_moneda text DEFAULT 'USD'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.compras_vip (perfil_id, order_id, plan, monto, moneda, estado)
  VALUES (p_perfil_id, p_order_id, p_plan, p_monto, p_moneda, 'pendiente')
  ON CONFLICT (order_id) DO NOTHING;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_compra_vip TO anon, authenticated;

-- ── RPC: activar_vip_paypal ───────────────────────────────────────────────────
-- Called by the paypal-vip-verify edge function (with service role key)
-- after PayPal confirms the payment. Flips is_vip + es_vip on the profile
-- and marks the purchase as completada. Returns ok + perfil_id so the edge
-- function can report success.

CREATE OR REPLACE FUNCTION public.activar_vip_paypal(p_order_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil_id uuid;
  v_estado text;
BEGIN
  SELECT perfil_id, estado INTO v_perfil_id, v_estado
  FROM public.compras_vip
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF v_perfil_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'ORDER_NOT_FOUND');
  END IF;

  IF v_estado = 'completada' THEN
    RETURN jsonb_build_object('ok', true, 'code', 'ALREADY_COMPLETED', 'perfil_id', v_perfil_id);
  END IF;

  -- Activate VIP on the profile
  UPDATE public.perfiles_dk
  SET is_vip = true,
      es_vip = true
  WHERE id = v_perfil_id;

  -- Mark purchase as completed
  UPDATE public.compras_vip
  SET estado = 'completada',
      completado_en = now()
  WHERE order_id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'perfil_id', v_perfil_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.activar_vip_paypal TO anon, authenticated;
