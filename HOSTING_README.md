# Chat Konekto — guía rápida de edición y hosting

Este proyecto está compuesto por archivos de texto y código fuente sin cifrar.
La aplicación es una SPA de React + Vite conectada a Supabase.

## Dónde editar cada cosa

- `src/App.tsx`: páginas, rutas, formularios, salas, mensajes, Presence y lógica de interacción.
- `src/index.css`: tokens visuales, colores, responsive y estilos globales.
- `src/lib/supabase.ts`: cliente de Supabase y tipos de datos compartidos.
- `public/gifts/`: imágenes de regalos.
- `supabase/migrations/`: SQL de la base de datos, en orden cronológico.
- `.env.example`: variables necesarias para ejecutar el frontend.

Las mejoras de salas de esta entrega están principalmente en:

- `src/App.tsx`, sección `Salas públicas`.
- `supabase/migrations/20260821_public_chat_rooms_ux.sql`.
- `supabase/migrations/20260822_single_line_messages.sql`.
- `supabase/migrations/20260828_comentarios_permisos.sql`.

## Variables de entorno

Copia `.env.example` como `.env` en el entorno de desarrollo o configura estas
variables directamente en el panel del hosting:

```text
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-clave-anon-publica
```

No incluyas `SUPABASE_ACCESS_TOKEN`, `SESSION_SECRET` ni otras credenciales
privadas en el frontend o en este ZIP.

## Base de datos

Ejecuta las migraciones de `supabase/migrations/` en orden. Para esta entrega,
asegúrate de ejecutar primero:

1. `20260820_public_chat_rooms.sql`
2. `20260821_public_chat_rooms_ux.sql`
3. `20260822_single_line_messages.sql`

Las migraciones más recientes corrigen la moderación de comentarios del muro,
habilitan que el dueño de una foto elimine cualquier comentario de esa foto y
mantienen la normalización de salas, mensajes privados y comentarios.

## Desarrollo local

Desde la raíz del proyecto completo:

```bash
pnpm install
PORT=21930 BASE_PATH=/ pnpm --filter @workspace/chat-konekto run dev
```

## Build para hosting estático

```bash
pnpm install
PORT=21930 BASE_PATH=/ pnpm --filter @workspace/chat-konekto run build
```

Publica esta carpeta como sitio estático:

```text
artifacts/chat-konekto/dist/public
```

Configura el hosting para devolver `index.html` en las rutas de la SPA
(`/salas`, `/salas/123`, `/bandeja`, etc.). Si el hosting usa un subdirectorio,
establece `BASE_PATH` con la ruta correspondiente y conserva el mismo valor al
servir la aplicación.

## Nota sobre el ZIP

El ZIP de entrega contiene código fuente editable, migraciones SQL, imágenes
públicas, configuración y el build verificado. No contiene `node_modules`,
secretos, claves privadas ni archivos cifrados.