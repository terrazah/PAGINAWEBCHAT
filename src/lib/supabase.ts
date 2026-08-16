import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anonKey) {
  throw new Error('Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY');
}

export const supabase = createClient(url, anonKey);

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type Profile = {
  id: string;
  username: string;
  password_hash?: string;
  es_publico: boolean;
  avatar_url: string | null;
  avatar_foto_id?: string | null;
  banner_url?: string | null;
  es_vip: boolean | null;
  is_vip?: boolean | null;
  fecha_creacion: string | null;
  ocultar_amigos?: boolean | null;
  visitas?: number | null;
  regalos?: number | null;
  // Fase 3 — Personalización de identidad
  estado_personal?: string | null;
  fecha_nacimiento?: string | null;
  pais?: string | null;
  genero?: string | null;
  estado_civil?: string | null;
  mostrar_estado_civil?: boolean | null;
  modo_fantasma?: boolean | null;
};

export type Comment = {
  id: string;
  comentario: string;
  autor_id: string;
  foto_id: string | null;
  perfil_id?: string | null;
  fecha: string | null;
};

export type Friendship = {
  id: string;
  usuario_id: string;
  amigo_id: string;
  estado: 'pendiente' | 'aceptada' | 'rechazada';
  fecha?: string | null;
};

export type Block = {
  id: string;
  bloqueador_id: string;
  bloqueado_id: string;
};

export type GiftRecord = {
  id: string | number;
  remitente_alias: string;
  receptor_alias: string;
  tipo_regalo: string;
  mensaje?: string | null;
  imagen_url?: string | null;
  creado_en: string | null;
};

export type PrivateMessage = {
  id: string | number;
  conversacion_id?: string | null;
  remitente_alias: string;
  receptor_alias: string;
  direccion?: 'recibido' | 'enviado';
  contacto_id?: string | null;
  contacto_alias?: string | null;
  contacto_avatar_url?: string | null;
  tipo_mensaje: string;
  foto_id?: string | null;
  tipo_regalo?: string | null;
  mensaje?: string | null;
  imagen_url?: string | null;
  creado_en: string | null;
  leido_en?: string | null;
  mensajes_no_leidos?: number | null;
  foto_visibilidad?: 'public' | 'private' | null;
};

export type ChatRoom = {
  id: string | number;
  nombre: string;
  slug: string;
  categoria?: string;
  usuarios_activos: number;
  es_favorita: boolean;
};

export type RoomMessage = {
  id: string | number;
  autor_id: string;
  autor_alias: string;
  avatar_url?: string | null;
  fecha_nacimiento?: string | null;
  es_vip: boolean;
  contenido: string;
  creado_en: string | null;
};

export type GalleryPhoto = {
  id: string;
  user_id: string;
  url: string;
  storage_path?: string | null;
  visibilidad: 'public' | 'private';
  vistas: number;
  fecha: string | null;
};

export type PhotoComment = {
  id: string;
  foto_id: string;
  autor_id: string;
  autor_alias: string;
  autor_avatar_url?: string | null;
  comentario: string;
  fecha: string | null;
};

// ─── Hash de contraseña (Web Crypto API — SHA-256) ────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
