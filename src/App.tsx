import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  ArrowLeft, ArrowRight, Ban, Bell, Calendar, Check, ChevronLeft, ChevronRight, Compass,
  Crown, Eye, EyeOff, FileLock2, Flame, Gamepad2, Gift, Globe, Ghost, Heart, Image as ImageIcon, Images as ImagesIcon, LayoutDashboard, Loader2,
  Lock, LockKeyhole, LogOut, Mail, Menu, MessageCircle, MessageSquare,
  Pencil, Send, Settings2, Share2, ShieldCheck, ShieldOff, Skull, Sliders, Sparkles,
  Smile, Star, Trash2, Upload, UserMinus, UserRound, UserRoundPlus, Users, Wifi, X,
} from 'lucide-react';
import {
  Route, Switch, useLocation, useParams, Router as WouterRouter, Link,
} from 'wouter';
import { supabase, hashPassword, type ChatRoom, type Profile, type Comment, type Friendship, type GalleryPhoto, type GiftRecord, type PhotoComment, type PrivateMessage, type RoomMessage } from '@/lib/supabase';
import { CUSTOM_EMOJIS, CUSTOM_EMOJI_BY_ID, CUSTOM_EMOJI_TOKEN_PATTERN, customEmojiToken, replaceEmojiCommands, type CustomEmoji } from '@/lib/emojis';
import { CUSTOM_GIFT_ASSETS, type GiftCategory as GiftCategoryType } from '@/lib/gifts';
import { censorProfanity } from '@/lib/profanity';

// ─── Sesión ───────────────────────────────────────────────────────────────────

type Session = { id: string; username: string; token?: string; avatarUrl?: string | null };
const SESSION_KEY = 'konekto_session_v2';
const CLIENT_CACHE_PREFIX = 'konekto_ui_cache_v1:';
const CLIENT_CACHE_TTL = 1000 * 60 * 10;

function readClientCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(`${CLIENT_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt?: number; value?: T };
    if (!parsed.savedAt || Date.now() - parsed.savedAt > CLIENT_CACHE_TTL) {
      localStorage.removeItem(`${CLIENT_CACHE_PREFIX}${key}`);
      return null;
    }
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

function writeClientCache<T>(key: string, value: T) {
  try {
    localStorage.setItem(`${CLIENT_CACHE_PREFIX}${key}`, JSON.stringify({ savedAt: Date.now(), value }));
  } catch {
    // El caché es una mejora de velocidad, nunca debe bloquear la aplicación.
  }
}

function readSession(): Session | null {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null') as Session | null; } catch { return null; }
}
function saveSession(s: Session) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession() { localStorage.removeItem(SESSION_KEY); }

async function createKonektoSession(username: string, passwordHash: string): Promise<string> {
  const { data, error } = await supabase.rpc('crear_sesion_konekto', {
    p_username: username,
    p_password_hash: passwordHash,
  });
  if (error) throw error;
  const result = data as { ok?: boolean; token?: string } | null;
  if (!result?.ok || !result.token) throw new Error('No se pudo crear la sesión segura. Ejecuta la migración mega de Fase 3.');
  return result.token;
}

// ─── Presence ─────────────────────────────────────────────────────────────────

type OnlineUser = { id: string; username: string; avatarUrl?: string | null };

// ─── Helpers de UI ────────────────────────────────────────────────────────────

function initials(username = 'DK') { return username.slice(0, 2).toUpperCase(); }
function relativeDate(value?: string | null) {
  if (!value) return 'ahora';
  const diff = Date.now() - new Date(value).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} mes${months === 1 ? '' : 'es'}`;
  const years = Math.floor(months / 12);
  return `hace ${years} año${years === 1 ? '' : 's'}`;
}

function inboxRelativeDate(value?: string | null) {
  if (!value) return 'ahora';
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} día${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `hace ${months} mes${months === 1 ? '' : 'es'}`;
  const years = Math.floor(months / 12);
  return `hace ${years} año${years === 1 ? '' : 's'}`;
}

function normalizeSingleLine(value: string) {
  return value.replace(/\r\n?|\n/g, ' ');
}

function sanitizeSingleLineForDisplay(value: string) {
  return normalizeSingleLine(value).replace(/[ \t]{2,}/g, ' ').trim();
}

function newestFirst<T extends { fecha?: string | null }>(items: T[]) {
  return [...items].sort((left, right) => {
    const leftTime = left.fecha ? Date.parse(left.fecha) : 0;
    const rightTime = right.fecha ? Date.parse(right.fecha) : 0;
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

type EmojiInputElement = HTMLInputElement | HTMLTextAreaElement;
type EmojiDisplaySize = 'comment' | 'message';
const QUICK_EMOJIS = ['😀', '😎', '😂', '🤣', '😍', '🥰', '😘', '😏', '🤔', '😮', '😢', '😭', '😡', '🤯', '🥳', '🤩', '❤️', '🖤', '💜', '💙', '🔥', '⚡', '✨', '💯', '👍', '👎', '👏', '🙌', '💪', '🎮', '👾', '🚀'];

function renderCustomEmojiText(value: string, size: EmojiDisplaySize = 'comment'): ReactNode {
  const parts = censorProfanity(replaceEmojiCommands(value)).split(CUSTOM_EMOJI_TOKEN_PATTERN);
  return parts.map((part, index) => {
    if (index % 2 === 1) {
      const emoji = CUSTOM_EMOJI_BY_ID.get(part);
      if (emoji) {
        const isLowResolutionEmoji = emoji.id.startsWith('emojis2-');
        const imageClassName = size === 'message'
          ? isLowResolutionEmoji
            ? 'inline-block h-6 w-6 max-w-full align-middle object-contain sm:h-7 sm:w-7'
            : 'inline-block h-7 w-7 max-w-full align-middle object-contain sm:h-8 sm:w-8'
          : isLowResolutionEmoji
            ? 'inline-block h-4 w-4 max-w-full align-middle object-contain'
            : 'inline-block h-5 w-5 max-w-full align-middle object-contain';
        return <img key={`emoji-${index}`} src={emoji.src} alt={emoji.alt} className={imageClassName} draggable={false} />;
      }
      return customEmojiToken(part);
    }
    return part;
  });
}

function EmojiPicker({
  value,
  onChange,
  inputRef,
  maxLength,
  className = '',
  footerClassName = '',
  children,
}: {
  value: string;
  onChange: (value: string) => void;
  inputRef: { current: EmojiInputElement | null };
  maxLength?: number;
  className?: string;
  footerClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  const insertEmoji = (emoji: Pick<CustomEmoji, 'token' | 'alt'>) => {
    const input = inputRef.current;
    const start = Math.max(0, Math.min(input?.selectionStart ?? value.length, value.length));
    const end = Math.max(start, Math.min(input?.selectionEnd ?? start, value.length));
    const before = value.slice(0, start);
    const after = value.slice(end);
    const prefix = before && !/\s$/.test(before) ? ' ' : '';
    const suffix = after && !/^\s/.test(after) ? ' ' : '';
    const inserted = `${prefix}${emoji.token}${suffix}`;
    const nextValue = `${before}${inserted}${after}`;
    if (maxLength && nextValue.length > maxLength) return;
    onChange(nextValue);
    setOpen(false);
    const nextCaret = start + inserted.length;
    window.requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  return (
    <div className={`min-w-0 ${className}`}>
      <div className={`flex items-center justify-end gap-2 ${footerClassName}`}>
        <button
          type="button"
          aria-label={open ? 'Ocultar emojis personalizados' : 'Mostrar emojis personalizados'}
          aria-expanded={open}
          className="icon-action shrink-0 border border-border text-primary hover:border-primary/60 hover:bg-primary/10 hover:text-primary"
          onClick={() => {
            if (!open) inputRef.current?.blur();
            setOpen((current) => !current);
          }}
        >
          <Smile size={17} />
        </button>
        <div className="min-w-0 flex-1 sm:flex-initial">{children}</div>
      </div>
      {open && (
        <section className="emoji-picker mt-3 max-h-48 overflow-y-auto rounded-xl border border-primary/25 bg-primary/[.055] p-2.5 overscroll-contain sm:p-3" aria-label="Selector de emojis personalizados">
           <div className="mb-2 flex items-center justify-between gap-3">
             <span className="text-xs font-bold text-foreground">Emojis</span>
             <span className="font-mono-app text-[10px] text-muted-foreground">{CUSTOM_EMOJIS.length} personalizados</span>
           </div>
           <div className="mb-2 grid grid-cols-8 gap-1 border-b border-border pb-2 sm:grid-cols-10">
             {QUICK_EMOJIS.map((emoji) => (
               <button
                 key={emoji}
                 type="button"
                 title={`Insertar ${emoji}`}
                 aria-label={`Insertar ${emoji}`}
                 className="grid aspect-square min-w-0 place-items-center rounded-lg border border-transparent text-lg transition-colors hover:border-primary/60 hover:bg-primary/10 focus-visible:border-accent"
                 onClick={() => insertEmoji({ token: emoji, alt: emoji })}
               >
                 {emoji}
               </button>
             ))}
           </div>
           <div className="mb-1 font-mono-app text-[9px] uppercase text-muted-foreground">Personalizados</div>
           <div className="grid grid-cols-6 gap-1 sm:grid-cols-8 md:grid-cols-10">
            {CUSTOM_EMOJIS.map((emoji) => (
              <button
                key={emoji.id}
                type="button"
                title={emoji.alt}
                aria-label={`Insertar ${emoji.alt}`}
                className="grid min-h-10 min-w-0 place-items-center rounded-lg border border-border bg-black/20 p-0.5 transition-colors hover:border-primary/60 hover:bg-primary/10 focus-visible:border-accent"
                onClick={() => insertEmoji(emoji)}
              >
                <img src={emoji.src} alt="" className={`${emoji.id.startsWith('emojis2-') ? 'h-6 w-6 sm:h-7 sm:w-7' : 'h-7 w-7 sm:h-8 sm:w-8'} max-w-full object-contain`} loading="lazy" draggable={false} />
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

const DASHBOARD_SUBTITLES = [
  '¿Cómo estás hoy?',
  '¿Listo para conocer gente nueva?',
  '¡Qué gusto verte de nuevo!',
  'Tu espacio sigue aquí cuando quieras volver.',
];

function dashboardGreeting(username: string) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Buenos días' : hour < 19 ? 'Buenas tardes' : 'Buenas noches';
  return `${greeting}, ${username}.`;
}

function dashboardSubtitle() {
  return DASHBOARD_SUBTITLES[new Date().getDate() % DASHBOARD_SUBTITLES.length];
}

function extractError(error: unknown): string {
  const e = error as { message?: string; error_description?: string } | null;
  return e?.message || e?.error_description || 'No se pudo completar la operación.';
}

const DEFAULT_AVATAR_MARKER = 'konekto://default-avatar';
const DEFAULT_BANNER_MARKER = 'konekto://default-banner';
const DEFAULT_AVATAR_URL = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"%3E%3Cdefs%3E%3ClinearGradient id="g" x1="0" x2="1" y1="0" y2="1"%3E%3Cstop stop-color="%235b21b6"/%3E%3Cstop offset="1" stop-color="%230e7490"/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width="256" height="256" rx="48" fill="url(%23g)"/%3E%3Ccircle cx="128" cy="101" r="44" fill="%23ede9fe" fill-opacity=".9"/%3E%3Cpath d="M48 222c12-46 42-70 80-70s68 24 80 70" fill="%23ede9fe" fill-opacity=".9"/%3E%3C/svg%3E';

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) throw new Error('Solo puedes subir imágenes.');
  const bitmap = await createImageBitmap(file);
  try {
    let width = bitmap.width;
    let height = bitmap.height;
    const scale = Math.min(1, 1080 / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));

    for (let attempt = 0; attempt < 14; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Tu navegador no pudo preparar la imagen.');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, width, height);

      const type = 'image/webp';
      const quality = attempt === 0 ? 0.8 : Math.max(0.35, 0.8 - attempt * 0.05);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
      if (!blob) throw new Error('No se pudo comprimir la imagen.');
      if (blob.size <= 500 * 1024) {
        const extension = type === 'image/webp' ? 'webp' : 'jpg';
        const baseName = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-').slice(0, 60) || 'imagen';
        return new File([blob], `${baseName}.${extension}`, { type, lastModified: Date.now() });
      }
      width = Math.max(320, Math.round(width * 0.78));
      height = Math.max(320, Math.round(height * 0.78));
    }
  } finally {
    bitmap.close();
  }
  throw new Error('No se pudo comprimir la imagen.');
}

function useTransientNotice(): [string, (message: string) => void] {
  const [notice, setNotice] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const notify = useCallback((message: string) => {
    setNotice(message);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setNotice(''), 3000);
  }, []);
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
  return [notice, notify];
}

function DefaultBanner() {
  return (
    <div className="default-banner h-full w-full" role="img" aria-label="Banner predeterminado de Chat Konekto">
      <div className="default-banner-grid" />
      <div className="relative z-[1] text-center font-display text-2xl font-bold tracking-tight sm:text-4xl">
        <span className="text-white">Chat</span>{' '}
        <span className="text-primary">Konekto</span>
      </div>
    </div>
  );
}

// ─── Dialog de confirmación personalizado ─────────────────────────────────────

type ConfirmOptions = { title: string; message?: string; confirmLabel?: string; danger?: boolean };

function ConfirmDialog({ state, onResolve }: {
  state: ConfirmOptions | null;
  onResolve: (v: boolean) => void;
}) {
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onResolve(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, onResolve]);
  if (!state) return null;
  return (
    <section className="confirmation-screen mt-6 w-full rounded-2xl border border-border bg-card p-5 sm:p-8" aria-labelledby="confirmation-title">
      <div className="mx-auto w-full max-w-lg text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-destructive/25 bg-destructive/10 text-destructive">
          {state.danger ? <Ban size={18} /> : <ShieldCheck size={18} className="text-accent" />}
        </div>
        <div className="eyebrow mb-3">{state.danger ? 'Confirmación requerida' : 'Verificación'}</div>
        <h2 id="confirmation-title" className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{state.title}</h2>
        {state.message && <p className="mx-auto mt-3 max-w-md break-words text-sm leading-6 text-muted-foreground">{state.message}</p>}
        <div className="mx-auto mt-8 flex w-full max-w-md flex-col gap-3 sm:flex-row-reverse">
          <Button variant={state.danger ? 'danger' : 'primary'} className="min-h-12 w-full flex-1 px-5 text-sm" onClick={() => onResolve(true)}>
            {state.confirmLabel ?? 'Confirmar'}
          </Button>
          <Button variant="outline" className="min-h-12 w-full flex-1 px-5 text-sm" onClick={() => onResolve(false)}>Cancelar</Button>
        </div>
      </div>
    </section>
  );
}

function useConfirmDialog(): [ReactNode, (opts: ConfirmOptions) => Promise<boolean>] {
  const [state, setState] = useState<ConfirmOptions | null>(null);
  const resolveRef = useRef<((v: boolean) => void) | null>(null);
  const showConfirm = useCallback((opts: ConfirmOptions) => new Promise<boolean>((resolve) => {
    resolveRef.current = resolve;
    setState(opts);
  }), []);
  const onResolve = useCallback((value: boolean) => {
    const res = resolveRef.current;
    resolveRef.current = null;
    setState(null);
    res?.(value);
  }, []);
  return [<ConfirmDialog key="dlg" state={state} onResolve={onResolve} />, showConfirm];
}

type RecoveryDialogProps = {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

function PasswordRecoveryDialog({ open, onClose, onSuccess }: RecoveryDialogProps) {
  const [step, setStep] = useState<'verify' | 'reset'>('verify');
  const [form, setForm] = useState({ username: '', pin: '', respuesta: '', password: '', confirmPassword: '' });
  const [question, setQuestion] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!open) return;
    setStep('verify');
    setForm({ username: '', pin: '', respuesta: '', password: '', confirmPassword: '' });
    setQuestion('');
    setError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm(current => ({ ...current, [key]: event.target.value }));
  };

  const findQuestion = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!form.username.trim()) { setError('Escribe tu nombre de usuario.'); return; }
    if (!/^\d{4}$/.test(form.pin)) { setError('El PIN debe tener exactamente 4 dígitos.'); return; }
    if (!form.respuesta.trim()) { setError('Escribe tu respuesta de recuperación.'); return; }
    setPending(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('obtener_pregunta_recuperacion', {
        p_username: form.username.trim(),
      });
      if (rpcError) {
        if (rpcError.code === '42883') throw new Error('Ejecuta la migración mega de Fase 3 en Supabase primero.');
        throw rpcError;
      }
      const result = data as { ok?: boolean; pregunta?: string } | null;
      const nextQuestion = result?.ok ? String(result.pregunta ?? '') : '';

      if (!nextQuestion) {
        setError('No encontramos una pregunta de recuperación para ese usuario.');
        return;
      }
      setQuestion(nextQuestion);
      setStep('reset');
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setPending(false);
    }
  };

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (form.password.length < 4) { setError('La nueva contraseña debe tener al menos 4 caracteres.'); return; }
    if (form.password !== form.confirmPassword) { setError('Las contraseñas no coinciden.'); return; }
    setPending(true);
    try {
      const passwordHash = await hashPassword(form.password);
      const { data, error: rpcError } = await supabase.rpc('restablecer_contrasena', {
        p_username: form.username.trim(),
        p_pin: form.pin,
        p_respuesta: form.respuesta.trim(),
        p_password_hash: passwordHash,
      });
      if (rpcError) {
        if (rpcError.code === '42883') throw new Error('Ejecuta la migración mega de Fase 3 en Supabase primero.');
        throw rpcError;
      }
      const result = data as { ok?: boolean; code?: string } | null;
      const ok = Boolean(result?.ok);

      if (!ok) {
        setError(result?.code === 'RECOVERY_LOCKED'
          ? 'Demasiados intentos. Espera 15 minutos antes de volver a intentarlo.'
          : 'El PIN o la respuesta de recuperación no coinciden.');
        return;
      }
      onSuccess();
      onClose();
    } catch (cause) {
      setError(extractError(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="modal-viewport mt-6 w-full" aria-labelledby="recovery-title">
      <div className="mobile-modal-panel panel relative w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl p-4 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 grid h-10 w-10 place-items-center rounded-xl bg-accent/10 text-accent"><LockKeyhole size={18} /></div>
            <h2 id="recovery-title" className="font-display text-xl font-bold">Recuperar contraseña</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Usa los datos de recuperación de tu cuenta.</p>
          </div>
          <button type="button" aria-label="Cerrar" className="icon-action shrink-0" onClick={onClose}><X size={17} /></button>
        </div>

        {step === 'verify' ? (
          <form onSubmit={findQuestion} className="space-y-4">
            <label className="block text-xs font-semibold text-muted-foreground">Nombre de usuario
              <input className="field mt-2" value={form.username} onChange={set('username')} maxLength={16} autoComplete="username" />
            </label>
            <label className="block text-xs font-semibold text-muted-foreground">PIN de recuperación
              <input className="field mt-2" value={form.pin} onChange={set('pin')} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} autoComplete="one-time-code" />
            </label>
            <label className="block text-xs font-semibold text-muted-foreground">Respuesta de recuperación
              <input className="field mt-2" value={form.respuesta} onChange={set('respuesta')} autoComplete="off" />
            </label>
            {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs leading-5 text-destructive">{error}</div>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
              <Button type="submit" disabled={pending}>{pending ? <Spinner /> : <>Continuar <ArrowRight size={15} /></>}</Button>
            </div>
          </form>
        ) : (
          <form onSubmit={resetPassword} className="space-y-4">
            <div className="rounded-xl border border-accent/25 bg-accent/[.06] p-4">
              <div className="font-mono-app text-[10px] uppercase tracking-wider text-accent">Pregunta de tu cuenta</div>
              <p className="mt-2 break-words text-sm leading-6">{question}</p>
            </div>
            <label className="block text-xs font-semibold text-muted-foreground">Nueva contraseña
              <input type="password" className="field mt-2" value={form.password} onChange={set('password')} autoComplete="new-password" />
            </label>
            <label className="block text-xs font-semibold text-muted-foreground">Confirmar contraseña
              <input type="password" className="field mt-2" value={form.confirmPassword} onChange={set('confirmPassword')} autoComplete="new-password" />
            </label>
            {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs leading-5 text-destructive">{error}</div>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => { setError(''); setStep('verify'); }}>Atrás</Button>
              <Button type="submit" disabled={pending}>{pending ? <Spinner /> : <><Check size={15} /> Guardar contraseña</>}</Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

type GiftCategory = GiftCategoryType;
type GiftCatalogItem = {
  id: string;
  category: GiftCategory;
  label: string;
  description: string;
  imageUrl: string;
  Icon: typeof Heart;
  tone: string;
  vip?: boolean;
};

const giftAsset = (filename: string) => `${import.meta.env.BASE_URL}gifts/${filename}`;

const BASE_GIFT_CATALOG: GiftCatalogItem[] = [
  { id: 'rosa-nocturna', category: 'amor', label: 'Rosa nocturna', description: 'Un detalle que habla sin hacer ruido.', imageUrl: giftAsset('konekto-free-rose.png'), Icon: Heart, tone: 'text-pink-300 border-pink-300/25 bg-pink-300/10' },
  { id: 'carta-secreta', category: 'amor', label: 'Carta especial', description: 'Un mensaje especial para compartir.', imageUrl: giftAsset('konekto-free-letter.png'), Icon: FileLock2, tone: 'text-rose-200 border-rose-200/25 bg-rose-200/10' },
  { id: 'corazon-neon', category: 'amor', label: 'Corazón neón', description: 'Una energía premium para una conexión especial.', imageUrl: giftAsset('konekto-vip-heart.png'), Icon: Heart, tone: 'text-fuchsia-200 border-fuchsia-200/25 bg-fuchsia-200/10', vip: true },
  { id: 'luna-oscura', category: 'terror', label: 'Luna oscura', description: 'Un saludo desde el lado desconocido.', imageUrl: giftAsset('konekto-free-moon.png'), Icon: Skull, tone: 'text-violet-300 border-violet-300/25 bg-violet-300/10' },
  { id: 'cuervo', category: 'terror', label: 'Cuervo', description: 'Una sorpresa diferente para compartir.', imageUrl: giftAsset('konekto-free-moon.png'), Icon: EyeOff, tone: 'text-slate-200 border-slate-200/25 bg-slate-200/10' },
  { id: 'calavera-neon', category: 'terror', label: 'Calavera neón', description: 'Una aparición imposible de ignorar.', imageUrl: giftAsset('konekto-vip-crown.png'), Icon: Skull, tone: 'text-cyan-300 border-cyan-300/25 bg-cyan-300/10', vip: true },
  { id: 'chispa', category: 'fuego', label: 'Chispa', description: 'Un impulso rápido para encender el chat.', imageUrl: giftAsset('konekto-free-flame.png'), Icon: Flame, tone: 'text-orange-300 border-orange-300/25 bg-orange-300/10' },
  { id: 'llama-violeta', category: 'fuego', label: 'Llama violeta', description: 'Una chispa intensa para compartir.', imageUrl: giftAsset('konekto-free-flame.png'), Icon: Flame, tone: 'text-amber-200 border-amber-200/25 bg-amber-200/10' },
  { id: 'cometa-aurora', category: 'fuego', label: 'Cometa Aurora', description: 'Haz que tu mensaje cruce toda la galaxia.', imageUrl: giftAsset('konekto-vip-comet.png'), Icon: Sparkles, tone: 'text-yellow-200 border-yellow-200/25 bg-yellow-200/10', vip: true },
  { id: 'confeti', category: 'divertido', label: 'Confeti', description: 'Una celebración instantánea para el muro.', imageUrl: giftAsset('konekto-free-confetti.png'), Icon: Sparkles, tone: 'text-accent border-accent/25 bg-accent/10' },
  { id: 'arcade', category: 'divertido', label: 'Arcade', description: 'Una ficha extra para seguir jugando.', imageUrl: giftAsset('konekto-free-arcade.png'), Icon: Gamepad2, tone: 'text-cyan-300 border-cyan-300/25 bg-cyan-300/10' },
  { id: 'brillo', category: 'divertido', label: 'Brillo', description: 'Un pequeño destello para mejorar el día.', imageUrl: giftAsset('konekto-vip-crown.png'), Icon: Sparkles, tone: 'text-yellow-100 border-yellow-100/25 bg-yellow-100/10', vip: true },
];

const GIFT_CATEGORIES: Array<{ id: GiftCategory; label: string; Icon: typeof Heart }> = [
  { id: 'amor', label: 'Amor', Icon: Heart },
  { id: 'terror', label: 'Terror', Icon: Skull },
  { id: 'fuego', label: 'Fuego', Icon: Flame },
  { id: 'divertido', label: 'Divertido', Icon: Sparkles },
];

function giftIconForCategory(category: GiftCategory) {
  return GIFT_CATEGORIES.find((item) => item.id === category)?.Icon ?? Gift;
}

function giftToneForCategory(category: GiftCategory) {
  return {
    amor: 'text-pink-300 border-pink-300/25 bg-pink-300/10',
    terror: 'text-violet-300 border-violet-300/25 bg-violet-300/10',
    fuego: 'text-orange-300 border-orange-300/25 bg-orange-300/10',
    divertido: 'text-accent border-accent/25 bg-accent/10',
  }[category];
}

const CUSTOM_GIFT_CATALOG: GiftCatalogItem[] = CUSTOM_GIFT_ASSETS.map((asset) => ({
  id: asset.id,
  category: asset.category,
  label: asset.label,
  description: asset.description,
  imageUrl: asset.src,
  Icon: giftIconForCategory(asset.category),
  tone: giftToneForCategory(asset.category),
  vip: asset.vip,
}));

const GIFT_CATALOG: GiftCatalogItem[] = [...BASE_GIFT_CATALOG, ...CUSTOM_GIFT_CATALOG];

function giftItem(type: string) {
  return GIFT_CATALOG.find(item => item.id === type) ?? GIFT_CATALOG[0];
}

function giftLabel(type: string) {
  return giftItem(type)?.label ?? type;
}

function GiftMark({ type, size = 15 }: { type: string; size?: number }) {
  const Icon = giftItem(type).Icon;
  return <Icon size={size} aria-hidden="true" />;
}

function GiftPreview({ item, className = 'h-24', imageUrl, locked = false }: { item: GiftCatalogItem; className?: string; imageUrl?: string | null; locked?: boolean }) {
  const [failed, setFailed] = useState(false);
  const resolvedImageUrl = imageUrl?.includes('/gifts/') ? imageUrl : item.imageUrl;
  return failed ? (
    <div className={`${className} gift-art grid place-items-center bg-black/20 ${locked ? 'gift-art-locked' : ''} ${item.tone.split(' ').filter(Boolean).join(' ')}`} aria-label={`Ilustración de ${item.label}`}>
      <item.Icon size={27} aria-hidden="true" />
    </div>
  ) : (
    <div className={`${className} gift-art ${item.vip ? 'gift-art-vip' : ''} ${locked ? 'gift-art-locked' : ''} ${item.tone.split(' ').filter(Boolean).join(' ')}`}>
      <img src={resolvedImageUrl} alt={`Regalo ${item.label}`} loading="lazy" onError={() => setFailed(true)} />
    </div>
  );
}

function GiftDialog({ open, onClose, onSend, sending, isVip, limitReached, error }: {
  open: boolean;
  onClose: () => void;
  onSend: (type: string, message: string, imageUrl: string) => void;
  sending: boolean;
  isVip: boolean;
  limitReached: boolean;
  error: string;
}) {
  const [category, setCategory] = useState<GiftCategory>('amor');
  const [selectedGiftId, setSelectedGiftId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setCategory('amor');
    setSelectedGiftId(null);
    setMessage('');
    setSelectionError('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !sending) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, sending]);

  if (!open) return null;
  const limit = isVip ? 5 : 1;
  const visibleGifts = GIFT_CATALOG.filter(item => item.category === category);
  const selectedGift = GIFT_CATALOG.find(item => item.id === selectedGiftId) ?? null;

  return (
    <section className="gift-vault-screen mt-6 w-full" aria-labelledby="gift-dialog-title">
      <div className="w-full">
        <div className="gift-dialog-panel panel mx-auto w-full max-w-4xl border-yellow-300/25 bg-[linear-gradient(145deg,rgba(48,35,20,.94),rgba(18,16,22,.98))] p-4 shadow-2xl shadow-black/60 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 grid h-10 w-10 place-items-center rounded-xl bg-yellow-300/10 text-yellow-200"><Gift size={18} /></div>
            <h2 id="gift-dialog-title" className="font-display text-xl font-bold text-yellow-50">Bóveda de regalos</h2>
            <p className="mt-1 text-xs leading-5 text-yellow-100/60">Elige un detalle visual y acompáñalo con un mensaje.</p>
          </div>
          <button type="button" aria-label="Volver al perfil" className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-yellow-100/10 px-3 text-xs font-semibold text-yellow-100/70 transition-colors hover:border-yellow-300/30 hover:text-yellow-50" disabled={sending} onClick={onClose}><ArrowLeft size={15} /> <span className="hidden sm:inline">Volver al perfil</span><span className="sm:hidden">Volver</span></button>
        </div>
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Categorías de regalos">
          {GIFT_CATEGORIES.map(({ id, label, Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={category === id} onClick={() => { setCategory(id); setSelectedGiftId(null); }} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-3.5 text-xs font-bold transition-colors ${category === id ? 'border-yellow-300/55 bg-yellow-300/15 text-yellow-100' : 'border-yellow-100/10 bg-white/[.03] text-yellow-100/55 hover:border-yellow-300/30 hover:text-yellow-100'}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3">
          {visibleGifts.map((item) => {
            const selected = selectedGiftId === item.id;
            const locked = Boolean(item.vip && !isVip);
            return (
              <button key={item.id} type="button" role="option" aria-selected={selected} aria-disabled={locked} disabled={sending} onClick={() => {
                if (locked) {
                  setSelectionError('Este regalo es exclusivo para usuarios VIP. Activa tu membresía para enviarlo.');
                  return;
                }
                setSelectionError('');
                setSelectedGiftId(item.id);
              }} className={`min-w-0 overflow-hidden rounded-xl border text-left transition-transform hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-60 ${selected ? 'border-yellow-300/70 bg-yellow-300/[.12] ring-1 ring-yellow-300/35' : locked ? 'border-yellow-100/10 bg-white/[.015]' : 'border-yellow-100/10 bg-white/[.035] hover:border-yellow-300/30'}`}>
                <GiftPreview item={item} locked={locked} />
                <div className="gift-card-copy p-3">
                   <div className={`flex items-center gap-1.5 text-xs font-bold ${locked ? 'text-yellow-100/45' : 'text-yellow-50'}`}><GiftMark type={item.id} size={13} /> <span className="min-w-0 truncate">{item.label}</span>{item.vip && <span className="gift-vip-chip">{locked ? <><Lock size={9} /> VIP</> : 'VIP'}</span>}</div>
                  <p className="mt-1.5 line-clamp-2 text-[10px] leading-4 text-yellow-100/55">{item.description}</p>
                </div>
              </button>
            );
          })}
        </div>
        {selectedGift && (
          <div className="mt-5 rounded-xl border border-yellow-300/20 bg-black/15 p-3">
            <label className="block text-xs font-semibold text-yellow-100/75" htmlFor="gift-message">Mensaje adjunto</label>
            <textarea id="gift-message" ref={messageInputRef} className="field mt-2 min-h-20 resize-y border-yellow-200/15 bg-black/20 text-yellow-50 placeholder:text-yellow-100/35" value={message} onChange={(event) => setMessage(event.target.value.slice(0, 240))} maxLength={240} placeholder="Escribir mensaje..." />
            <div className="mt-2 flex items-center justify-between gap-3">
              <span className="text-[10px] text-yellow-100/45">{message.length}/240 caracteres</span>
            </div>
            <EmojiPicker value={message} onChange={setMessage} inputRef={messageInputRef} maxLength={240} className="mt-3" footerClassName="justify-between">
              <Button type="button" className="w-full sm:w-auto" disabled={sending || limitReached} onClick={() => onSend(selectedGift.id, message.trim(), selectedGift.imageUrl)}>
                {sending ? <Spinner /> : limitReached ? 'Límite agotado' : <><Send size={14} /> Enviar regalo</>}
              </Button>
            </EmojiPicker>
          </div>
        )}
        {(error || selectionError) && <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/[.08] p-3 text-xs leading-5 text-red-100" role="alert">{error || selectionError}</div>}
        <div className={`mt-5 flex items-start gap-2 rounded-lg border p-3 text-[11px] leading-5 ${limitReached ? 'border-yellow-300/35 bg-yellow-300/[.08] text-yellow-50' : 'border-yellow-200/15 bg-yellow-200/[.04] text-yellow-100/60'}`}>
          <Crown size={14} className="mt-0.5 shrink-0 text-yellow-200" />
          {limitReached ? (
            <span><strong className="text-yellow-100">Tu límite de regalos diario terminó.</strong> Regresa mañana.{!isVip && ' Sé usuario VIP para obtener una bóveda ampliada.'}</span>
          ) : (
            <span>Límite diario: <strong className="text-yellow-100">{limit} regalo{limit === 1 ? '' : 's'}</strong>. Los usuarios VIP tienen una bóveda ampliada.</span>
          )}
        </div>
        </div>
      </div>
    </section>
  );
}

function GiftHistoryDialog({ open, onClose, gifts, loading, error, onRetry, canDelete, deletingId, onDelete }: {
  open: boolean;
  onClose: () => void;
  gifts: GiftRecord[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  canDelete: boolean;
  deletingId: string | null;
  onDelete: (gift: GiftRecord) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <section className="gift-history-screen mt-6 w-full" aria-labelledby="gift-history-title">
      <div className="w-full">
      <div className="panel w-full border-yellow-300/20 bg-[linear-gradient(145deg,rgba(35,28,22,.97),rgba(18,16,22,.98))] p-4 shadow-2xl shadow-black/60 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 grid h-10 w-10 place-items-center rounded-xl bg-yellow-300/10 text-yellow-200"><Gift size={18} /></div>
            <h2 id="gift-history-title" className="font-display text-xl font-bold text-yellow-50">Regalos recibidos</h2>
            <p className="mt-1 text-xs leading-5 text-yellow-100/55">Historial visible según la privacidad de este perfil.</p>
          </div>
          <button type="button" aria-label="Volver al perfil" className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-yellow-100/10 px-3 text-xs font-semibold text-yellow-100/70 transition-colors hover:border-yellow-300/30 hover:text-yellow-50" onClick={onClose}><ArrowLeft size={15} /> <span className="hidden sm:inline">Volver al perfil</span><span className="sm:hidden">Volver</span></button>
        </div>
        {!loading && error && (
          <div className="rounded-xl border border-destructive/25 bg-destructive/[.06] p-4 text-sm text-destructive">
            <p>{error}</p>
            <Button variant="outline" className="mt-3" onClick={onRetry}>Reintentar</Button>
          </div>
        )}
        {!loading && !error && !gifts.length && <div className="panel-subtle px-5 py-10 text-center text-sm text-muted-foreground">Todavía no hay regalos en este historial.</div>}
        {!loading && !error && gifts.length > 0 && (
          <div className="space-y-3">
            {gifts.map((gift) => {
              const item = giftItem(gift.tipo_regalo);
              return (
                <article key={String(gift.id)} className="overflow-hidden rounded-xl border border-yellow-100/10 bg-white/[.035]">
                  <div className="flex gap-3 p-3">
                    <GiftPreview item={item} imageUrl={gift.imagen_url} className="h-16 w-16 shrink-0 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-sm font-bold text-yellow-50">{giftLabel(gift.tipo_regalo)}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-yellow-100/65">De <strong className="text-yellow-100">{gift.remitente_alias}</strong></p>
                      {gift.mensaje && <p className="mt-2 break-words rounded-lg border border-yellow-100/10 bg-black/15 px-3 py-2 text-xs leading-5 text-yellow-50/85">{renderCustomEmojiText(sanitizeSingleLineForDisplay(gift.mensaje), 'message')}</p>}
                      <p className="mt-2 text-[10px] text-yellow-100/45">{relativeDate(gift.creado_en)}</p>
                    </div>
                    {canDelete && <button type="button" aria-label={`Eliminar regalo de ${gift.remitente_alias}`} title="Eliminar regalo" className="icon-action mt-0.5 shrink-0 text-yellow-100/45 hover:text-destructive disabled:cursor-wait disabled:opacity-50" disabled={deletingId === String(gift.id)} onClick={() => onDelete(gift)}>{deletingId === String(gift.id) ? <Spinner /> : <Trash2 size={15} />}</button>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </section>
  );
}

function GiftHistoryPage({ session }: { session: Session }) {
  const params = useParams<{ username?: string }>();
  const [, setLocation] = useLocation();
  const targetUsername = params.username === 'me' ? session.username : (params.username ?? session.username);
  const isSelf = targetUsername.toLowerCase() === session.username.toLowerCase();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [gifts, setGifts] = useState<GiftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [notice, showNotice] = useTransientNotice();
  const [confirmNode, showConfirm] = useConfirmDialog();

  const load = useCallback(async () => {
    if (!session.token || !targetUsername) {
      setError('Cierra sesión y vuelve a entrar para abrir tus regalos.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    const { data, error: profileError } = await profileByUsername(targetUsername);
    if (profileError || !data) {
      setError('Perfil no encontrado.');
      setLoading(false);
      return;
    }
    setProfile(data);
    const { data: historyData, error: historyError } = await supabase.rpc('obtener_historial_regalos_seguro', {
      p_session_token: session.token,
      p_receptor_alias: data.username,
    });
    setLoading(false);
    if (historyError) {
      setError(extractError(historyError));
      return;
    }
    const result = historyData as { ok?: boolean; code?: string; gifts?: GiftRecord[] } | null;
    if (!result?.ok) {
      setError(result?.code === 'FORBIDDEN'
        ? 'Este historial solo está disponible para el dueño, sus amistades o perfiles públicos.'
        : 'No se pudo abrir el historial de regalos.');
      return;
    }
    setGifts(Array.isArray(result.gifts) ? result.gifts : []);
  }, [session.token, targetUsername]);

  useEffect(() => { void load(); }, [load]);

  const deleteGift = async (gift: GiftRecord) => {
    if (!isSelf || !session.token || deletingId) return;
    const confirmed = await showConfirm({
      title: '¿Eliminar este regalo?',
      message: `Se quitará el regalo de ${gift.remitente_alias} de tu historial y de tu bandeja privada.`,
      confirmLabel: 'Sí, eliminar',
      danger: true,
    });
    if (!confirmed) return;
    setDeletingId(String(gift.id));
    const { data, error: deleteError } = await supabase.rpc('eliminar_regalo_recibido_seguro', {
      p_session_token: session.token,
      p_regalo_id: gift.id,
    });
    setDeletingId(null);
    const result = data as { ok?: boolean; code?: string } | null;
    if (deleteError || !result?.ok) {
      showNotice(deleteError ? extractError(deleteError) : result?.code === 'NOT_FOUND' ? 'Este regalo ya no está disponible.' : 'No se pudo eliminar el regalo.');
      return;
    }
    setGifts((current) => current.filter((item) => String(item.id) !== String(gift.id)));
    showNotice('Regalo eliminado.');
  };

  const backUrl = profile ? `/profile/${profile.username}` : '/dashboard';

  return <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    {loading && <div className="flex min-h-[55dvh] items-center justify-center"><Spinner /></div>}
    {!loading && error && <div className="mx-auto max-w-xl"><StateMsg error={error} /><Link href={backUrl} className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary"><ArrowLeft size={14} /> Volver al perfil</Link></div>}
    {!loading && !error && profile && (
      <>
        <PageHeader eyebrow="Tu espacio personal" title="Regalos recibidos." description={`Aquí puedes consultar los detalles que ${isSelf ? 'te han enviado' : `ha recibido ${profile.username}`}.`} />
        <GiftHistoryDialog open onClose={() => setLocation(backUrl)} gifts={gifts} loading={false} error="" onRetry={() => void load()} canDelete={isSelf} deletingId={deletingId} onDelete={(gift) => void deleteGift(gift)} />
      </>
    )}
    {notice && <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-border bg-card px-4 py-3 text-xs shadow-2xl">{notice}</div>}
    {confirmNode}
  </div>;
}

// ─── Página de envío de regalo (/regalar/:userId) ────────────────────────────

function GiftPage({ session }: { session: Session }) {
  const params = useParams<{ userId?: string }>();
  const [, setLocation] = useLocation();
  const userId = params.userId ?? '';

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [sending, setSending] = useState(false);
  const [limitReached, setLimitReached] = useState(false);
  const [giftError, setGiftError] = useState('');
  const [viewerVip, setViewerVip] = useState(false);
  const [notice, showNotice] = useTransientNotice();

  useEffect(() => {
    if (!userId || !session.token) {
      setPageError('No se pudo cargar esta página.');
      setLoading(false);
      return;
    }
    let active = true;
    void (async () => {
      const [profileResult, configResult] = await Promise.all([
        profileById(userId),
        supabase.rpc('obtener_configuracion_segura', { p_session_token: session.token }),
      ]);
      if (!active) return;
      const configData = configResult.data as { es_vip?: boolean } | null;
      setViewerVip(Boolean(configData?.es_vip));
      if (!profileResult.data) {
        setPageError('Perfil no encontrado.');
      } else {
        setProfile(profileResult.data);
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [userId, session.token]);

  const backUrl = profile ? `/profile/${profile.username}` : '/dashboard';

  const handleSend = async (type: string, message: string, imageUrl: string) => {
    if (!profile || sending) return;
    const selectedGift = giftItem(type);
    if (selectedGift.vip && !viewerVip) {
      setGiftError('Este regalo es exclusivo para usuarios VIP. Activa tu membresía para enviarlo.');
      return;
    }
    setSending(true);
    setGiftError('');
    try {
      if (!session.token) {
        setGiftError('Cierra sesión y vuelve a entrar para activar los regalos seguros.');
        return;
      }
      const { data, error: giftRpcError } = await supabase.rpc('enviar_regalo', {
        p_session_token: session.token,
        p_receptor_alias: profile.username,
        p_tipo_regalo: type,
        p_mensaje: censorProfanity(replaceEmojiCommands(normalizeSingleLine(message).trim())) || null,
        p_imagen_url: imageUrl || null,
      });
      if (giftRpcError) throw giftRpcError;
      const result = data as { ok?: boolean; code?: string } | null;
      if (!result?.ok) {
        if (result?.code === 'DAILY_LIMIT') {
          setLimitReached(true);
        } else {
          setGiftError(result?.code === 'RECIPIENT_NOT_FOUND'
            ? 'No encontramos al receptor de este regalo.'
            : 'No se pudo enviar el regalo. Intenta de nuevo.');
        }
        return;
      }
      showNotice(`Regalo de ${giftLabel(type)} enviado a ${profile.username}.`);
      setTimeout(() => setLocation(backUrl), 1400);
    } catch (cause) {
      setGiftError(extractError(cause));
    } finally {
      setSending(false);
    }
  };

  if (loading) return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <Spinner />
    </div>
  );

  if (pageError || !profile) return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <StateMsg error={pageError || 'Perfil no encontrado.'} />
      <button type="button" className="mt-4 text-sm text-primary hover:underline" onClick={() => setLocation('/dashboard')}>← Volver al inicio</button>
    </div>
  );

  return (
    <div className="mx-auto w-full min-w-0 max-w-4xl px-4 py-5 sm:px-8 sm:py-8">
      {notice && <div className="mb-4 rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs text-accent" role="status">{notice}</div>}
      <div className="mb-1 flex items-center gap-3">
        <button
          type="button"
          onClick={() => setLocation(backUrl)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:border-primary/45 hover:text-foreground transition-colors"
        >
          <ArrowLeft size={14} /> Volver al perfil
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-foreground">Enviar regalo a <span className="text-primary">{profile.username}</span></p>
        </div>
      </div>
      <GiftDialog
        open
        onClose={() => setLocation(backUrl)}
        onSend={handleSend}
        sending={sending}
        isVip={viewerVip}
        limitReached={limitReached}
        error={giftError}
      />
    </div>
  );
}

// ─── Foto ────────────────────────────────────────────────────────────────────

type PhotoViewerProps = {
  open: boolean;
  photo: GalleryPhoto | null;
  profileUsername: string;
  session: Session;
  viewerAvatarUrl?: string | null;
  isOwner: boolean;
  onClose: () => void;
};

type PhotoPageSnapshot = {
  photo: GalleryPhoto;
  owner: Profile;
};

function PhotoViewer({ open, photo, profileUsername, session, viewerAvatarUrl: initialViewerAvatarUrl, isOwner, onClose }: PhotoViewerProps) {
  const [, setLocation] = useLocation();
  const [comments, setComments] = useState<PhotoComment[]>([]);
  const [reactions, setReactions] = useState<Record<string, number>>({});
  const [myReaction, setMyReaction] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const commentInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);
  const [notice, setNotice] = useState('');
  const [showAllComments, setShowAllComments] = useState(false);
  const [viewerAvatarUrl, setViewerAvatarUrl] = useState<string | null>(initialViewerAvatarUrl ?? session.avatarUrl ?? null);
  const isPrivatePhoto = photo?.visibilidad === 'private';
  const latestPhotoComments = comments.slice(0, 3);
  const isPhotoCommentLocked = latestPhotoComments.length === 3
    && latestPhotoComments.every((item) => String(item.autor_id) === String(session.id));
  useEffect(() => {
    setViewerAvatarUrl(initialViewerAvatarUrl ?? session.avatarUrl ?? null);
  }, [initialViewerAvatarUrl, session.avatarUrl]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void profileById(session.id).then(({ data }) => {
      if (active && data) setViewerAvatarUrl(data.avatar_url ?? session.avatarUrl ?? null);
    });
    return () => { active = false; };
  }, [open, session.id, session.avatarUrl]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !photo || !session.token) return;
    let active = true;
    setLoading(true);
    setNotice('');
    setComment('');
    setShowAllComments(false);
    const load = async () => {
      const [{ data: interactionData, error: interactionError }, { data: viewData }] = await Promise.all([
        isPrivatePhoto
          ? Promise.resolve({ data: { ok: true, comments: [], reactions: {}, my_reaction: null }, error: null })
          : supabase.rpc('obtener_interacciones_foto_seguras', { p_session_token: session.token, p_foto_id: photo.id }),
        supabase.rpc('registrar_vista_foto_segura', { p_session_token: session.token, p_foto_id: photo.id }),
      ]);
      if (!active) return;
      setLoading(false);
      if (interactionError) {
        setNotice(interactionError.code === '42883' ? 'Ejecuta la migración de medios para activar esta galería.' : extractError(interactionError));
        return;
      }
      const result = interactionData as {
        ok?: boolean;
        comments?: PhotoComment[];
        reactions?: Record<string, number>;
        my_reaction?: string | null;
      } | null;
      if (!result?.ok) {
        setNotice('No se pudo cargar la interacción de esta foto.');
        return;
      }
      setComments(newestFirst(Array.isArray(result.comments) ? result.comments : []));
      setReactions(result.reactions ?? {});
      setMyReaction(result.my_reaction ?? null);
      const nextViews = viewData as number | null;
      if (typeof nextViews === 'number') photo.vistas = nextViews;
    };
    void load();
    return () => { active = false; };
  }, [isPrivatePhoto, open, photo, session.token]);

  if (!open || !photo) return null;

  const submitComment = async (event: FormEvent) => {
    event.preventDefault();
    if (isPrivatePhoto || !session.token || !comment.trim() || sendingComment) return;
    if (isPhotoCommentLocked) {
      setNotice('Espera a que alguien más comente para seguir la conversación.');
      return;
    }
    setSendingComment(true);
    const { data, error } = await supabase.rpc('comentar_foto_seguro', {
      p_session_token: session.token,
      p_foto_id: photo.id,
      p_comentario: censorProfanity(replaceEmojiCommands(normalizeSingleLine(comment).trim())),
    });
    setSendingComment(false);
    if (error) { setNotice(extractError(error)); return; }
    const result = data as { ok?: boolean; comment?: PhotoComment } | null;
    if (!result?.ok || !result.comment) { setNotice('No se pudo publicar el comentario.'); return; }
    setComments((current) => newestFirst([{
      ...result.comment!,
      autor_avatar_url: result.comment!.autor_avatar_url ?? viewerAvatarUrl ?? null,
    }, ...current]));
    setComment('');
  };

  const reactToPhoto = async (type: string) => {
    if (isPrivatePhoto || !session.token) return;
    const { data, error } = await supabase.rpc('reaccionar_foto_segura', {
      p_session_token: session.token,
      p_foto_id: photo.id,
      p_tipo: type,
    });
    if (error) { setNotice(extractError(error)); return; }
    const result = data as { ok?: boolean; reactions?: Record<string, number>; my_reaction?: string | null } | null;
    if (!result?.ok) { setNotice('No se pudo guardar la reacción.'); return; }
    setReactions(result.reactions ?? {});
    setMyReaction(result.my_reaction ?? null);
  };

  const deletePhotoComment = async (commentId: string) => {
    if (!session.token || !commentId) return;
    const { data, error } = await supabase.rpc('eliminar_comentario_foto_seguro', {
      p_session_token: session.token,
      p_comentario_id: commentId,
    });
    const result = data as { ok?: boolean; code?: string } | null;
    if (error || !result?.ok) {
      setNotice(error ? extractError(error) : result?.code === 'FORBIDDEN' ? 'Solo puedes eliminar tus propios comentarios.' : 'No se pudo eliminar el comentario.');
      return;
    }
    setComments((current) => current.filter((item) => String(item.id) !== String(commentId)));
    setNotice('Comentario eliminado.');
  };

  const reactionOptions = [
    { type: 'like', emoji: '👍', label: 'Me gusta' },
    { type: 'love', emoji: '❤️', label: 'Me encanta' },
    { type: 'haha', emoji: '😂', label: 'Me divierte' },
    { type: 'wow', emoji: '😮', label: 'Me sorprende' },
    { type: 'sad', emoji: '😢', label: 'Me entristece' },
  ];

     return (
    <div className="media-route-page mx-auto w-full max-w-6xl" aria-labelledby="photo-viewer-title">
      <div className="media-viewer-panel media-page-panel relative w-full">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="eyebrow">Visor de foto</div>
            <h2 id="photo-viewer-title" className="truncate font-display text-base font-bold">{profileUsername}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label="Volver a la galería" className="icon-action" onClick={onClose}><ArrowLeft size={17} /></button>
          </div>
        </div>
         <div className="media-page-layout grid min-w-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]">
             <div className="media-photo-stage media-page-photo-stage flex min-w-0 items-center justify-center bg-transparent p-0 sm:p-4 lg:sticky lg:top-6 lg:self-start">
             <img src={photo.url} alt={`Foto de ${profileUsername}`} className="max-h-[62dvh] w-full max-w-full object-contain" />
          </div>
          <aside className="flex min-w-0 flex-col border-t border-border p-4 sm:p-5 lg:border-l lg:border-t-0">
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><Eye size={14} /> {photo.vistas} visitas</span>
                  <button type="button" className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-semibold hover:border-primary/45 hover:text-primary" onClick={() => setLocation(`/foto/${photo.id}/compartir`)}><Share2 size={14} /> Compartir en chat</button>
            </div>
            {notice && <div className="mt-4 break-words rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs leading-5 text-accent" role="status">{notice}</div>}
             {isPrivatePhoto ? (
               <div className="mt-5 rounded-xl border border-yellow-300/20 bg-yellow-300/[.05] p-4 text-center">
                 <LockKeyhole size={18} className="mx-auto mb-2 text-yellow-200" />
                 <p className="text-xs font-semibold text-yellow-100">Interacciones desactivadas</p>
                 <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Las fotos privadas no admiten comentarios ni reacciones.</p>
               </div>
             ) : <>
               <div className="mt-5">
                 <div className="mb-2 text-xs font-bold text-muted-foreground">Reacciones</div>
                 <div className="flex flex-wrap gap-1.5">
                   {reactionOptions.map((reaction) => (
                     <button key={reaction.type} type="button" title={reaction.label} aria-label={reaction.label} aria-pressed={myReaction === reaction.type} onClick={() => void reactToPhoto(reaction.type)} className={`reaction-pill ${myReaction === reaction.type ? 'reaction-pill-active' : ''}`}>
                       <span>{reaction.emoji}</span><span>{reactions[reaction.type] ?? 0}</span>
                     </button>
                   ))}
                 </div>
               </div>
               <div className="mt-5 min-h-0 flex-1">
                  <div className="mb-2 flex items-center justify-between gap-2">
                   <div className="text-xs font-bold text-muted-foreground">Comentarios</div>
                   <span className="font-mono-app text-[10px] text-muted-foreground">{comments.length}</span>
                 </div>
                  {isPhotoCommentLocked && <p className="mb-3 rounded-lg border border-accent/25 bg-accent/[.05] p-2.5 text-[11px] leading-5 text-accent">Espera a que alguien más comente para seguir la conversación.</p>}
                  <div className="media-comments-scroll space-y-3 pr-1">
                    {loading && !comments.length && <p className="text-xs text-muted-foreground">Los comentarios aparecerán aquí.</p>}
                   {!loading && !comments.length && <p className="rounded-lg border border-border bg-white/[.02] p-4 text-center text-xs text-muted-foreground">Sé la primera persona en comentar.</p>}
                      {comments.slice(0, showAllComments ? comments.length : 4).map((item) => <article key={item.id} className="border-b border-border pb-3 last:border-0 last:pb-0"><div className="flex items-center gap-2"><Avatar username={item.autor_alias} size="sm" imageUrl={item.autor_avatar_url} /><span className="min-w-0 flex-1 truncate text-xs font-bold">{item.autor_alias}</span><span className="shrink-0 font-mono-app text-[10px] text-muted-foreground">{relativeDate(item.fecha)}</span>{(isOwner || String(item.autor_id) === String(session.id)) && <button type="button" aria-label="Eliminar comentario" title={isOwner && String(item.autor_id) !== String(session.id) ? 'Eliminar comentario de tu foto' : 'Eliminar comentario'} className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => void deletePhotoComment(String(item.id))}><Trash2 size={13} /></button>}</div><p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{renderCustomEmojiText(sanitizeSingleLineForDisplay(item.comentario))}</p></article>)}
                   {!loading && comments.length > 4 && <button type="button" className="w-full rounded-lg border border-border py-2 text-[11px] font-semibold text-primary hover:border-primary/45" onClick={() => setShowAllComments((current) => !current)}>{showAllComments ? 'Mostrar menos comentarios' : `Mostrar más comentarios (${comments.length - 4})`}</button>}
                 </div>
               </div>
                <form className="mt-4 min-w-0 space-y-2 border-t border-border/50 pt-4" onSubmit={submitComment}>
                   <input ref={commentInputRef} className="field min-w-0 w-full text-xs" value={comment} onChange={(event) => setComment(event.target.value.slice(0, 240))} maxLength={240} placeholder={isPhotoCommentLocked ? 'Espera a otro comentario...' : 'Escribe un comentario...'} disabled={isPhotoCommentLocked} />
                  <EmojiPicker value={comment} onChange={setComment} inputRef={commentInputRef} maxLength={240}>
                     <Button type="submit" aria-label="Publicar comentario" className="w-full min-w-0 sm:w-auto sm:px-4" disabled={isPhotoCommentLocked || !comment.trim() || sendingComment}>{sendingComment ? <Spinner /> : <><Send size={14} /> Enviar comentario</>}</Button>
                  </EmojiPicker>
               </form>
             </>}
          </aside>
           </div>
       </div>
     </div>
  );
}

function PhotoPage({ session }: { session: Session }) {
  const params = useParams<{ fotoId?: string }>();
  const [, setLocation] = useLocation();
  const cached = readClientCache<PhotoPageSnapshot>(`photo:${params.fotoId ?? ''}`);
  const [photo, setPhoto] = useState<GalleryPhoto | null>(() => cached?.photo ?? null);
  const [owner, setOwner] = useState<Profile | null>(() => cached?.owner ?? null);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!params.fotoId || !session.token) {
      setError('No encontramos esa foto.');
      setLoading(false);
      return;
    }
    if (!photo) setLoading(true);
    setError('');
    const { data, error: photoError } = await supabase.rpc('obtener_foto_segura', {
      p_session_token: session.token,
      p_foto_id: params.fotoId,
    });
    if (photoError) {
      setError(photoError.code === '42883' ? 'Ejecuta la migración de medios para activar las rutas de fotos.' : extractError(photoError));
      setLoading(false);
      return;
    }
    const result = data as { ok?: boolean; photo?: GalleryPhoto } | null;
    if (!result?.ok || !result.photo) {
      setError('Esta foto no existe o no tienes permiso para verla.');
      setLoading(false);
      return;
    }
    setPhoto(result.photo);
    setLoading(false);
    const { data: ownerProfile } = await profileById(result.photo.user_id);
    if (ownerProfile) {
      setOwner(ownerProfile);
      writeClientCache<PhotoPageSnapshot>(`photo:${params.fotoId}`, { photo: result.photo, owner: ownerProfile });
    }
  }, [params.fotoId, session.token]);

  useEffect(() => { void load(); }, [load]);

  return <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    {error && <StateMsg error={error} onRetry={() => void load()} />}
    {!error && photo && owner && <PhotoViewer
      open
      photo={photo}
      profileUsername={owner.username}
      session={session}
      viewerAvatarUrl={session.avatarUrl}
      isOwner={String(photo.user_id) === String(session.id)}
      onClose={() => setLocation(`/profile/${owner.username}/galeria`)}
    />}
  </div>;
}

function PhotoSharePage({ session }: { session: Session }) {
  const params = useParams<{ fotoId?: string }>();
  const [, setLocation] = useLocation();
  const cached = readClientCache<PhotoPageSnapshot>(`photo:${params.fotoId ?? ''}`);
  const [photo, setPhoto] = useState<GalleryPhoto | null>(() => cached?.photo ?? null);
  const [owner, setOwner] = useState<Profile | null>(() => cached?.owner ?? null);
  const [friends, setFriends] = useState<FriendView[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<FriendView | null>(null);
  const [message, setMessage] = useState('');
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(() => !cached);
  const [friendsLoading, setFriendsLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const loadPhoto = useCallback(async () => {
    if (!params.fotoId || !session.token) {
      setError('No encontramos esa foto.');
      setLoading(false);
      return;
    }
    if (!photo) setLoading(true);
    setError('');
    const { data, error: photoError } = await supabase.rpc('obtener_foto_segura', {
      p_session_token: session.token,
      p_foto_id: params.fotoId,
    });
    if (photoError) {
      setError(photoError.code === '42883' ? 'Ejecuta la migración de medios para activar las rutas de fotos.' : extractError(photoError));
      setLoading(false);
      return;
    }
    const result = data as { ok?: boolean; photo?: GalleryPhoto } | null;
    if (!result?.ok || !result.photo) {
      setError('Esta foto no existe o no tienes permiso para verla.');
      setLoading(false);
      return;
    }
    setPhoto(result.photo);
    setLoading(false);
    const { data: ownerProfile } = await profileById(result.photo.user_id);
    if (ownerProfile) {
      setOwner(ownerProfile);
      writeClientCache<PhotoPageSnapshot>(`photo:${params.fotoId}`, { photo: result.photo, owner: ownerProfile });
    }
  }, [params.fotoId, session.token]);

  const loadFriends = useCallback(async () => {
    if (!session.token) {
      setFriendsLoading(false);
      return;
    }
    setFriendsLoading(true);
    const { data: relations, error: relationError } = await supabase.from('amigos')
      .select('usuario_id, amigo_id')
      .or(`usuario_id.eq.${session.id},amigo_id.eq.${session.id}`)
      .eq('estado', 'aceptada');
    const friendIds = [...new Set((relations ?? []).map((row: { usuario_id: string; amigo_id: string }) =>
      String(row.usuario_id) === String(session.id) ? String(row.amigo_id) : String(row.usuario_id),
    ))];
    const { data: profiles, error: profileError } = friendIds.length
      ? await supabase.from('perfiles_dk').select('id, username, avatar_url').in('id', friendIds)
      : { data: [], error: null };
    setFriendsLoading(false);
    if (relationError || profileError) {
      setError(extractError(relationError ?? profileError));
      return;
    }
    setFriends((profiles ?? []).map((item: { id: string; username: string; avatar_url?: string | null }) => ({
      id: String(item.id),
      userId: String(item.id),
      username: item.username,
      avatarUrl: item.avatar_url ?? null,
    })));
  }, [session.id, session.token]);

  useEffect(() => { void loadPhoto(); }, [loadPhoto]);
  useEffect(() => { void loadFriends(); }, [loadFriends]);

  const sendPhoto = async (event: FormEvent) => {
    event.preventDefault();
    if (!session.token || !photo || !selectedFriend || sending) return;
    setSending(true);
    setError('');
    setNotice('');
    const { data, error: sendError } = await supabase.rpc('compartir_foto_segura', {
      p_session_token: session.token,
      p_receptor_id: selectedFriend.userId,
      p_foto_id: photo.id,
       p_mensaje: censorProfanity(replaceEmojiCommands(normalizeSingleLine(message).trim())) || `Te compartió una foto de ${owner?.username ?? 'tu amigo'}.`,
    });
    setSending(false);
    const result = data as { ok?: boolean; code?: string; message_id?: string | number } | null;
    if (sendError || !result?.ok) {
      setError(extractError(sendError) || (result?.code === 'NOT_FRIEND' ? 'Solo puedes compartir fotos con amigos aceptados.' : 'No se pudo enviar la foto.'));
      return;
    }
    if (result.message_id) {
      setLocation(`/chat/${result.message_id}`);
      return;
    }
    setNotice(`Foto enviada a ${selectedFriend.username}.`);
    setMessage('');
  };

  const backHref = owner ? `/profile/${owner.username}/galeria` : '/salas';

  return <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    <PageHeader
      eyebrow="Compartir una foto"
      title="Elige a quién enviarla."
      description="Selecciona una amistad aceptada, añade un mensaje si quieres y envíala por conversación privada."
      action={<Link href={backHref} className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/45 hover:text-foreground"><ArrowLeft size={14} /> Volver a la galería</Link>}
    />
    {error && <div className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs leading-5 text-destructive" role="alert">{error}</div>}
    {notice && <div className="mb-5 rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs leading-5 text-emerald-300" role="status" aria-live="polite">{notice}</div>}
    {!loading && photo && <section className="photo-share-layout grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,.95fr)]" aria-labelledby="photo-share-title">
      <div className="panel overflow-hidden p-3 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="eyebrow mb-1">Vista previa</div>
            <h2 className="font-display text-lg font-bold">{owner ? `Foto de ${owner.username}` : 'Tu foto'}</h2>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-[10px] text-muted-foreground"><Eye size={12} /> {photo.vistas} visitas</span>
        </div>
        <div className="flex min-h-[300px] items-center justify-center rounded-xl border border-border bg-black/25 p-3 sm:min-h-[460px]">
          <img src={photo.url} alt={`Foto de ${owner?.username ?? 'tu galería'}`} className="max-h-[62dvh] w-full object-contain" />
        </div>
        {photo.visibilidad === 'private' && <p className="mt-3 rounded-lg border border-yellow-300/20 bg-yellow-300/[.05] p-3 text-xs leading-5 text-yellow-100/80"><LockKeyhole size={14} className="mr-1 inline-block" /> Esta foto es privada. Sólo podrá verla la persona a la que la envíes.</p>}
      </div>
      <form className="panel flex flex-col p-5 sm:p-6" onSubmit={sendPhoto}>
        <div className="mb-5 border-b border-border pb-5">
          <div className="eyebrow mb-2">Nueva conversación</div>
          <h2 id="photo-share-title" className="font-display text-xl font-bold">¿Con quién quieres compartirla?</h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Sólo puedes compartir fotos con amistades aceptadas.</p>
        </div>
        <div aria-live="polite" className="min-h-8">
          {friendsLoading && <p className="text-xs text-muted-foreground">Cargando tu lista de amigos…</p>}
          {!friendsLoading && !friends.length && <p className="rounded-lg border border-border bg-white/[.02] p-4 text-xs leading-5 text-muted-foreground">No tienes amistades aceptadas disponibles para compartir esta foto.</p>}
        </div>
        {!friendsLoading && friends.length > 0 && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {friends.map((friend) => <button type="button" key={friend.userId} aria-pressed={selectedFriend?.userId === friend.userId} aria-label={`${selectedFriend?.userId === friend.userId ? 'Quitar selección de' : 'Seleccionar a'} ${friend.username}`} className={`flex min-h-12 items-center gap-3 rounded-xl border p-3 text-left transition-colors ${selectedFriend?.userId === friend.userId ? 'border-primary bg-primary/10' : 'border-border bg-white/[.02] hover:border-primary/45 hover:bg-white/[.04]'}`} onClick={() => setSelectedFriend((current) => current?.userId === friend.userId ? null : friend)}>
            <Avatar username={friend.username} size="sm" imageUrl={friend.avatarUrl} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{friend.username}</span>
            {selectedFriend?.userId === friend.userId && <Check size={15} className="shrink-0 text-primary" />}
          </button>)}
        </div>}
        <label className="mt-5 block text-xs font-semibold text-muted-foreground" htmlFor="photo-share-message">Añade un mensaje <span className="font-normal text-muted-foreground/70">(opcional)</span></label>
        <textarea id="photo-share-message" ref={messageInputRef} className="field mt-2 min-h-24 resize-y" value={message} onChange={(event) => setMessage(event.target.value.slice(0, 240))} maxLength={240} placeholder="Escribe algo para acompañar la foto…" />
        <div className="mt-2 flex justify-between gap-3 text-[10px] text-muted-foreground"><span>Tu mensaje se enviará junto con la foto.</span><span>{message.length}/240</span></div>
        <EmojiPicker value={message} onChange={setMessage} inputRef={messageInputRef} maxLength={240} className="mt-5">
          <div className="photo-share-actions grid w-full gap-2 sm:grid-cols-2">
            <Button type="submit" className="w-full min-w-0 justify-center" disabled={!selectedFriend || sending || friendsLoading}>{sending ? <Spinner /> : <><Send size={15} /> Enviar foto a {selectedFriend?.username ?? '…'}</>}</Button>
            {selectedFriend && <Button type="button" variant="outline" className="w-full min-w-0 justify-center" disabled={sending} onClick={() => setSelectedFriend(null)}><X size={15} /> Quitar destinatario</Button>}
            <Button type="button" variant="ghost" className="w-full min-w-0 justify-center" disabled={sending} onClick={() => setLocation(backHref)}><ArrowLeft size={15} /> Cancelar y volver</Button>
          </div>
        </EmojiPicker>
      </form>
    </section>}
  </div>;
}

function GalleryPage({ session, onAvatarChange }: { session: Session; onAvatarChange: (avatarUrl: string | null) => void }) {
  const params = useParams<{ username?: string }>();
  const [, setLocation] = useLocation();
  const targetUsername = params.username === 'me' ? session.username : (params.username ?? session.username);
  const cached = readClientCache<{ profile: Profile; photos: GalleryPhoto[]; offset: number; hasMore: boolean }>(`gallery:${targetUsername}`);
  const [profile, setProfile] = useState<Profile | null>(() => cached?.profile ?? null);
  const [photos, setPhotos] = useState<GalleryPhoto[]>(() => cached?.photos ?? []);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(() => cached?.hasMore ?? false);
  const [loading, setLoading] = useState(() => !cached);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [notice, showNotice] = useTransientNotice();
  const [uploadChoiceOpen, setUploadChoiceOpen] = useState(false);
  const [uploadVisibility, setUploadVisibility] = useState<'public' | 'private'>('public');
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmNode, showConfirm] = useConfirmDialog();
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const PAGE_SIZE = 8;
  const isOwner = profile ? String(profile.id) === String(session.id) : targetUsername === session.username;

  const load = useCallback(async (nextOffset = 0) => {
    if (!session.token) return;
    if (nextOffset === 0 && !cached) setLoading(true);
    else setLoadingMore(true);
    setError('');
    const { data: profileData, error: profileError } = await profileByUsername(targetUsername);
    if (profileError || !profileData) {
      setError('Perfil no encontrado.');
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    const { data, error: galleryError } = await supabase.rpc('obtener_galeria_segura', {
      p_session_token: session.token,
      p_perfil_id: profileData.id,
      p_offset: nextOffset,
      p_limit: PAGE_SIZE,
    });
    if (galleryError) {
      setError(galleryError.code === '42883' ? 'Ejecuta la migración de galería para activar esta vista.' : extractError(galleryError));
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    const result = data as { ok?: boolean; photos?: GalleryPhoto[]; has_more?: boolean } | null;
    if (!result?.ok) {
      setError('No se pudo cargar la galería.');
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    setProfile(profileData);
    const existingPhotos = nextOffset === 0 ? [] : (readClientCache<{ photos: GalleryPhoto[] }>(`gallery:${targetUsername}`)?.photos ?? []);
    const nextPhotos = nextOffset === 0 ? (result.photos ?? []) : [...existingPhotos, ...(result.photos ?? []).filter((item) => !existingPhotos.some((existing) => existing.id === item.id))];
    setPhotos(nextPhotos);
    setOffset(nextOffset + (result.photos?.length ?? 0));
    setHasMore(Boolean(result.has_more));
    writeClientCache(`gallery:${targetUsername}`, {
      profile: profileData,
      photos: nextPhotos,
      offset: nextOffset + (result.photos?.length ?? 0),
      hasMore: Boolean(result.has_more),
    });
    setLoading(false);
    setLoadingMore(false);
  }, [session.token, targetUsername]);

  useEffect(() => { void load(0); }, [load]);

  const chooseUpload = (visibility: 'public' | 'private') => {
    setUploadVisibility(visibility);
    setUploadChoiceOpen(false);
    requestAnimationFrame(() => galleryInputRef.current?.click());
  };

  const uploadFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.currentTarget.value = '';
    if (!isOwner || !profile || !session.token || !files.length) return;
    const validFiles = files.filter((file) => file.type.startsWith('image/') && file.size <= 25 * 1024 * 1024).slice(0, 12);
    if (!validFiles.length) { showNotice('Selecciona imágenes de hasta 25 MB.'); return; }
    setUploading(true);
    let uploaded = 0;
    try {
      for (const sourceFile of validFiles) {
        const file = await compressImage(sourceFile);
        const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(-80) || 'imagen.webp';
        const path = `profiles/${session.id}/gallery/${crypto.randomUUID()}-${safeName}`;
        const { error: storageError } = await supabase.storage.from('konekto_media').upload(path, file, { cacheControl: '31536000', contentType: file.type, upsert: false });
        if (storageError) throw storageError;
        const url = supabase.storage.from('konekto_media').getPublicUrl(path).data.publicUrl;
        const { data, error: rpcError } = await supabase.rpc('crear_foto_galeria_segura', {
          p_session_token: session.token,
          p_url: url,
          p_storage_path: path,
          p_visibilidad: uploadVisibility,
        });
        const result = data as { ok?: boolean; avatar_updated?: boolean; avatar_url?: string | null } | null;
        if (rpcError || !result?.ok) {
          await supabase.storage.from('konekto_media').remove([path]);
          throw rpcError ?? new Error('No se pudo registrar la foto.');
        }
        if (uploaded === 0 && result.avatar_updated && result.avatar_url) onAvatarChange(result.avatar_url);
        uploaded += 1;
      }
      await load(0);
      showNotice(`${uploaded} ${uploaded === 1 ? 'foto subida' : 'fotos subidas'} como ${uploadVisibility === 'public' ? 'públicas' : 'privadas'}. La primera se usará como avatar si aún no tienes uno.`);
    } catch (cause) {
      showNotice(extractError(cause));
      if (uploaded) await load(0);
    } finally {
      setUploading(false);
    }
  };

  const deletePhoto = async (photo: GalleryPhoto) => {
    if (!isOwner || !session.token || deletingId) return;
    const ok = await showConfirm({ title: '¿Eliminar esta foto?', message: 'La foto, sus comentarios y reacciones se eliminarán permanentemente.', confirmLabel: 'Sí, eliminar foto', danger: true });
    if (!ok) return;
    setDeletingId(photo.id);
    const { data, error: deleteError } = await supabase.rpc('eliminar_foto_segura', { p_session_token: session.token, p_foto_id: photo.id });
    setDeletingId(null);
    const result = data as { ok?: boolean; storage_path?: string | null } | null;
    if (deleteError || !result?.ok) { showNotice(extractError(deleteError) || 'No se pudo eliminar la foto.'); return; }
    if (result.storage_path) void supabase.storage.from('konekto_media').remove([result.storage_path]);
    setPhotos((current) => current.filter((item) => item.id !== photo.id));
    showNotice('Foto eliminada.');
  };

  const toggleVisibility = async (photo: GalleryPhoto) => {
    if (!isOwner || !session.token) return;
    const nextVisibility = photo.visibilidad === 'public' ? 'private' : 'public';
    const { data, error: visibilityError } = await supabase.rpc('cambiar_visibilidad_foto_segura', { p_session_token: session.token, p_foto_id: photo.id, p_visibilidad: nextVisibility });
    const result = data as { ok?: boolean } | null;
    if (visibilityError || !result?.ok) { showNotice(extractError(visibilityError) || 'No se pudo cambiar la visibilidad.'); return; }
    setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, visibilidad: nextVisibility } : item));
    showNotice(nextVisibility === 'public' ? 'Foto pública.' : 'Foto privada solo para ti.');
  };

  return <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    {confirmNode}
     <PageHeader eyebrow="Archivo visual" title={profile ? `Galería de ${profile.username}.` : 'Galería.'} description="Una vista dedicada para recorrer tus fotos sin ventanas flotantes." action={<div className="flex flex-wrap items-center justify-end gap-2"><Link href={`/profile/${targetUsername}`} className="inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Perfil</Link>{isOwner && <div className="flex flex-wrap items-center gap-1.5">{uploading ? <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Spinner /> Subiendo…</span> : <><button type="button" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-transparent px-3 text-xs font-semibold text-foreground hover:border-primary/45 hover:text-primary transition-colors" onClick={() => chooseUpload('public')}><Eye size={13} /> Pública</button><button type="button" className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-border bg-transparent px-3 text-xs font-semibold text-foreground hover:border-yellow-300/45 hover:text-yellow-200 transition-colors" onClick={() => chooseUpload('private')}><LockKeyhole size={13} /> Privada</button></>}</div>}</div>} />
    <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => void uploadFiles(event)} />
    {notice && <div className="mb-4 rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs text-accent" role="status">{notice}</div>}
    <StateMsg loading={loading} error={error || null} onRetry={() => void load(0)} />
    {!loading && !error && <section className="panel min-w-0 p-3 sm:p-6">
      {!photos.length ? <div className="panel-subtle px-5 py-16 text-center"><ImageIcon size={26} className="mx-auto mb-3 text-primary/70" /><p className="text-sm text-muted-foreground">{isOwner ? 'Todavía no has añadido fotos.' : 'Este perfil todavía no tiene fotos públicas.'}</p></div> : <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-4">{photos.map((photo) => <div key={photo.id} className={`media-gallery-tile group relative overflow-hidden rounded-xl border bg-black/20 ${photo.visibilidad === 'private' ? 'border-yellow-300/50' : 'border-border'}`}><Link href={`/foto/${photo.id}`} className="block"><img src={photo.url} alt={`Foto de ${profile?.username ?? targetUsername}`} className={`aspect-square w-full object-cover ${photo.visibilidad === 'private' ? 'opacity-75' : ''}`} loading="lazy" /></Link>{photo.visibilidad === 'private' && <span className="pointer-events-none absolute left-1 top-1 flex items-center gap-0.5 rounded-full bg-black/80 px-1.5 py-0.5 text-[9px] font-bold text-yellow-200"><LockKeyhole size={8} />Priv</span>}{isOwner && <div className="gallery-tile-actions"><button type="button" className="grid h-8 w-8 place-items-center rounded-lg bg-black/80 text-white hover:bg-primary active:bg-primary" title={photo.visibilidad === 'public' ? 'Hacer privada' : 'Hacer pública'} onClick={() => void toggleVisibility(photo)}>{photo.visibilidad === 'public' ? <EyeOff size={13} /> : <Eye size={13} />}</button><button type="button" className="grid h-8 w-8 place-items-center rounded-lg bg-black/80 text-white hover:bg-destructive active:bg-destructive" title="Eliminar foto" onClick={() => void deletePhoto(photo)} disabled={deletingId === photo.id}>{deletingId === photo.id ? <Spinner /> : <Trash2 size={13} />}</button></div>}</div>)}</div>}
      {hasMore && <div className="mt-6 flex justify-center"><Button type="button" variant="outline" onClick={() => void load(offset)} disabled={loadingMore}>{loadingMore ? <Spinner /> : <>Ver más fotos <ChevronRight size={14} /></>}</Button></div>}
    </section>}
  </div>;
}

function VipBenefitsPage({ session }: { session: Session }) {
  const [isVip, setIsVip] = useState(false);
  const [ghostMode, setGhostMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingGhost, setSavingGhost] = useState(false);
  const [notice, showNotice] = useTransientNotice();

  useEffect(() => {
    let active = true;
    setLoading(true);
    const load = async () => {
      const profileResult = await profileById(session.id);
      let nextVip = profileIsVip(profileResult.data);
      let nextGhost = Boolean(profileResult.data?.modo_fantasma);
      if (session.token) {
        const { data } = await supabase.rpc('obtener_configuracion_segura', { p_session_token: session.token });
        const secure = data as { ok?: boolean; is_vip?: boolean; modo_fantasma?: boolean } | null;
        if (secure?.ok) {
          nextVip = Boolean(secure.is_vip);
          nextGhost = Boolean(secure.modo_fantasma);
        }
      }
      if (active) {
        setIsVip(nextVip);
        setGhostMode(nextGhost);
        setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [session.id, session.token]);

  const toggleGhost = async () => {
    if (!isVip || !session.token || savingGhost) return;
    const next = !ghostMode;
    setSavingGhost(true);
    const { data, error } = await supabase.rpc('actualizar_modo_fantasma', {
      p_session_token: session.token,
      p_modo_fantasma: next,
    });
    setSavingGhost(false);
    if (error) { showNotice(extractError(error)); return; }
    const result = data as { ok?: boolean; modo_fantasma?: boolean } | null;
    if (!result?.ok) { showNotice('El Modo Fantasma requiere estatus VIP.'); return; }
    setGhostMode(Boolean(result.modo_fantasma));
    showNotice(result.modo_fantasma ? 'Modo Fantasma activado.' : 'Modo Fantasma desactivado.');
  };

  const benefits = [
    { Icon: Ghost, title: 'Modo Fantasma', description: 'Visita perfiles sin aparecer en su historial.' },
    { Icon: Gift, title: 'Bóveda ampliada', description: 'Envía hasta 5 regalos diarios con mensaje adjunto.' },
    { Icon: Sparkles, title: 'Emojis exclusivos', description: 'Accede a reacciones y detalles premium para tus conversaciones.' },
    { Icon: Crown, title: 'Insignia VIP', description: 'Tu nombre de usuario destaca con una insignia dorada en tu perfil y comentarios.' },
    { Icon: Gamepad2, title: 'Apariencias exclusivas', description: 'Desbloquea marcos, acentos y estilos especiales para tu perfil.' },
    { Icon: ShieldCheck, title: 'Perfil personalizado', description: 'Más formas de personalizar cómo te presentas en Konekto.' },
  ];

  return (
    <div className="mx-auto w-full max-w-7xl px-3 py-5 sm:px-8 sm:py-8 lg:px-12">
    <section className="vip-screen w-full" aria-labelledby="vip-benefits-title">
      <div className="w-full">
      <div className="vip-dialog-panel panel relative mx-auto w-full border-yellow-300/25 bg-[linear-gradient(145deg,rgba(48,35,20,.96),rgba(18,16,22,.98))] p-4 shadow-2xl shadow-black/60 sm:max-w-4xl sm:p-7">
        <div className="pointer-events-none absolute -right-16 -top-20 h-48 w-48 rounded-full bg-yellow-300/10 blur-3xl" />
        <div className="relative">
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-yellow-300/30 bg-yellow-300/10 text-yellow-200"><Crown size={20} /></div>
              <div className="min-w-0">
                <div className="eyebrow mb-1 text-yellow-200/75">Estatus y beneficios</div>
                <h2 id="vip-benefits-title" className="font-display text-2xl font-bold text-yellow-50">Usuarios VIP</h2>
                <p className="mt-0.5 text-xs leading-5 text-yellow-100/60">Un perfil más visible, expresivo y personalizado.</p>
              </div>
            </div>
            <Link href="/dashboard" className="inline-flex min-h-9 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-yellow-100/10 px-3 text-xs font-semibold text-yellow-100/70 transition-colors hover:border-yellow-300/30 hover:text-yellow-50 sm:w-auto sm:justify-start"><ArrowLeft size={15} /> Volver</Link>
          </div>
          {notice && <div className="mb-4 rounded-lg border border-yellow-300/25 bg-yellow-300/[.07] p-3 text-xs text-yellow-100" role="status">{notice}</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            {benefits.map(({ Icon, title, description }) => (
              <div key={title} className="rounded-xl border border-yellow-100/10 bg-black/15 p-4">
                <div className="flex items-start gap-3">
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-yellow-300/20 bg-yellow-300/10 text-yellow-200"><Icon size={16} /></div>
                  <div><h3 className="text-sm font-bold text-yellow-50">{title}</h3><p className="mt-1 text-[11px] leading-5 text-yellow-100/55">{description}</p></div>
                </div>
              </div>
            ))}
          </div>
          {!loading && isVip && (
            <button type="button" role="switch" aria-checked={ghostMode} disabled={savingGhost} onClick={() => void toggleGhost()} className="mt-4 flex w-full items-center gap-3 rounded-xl border border-yellow-300/20 bg-yellow-300/[.05] p-3 text-left transition-colors hover:border-yellow-300/40">
              <Ghost size={17} className="shrink-0 text-yellow-200" />
              <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-yellow-50">Activar Modo Fantasma</span><span className="mt-1 block text-[11px] text-yellow-100/55">Controla esta ventaja directamente desde Usuarios VIP.</span></span>
              <span className={`relative h-6 w-11 shrink-0 rounded-full border ${ghostMode ? 'border-yellow-300 bg-yellow-300/70' : 'border-white/15 bg-white/[.08]'}`}><span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform ${ghostMode ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} /></span>
            </button>
          )}
          {!loading && !isVip && <Button variant="outline" className="mt-5 w-full border-yellow-300/25 text-yellow-100 hover:border-yellow-300/45 hover:bg-yellow-300/10" onClick={() => showNotice('La membresía VIP estará disponible próximamente.')}><Crown size={15} /> Quiero ser VIP</Button>}
        </div>
      </div>
      </div>
    </section>
    </div>
  );
}

function VipBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`vip-badge ${compact ? 'vip-badge-compact' : ''}`} title="Usuario VIP" aria-label="Usuario VIP">
      <Crown size={compact ? 11 : 12} aria-hidden="true" />
      {!compact && <span>VIP</span>}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const PROFILE_BASE_COLUMNS = 'id, username, es_publico, avatar_url, es_vip, fecha_creacion';
const PROFILE_COLUMNS = `${PROFILE_BASE_COLUMNS}, avatar_foto_id, banner_url`;
const PROFILE_EXTENDED_COLUMNS = `${PROFILE_COLUMNS}, ocultar_amigos, visitas, regalos`;
const PROFILE_IDENTITY_COLUMNS = `${PROFILE_EXTENDED_COLUMNS}, estado_personal, fecha_nacimiento, pais, genero, estado_civil, mostrar_estado_civil`;
const PROFILE_MEGA_COLUMNS = `${PROFILE_IDENTITY_COLUMNS}, is_vip`;

type ProfileQueryResult = {
  data: Profile | null;
  error: { code?: string; message?: string } | null;
};

const profileMemoryCache = new Map<string, { profile: Profile | null; savedAt: number }>();

function cachedProfile(key: string): ProfileQueryResult | null {
  const entry = profileMemoryCache.get(key);
  if (!entry || Date.now() - entry.savedAt > 1000 * 30) return null;
  return { data: entry.profile, error: null };
}

function rememberProfile(key: string, result: ProfileQueryResult): ProfileQueryResult {
  if (result.data) profileMemoryCache.set(key, { profile: result.data, savedAt: Date.now() });
  return result;
}

// 3-tier fallback: identity → extended → base (tolerante a migraciones parciales)
async function profileByUsername(username: string): Promise<ProfileQueryResult> {
  const key = `username:${username}`;
  const cached = cachedProfile(key);
  if (cached) return cached;
  const mega = await supabase.from('perfiles_dk').select(PROFILE_MEGA_COLUMNS).eq('username', username).single();
  if (!mega.error || mega.error.code !== '42703') {
    return rememberProfile(key, { data: mega.data as Profile | null, error: mega.error });
  }
  const identity = await supabase.from('perfiles_dk').select(PROFILE_IDENTITY_COLUMNS).eq('username', username).single();
  if (!identity.error || identity.error.code !== '42703') {
    return rememberProfile(key, { data: identity.data as Profile | null, error: identity.error });
  }
  const extended = await supabase.from('perfiles_dk').select(PROFILE_EXTENDED_COLUMNS).eq('username', username).single();
  if (!extended.error || extended.error.code !== '42703') {
    return rememberProfile(key, { data: extended.data as Profile | null, error: extended.error });
  }
  const base = await supabase.from('perfiles_dk').select(PROFILE_BASE_COLUMNS).eq('username', username).single();
  return rememberProfile(key, { data: base.data as Profile | null, error: base.error });
}

async function profileById(id: string): Promise<ProfileQueryResult> {
  const key = `id:${id}`;
  const cached = cachedProfile(key);
  if (cached) return cached;
  const mega = await supabase.from('perfiles_dk').select(PROFILE_MEGA_COLUMNS).eq('id', id).single();
  if (!mega.error || mega.error.code !== '42703') {
    return rememberProfile(key, { data: mega.data as Profile | null, error: mega.error });
  }
  const identity = await supabase.from('perfiles_dk').select(PROFILE_IDENTITY_COLUMNS).eq('id', id).single();
  if (!identity.error || identity.error.code !== '42703') {
    return rememberProfile(key, { data: identity.data as Profile | null, error: identity.error });
  }
  const extended = await supabase.from('perfiles_dk').select(PROFILE_EXTENDED_COLUMNS).eq('id', id).single();
  if (!extended.error || extended.error.code !== '42703') {
    return rememberProfile(key, { data: extended.data as Profile | null, error: extended.error });
  }
  const base = await supabase.from('perfiles_dk').select(PROFILE_BASE_COLUMNS).eq('id', id).single();
  return rememberProfile(key, { data: base.data as Profile | null, error: base.error });
}

function profileIsVip(profile?: Profile | null): boolean {
  return Boolean(profile?.is_vip || profile?.es_vip);
}

const authorProfileCache = new Map<string, { username: string; isVip: boolean; avatarUrl?: string | null }>();

async function authorProfilesByIds(ids: string[]): Promise<Map<string, { username: string; isVip: boolean; avatarUrl?: string | null }>> {
  const uniqueIds = [...new Set(ids.map(String))];
  const missingIds = uniqueIds.filter((id) => !authorProfileCache.has(id));
  const authors = missingIds.length > 0
    ? await supabase.from('perfiles_dk').select('id, username, avatar_url, es_vip, is_vip').in('id', missingIds)
    : { data: [], error: null };
  let rows = authors.data as Array<{ id: string; username: string; avatar_url?: string | null; es_vip?: boolean | null; is_vip?: boolean | null }> | null;
  if (authors.error?.code === '42703') {
    const fallback = await supabase.from('perfiles_dk').select('id, username, avatar_url, es_vip').in('id', missingIds);
    rows = fallback.data as Array<{ id: string; username: string; avatar_url?: string | null; es_vip?: boolean | null }> | null;
  }
  const result = new Map<string, { username: string; isVip: boolean; avatarUrl?: string | null }>();
  (rows ?? []).forEach((author) => {
    const normalized = {
      username: author.username,
      isVip: Boolean(author.is_vip || author.es_vip),
      avatarUrl: author.avatar_url ?? null,
    };
    authorProfileCache.set(String(author.id), normalized);
  });
  uniqueIds.forEach((id) => {
    const author = authorProfileCache.get(id);
    if (author) result.set(id, author);
  });
  return result;
}

// ─── Identidad — Zodiaco, Edad, Países, Género, Estado Civil ─────────────────

function calcularEdad(fechaNacimiento: string): number {
  const hoy = new Date();
  const nac = new Date(fechaNacimiento);
  let edad = hoy.getFullYear() - nac.getFullYear();
  const m = hoy.getMonth() - nac.getMonth();
  if (m < 0 || (m === 0 && hoy.getDate() < nac.getDate())) edad--;
  return edad;
}

type ZodiacInfo = { signo: string; icono: string };
function calcularZodiacal(fechaNacimiento: string): ZodiacInfo {
  const d = new Date(fechaNacimiento);
  const mes = d.getUTCMonth() + 1;
  const dia = d.getUTCDate();
  if ((mes === 3 && dia >= 21) || (mes === 4 && dia <= 19)) return { signo: 'Aries', icono: '♈' };
  if ((mes === 4 && dia >= 20) || (mes === 5 && dia <= 20)) return { signo: 'Tauro', icono: '♉' };
  if ((mes === 5 && dia >= 21) || (mes === 6 && dia <= 20)) return { signo: 'Géminis', icono: '♊' };
  if ((mes === 6 && dia >= 21) || (mes === 7 && dia <= 22)) return { signo: 'Cáncer', icono: '♋' };
  if ((mes === 7 && dia >= 23) || (mes === 8 && dia <= 22)) return { signo: 'Leo', icono: '♌' };
  if ((mes === 8 && dia >= 23) || (mes === 9 && dia <= 22)) return { signo: 'Virgo', icono: '♍' };
  if ((mes === 9 && dia >= 23) || (mes === 10 && dia <= 22)) return { signo: 'Libra', icono: '♎' };
  if ((mes === 10 && dia >= 23) || (mes === 11 && dia <= 21)) return { signo: 'Escorpio', icono: '♏' };
  if ((mes === 11 && dia >= 22) || (mes === 12 && dia <= 21)) return { signo: 'Sagitario', icono: '♐' };
  if ((mes === 12 && dia >= 22) || (mes === 1 && dia <= 19)) return { signo: 'Capricornio', icono: '♑' };
  if ((mes === 1 && dia >= 20) || (mes === 2 && dia <= 18)) return { signo: 'Acuario', icono: '♒' };
  return { signo: 'Piscis', icono: '♓' };
}

const GENERO_ICON: Record<string, string> = {
  Masculino: '♂',
  Femenino: '♀',
  'No definido': '⬡',
};

const ESTADO_CIVIL_ICON: Record<string, string> = {
  Soltero: '🔓',
  'En una relación': '💞',
  Casado: '💍',
  Divorciado: '💔',
  Viudo: '🕊',
  'No definido': '—',
};

type CountryOption = { code: string; name: string; flag: string };
const COUNTRIES: CountryOption[] = [
  { code: 'MX', name: 'México', flag: '🇲🇽' },
  { code: 'US', name: 'Estados Unidos', flag: '🇺🇸' },
  { code: 'AR', name: 'Argentina', flag: '🇦🇷' },
  { code: 'CO', name: 'Colombia', flag: '🇨🇴' },
  { code: 'ES', name: 'España', flag: '🇪🇸' },
  { code: 'PE', name: 'Perú', flag: '🇵🇪' },
  { code: 'VE', name: 'Venezuela', flag: '🇻🇪' },
  { code: 'CL', name: 'Chile', flag: '🇨🇱' },
  { code: 'EC', name: 'Ecuador', flag: '🇪🇨' },
  { code: 'GT', name: 'Guatemala', flag: '🇬🇹' },
  { code: 'CU', name: 'Cuba', flag: '🇨🇺' },
  { code: 'BO', name: 'Bolivia', flag: '🇧🇴' },
  { code: 'DO', name: 'Rep. Dominicana', flag: '🇩🇴' },
  { code: 'HN', name: 'Honduras', flag: '🇭🇳' },
  { code: 'PY', name: 'Paraguay', flag: '🇵🇾' },
  { code: 'SV', name: 'El Salvador', flag: '🇸🇻' },
  { code: 'NI', name: 'Nicaragua', flag: '🇳🇮' },
  { code: 'CR', name: 'Costa Rica', flag: '🇨🇷' },
  { code: 'PA', name: 'Panamá', flag: '🇵🇦' },
  { code: 'UY', name: 'Uruguay', flag: '🇺🇾' },
  { code: 'PR', name: 'Puerto Rico', flag: '🇵🇷' },
  { code: 'BR', name: 'Brasil', flag: '🇧🇷' },
  { code: 'PT', name: 'Portugal', flag: '🇵🇹' },
  { code: 'GB', name: 'Reino Unido', flag: '🇬🇧' },
  { code: 'FR', name: 'Francia', flag: '🇫🇷' },
  { code: 'DE', name: 'Alemania', flag: '🇩🇪' },
  { code: 'IT', name: 'Italia', flag: '🇮🇹' },
  { code: 'CA', name: 'Canadá', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
  { code: 'JP', name: 'Japón', flag: '🇯🇵' },
  { code: 'KR', name: 'Corea del Sur', flag: '🇰🇷' },
  { code: 'CN', name: 'China', flag: '🇨🇳' },
  { code: 'RU', name: 'Rusia', flag: '🇷🇺' },
  { code: 'TR', name: 'Turquía', flag: '🇹🇷' },
  { code: 'PH', name: 'Filipinas', flag: '🇵🇭' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'ZA', name: 'Sudáfrica', flag: '🇿🇦' },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬' },
  { code: 'EG', name: 'Egipto', flag: '🇪🇬' },
  { code: 'MA', name: 'Marruecos', flag: '🇲🇦' },
  { code: 'OTHER', name: 'Otro', flag: '🌍' },
];

function getFlagByCode(code: string | null | undefined): string {
  if (!code) return '';
  return COUNTRIES.find(c => c.code === code)?.flag ?? '';
}

// Máxima fecha de nacimiento permitida (≥ 18 años)
function maxBirthDate(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 18);
  return d.toISOString().split('T')[0];
}

// ─── Primitivos de UI ─────────────────────────────────────────────────────────

function Button({ children, variant = 'primary', className = '', disabled, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'outline' }) {
  const variants = {
    primary: 'btn-primary',
    ghost: 'btn-ghost border-transparent',
    danger: 'btn-danger',
    outline: 'btn-outline',
  };
  return <button {...props} disabled={disabled} className={`button-lift inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-all disabled:cursor-not-allowed disabled:opacity-45 ${variants[variant]} ${className}`}>{children}</button>;
}

function Avatar({ username, size = 'md', online, imageUrl, shape = 'rounded', photoHref }: { username?: string; size?: 'sm' | 'md' | 'lg'; online?: boolean; imageUrl?: string | null; shape?: 'rounded' | 'circle'; photoHref?: string }) {
  const sizes = { sm: 'h-8 w-8 text-[10px]', md: 'h-10 w-10 text-xs', lg: 'h-16 w-16 text-lg' };
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => { setImageFailed(false); }, [imageUrl]);
  const resolvedImageUrl = imageUrl && imageUrl !== DEFAULT_AVATAR_MARKER ? imageUrl : DEFAULT_AVATAR_URL;
  const content = (
    <div className="relative shrink-0 inline-flex">
      <div className={`avatar-ring ${shape === 'circle' ? 'rounded-full' : 'rounded-xl'} overflow-hidden font-display font-bold ${sizes[size]}`}>
        {resolvedImageUrl && !imageFailed ? <img src={resolvedImageUrl} alt={`Avatar de ${username ?? 'usuario'}`} className="h-full w-full object-cover" onError={() => setImageFailed(true)} /> : initials(username)}
      </div>
      {online && <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-background" title="En línea" />}
    </div>
  );
  return photoHref ? <Link href={photoHref} aria-label={`Abrir foto de perfil de ${username ?? 'usuario'}`} className="inline-flex rounded-full transition-transform hover:scale-[1.03]">{content}</Link> : content;
}

function Spinner() { return <Loader2 size={16} className="animate-spin" />; }

function StateMsg({ loading, error, empty, onRetry }: { loading?: boolean; error?: string | null; empty?: boolean; onRetry?: () => void }) {
  // La navegación nunca debe quedar bloqueada por un estado visual de carga.
  // Las pantallas conservan sus datos anteriores o muestran el estado vacío.
  if (loading) return null;
  if (error) return <div className="panel-subtle flex items-center justify-between gap-4 p-4 text-sm text-destructive"><span>{error}</span>{onRetry && <Button variant="outline" onClick={onRetry}>Reintentar</Button>}</div>;
  if (empty) return <div className="panel-subtle px-5 py-10 text-center"><div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary"><Compass size={18} /></div><p className="text-sm text-muted-foreground">Todavía no hay actividad aquí.</p></div>;
  return null;
}

function ProfileSkeleton() {
  return null;
}

function BrandMark() {
  return <div className="brand-lockup" data-testid="brand-mark">
    <div className="brand-emblem"><Gamepad2 size={21} strokeWidth={1.8} aria-hidden="true" /></div>
    <div className="brand-copy">
      <div className="brand-title">CHAT <span>KONEKTO</span></div>
      <div className="brand-subtitle">DK ANONYMOUS <span>KONEKTO</span></div>
    </div>
  </div>;
}

function NavItem({ href, icon: Icon, label, badge, active, onNavigate }: { href: string; icon: typeof LayoutDashboard; label: string; badge?: number; active: boolean; onNavigate?: () => void }) {
  return <Link href={href} onClick={onNavigate} className={`nav-item flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-muted-foreground ${active ? 'active' : ''}`}><Icon size={16} /><span>{label}</span>{badge ? <span className="ml-auto rounded-md bg-accent/15 px-1.5 py-0.5 font-mono-app text-[10px] text-accent">{badge}</span> : null}</Link>;
}

function useUnreadMessageCount(session: Session) {
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!session.token) return;
    const { data } = await supabase.rpc('obtener_bandeja_segura', { p_session_token: session.token });
    const result = data as { ok?: boolean; messages?: PrivateMessage[] } | null;
    if (!result?.ok) return;
    setCount((result.messages ?? []).reduce((total, item) => total + Number(item.mensajes_no_leidos ?? 0), 0));
  }, [session.token]);

  useEffect(() => {
    void refresh();
    const onInboxUpdate = () => void refresh();
    window.addEventListener('konekto:inbox-updated', onInboxUpdate);
    const channel = supabase.channel(`konekto:message-count:${session.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'mensajes_privados',
        filter: `receptor_id=eq.${session.id}`,
      }, () => void refresh())
      .subscribe();
    return () => {
      window.removeEventListener('konekto:inbox-updated', onInboxUpdate);
      void supabase.removeChannel(channel);
    };
  }, [refresh, session.id]);

  return count;
}

type HeaderNotification = {
  id: string;
  tipo: 'mensaje' | 'comentario_perfil' | 'comentario_foto' | 'regalo';
  referencia_id?: string | null;
  contenido?: string | null;
  tipo_regalo?: string | null;
  imagen_url?: string | null;
  foto_id?: string | null;
  fecha?: string | null;
  leida_en?: string | null;
  actor_alias?: string | null;
  actor_avatar_url?: string | null;
};

function useHeaderNotifications(session: Session) {
  const [notifications, setNotifications] = useState<HeaderNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!session.token) return;
    const { data, error } = await supabase.rpc('obtener_notificaciones_seguras', {
      p_session_token: session.token,
      p_limite: 30,
    });
    if (error) return;
    const result = data as { ok?: boolean; unread_count?: number; notifications?: HeaderNotification[] } | null;
    if (!result?.ok) return;
    setNotifications(Array.isArray(result.notifications) ? result.notifications : []);
    setUnreadCount(Number(result.unread_count ?? 0));
  }, [session.token]);

  const markAllRead = useCallback(async () => {
    if (!session.token) return;
    const { data, error } = await supabase.rpc('marcar_notificaciones_seguras', {
      p_session_token: session.token,
      p_notificacion_id: null,
    });
    const result = data as { ok?: boolean } | null;
    if (!error && result?.ok) {
      setUnreadCount(0);
      setNotifications((current) => current.map((item) => ({ ...item, leida_en: item.leida_en ?? new Date().toISOString() })));
    }
  }, [session.token]);

  useEffect(() => {
    void refresh();
    const onInboxUpdate = () => void refresh();
    window.addEventListener('konekto:inbox-updated', onInboxUpdate);
    const channel = supabase.channel(`konekto:notifications:${session.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'konekto_notificaciones',
        filter: `receptor_id=eq.${session.id}`,
      }, () => void refresh())
      .subscribe();
    return () => {
      window.removeEventListener('konekto:inbox-updated', onInboxUpdate);
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      if (next) void markAllRead();
      return next;
    });
  };

  return { notifications, unreadCount, open, setOpen, toggle, refresh };
}

function notificationLabel(item: HeaderNotification) {
  const actor = item.actor_alias ?? 'Alguien';
  if (item.tipo === 'comentario_perfil') return `${actor} comentó en tu perfil`;
  if (item.tipo === 'comentario_foto') return `${actor} comentó en una de tus fotos`;
  if (item.tipo === 'regalo') return `${actor} te envió ${giftLabel(item.tipo_regalo ?? 'regalo')}`;
  return `${actor} te escribió un mensaje`;
}

function notificationHref(item: HeaderNotification, username: string) {
  if (item.tipo === 'mensaje') return '/bandeja';
  if (item.tipo === 'comentario_foto' && item.foto_id) return `/foto/${item.foto_id}`;
  return `/profile/${username}`;
}

function NotificationBell({ notifications, unreadCount, open, toggle, setOpen, username }: ReturnType<typeof useHeaderNotifications> & { username: string }) {
  if (unreadCount <= 0 && !open) return null;

  return <div className="relative">
    <button
      type="button"
      aria-label={`${unreadCount} notificaciones sin leer`}
      className="notification-bell icon-action relative border border-transparent"
      onClick={toggle}
      aria-expanded={open}
    >
      <Bell size={18} className="text-white" />
      <span className="notification-mail-seal" aria-hidden="true" />
      <span className="notification-bell-count">{unreadCount > 99 ? '99+' : unreadCount}</span>
    </button>
    {open && <div className="absolute right-0 top-[calc(100%+.65rem)] z-50 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="eyebrow">Centro de avisos</div>
          <h2 className="mt-1 text-sm font-bold">Tus notificaciones</h2>
        </div>
        <button type="button" aria-label="Cerrar notificaciones" className="icon-action" onClick={() => setOpen(false)}><X size={15} /></button>
      </div>
      <div className="max-h-[min(26rem,70vh)] overflow-y-auto">
        {notifications.length === 0
          ? <p className="px-4 py-6 text-center text-xs text-muted-foreground">No hay avisos recientes.</p>
          : notifications.map((item) => (
            <Link
              href={notificationHref(item, username)}
              key={item.id}
              onClick={() => setOpen(false)}
              className={`block border-b border-border/50 px-4 py-3 transition-colors last:border-0 hover:bg-white/[.04] ${item.leida_en ? 'opacity-70' : ''}`}
            >
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 text-primary">
                  {item.tipo === 'regalo' ? <Gift size={15} /> : item.tipo === 'mensaje' ? <Mail size={15} /> : <MessageCircle size={15} />}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold leading-5">{notificationLabel(item)}</p>
                  <p className="mt-1 font-mono-app text-[10px] text-muted-foreground">{relativeDate(item.fecha)}</p>
                </div>
              </div>
            </Link>
          ))}
      </div>
    </div>}
  </div>;
}

function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end"><div><div className="eyebrow mb-3">{eyebrow}</div><h1 className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">{title}</h1>{description && <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>}</div>{action}</header>;
}

// ─── Shell ────────────────────────────────────────────────────────────────────

function Shell({ children, session, onSignOut, onlineUsers }: {
  children: ReactNode;
  session: Session;
  onSignOut: () => void;
  onlineUsers: OnlineUser[];
}) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [menuAvatarUrl, setMenuAvatarUrl] = useState<string | null>(session.avatarUrl ?? null);
   const unreadMessageCount = useUnreadMessageCount(session);
  const headerNotifications = useHeaderNotifications(session);
  const closeMobileMenu = () => setMobileMenuOpen(false);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    let active = true;
    void profileById(session.id).then(({ data }) => {
      if (active && data) setMenuAvatarUrl(data.avatar_url ?? null);
    });
    return () => { active = false; };
  }, [mobileMenuOpen, session.id]);

  return <div className="app-shell app-grid">
    {mobileMenuOpen && (
      <div
        className="mobile-scrim md:hidden"
        onClick={closeMobileMenu}
        aria-hidden="true"
      />
    )}
    <aside className={`sidebar hidden flex-col gap-8 p-5 md:flex ${mobileMenuOpen ? 'mobile-drawer-open' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <Link href="/dashboard" className="shrink-0" onClick={closeMobileMenu}><BrandMark /></Link>
        <button type="button" aria-label="Cerrar menú" className="rounded-lg p-2 text-muted-foreground hover:bg-white/[.06] hover:text-foreground md:hidden" onClick={closeMobileMenu}><X size={18} /></button>
      </div>
      <div className="sidebar-scroll flex flex-1 flex-col gap-1">
        <div className="mb-2 px-3 font-mono-app text-[9px] uppercase tracking-[.2em] text-muted-foreground">Navegación</div>
        <NavItem href="/dashboard" icon={LayoutDashboard} label="Inicio" active={location === '/dashboard'} onNavigate={closeMobileMenu} />
        <NavItem href="/salas" icon={MessageSquare} label="Salas" active={location === '/salas' || location.startsWith('/salas/')} onNavigate={closeMobileMenu} />
        <NavItem href="/online" icon={Users} label="Personas" badge={onlineUsers.length} active={location === '/online'} onNavigate={closeMobileMenu} />
        <NavItem href="/mensajes" icon={Mail} label="Mensajes" badge={unreadMessageCount} active={location === '/bandeja' || location === '/mensajes' || location === '/messages' || location.startsWith('/chat')} onNavigate={closeMobileMenu} />
        <NavItem href="/dashboard" icon={Bell} label="Notificaciones" active={false} onNavigate={closeMobileMenu} />
        <NavItem href="/regalos" icon={Gift} label="Regalos" active={location === '/regalos' || location.endsWith('/regalos')} onNavigate={closeMobileMenu} />
        <Link
          href="/vip"
          onClick={closeMobileMenu}
          data-testid="link-vip-benefits"
          className={`nav-item vip-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold ${location === '/vip' ? 'active text-yellow-100' : 'text-yellow-100/70 hover:text-yellow-50'}`}
        >
          <Crown size={16} /> <span className="vip-nav-label">Tienda VIP</span>
        </Link>
        <NavItem href="/settings" icon={Sliders} label="Membresías" active={location === '/settings'} onNavigate={closeMobileMenu} />
        <div className="mb-2 mt-5 px-3 font-mono-app text-[9px] uppercase tracking-[.2em] text-muted-foreground">Perfil</div>
        <NavItem href="/profile/me" icon={UserRound} label="Mi perfil" active={location.startsWith('/profile')} onNavigate={closeMobileMenu} />
        <NavItem href="/friends" icon={Sparkles} label="Amigos" active={location === '/friends'} onNavigate={closeMobileMenu} />
        <NavItem href="/privacy" icon={ShieldCheck} label="Privacidad" active={location === '/privacy'} onNavigate={closeMobileMenu} />
      </div>
      <div className="sidebar-meta panel-subtle p-3">
        <div className="flex items-center gap-2">
          <Avatar username={session.username} size="sm" online imageUrl={menuAvatarUrl ?? session.avatarUrl} />
          <div className="min-w-0">
            <p className="truncate text-xs font-bold">{session.username}</p>
            <p className="font-mono-app text-[9px] text-emerald-400">en línea</p>
          </div>
        </div>
        <Button variant="ghost" className="mt-3 w-full justify-start px-0 text-xs" onClick={onSignOut}><LogOut size={14} /> Cerrar sesión</Button>
      </div>
    </aside>
    <main className="main-canvas page-enter">
      <div className="mobile-topbar md:hidden">
        <button type="button" aria-label="Abrir menú" className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-white/[.06] hover:text-foreground" onClick={() => setMobileMenuOpen(true)}><Menu size={20} /></button>
        <Link href="/dashboard" onClick={closeMobileMenu} className="min-w-0 flex-1 overflow-hidden"><div className="scale-[.84] origin-left"><BrandMark /></div></Link>
           <NotificationBell {...headerNotifications} username={session.username} />
      </div>
        <div className="notification-desktop-bar hidden md:flex"><NotificationBell {...headerNotifications} username={session.username} /></div>
      {children}
    </main>
  </div>;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

const AUTH_IMAGE_URL = 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1400&q=85';

function AuthPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ username: '', password: '', confirm_password: '', pin: '', pregunta_secreta: '', respuesta_secreta: '' });
  const [error, setError] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [pending, setPending] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(prev => ({ ...prev, [key]: e.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!/^[a-zA-Z0-9_-]{1,16}$/.test(form.username)) { setError('El nombre de usuario debe tener entre 1 y 16 caracteres: letras, números, guion o guion bajo.'); return; }
    if (!form.password) { setError('Escribe tu contraseña.'); return; }

    if (mode === 'register') {
      if (form.password.length < 4) { setError('La contraseña debe tener al menos 4 caracteres.'); return; }
      if (form.password !== form.confirm_password) { setError('Las contraseñas no coinciden.'); return; }
      if (!/^\d{4}$/.test(form.pin)) { setError('El PIN debe tener exactamente 4 dígitos.'); return; }
      if (form.pregunta_secreta.trim().length < 2) { setError('Escribe una pregunta de recuperación de al menos 2 caracteres.'); return; }
      if (!form.respuesta_secreta.trim()) { setError('Escribe una respuesta de recuperación.'); return; }
    }

    setPending(true);
    try {
      const pwHash = await hashPassword(form.password);

      if (mode === 'login') {
        // Anti-fuerza bruta: intentar vía RPC server-side primero.
        // El RPC maneja contadores y bloqueos sin exponer password_hash al cliente.
        const { data: rpcData, error: rpcErr } = await supabase.rpc('intentar_login', {
          p_username: form.username,
          p_password_hash: pwHash,
        });
        if (rpcErr) {
          setError(rpcErr.code === '42883' ? 'El sistema de acceso necesita la migración de autenticación segura.' : extractError(rpcErr));
          return;
        }
        const result = rpcData as { ok?: boolean; code?: string; id?: string; username?: string } | null;
        if (!result?.ok || !result.id || !result.username) {
          setError(result?.code === 'LOCKED'
            ? 'Demasiados intentos. Cuenta bloqueada por 30 minutos por seguridad.'
            : 'Nombre de usuario o contraseña incorrectos.');
          return;
        }
        const token = await createKonektoSession(String(result.username), pwHash);
        saveSession({ id: String(result.id), username: String(result.username), token });
        onLogin({ id: String(result.id), username: String(result.username), token });
      } else {
        const { data: existing } = await supabase.from('perfiles_dk').select('id').eq('username', form.username).maybeSingle();
        if (existing) { setError('Ese nombre de usuario ya está ocupado. Prueba con otro.'); return; }
        const { data: inserted, error: insertErr } = await supabase
          .from('perfiles_dk')
          .insert({ username: form.username, password_hash: pwHash, pin_recuperacion: form.pin, pregunta_secreta: form.pregunta_secreta.trim(), respuesta_secreta: form.respuesta_secreta.trim(), es_publico: true })
          .select('id, username').single();
        if (insertErr || !inserted) { setError(insertErr?.message || 'No se pudo crear la cuenta.'); return; }
        const token = await createKonektoSession(inserted.username, pwHash);
        saveSession({ id: String(inserted.id), username: inserted.username, token });
        onLogin({ id: String(inserted.id), username: inserted.username, token });
      }
    } catch (e) {
      setError(extractError(e));
    } finally {
      setPending(false);
    }
  };

  return <div className="auth-page">
    <img src={AUTH_IMAGE_URL} alt="" className="auth-page-bg" />
    <div className="auth-page-overlay" />
    <div className="auth-page-glow-l" />
    <div className="auth-page-glow-r" />

    <div className="auth-center">
      {/* Brand */}
      <div><BrandMark /></div>

      {/* Hero */}
      {mode === 'login' && (
        <div>
          <h1 className="auth-hero-title">
            Conoce gente.<br /><span>Empieza a conversar.</span>
          </h1>
          <p className="auth-hero-sub">Comparte lo que te gusta, haz amistades y encuentra conversaciones que sí te interesan.</p>
        </div>
      )}

      {/* Form card */}
      <div className="auth-form-card">
        <div className="auth-form-label">{mode === 'login' ? 'Iniciar Sesión' : 'Crear cuenta'}</div>
        <form onSubmit={submit} className="space-y-3">
          {/* Username */}
          <div className="auth-field-row">
            <UserRound size={16} className="auth-field-icon-l" />
            <input
              id="auth-username"
              autoComplete="username"
              className="auth-field-v2"
              value={form.username}
              onChange={set('username')}
              placeholder="Nombre de usuario"
              maxLength={16}
            />
          </div>
          {/* Password */}
          <div className="auth-field-row">
            <LockKeyhole size={16} className="auth-field-icon-l" />
            <input
              id="auth-password"
              type={showPw ? 'text' : 'password'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              className="auth-field-v2"
              value={form.password}
              onChange={set('password')}
              placeholder="Contraseña"
            />
            <button type="button" className="auth-field-icon-r" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Ocultar contraseña' : 'Ver contraseña'}>
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          {/* Login extras */}
          {mode === 'login' && (
            <div className="auth-check-row">
              <label className="auth-check-label">
                <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} />
                Recordarme
              </label>
              <button type="button" className="auth-forgot-link" onClick={() => { setRecoveryMessage(''); setRecoveryOpen(true); }}>
                ¿Olvidaste tu contraseña?
              </button>
            </div>
          )}

          {/* Register fields */}
          {mode === 'register' && (
            <div className="space-y-3 rounded-xl border border-white/10 bg-white/[.03] p-3.5">
              <div>
                <div className="text-xs font-bold text-foreground">Recuperación de cuenta</div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Guarda estos datos: los necesitarás si olvidas tu contraseña.</p>
              </div>
              <div className="auth-field-row">
                <LockKeyhole size={16} className="auth-field-icon-l" />
                <input id="auth-confirm-password" type="password" autoComplete="new-password" className="auth-field-v2" value={form.confirm_password} onChange={set('confirm_password')} placeholder="Confirmar contraseña" />
              </div>
              <input id="auth-pin" className="auth-field-v2 auth-field-no-icon" value={form.pin} onChange={set('pin')} inputMode="numeric" pattern="[0-9]{4}" placeholder="PIN de recuperación (4 dígitos)" maxLength={4} />
              <input id="auth-secret-question" className="auth-field-v2 auth-field-no-icon" value={form.pregunta_secreta} onChange={set('pregunta_secreta')} placeholder="Pregunta de recuperación" />
              <input id="auth-secret-answer" className="auth-field-v2 auth-field-no-icon" value={form.respuesta_secreta} onChange={set('respuesta_secreta')} placeholder="Respuesta de recuperación" />
            </div>
          )}

          {error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive" role="alert" aria-live="assertive">{error}</div>}
          {recoveryMessage && <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 p-3 text-xs leading-5 text-emerald-300" role="status" aria-live="polite">{recoveryMessage}</div>}

          <button type="submit" className="btn-gradient mt-1" disabled={pending}>
            {pending ? <Spinner /> : <>{mode === 'login' ? 'Entrar a mi cuenta' : 'Crear mi cuenta'} <ArrowRight size={16} /></>}
          </button>
        </form>

        <button
          type="button"
          className="mt-4 w-full text-center text-sm transition-colors"
          style={{ color: 'rgba(255,255,255,.5)' }}
          onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
        >
          {mode === 'login'
            ? <>¿No tienes cuenta? <span style={{ color: 'hsl(268 80% 72%)', fontWeight: 600 }}>Regístrate aquí</span></>
            : <>Ya tengo una cuenta · <span style={{ color: 'hsl(268 80% 72%)', fontWeight: 600 }}>Entrar</span></>}
        </button>
      </div>

      {/* Bottom decorative row */}
      <div className="auth-bottom-row">
        <div className="auth-bottom-item"><Users size={22} /><span>Personas</span></div>
        <div className="auth-bottom-item"><MessageSquare size={22} /><span>Salas</span></div>
        <div className="auth-bottom-item"><Mail size={22} /><span>Mensajes</span></div>
      </div>
    </div>

    <PasswordRecoveryDialog
      open={recoveryOpen}
      onClose={() => setRecoveryOpen(false)}
      onSuccess={() => { setRecoveryMessage('Contraseña actualizada. Ya puedes entrar con tu nueva contraseña.'); setError(''); }}
    />
  </div>;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

type DashboardData = {
  profile: Profile;
  friendCount: number;
  pendingCount: number;
  messageCount: number;
  messageTotal: number;
  blockedCount: number;
  recentActivity: Array<{
    id: string;
    kind: 'comment' | 'friendship' | 'photo';
    actorId?: string;
    targetId?: string | null;
    viewerIsParticipant?: boolean;
    actorUsername: string;
    targetUsername: string;
    actorAvatarUrl?: string | null;
    photoId?: string;
    content?: string;
    fecha: string | null;
  }>;
};

function DashboardPage({ session, onlineUsers }: { session: Session; onlineUsers: OnlineUser[] }) {
  const cachedData = readClientCache<DashboardData>(`dashboard:${session.id}`);
  const [data, setData] = useState<DashboardData | null>(() => cachedData);
  const dataRef = useRef<DashboardData | null>(cachedData);
  const [loading, setLoading] = useState(() => !cachedData);
  const [error, setError] = useState('');
  const [activityShowAll, setActivityShowAll] = useState(false);
  const [editingStatus, setEditingStatus] = useState(false);
  const [statusDraft, setStatusDraft] = useState('');
  const [savingStatus, setSavingStatus] = useState(false);
  const ACTIVITY_INITIAL = 4;

  const onlineIds = new Set(onlineUsers.map(u => u.id));

  const load = useCallback(async () => {
    if (!dataRef.current) setLoading(true);
    setError('');
    try {
      const { data: profile, error: pErr } = await profileById(session.id);
      if (pErr || !profile) throw new Error('No encontramos tu perfil.');

      const { data: friendRows } = await supabase.from('amigos')
        .select('usuario_id, amigo_id')
        .or(`usuario_id.eq.${profile.id},amigo_id.eq.${profile.id}`)
        .eq('estado', 'aceptada');
      const friendIds = new Set((friendRows ?? []).map((row: { usuario_id: string; amigo_id: string }) =>
        String(row.usuario_id) === String(profile.id) ? String(row.amigo_id) : String(row.usuario_id),
      ));
      const friendIdList = [...friendIds];

      const [
        { count: friendCount },
        { count: pendingCount },
        { count: blockedCount },
      ] = await Promise.all([
        supabase.from('amigos').select('id', { count: 'exact', head: true })
          .or(`usuario_id.eq.${profile.id},amigo_id.eq.${profile.id}`).eq('estado', 'aceptada'),
        supabase.from('amigos').select('id', { count: 'exact', head: true })
          .eq('amigo_id', profile.id).eq('estado', 'pendiente'),
        supabase.from('bloqueos').select('id', { count: 'exact', head: true })
          .eq('bloqueador_id', profile.id),
      ]);

      const [activityResult, inboxResult] = await Promise.all([
        session.token
          ? supabase.rpc('obtener_actividad_amigos_segura', { p_session_token: session.token, p_limit: 40 })
          : Promise.resolve({ data: null, error: null }),
        session.token
          ? supabase.rpc('obtener_bandeja_segura', { p_session_token: session.token })
          : Promise.resolve({ data: null, error: null }),
      ]);
      const inboxPayload = inboxResult.data as { ok?: boolean; messages?: PrivateMessage[] } | null;
      const inboxMessages = inboxPayload?.ok && Array.isArray(inboxPayload.messages) ? inboxPayload.messages : [];
      const messageCount = inboxMessages.reduce((total, item) => total + Number(item.mensajes_no_leidos ?? 0), 0);
      const activityPayload = activityResult.data as { ok?: boolean; activities?: Array<{ id: string; tipo: string; actor_id: string; target_id: string | null; contenido: string | null; fecha: string | null }> } | null;
       let activityRows = activityResult.error || !activityPayload?.ok
         ? null
          : (activityPayload.activities ?? []).filter((event) => (
            event.tipo === 'amistad' || String(event.actor_id) !== String(session.id)
          ));

      // Compatibilidad con instalaciones que todavía no tienen la migración del historial.
      if (!activityRows) {
        const [recentCommentsResult, recentFriendshipsResult, recentFeedResult] = friendIdList.length > 0
          ? await Promise.all([
            supabase.from('comentarios_perfil_fotos')
              .select('id, comentario, autor_id, perfil_id, foto_id, fecha')
              .in('autor_id', friendIdList)
              .order('fecha', { ascending: false })
              .limit(20),
            supabase.from('amigos')
              .select('id, usuario_id, amigo_id, estado, fecha')
              .eq('estado', 'aceptada')
              .or(`usuario_id.in.(${friendIdList.join(',')}),amigo_id.in.(${friendIdList.join(',')})`)
              .order('fecha', { ascending: false })
              .limit(20),
            supabase.from('feed_actividad')
              .select('id, tipo, actor_id, target_id, contenido, fecha')
              .in('actor_id', friendIdList)
              .eq('tipo', 'foto')
              .order('fecha', { ascending: false })
              .limit(20),
          ])
          : [
            { data: [], error: null },
            { data: [], error: null },
            { data: [], error: null },
          ];
        if (recentCommentsResult.error) throw recentCommentsResult.error;
        if (recentFriendshipsResult.error) throw recentFriendshipsResult.error;
        const recentComments = (recentCommentsResult.data ?? []) as Array<Comment & { foto_id: string | null }>;
        const recentFriendships = (recentFriendshipsResult.data ?? []) as Friendship[];
        const recentPhotoActivities = recentFeedResult.error ? [] : (recentFeedResult.data ?? []) as Array<{ id: string; actor_id: string; target_id: string | null; contenido: string | null; fecha: string | null }>;
        activityRows = [
          ...recentComments.map((comment) => ({ id: String(comment.id), tipo: 'comentario', actor_id: String(comment.autor_id), target_id: comment.perfil_id ? String(comment.perfil_id) : null, contenido: comment.comentario, fecha: comment.fecha })),
          ...recentFriendships.map((friendship) => ({ id: String(friendship.id), tipo: 'amistad', actor_id: String(friendship.usuario_id), target_id: String(friendship.amigo_id), contenido: null, fecha: friendship.fecha ?? null })),
          ...recentPhotoActivities.map((event) => ({ id: String(event.id), tipo: 'foto', actor_id: String(event.actor_id), target_id: event.target_id, contenido: event.contenido, fecha: event.fecha })),
        ];
      }

       // Las amistades también deben aparecer para quien inició la conexión;
       // solo se ocultan las demás actividades creadas por la propia persona.
       activityRows = activityRows.filter((event) => (
         event.tipo === 'amistad' || String(event.actor_id) !== String(session.id)
       ));
      const recentComments = activityRows
        .filter((event) => event.tipo === 'comentario')
        .map((event) => ({ id: event.id, comentario: event.contenido ?? '', autor_id: event.actor_id, perfil_id: event.target_id, foto_id: null, fecha: event.fecha })) as Array<Comment & { foto_id: string | null }>;
      const recentFriendships = activityRows.filter((event) => event.tipo === 'amistad').map((event) => ({
        id: event.id,
        usuario_id: event.actor_id,
        amigo_id: event.target_id ?? event.actor_id,
        estado: 'aceptada' as const,
        fecha: event.fecha,
      })) as Friendship[];
      const recentPhotoActivities = activityRows
        .filter((event) => event.tipo === 'foto')
        .map((event) => ({ id: event.id, actor_id: event.actor_id, target_id: event.target_id, contenido: event.contenido, fecha: event.fecha }));
       const relevantFriendships = activityResult.error || !activityPayload?.ok
         ? recentFriendships.filter((row) => (
           friendIds.has(String(row.usuario_id)) || friendIds.has(String(row.amigo_id))
         ))
         : recentFriendships;
      const activityProfileIds = [
        ...friendIdList,
        ...recentComments.flatMap((comment) => [String(comment.autor_id), comment.perfil_id ? String(comment.perfil_id) : '']),
        ...relevantFriendships.flatMap((friendship) => [String(friendship.usuario_id), String(friendship.amigo_id)]),
        ...recentPhotoActivities.flatMap((event) => [String(event.actor_id), event.target_id ? String(event.target_id) : '']),
      ].filter(Boolean);
      const authorMap = new Map<string, string>();
      const authorAvatarMap = new Map<string, string | null>();
      if (activityProfileIds.length > 0) {
        const { data: authors } = await supabase.from('perfiles_dk').select('id, username, avatar_url').in('id', [...new Set(activityProfileIds)]);
        (authors ?? []).forEach((a: { id: string; username: string; avatar_url?: string | null }) => {
          authorMap.set(String(a.id), a.username);
          authorAvatarMap.set(String(a.id), a.avatar_url ?? null);
        });
      }

      const activity = [
        ...recentComments
          // No mostrar comentarios hechos en el propio perfil del usuario actual
          .filter((comment) => comment.perfil_id ? String(comment.perfil_id) !== String(profile.id) : true)
          .map((comment) => {
            const actorUsername = authorMap.get(String(comment.autor_id)) ?? 'usuario';
            const targetUsername = comment.perfil_id
              ? authorMap.get(String(comment.perfil_id)) ?? 'otro perfil'
              : 'un perfil';
            return {
              id: `comment-${String(comment.id)}`,
              kind: 'comment' as const,
             actorId: String(comment.autor_id),
             targetId: comment.perfil_id ? String(comment.perfil_id) : null,
              actorUsername,
              targetUsername,
              content: comment.comentario,
              fecha: comment.fecha,
                actorAvatarUrl: authorAvatarMap.get(String(comment.autor_id)) ?? null,
            };
          }),
         ...relevantFriendships.map((friendship) => {
           const involvesViewer = String(friendship.usuario_id) === String(session.id)
             || String(friendship.amigo_id) === String(session.id);
           const otherId = String(friendship.usuario_id) === String(session.id)
             ? String(friendship.amigo_id)
             : String(friendship.usuario_id);
            const actorId = involvesViewer ? String(session.id) : String(friendship.usuario_id);
            const targetId = involvesViewer ? otherId : String(friendship.amigo_id);
           return {
             id: `friendship-${String(friendship.id)}`,
             kind: 'friendship' as const,
             actorId,
             targetId,
             viewerIsParticipant: involvesViewer,
              actorUsername: involvesViewer ? session.username : authorMap.get(actorId) ?? 'usuario',
             targetUsername: authorMap.get(targetId) ?? 'otra persona',
             fecha: friendship.fecha ?? null,
              actorAvatarUrl: involvesViewer ? profile.avatar_url : authorAvatarMap.get(actorId) ?? null,
           };
         }),
           ...recentPhotoActivities.map((event) => ({
          id: `photo-${String(event.id)}`,
          kind: 'photo' as const,
           actorId: String(event.actor_id),
           targetId: event.target_id,
          actorUsername: authorMap.get(String(event.actor_id)) ?? 'usuario',
          targetUsername: authorMap.get(String(event.target_id ?? event.actor_id)) ?? 'un perfil',
          photoId: event.contenido ?? undefined,
          fecha: event.fecha,
          actorAvatarUrl: authorAvatarMap.get(String(event.actor_id)) ?? null,
        })),
      ].sort((a, b) => {
        const left = a.fecha ? new Date(a.fecha).getTime() : 0;
        const right = b.fecha ? new Date(b.fecha).getTime() : 0;
        return right - left;
      }).slice(0, 8);

       const nextData = {
        profile,
        friendCount: friendCount ?? 0,
        pendingCount: pendingCount ?? 0,
         messageCount,
         messageTotal: inboxMessages.length,
        blockedCount: blockedCount ?? 0,
        recentActivity: activity,
       };
       writeClientCache(`dashboard:${session.id}`, nextData);
       dataRef.current = nextData;
       setData(nextData);
    } catch (e) { setError(extractError(e)); }
    finally { setLoading(false); }
  }, [session.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onDashboardUpdate = () => void load();
    window.addEventListener('konekto:friendships-updated', onDashboardUpdate);
    window.addEventListener('konekto:inbox-updated', onDashboardUpdate);
    return () => {
      window.removeEventListener('konekto:friendships-updated', onDashboardUpdate);
      window.removeEventListener('konekto:inbox-updated', onDashboardUpdate);
    };
  }, [load]);

  // Sincronizar draft cuando carga el perfil
  useEffect(() => {
    if (data) setStatusDraft(data.profile.estado_personal ?? '');
  }, [data]);

  const saveStatus = async () => {
    setSavingStatus(true);
    const cleanStatus = normalizeSingleLine(statusDraft).trim();
    const { error } = await supabase.from('perfiles_dk')
      .update({ estado_personal: cleanStatus || null })
      .eq('id', session.id);
    setSavingStatus(false);
    if (error) { setError(error.message); return; }
    setData(prev => prev ? { ...prev, profile: { ...prev.profile, estado_personal: cleanStatus || null } } : null);
    setEditingStatus(false);
  };

   const statItems: Array<[string, number, typeof Users, string, string]> = data ? [
    ['Amigos', data.friendCount, Users, 'text-primary', '/friends'],
    ['Invitaciones', data.pendingCount, Bell, 'text-accent', '/friends#invitations'],
     ['Mensajes', data.messageCount ?? 0, Mail, 'text-secondary', '/mensajes'],
    ['Bloqueos', data.blockedCount, Ban, 'text-destructive', '/privacy#blocked'],
  ] : [];

  return <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:px-12">
     <PageHeader eyebrow="Centro de actividad" title={dashboardGreeting(session.username)} description={dashboardSubtitle()} action={<div className="panel-subtle hidden items-center gap-2 px-3 py-2 text-xs text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {onlineIds.size} en línea ahora</div>} />
    <StateMsg loading={loading} error={error || null} onRetry={load} />
    {data && <div className="space-y-6">

      {/* ── Estado personal — tarjeta editable inline con acento violeta ── */}
      <div className="relative overflow-hidden rounded-2xl border border-primary/35 bg-primary/[.055] p-5 shadow-sm">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/[.09] via-transparent to-transparent" />
        <div className="absolute left-0 top-0 h-full w-[3px] rounded-l-2xl bg-gradient-to-b from-primary/70 to-primary/20" />
        <div className="relative pl-1">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Sparkles size={14} className="text-primary shrink-0" />
              <span className="font-mono-app text-[.68rem] font-medium uppercase tracking-[.16em] text-primary">Mi estado personal</span>
            </div>
            {!editingStatus && (
              <button type="button" aria-label="Editar estado personal" className="icon-action shrink-0 text-primary/70 hover:text-primary" onClick={() => setEditingStatus(true)}>
                <Pencil size={14} />
              </button>
            )}
          </div>
          {editingStatus ? (
            <div className="mt-3 space-y-3">
              <textarea
                className="field resize-none"
                rows={2}
                maxLength={200}
                placeholder="¿Cómo te describes hoy? (máx. 200 caracteres)"
                value={statusDraft}
                onChange={e => setStatusDraft(e.target.value)}
                autoFocus
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" className="px-3 py-1.5 text-xs" onClick={() => { setStatusDraft(data.profile.estado_personal ?? ''); setEditingStatus(false); }}>Cancelar</Button>
                <Button className="px-3 py-1.5 text-xs" onClick={() => void saveStatus()} disabled={savingStatus}>
                  {savingStatus ? <Spinner /> : <><Check size={13} /> Guardar</>}
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-2.5 break-words [overflow-wrap:anywhere] text-sm font-medium leading-6">
              {data.profile.estado_personal
                ? <span className="text-foreground">{sanitizeSingleLineForDisplay(data.profile.estado_personal)}</span>
                : <span className="italic text-muted-foreground/70 text-xs">Sin estado personal aún. Pulsa el ícono ✏ para agregar uno.</span>}
            </p>
          )}
        </div>
      </div>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statItems.map(([label, value, Icon, color, href], i) => {
          const isMessages = label === 'Mensajes';
          const unreadMessages = data.messageCount ?? 0;
          const totalMessages = data.messageTotal ?? 0;
          const hasMessages = isMessages && Boolean(unreadMessages || totalMessages);
          return <Link href={href} className={`panel page-enter block p-5 transition-transform hover:-translate-y-1 hover:border-primary/50 stagger-${i + 1} ${isMessages && unreadMessages > 0 ? 'border-accent/50 bg-accent/[.05]' : ''}`} key={label}>
           <div className="mb-7 flex items-start justify-between gap-3"><div className="flex items-center gap-2"><span className="text-xs font-semibold text-muted-foreground">{label}</span>{isMessages && unreadMessages > 0 && <span className="rounded-full bg-accent/15 px-2 py-0.5 font-mono-app text-[9px] font-bold uppercase tracking-wider text-accent">Nuevo</span>}</div><span className={`rounded-lg bg-white/[.04] p-2 ${color}`}><Icon size={16} /></span></div>
          <div className="font-display text-3xl font-bold">{value}</div>
           <div className={`mt-2 flex items-center gap-1 font-mono-app text-[9px] uppercase tracking-widest ${isMessages && unreadMessages > 0 ? 'text-accent' : 'text-muted-foreground'}`}>{isMessages ? (unreadMessages > 0 ? `${unreadMessages} sin leer` : hasMessages ? 'Bandeja con mensajes' : 'Sin mensajes nuevos') : 'abrir sección'} <ChevronRight size={12} /></div>
         </Link>;
        })}
      </section>
      <section className="grid gap-6 lg:grid-cols-[1.4fr_.8fr]">
        <div className="">
           <div className="mb-4"><div className="eyebrow mb-2">Muro reciente</div><h2 className="font-display text-xl font-bold">Actividad de tus amigos</h2><p className="mt-1 text-xs text-muted-foreground">Aquí verás lo que comparten tus amigos.</p></div>
           <StateMsg empty={!data.recentActivity.length} />
           {data.recentActivity.length > 0 && (() => {
             const visible = activityShowAll ? data.recentActivity : data.recentActivity.slice(0, ACTIVITY_INITIAL);
             return <>
               <div className="space-y-0">{visible.map((activity) => <div className="flex gap-3 border-b border-border/50 py-3.5 last:border-0" key={activity.id}>
                  <Avatar username={activity.actorUsername} size="sm" imageUrl={activity.actorAvatarUrl} />
                 <div className="min-w-0">
                   <div className="flex flex-wrap items-center gap-2 text-sm">
                     <Link href={`/profile/${activity.actorUsername}`} className="font-bold hover:text-primary">{activity.actorUsername}</Link>
                      {activity.kind === 'photo'
                         ? <span className="text-muted-foreground">subió una foto</span>
                        : activity.kind === 'comment' && activity.actorUsername === activity.targetUsername
                       ? <span className="text-muted-foreground">hizo un comentario en su perfil</span>
                        : activity.kind === 'friendship' && activity.viewerIsParticipant
                           ? <><span className="text-muted-foreground">, te hiciste amigo de</span><Link href={`/profile/${activity.targetUsername}`} className="font-bold hover:text-primary">{activity.targetUsername}</Link></>
                       : activity.kind === 'comment'
                         ? <><span className="text-muted-foreground">comentó en</span><Link href={`/profile/${activity.targetUsername}`} className="font-bold hover:text-primary">{activity.targetUsername}</Link></>
                         : <><span className="text-muted-foreground">se conectó con</span><Link href={`/profile/${activity.targetUsername}`} className="font-bold hover:text-primary">{activity.targetUsername}</Link></>}
                     <span className="font-mono-app text-[10px] text-muted-foreground">{relativeDate(activity.fecha)}</span>
                   </div>
                    {activity.content && <p className="mt-1 break-words text-sm text-muted-foreground">{renderCustomEmojiText(sanitizeSingleLineForDisplay(activity.content))}</p>}
                    {activity.kind === 'photo' && activity.photoId && <Link href={`/foto/${activity.photoId}`} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-accent">Abrir foto <ChevronRight size={13} /></Link>}
                 </div>
               </div>)}</div>
               {!activityShowAll && data.recentActivity.length > ACTIVITY_INITIAL && (
                 <button className="mt-4 w-full rounded-lg border border-border bg-white/[.025] py-2.5 text-xs font-semibold text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors" onClick={() => setActivityShowAll(true)}>
                   Mostrar más actividades ({data.recentActivity.length - ACTIVITY_INITIAL} restantes)
                 </button>
               )}
             </>;
           })()}
        </div>
        <div className="panel scanline flex min-h-[280px] flex-col justify-between overflow-hidden p-6">
          <div><div className="eyebrow mb-3">Mi perfil</div><h2 className="font-display text-2xl font-bold">Tu perfil,<br />a tu manera.</h2><p className="mt-4 text-sm leading-6 text-muted-foreground">Tú decides quién puede ver tu perfil y tu actividad.</p></div>
          <Link href="/privacy" className="inline-flex items-center gap-2 text-xs font-bold text-accent hover:text-primary">Gestionar privacidad <ArrowRight size={14} /></Link>
        </div>
      </section>
    </div>}
  </div>;
}

// ─── Perfil ───────────────────────────────────────────────────────────────────

type ProfileCommentView = {
  id: string;
  content: string;
  authorId: string;
  authorUsername: string;
  authorAvatarUrl?: string | null;
  authorVip: boolean;
  fecha: string | null;
};

type RecentVisitor = {
  id: string;
  username: string;
  avatarUrl?: string | null;
  visitedAt: string | null;
};

type ProfileClientSnapshot = {
  profile: Profile;
  comments: ProfileCommentView[];
  recentVisitors: RecentVisitor[];
  friendCount: number;
  visits: number;
  gifts: number;
  totalComments: number;
};

function ProfilePage({ session, onlineUsers, onAvatarChange }: { session: Session; onlineUsers: OnlineUser[]; onAvatarChange: (avatarUrl: string | null) => void }) {
  const params = useParams<{ username?: string }>();
  const [, setLocation] = useLocation();
  const targetUsername = params.username === 'me' ? session.username : (params.username ?? session.username);
  const isSelf = targetUsername === session.username;
  const cachedSnapshot = readClientCache<ProfileClientSnapshot>(`profile:${targetUsername}`);

  const [profile, setProfile] = useState<Profile | null>(() => cachedSnapshot?.profile ?? null);
  const profileRef = useRef<Profile | null>(cachedSnapshot?.profile ?? null);
  const requestRef = useRef(0);
  const [comments, setComments] = useState<ProfileCommentView[]>(() => cachedSnapshot?.comments ?? []);
  const [latestComments, setLatestComments] = useState<ProfileCommentView[]>(() => cachedSnapshot?.comments ?? []);
  const [recentVisitors, setRecentVisitors] = useState<RecentVisitor[]>(() => cachedSnapshot?.recentVisitors ?? []);
  const [friendCount, setFriendCount] = useState(() => cachedSnapshot?.friendCount ?? 0);
  const [visits, setVisits] = useState(() => cachedSnapshot?.visits ?? 0);
  const [gifts, setGifts] = useState(() => cachedSnapshot?.gifts ?? 0);
  const [giftDialogOpen, setGiftDialogOpen] = useState(false);
  const [giftSending, setGiftSending] = useState(false);
  const [giftDialogError, setGiftDialogError] = useState('');
  const [giftLimitReached, setGiftLimitReached] = useState(false);
  const [galleryPhotos, setGalleryPhotos] = useState<GalleryPhoto[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [galleryError, setGalleryError] = useState('');
  const [galleryUploadChoiceOpen, setGalleryUploadChoiceOpen] = useState(false);
  const [galleryVisibility, setGalleryVisibility] = useState<'public' | 'private'>('public');
  const [mediaUploading, setMediaUploading] = useState<'banner' | 'gallery' | null>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [viewerVip, setViewerVip] = useState(false);
  const [viewerAvatarUrl, setViewerAvatarUrl] = useState<string | null>(session.avatarUrl ?? null);
  const [isFriend, setIsFriend] = useState(isSelf);
  const [isBlockedByThem, setIsBlockedByThem] = useState(false);
  const [loading, setLoading] = useState(() => !cachedSnapshot);
  const [error, setError] = useState('');
  const [comment, setComment] = useState('');
  const commentInputRef = useRef<HTMLInputElement>(null);
  const [notice, showNotice] = useTransientNotice();
  const [confirmNode, showConfirm] = useConfirmDialog();
  const [submitting, setSubmitting] = useState(false);
  const [inviteStatus, setInviteStatus] = useState<'none' | 'pending' | 'accepted'>('none');
  const [inviteDirection, setInviteDirection] = useState<'incoming' | 'outgoing' | null>(null);
  const [inviteRowId, setInviteRowId] = useState<string | null>(null);
  const [friendshipRowId, setFriendshipRowId] = useState<string | null>(null);
  const [blockRowId, setBlockRowId] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [totalComments, setTotalComments] = useState(() => cachedSnapshot?.totalComments ?? 0);
  // Pagination: phase 'initial' shows 4, 'paged' shows PAGE_SIZE per page
  const [commentPhase, setCommentPhase] = useState<'initial' | 'paged'>('initial');
  const [commentPage, setCommentPage] = useState(0);
  const PAGE_INITIAL = 4;
  const PAGE_SIZE = 10;

  const onlineIds = new Set(onlineUsers.map(u => u.id));
  const isBlocked = blockRowId !== null; // I blocked them

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!profileRef.current) setLoading(true);
    setError('');
    try {
      const { data: p, error: pErr } = await profileByUsername(targetUsername);
      if (pErr || !p) throw new Error('Perfil no encontrado.');
      if (isSelf && p.avatar_url !== (session.avatarUrl ?? null)) onAvatarChange(p.avatar_url ?? null);
      const viewerProfilePromise = isSelf ? Promise.resolve({ data: p, error: null }) : profileById(session.id);

      const [
        { data: rawComments, error: commentsError },
        { count: commentsTotal },
        { count: fc },
         { data: relationRows, error: relationError },
        { data: myBlockRows },
        { data: theirBlockRows },
        viewerProfileResult,
      ] = await Promise.all([
        supabase.from('comentarios_perfil_fotos')
          .select('id, comentario, autor_id, perfil_id, foto_id, fecha')
          .eq('perfil_id', p.id)
          .order('fecha', { ascending: false })
          .limit(PAGE_INITIAL),
        supabase.from('comentarios_perfil_fotos')
          .select('id', { count: 'exact', head: true })
          .eq('perfil_id', p.id),
        supabase.from('amigos').select('id', { count: 'exact', head: true })
          .or(`usuario_id.eq.${p.id},amigo_id.eq.${p.id}`).eq('estado', 'aceptada'),
        // One query, both directions: friendship is an undirected relation.
        supabase.from('amigos').select('id, usuario_id, amigo_id, estado, fecha')
          .or(`and(usuario_id.eq.${session.id},amigo_id.eq.${p.id}),and(usuario_id.eq.${p.id},amigo_id.eq.${session.id})`)
          .in('estado', ['pendiente', 'aceptada'])
          .order('fecha', { ascending: false }),
        // I blocked them
        supabase.from('bloqueos').select('id')
          .eq('bloqueador_id', session.id).eq('bloqueado_id', p.id)
          .order('fecha', { ascending: false }).limit(1),
        // They blocked me
        supabase.from('bloqueos').select('id')
          .eq('bloqueador_id', p.id).eq('bloqueado_id', session.id)
          .limit(1),
        viewerProfilePromise,
      ]);
      if (commentsError) throw commentsError;
      if (relationError) throw relationError;
      if (requestId !== requestRef.current) return;

      const relations = (relationRows ?? []) as Friendship[];
      const acceptedRelation = relations.find((row) => row.estado === 'aceptada');
      const outgoingInvite = relations.find((row) => row.estado === 'pendiente' && String(row.usuario_id) === String(session.id));
      const incomingInvite = relations.find((row) => row.estado === 'pendiente' && String(row.amigo_id) === String(session.id));
      const accepted = Boolean(acceptedRelation);
      setIsFriend(isSelf || accepted);
      setFriendCount(fc ?? 0);
      setTotalComments(commentsTotal ?? 0);
      setViewerVip(profileIsVip(viewerProfileResult.data));
      setViewerAvatarUrl((viewerProfileResult.data as Profile | null)?.avatar_url ?? session.avatarUrl ?? null);
      setGifts(Number(p.regalos ?? 0));

      setFriendshipRowId(acceptedRelation?.id ? String(acceptedRelation.id) : null);
      setInviteRowId(outgoingInvite?.id ? String(outgoingInvite.id) : incomingInvite?.id ? String(incomingInvite.id) : null);
      setInviteDirection(outgoingInvite ? 'outgoing' : incomingInvite ? 'incoming' : null);
      setInviteStatus(accepted ? 'accepted' : outgoingInvite || incomingInvite ? 'pending' : 'none');
      const myBlock = (myBlockRows ?? [])[0] as { id: string } | undefined;
      setBlockRowId(myBlock?.id ? String(myBlock.id) : null);
      setIsBlockedByThem(((theirBlockRows ?? []).length > 0));

      const authorIds = [...new Set((rawComments ?? []).map((c: Comment) => c.autor_id))];
      const authorMap = new Map<string, string>();
      const authorVipMap = new Map<string, boolean>();
      const authorAvatarMap = new Map<string, string | null>();
      if (authorIds.length > 0) {
        const authors = await authorProfilesByIds(authorIds);
        authors.forEach((author, id) => {
          authorMap.set(id, author.username);
          authorVipMap.set(id, author.isVip);
          authorAvatarMap.set(id, author.avatarUrl ?? null);
        });
      }
      const mappedComments = (rawComments ?? []).map((c: Comment) => ({
        id: String(c.id),
        content: c.comentario,
        authorId: String(c.autor_id),
        authorUsername: authorMap.get(String(c.autor_id)) ?? 'usuario',
        authorAvatarUrl: authorAvatarMap.get(String(c.autor_id)) ?? null,
        authorVip: authorVipMap.get(String(c.autor_id)) ?? false,
        fecha: c.fecha,
      }));

      // The history table is optional until its migration is applied.
      // A missing table should not break the profile page.
      let nextRecentVisitors: RecentVisitor[] = [];
      if (isSelf) {
        const { data: visitorRows, error: visitorsError } = await supabase
          .from('visitas_perfil')
          .select('visitante_id, visitado_en')
          .eq('perfil_id', p.id)
          .neq('visitante_id', session.id)
          .order('visitado_en', { ascending: false })
          .limit(8);
        if (!visitorsError && visitorRows?.length) {
          const visitorIds = visitorRows.map((row: { visitante_id: string }) => String(row.visitante_id));
          const { data: visitorProfiles } = await supabase.from('perfiles_dk')
            .select('id, username, avatar_url')
            .in('id', visitorIds);
          const visitorNames = new Map<string, { username: string; avatarUrl?: string | null }>();
          (visitorProfiles ?? []).forEach((visitor: { id: string; username: string; avatar_url?: string | null }) => visitorNames.set(String(visitor.id), { username: visitor.username, avatarUrl: visitor.avatar_url }));
          nextRecentVisitors = visitorRows
            .map((row: { visitante_id: string; visitado_en: string | null }) => ({
              id: String(row.visitante_id),
              username: visitorNames.get(String(row.visitante_id))?.username ?? '',
              avatarUrl: visitorNames.get(String(row.visitante_id))?.avatarUrl ?? null,
              visitedAt: row.visitado_en,
            }))
            .filter((visitor) => visitor.username);
        }
      }
      if (requestId !== requestRef.current) return;
      const nextVisits = Number(p.visitas ?? 0);
      const nextGifts = Number(p.regalos ?? 0);
      writeClientCache<ProfileClientSnapshot>(`profile:${targetUsername}`, {
        profile: p,
        comments: mappedComments,
        recentVisitors: isSelf ? nextRecentVisitors : [],
        friendCount: fc ?? 0,
        visits: nextVisits,
        gifts: nextGifts,
        totalComments: commentsTotal ?? 0,
      });
      profileRef.current = p;
      setProfile(p);
      setVisits(nextVisits);
      setGifts(nextGifts);
       setComments(newestFirst(mappedComments));
       setLatestComments(newestFirst(mappedComments));
      setRecentVisitors(isSelf ? nextRecentVisitors : []);
      setCommentPhase('initial');
      setCommentPage(0);
    } catch (e) { setError(extractError(e)); }
    finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [isSelf, onAvatarChange, session.id, session.token, targetUsername]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onFriendshipUpdate = () => void load();
    window.addEventListener('konekto:friendships-updated', onFriendshipUpdate);
    const channel = supabase.channel(`konekto:profile-friendship:${session.id}:${targetUsername}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'amigos',
      }, () => void load())
      .subscribe();
    return () => {
      window.removeEventListener('konekto:friendships-updated', onFriendshipUpdate);
      void supabase.removeChannel(channel);
    };
  }, [load, session.id, targetUsername]);

  // Load more comments (paged)
  const loadPagedComments = useCallback(async (page: number) => {
    if (!profile) return;
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const { data: rawComments } = await supabase.from('comentarios_perfil_fotos')
      .select('id, comentario, autor_id, perfil_id, foto_id, fecha')
      .eq('perfil_id', profile.id)
      .order('fecha', { ascending: false })
      .range(from, to);
    const authorIds = [...new Set((rawComments ?? []).map((c: Comment) => c.autor_id))];
    const authorMap = new Map<string, string>();
    const authorVipMap = new Map<string, boolean>();
      const authorAvatarMap = new Map<string, string | null>();
    if (authorIds.length > 0) {
      const authors = await authorProfilesByIds(authorIds);
      authors.forEach((author, id) => {
        authorMap.set(id, author.username);
        authorVipMap.set(id, author.isVip);
          authorAvatarMap.set(id, author.avatarUrl ?? null);
      });
    }
     setComments(newestFirst((rawComments ?? []).map((c: Comment) => ({
      id: String(c.id),
      content: c.comentario,
      authorId: String(c.autor_id),
      authorUsername: authorMap.get(String(c.autor_id)) ?? 'usuario',
        authorAvatarUrl: authorAvatarMap.get(String(c.autor_id)) ?? null,
      authorVip: authorVipMap.get(String(c.autor_id)) ?? false,
      fecha: c.fecha,
     }))));
    setCommentPage(page);
  }, [profile]);

  const handleShowMore = async () => {
    if (!profile) return;
    setCommentPhase('paged');
    await loadPagedComments(0);
  };

  const handleNextPage = () => loadPagedComments(commentPage + 1);
  const handlePrevPage = () => { if (commentPage > 0) void loadPagedComments(commentPage - 1); };

  // Count visit
  useEffect(() => {
    if (!profile || isSelf) return;
    let active = true;
    const recordVisit = async () => {
      if (!session.token) return;
      const { data, error: rpcError } = await supabase.rpc('registrar_visita_segura', {
        p_session_token: session.token,
        p_perfil_id: profile.id,
      });
      if (active && !rpcError && typeof data === 'number' && data >= 0) setVisits(data);
    };
    void recordVisit();
    const channel = supabase.channel(`profile-visits-${profile.id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'perfiles_dk', filter: `id=eq.${profile.id}` },
        (payload) => {
          const nextVisits = (payload.new as { visitas?: number }).visitas;
          if (typeof nextVisits === 'number') setVisits(nextVisits);
        })
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [isSelf, profile, session.id, session.token]);

  // El límite de tres comentarios consecutivos corresponde a las fotos,
  // no al muro del perfil. Los comentarios del perfil siguen disponibles
  // para el dueño y sus amigos.
  const isSpamLocked = false;

  // Can view wall
  const canViewWall = isSelf || Boolean(profile?.es_publico) || isFriend;

  // Shadowban: el bloqueo es unidireccional. La UI se ve COMPLETAMENTE NORMAL para el bloqueado.
  // La interacción se intercepta en tiempo de acción (sendComment / sendInvite).
  const canComment = canViewWall && !isSpamLocked && !isBlockedByThem;
  const canViewGiftHistory = isSelf || Boolean(profile?.es_publico) || isFriend;
  const canViewFriendsCard = isSelf || isFriend || (Boolean(profile?.es_publico) && !Boolean(profile?.ocultar_amigos));
  const canViewSocialCards = canViewGiftHistory;
  const socialGridClass = 'grid-cols-3';

  const loadGallery = useCallback(async (profileId: string) => {
    if (!session.token) return;
    setGalleryLoading(true);
    setGalleryError('');
    const { data, error: galleryLoadError } = await supabase.rpc('obtener_galeria_segura', {
      p_session_token: session.token,
      p_perfil_id: profileId,
    });
    setGalleryLoading(false);
    if (galleryLoadError) {
      if (galleryLoadError.code === '42883' || galleryLoadError.code === 'PGRST202') return;
      setGalleryError(extractError(galleryLoadError));
      return;
    }
    const result = data as { ok?: boolean; photos?: GalleryPhoto[] } | null;
    if (!result?.ok) {
      setGalleryError('No se pudo cargar la galería.');
      return;
    }
    setGalleryPhotos(Array.isArray(result.photos) ? result.photos : []);
  }, [session.token]);

  useEffect(() => {
    if (profile?.id) void loadGallery(profile.id);
    else setGalleryPhotos([]);
  }, [loadGallery, profile?.id]);

  const validateMediaFile = (file: File, maxBytes: number) => {
    if (!file.type.startsWith('image/')) {
      showNotice('Solo puedes subir imágenes.');
      return false;
    }
    if (file.size > maxBytes) {
      showNotice(`La imagen debe pesar menos de ${Math.round(maxBytes / 1024 / 1024)} MB.`);
      return false;
    }
    return true;
  };

  const mediaFileName = (file: File) => file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(-80) || 'imagen';
  const mediaPath = (kind: string, file: File) => `profiles/${session.id}/${kind}/${crypto.randomUUID()}-${mediaFileName(file)}`;

  const uploadBannerImage = async (sourceFile: File) => {
    if (!isSelf || !profile || !validateMediaFile(sourceFile, 25 * 1024 * 1024)) return;
    setMediaUploading('banner');
    const file = await compressImage(sourceFile);
    const path = mediaPath('banner', file);
    try {
      const { error: uploadError } = await supabase.storage.from('konekto_media').upload(path, file, {
        cacheControl: '31536000',
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      const publicUrl = supabase.storage.from('konekto_media').getPublicUrl(path).data.publicUrl;
      const { error: profileUpdateError } = await supabase.from('perfiles_dk').update({ banner_url: publicUrl }).eq('id', session.id);
      if (profileUpdateError) {
        await supabase.storage.from('konekto_media').remove([path]);
        throw profileUpdateError;
      }
      setProfile((current) => current ? { ...current, banner_url: publicUrl } : current);
      profileRef.current = profile ? { ...profile, banner_url: publicUrl } : profile;
      showNotice('Banner actualizado.');
    } catch (cause) {
      showNotice(extractError(cause));
    } finally {
      setMediaUploading(null);
    }
  };

  const removeBanner = async () => {
    if (!isSelf || mediaUploading) return;
    setMediaUploading('banner');
    const { error: bannerError } = await supabase.from('perfiles_dk').update({ banner_url: null }).eq('id', session.id);
    setMediaUploading(null);
    if (bannerError) { showNotice(extractError(bannerError)); return; }
    setProfile((current) => current ? { ...current, banner_url: null } : current);
    profileRef.current = profile ? { ...profile, banner_url: null } : profile;
    showNotice('Banner eliminado. Se restauró el banner por defecto.');
  };

  const uploadGalleryFiles = async (files: File[]) => {
    if (!isSelf || !profile || !session.token) return;
    const validFiles = files.filter((file) => validateMediaFile(file, 10 * 1024 * 1024)).slice(0, 12);
    if (!validFiles.length) return;
    setMediaUploading('gallery');
    let uploaded = 0;
    try {
      for (const sourceFile of validFiles) {
        const file = await compressImage(sourceFile);
        const path = mediaPath('gallery', file);
        const { error: uploadError } = await supabase.storage.from('konekto_media').upload(path, file, {
          cacheControl: '31536000',
          contentType: file.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;
        const publicUrl = supabase.storage.from('konekto_media').getPublicUrl(path).data.publicUrl;
        const { data, error: createError } = await supabase.rpc('crear_foto_galeria_segura', {
          p_session_token: session.token,
          p_url: publicUrl,
          p_storage_path: path,
          p_visibilidad: galleryVisibility,
        });
        const result = data as { ok?: boolean; avatar_updated?: boolean; avatar_url?: string; avatar_foto_id?: string } | null;
        if (createError || !result?.ok) {
          await supabase.storage.from('konekto_media').remove([path]);
          throw createError ?? new Error('No se pudo guardar la foto en la galería.');
        }
        if (uploaded === 0 && result?.avatar_updated && result.avatar_url) {
          setProfile((current) => current ? { ...current, avatar_url: result.avatar_url ?? null, avatar_foto_id: result.avatar_foto_id ?? null } : current);
          onAvatarChange(result.avatar_url);
        }
        uploaded += 1;
      }
      await loadGallery(profile.id);
      showNotice(`${uploaded} ${uploaded === 1 ? 'foto añadida' : 'fotos añadidas'} como ${galleryVisibility === 'public' ? 'públicas' : 'privadas'}.`);
    } catch (cause) {
      showNotice(extractError(cause));
      if (uploaded > 0) await loadGallery(profile.id);
    } finally {
      setMediaUploading(null);
    }
  };

  const onMediaInput = (event: React.ChangeEvent<HTMLInputElement>, kind: 'banner' | 'gallery') => {
    const files = Array.from(event.target.files ?? []);
    event.currentTarget.value = '';
    if (kind === 'gallery') void uploadGalleryFiles(files);
    else if (files[0]) void uploadBannerImage(files[0]);
  };

  const chooseGalleryUpload = (visibility: 'public' | 'private') => {
    setGalleryVisibility(visibility);
    setGalleryUploadChoiceOpen(false);
    requestAnimationFrame(() => galleryInputRef.current?.click());
  };

  const deleteGalleryPhoto = async (photo: GalleryPhoto) => {
    if (!isSelf || !session.token) return;
    const ok = await showConfirm({
      title: '¿Eliminar esta foto?',
      message: 'La foto, sus comentarios y sus reacciones se eliminarán de forma permanente.',
      confirmLabel: 'Sí, eliminar foto',
      danger: true,
    });
    if (!ok) return;
    const { data, error: deleteError } = await supabase.rpc('eliminar_foto_segura', {
      p_session_token: session.token,
      p_foto_id: photo.id,
    });
    if (deleteError) { showNotice(extractError(deleteError)); return; }
    const result = data as { ok?: boolean; storage_path?: string | null } | null;
    if (!result?.ok) { showNotice('No se pudo eliminar la foto.'); return; }
    setGalleryPhotos((current) => current.filter((item) => item.id !== photo.id));
    if (result.storage_path) void supabase.storage.from('konekto_media').remove([result.storage_path]);
    showNotice('Foto eliminada.');
  };

  const togglePhotoVisibility = async (photo: GalleryPhoto) => {
    if (!isSelf || !session.token) return;
    const nextVisibility = photo.visibilidad === 'public' ? 'private' : 'public';
    const { data, error: visibilityError } = await supabase.rpc('cambiar_visibilidad_foto_segura', {
      p_session_token: session.token,
      p_foto_id: photo.id,
      p_visibilidad: nextVisibility,
    });
    if (visibilityError) { showNotice(extractError(visibilityError)); return; }
    const result = data as { ok?: boolean } | null;
    if (!result?.ok) { showNotice('No se pudo cambiar la visibilidad.'); return; }
    setGalleryPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, visibilidad: nextVisibility } : item));
    showNotice(nextVisibility === 'public' ? 'Foto visible para tus visitantes.' : 'Foto privada solo para ti.');
  };

  const sendComment = async (e: FormEvent) => {
    e.preventDefault();
    if (!comment.trim() || !profile || submitting || !canComment) return;
    // Shadowban silencioso: interceptar sin revelar que existe bloqueo con un error de BD
    if (isBlockedByThem) {
      showNotice('No puedes interactuar porque este usuario te ha bloqueado.');
      return;
    }
    const content = censorProfanity(replaceEmojiCommands(normalizeSingleLine(comment).trim()));
    const timestamp = new Date().toISOString();
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticComment: ProfileCommentView = {
      id: optimisticId,
      content,
      authorId: session.id,
      authorUsername: session.username,
      authorAvatarUrl: viewerAvatarUrl ?? session.avatarUrl ?? null,
      authorVip: viewerVip,
      fecha: timestamp,
    };
    setComments((current) => [optimisticComment, ...current].slice(0, commentPhase === 'initial' ? PAGE_INITIAL : PAGE_SIZE));
    setLatestComments((current) => [optimisticComment, ...current].slice(0, 4));
    setTotalComments(t => t + 1);
    setComment('');
    setSubmitting(true);
    const { data: inserted, error: err } = await supabase.from('comentarios_perfil_fotos').insert({
      comentario: content,
      autor_id: session.id,
      perfil_id: profile.id,
      foto_id: null,
      fecha: timestamp,
    }).select('id, comentario, autor_id, fecha').single();
    setSubmitting(false);
    if (err) {
      setComments((current) => current.filter((item) => item.id !== optimisticId));
      setLatestComments((current) => current.filter((item) => item.id !== optimisticId));
      setTotalComments(t => t - 1);
      showNotice(err.message);
      return;
    }
    if (inserted) {
      const persistedId = String((inserted as { id: string }).id);
      setComments((current) => current.map((item) => item.id === optimisticId ? { ...item, id: persistedId } : item));
      setLatestComments((current) => current.map((item) => item.id === optimisticId ? { ...item, id: persistedId } : item));
    }
    showNotice('Comentario publicado.');
  };

  const deleteComment = async (commentId: string) => {
    if (commentId.startsWith('optimistic-')) return;
    const previous = comments;
    const previousLatest = latestComments;
    const afterRemove = comments.filter((item) => item.id !== commentId);
    setComments(afterRemove);
    setLatestComments((current) => current.filter((item) => item.id !== commentId));
    const newTotal = Math.max(0, totalComments - 1);
    setTotalComments(newTotal);
    const { error: err } = await supabase.from('comentarios_perfil_fotos').delete().eq('id', commentId);
    if (err) { setComments(previous); setLatestComments(previousLatest); setTotalComments(t => t + 1); showNotice(err.message); return; }

    // Refill automático: si estamos en vista inicial y quedan huecos, jalamos el siguiente
    if (commentPhase === 'initial' && profile && afterRemove.length < PAGE_INITIAL && newTotal > afterRemove.length) {
      const { data: refillRaw } = await supabase.from('comentarios_perfil_fotos')
        .select('id, comentario, autor_id, foto_id, fecha')
        .eq('perfil_id', profile.id)
        .order('fecha', { ascending: false })
        .range(afterRemove.length, afterRemove.length);
      if (refillRaw?.length) {
        const authorIds = [...new Set(refillRaw.map((c: Comment) => c.autor_id))];
        const authorMap = new Map<string, string>();
        const authorVipMap = new Map<string, boolean>();
        const authorAvatarMap = new Map<string, string | null>();
        if (authorIds.length) {
          const authors = await authorProfilesByIds(authorIds);
          authors.forEach((author, id) => {
            authorMap.set(id, author.username);
            authorVipMap.set(id, author.isVip);
            authorAvatarMap.set(id, author.avatarUrl ?? null);
          });
        }
        const refillItems = refillRaw.map((c: Comment) => ({
          id: String(c.id), content: c.comentario, authorId: String(c.autor_id),
           authorUsername: authorMap.get(String(c.autor_id)) ?? 'usuario',
          authorAvatarUrl: authorAvatarMap.get(String(c.autor_id)) ?? null,
          authorVip: authorVipMap.get(String(c.autor_id)) ?? false,
          fecha: c.fecha,
        }));
         setComments((prev) => newestFirst([...prev, ...refillItems]));
         setLatestComments((prev) => newestFirst([...prev, ...refillItems]).slice(0, 4));
      }
    }

    showNotice('Comentario eliminado.');
  };

  const deleteAllMyComments = async () => {
    if (!profile) return;
    const ok = await showConfirm({ title: '¿Borrar todos tus comentarios?', message: 'Esta acción es permanente. Todos tus mensajes en este perfil desaparecerán.', confirmLabel: 'Sí, borrar todo', danger: true });
    if (!ok) return;
    const { error: err } = await supabase.from('comentarios_perfil_fotos')
      .delete().eq('autor_id', session.id).eq('perfil_id', profile.id);
    if (err) { showNotice(err.message); return; }
    setComments((current) => current.filter((item) => item.authorId !== session.id));
    setLatestComments((current) => current.filter((item) => item.authorId !== session.id));
    void load();
    showNotice('Todos tus comentarios fueron eliminados.');
  };

  const sendInvite = async () => {
    if (!profile || actionBusy) return;
    // Shadowban silencioso
    if (isBlockedByThem) {
      showNotice('No puedes interactuar porque este usuario te ha bloqueado.');
      return;
    }
    setActionBusy(true);
    const { data: inserted, error: err } = await supabase.from('amigos').insert({
      usuario_id: session.id, amigo_id: profile.id, estado: 'pendiente',
    }).select('id').single();
    setActionBusy(false);
    if (err) { showNotice(err.message); return; }
    setInviteRowId(inserted ? String((inserted as { id: string }).id) : null);
    setInviteStatus('pending');
    setInviteDirection('outgoing');
    window.dispatchEvent(new Event('konekto:friendships-updated'));
    showNotice('Invitación enviada. Puedes cancelarla cuando quieras.');
  };

  const cancelInvite = async () => {
    if (!inviteRowId || actionBusy) return;
    setActionBusy(true);
    const { error: err } = await supabase.from('amigos').delete().eq('id', inviteRowId);
    setActionBusy(false);
    if (err) { showNotice(err.message); return; }
    setInviteRowId(null);
    setInviteStatus('none');
    setInviteDirection(null);
    window.dispatchEvent(new Event('konekto:friendships-updated'));
    showNotice('Invitación cancelada.');
  };

  const respondToIncomingInvite = async (estado: 'aceptada' | 'rechazada') => {
    if (!inviteRowId || inviteDirection !== 'incoming' || actionBusy) return;
    setActionBusy(true);
    const { error: err } = await supabase.from('amigos').update({ estado }).eq('id', inviteRowId);
    setActionBusy(false);
    if (err) { showNotice(err.message); return; }
    if (estado === 'aceptada') {
      setFriendshipRowId(inviteRowId);
      setIsFriend(true);
      setInviteStatus('accepted');
      window.dispatchEvent(new Event('konekto:friendships-updated'));
      if (session.token) {
        const { data: autoMessage, error: autoMessageError } = await supabase.rpc('notificar_aceptacion_amistad_segura', {
          p_session_token: session.token,
          p_invitacion_id: inviteRowId,
        });
        const autoMessageResult = autoMessage as { ok?: boolean } | null;
        if (autoMessageError || !autoMessageResult?.ok) {
          showNotice('Ahora están conectados. No se pudo enviar el mensaje automático.');
          return;
        }
      }
    } else {
      setInviteRowId(null);
      setInviteDirection(null);
      setInviteStatus('none');
      window.dispatchEvent(new Event('konekto:friendships-updated'));
    }
    showNotice(estado === 'aceptada' ? 'Ahora están conectados.' : 'Invitación rechazada.');
  };

  const removeFriend = async () => {
    if (!friendshipRowId || actionBusy) return;
    setActionBusy(true);
    const { error: err } = await supabase.from('amigos').delete().eq('id', friendshipRowId);
    setActionBusy(false);
    if (err) { showNotice(err.message); return; }
    setFriendshipRowId(null);
    setIsFriend(false);
    setInviteRowId(null);
    setInviteDirection(null);
    setInviteStatus('none');
    window.dispatchEvent(new Event('konekto:friendships-updated'));
  };

  const toggleBlock = async () => {
    if (!profile || actionBusy) return;
    setActionBusy(true);
    if (isBlocked) {
      const { error: err } = await supabase.from('bloqueos').delete().eq('id', blockRowId!);
      setActionBusy(false);
      if (err) { showNotice(err.message); return; }
      setBlockRowId(null);
      return;
    }
    const { data: row, error: err } = await supabase.from('bloqueos')
      .insert({ bloqueador_id: session.id, bloqueado_id: profile.id })
      .select('id').single();
    setActionBusy(false);
    if (err) { showNotice(err.message); return; }
    setBlockRowId(row ? String((row as { id: string }).id) : 'created');
  };

  const sendGift = async (type: string, message: string, imageUrl: string) => {
    if (!profile || giftSending) return;
    if (isBlockedByThem) {
      showNotice('No puedes interactuar porque este usuario te ha bloqueado.');
      return;
    }
    const selectedGift = giftItem(type);
    if (selectedGift.vip && !viewerVip) {
      showNotice('Este regalo es exclusivo para usuarios VIP. Activa tu membresía para enviarlo.');
      return;
    }
    setGiftSending(true);
    setGiftDialogError('');
    try {
      if (!session.token) {
        setGiftDialogError('Cierra sesión y vuelve a entrar para activar los regalos seguros.');
        return;
      }
      const { data, error: giftError } = await supabase.rpc('enviar_regalo', {
        p_session_token: session.token,
        p_receptor_alias: profile.username,
        p_tipo_regalo: type,
        p_mensaje: censorProfanity(replaceEmojiCommands(normalizeSingleLine(message).trim())) || null,
        p_imagen_url: imageUrl || null,
      });
      if (giftError) throw giftError;
      const result = data as { ok?: boolean; code?: string; id?: string | number; limit?: number } | null;
      if (!result?.ok) {
        if (result?.code === 'DAILY_LIMIT') {
          setGiftLimitReached(true);
          setGiftDialogError('');
        } else {
          setGiftDialogError(result?.code === 'RECIPIENT_NOT_FOUND'
            ? 'No encontramos al receptor de este regalo.'
            : 'No se pudo enviar el regalo.');
        }
        return;
      }

      setGifts(current => current + 1);
      setGiftDialogError('');
      setGiftDialogOpen(false);
      showNotice(`Regalo de ${giftLabel(type)} enviado.`);
    } catch (cause) {
      setGiftDialogError(extractError(cause));
    } finally {
      setGiftSending(false);
    }
  };

  const isProfileOnline = profile ? onlineIds.has(String(profile.id)) : false;

  const totalPages = Math.ceil(totalComments / PAGE_SIZE);
  const showPagination = commentPhase === 'paged' && totalComments > PAGE_SIZE;

  return <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    {confirmNode}
    {!profile && error && <StateMsg error={error} onRetry={load} />}
    {!profile && loading && <ProfileSkeleton />}
    {profile && <div className="grid min-w-0 gap-6 lg:grid-cols-[.8fr_1.2fr]">
      {/* Left column */}
         <section className="min-w-0 space-y-4">
          <div className={`panel scanline overflow-hidden ${profileIsVip(profile) ? 'vip-profile-card' : ''}`}>
             <div className="profile-cover relative h-32 overflow-hidden sm:h-44">
              {profile.banner_url && profile.banner_url !== DEFAULT_BANNER_MARKER
                ? <img src={profile.banner_url} alt={`Banner de ${profile.username}`} className="h-full w-full object-cover" />
                : <DefaultBanner />}
             <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10" />
              {isSelf && <div className="absolute right-3 top-3 flex gap-2">
                <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/15 bg-black/45 px-3 text-[11px] font-semibold text-white backdrop-blur-sm transition-colors hover:border-white/35 hover:bg-black/65 disabled:cursor-wait disabled:opacity-60" onClick={() => bannerInputRef.current?.click()} disabled={mediaUploading === 'banner'}>{mediaUploading === 'banner' ? <Spinner /> : <Upload size={13} />} <span className="hidden sm:inline">Cambiar banner</span><span className="sm:hidden">Banner</span></button>
                {profile.banner_url && <button type="button" className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/15 bg-black/45 px-3 text-[11px] font-semibold text-white backdrop-blur-sm transition-colors hover:border-destructive/60 hover:bg-destructive/35 disabled:cursor-wait disabled:opacity-60" onClick={() => void removeBanner()} disabled={mediaUploading === 'banner'}><Trash2 size={13} /><span className="hidden sm:inline">Eliminar banner</span><span className="sm:hidden">Eliminar</span></button>}
              </div>}
             <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => onMediaInput(event, 'banner')} />
           </div>
           <div className="-mt-12 px-4 pb-5 sm:-mt-14 sm:px-6 sm:pb-6">
             <div className="relative w-fit">
                <Avatar username={profile.username} size="lg" online={isProfileOnline} imageUrl={profile.avatar_url || DEFAULT_AVATAR_URL} shape="circle" photoHref={profile.avatar_foto_id ? `/foto/${profile.avatar_foto_id}` : undefined} />
             </div>
            <div className="mt-4 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {/* Username + bandera de país */}
                <h2 className="flex flex-wrap items-center gap-2 font-display text-xl font-bold">
                  {isProfileOnline && (
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 align-middle">
                      <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" />
                      <span className="font-mono-app text-[9px] font-medium uppercase tracking-widest text-emerald-400">En línea</span>
                    </span>
                  )}
                  <span className={profileIsVip(profile) ? 'vip-alias' : ''}>{profile.username}</span>
                  {profileIsVip(profile) && <VipBadge />}
                  {profile.pais && profile.pais !== 'OTHER' && (
                    <img
                      src={`https://flagcdn.com/24x18/${profile.pais.toLowerCase()}.png`}
                      alt={COUNTRIES.find(c => c.code === profile.pais)?.name ?? profile.pais ?? ''}
                      title={COUNTRIES.find(c => c.code === profile.pais)?.name ?? ''}
                      className="h-4 w-auto rounded-[2px] shrink-0 object-cover"
                      loading="lazy"
                    />
                  )}
                  {profile.pais === 'OTHER' && <Globe size={15} className="text-muted-foreground shrink-0" />}
                </h2>
                {/* Visibilidad — solo cuando está offline */}
                {!isProfileOnline && (
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <span className={`h-1 w-1 shrink-0 rounded-full ${profile.es_publico ? 'bg-accent/50' : 'bg-muted-foreground/40'}`} />
                    <span className="font-mono-app text-[9px] uppercase tracking-wider text-muted-foreground/55">
                      {profile.es_publico ? 'perfil público' : 'perfil privado'}
                    </span>
                  </div>
                )}
                {/* Badges de identidad — flex-wrap para que nunca se corten */}
                {(profile.fecha_nacimiento || (profile.genero && profile.genero !== 'No definido') || (profile.mostrar_estado_civil && profile.estado_civil && profile.estado_civil !== 'No definido')) && (
                  <div className="identity-badges mt-3 grid grid-cols-3 gap-1.5">
                    {profile.fecha_nacimiento && (() => {
                      const zodiac = calcularZodiacal(profile.fecha_nacimiento!);
                      const age = calcularEdad(profile.fecha_nacimiento!);
                      return (
                        <span className="identity-badge" title={zodiac.signo}>
                          {zodiac.icono} {age} años
                        </span>
                      );
                    })()}
                    {profile.genero && profile.genero !== 'No definido' && (
                      <span className="identity-badge" title={profile.genero}>
                        {GENERO_ICON[profile.genero] ?? '⬡'} {profile.genero}
                      </span>
                    )}
                    {profile.mostrar_estado_civil && profile.estado_civil && profile.estado_civil !== 'No definido' && (
                      <span className="identity-badge" title={profile.estado_civil}>
                        {ESTADO_CIVIL_ICON[profile.estado_civil] ?? '—'} {profile.estado_civil}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
             <div className={`${socialGridClass} mt-6 grid gap-2`}>
              <div className="panel-subtle p-3"><Eye size={15} className="mb-2 text-accent" /><div className="font-display text-xl font-bold">{visits}</div><div className="text-[10px] text-muted-foreground">visitas</div></div>
                {canViewGiftHistory ? (
                  <Link
                    href={isSelf ? '/regalos' : `/profile/${profile.username}/regalos`}
                    aria-label="Abrir regalos recibidos"
                    className="panel-subtle block min-w-0 p-3 text-left transition-colors hover:border-yellow-300/35"
                  >
                    <Gift size={15} className="mb-2 text-secondary" />
                    <div className="font-display text-xl font-bold">{gifts}</div>
                    <div className="text-[10px] text-muted-foreground">regalos recibidos</div>
                  </Link>
                ) : (
                  <div className="panel-subtle block min-w-0 cursor-not-allowed p-3 text-left opacity-75">
                    <Gift size={15} className="mb-2 text-secondary" />
                    <div className="font-display text-xl font-bold">{gifts}</div>
                    <div className="text-[10px] text-muted-foreground">regalos recibidos</div>
                  </div>
                )}
               {canViewFriendsCard ? <Link href={`/profile/${profile.username}/amigos`} className="panel-subtle p-3 hover:border-primary/50 transition-colors block">
                <Users size={15} className="mb-2 text-primary" /><div className="font-display text-xl font-bold">{friendCount}</div><div className="text-[10px] text-muted-foreground">amigos</div>
               </Link> : <button type="button" disabled aria-label="Lista de amigos privada" className="panel-subtle block min-w-0 cursor-not-allowed p-3 text-left opacity-75">
                <Users size={15} className="mb-2 text-primary" /><div className="font-display text-xl font-bold">{friendCount}</div><div className="text-[10px] text-muted-foreground">amigos</div>
               </button>}
            </div>
            {!isSelf && (
               <div className="profile-action-stack mt-5 flex flex-col gap-2">
                   {canViewSocialCards && <Button
                   className="w-full vip-action-button"
                   variant="outline"
                   onClick={() => setLocation(`/regalar/${profile.id}`)}
                   disabled={isBlockedByThem}
                 >
                   <Gift size={15} /> Enviar regalo
                  </Button>}
                {/* Acción principal — ocupa todo el ancho */}
                {inviteStatus === 'none' && (
                  <Button className="w-full" onClick={sendInvite} disabled={actionBusy}>
                    <UserRoundPlus size={15} /> {actionBusy ? <Spinner /> : 'Conectar'}
                   </Button>
                )}
                {inviteStatus === 'pending' && inviteDirection === 'outgoing' && (
                  <Button className="w-full" variant="outline" onClick={cancelInvite} disabled={actionBusy}>
                    <X size={15} /> Cancelar invitación
                  </Button>
                )}
                {inviteStatus === 'pending' && inviteDirection === 'incoming' && (
                  <div className="flex gap-2">
                    <Button className="flex-1" onClick={() => void respondToIncomingInvite('aceptada')} disabled={actionBusy}><Check size={15} /> Aceptar</Button>
                    <Button className="flex-1" variant="outline" onClick={() => void respondToIncomingInvite('rechazada')} disabled={actionBusy}><X size={15} /> Rechazar</Button>
                  </div>
                )}
                 {inviteStatus === 'accepted' && (
                   <Button className="w-full" onClick={() => setLocation(`/chat/nuevo/${profile.id}`)}>
                    <MessageCircle size={15} /> Enviar mensaje
                  </Button>
                )}
                {/* Acciones secundarias — apiladas en móvil, en fila en pantallas amplias */}
                <div className="flex flex-col gap-2 sm:flex-row">
                  {inviteStatus === 'accepted' && (
                    <Button className="w-full sm:flex-1" variant="danger" onClick={() => void removeFriend()} disabled={actionBusy}>
                      <UserMinus size={15} /> Eliminar amigo
                    </Button>
                  )}
                  <Button
                    className="w-full sm:flex-1"
                    variant="danger"
                    onClick={toggleBlock}
                    disabled={actionBusy}
                  >
                    {blockRowId === null
                      ? <><Ban size={15} /> Bloquear</>
                      : <><ShieldOff size={15} /> Desbloquear</>}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Tarjeta de Estado Personal — borde violeta + gradiente */}
         {!isSelf && profile.estado_personal && (
          <div className="relative overflow-hidden rounded-2xl border border-primary/40 bg-primary/[.07] p-5 shadow-sm">
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[.11] via-transparent to-transparent" />
            <div className="absolute left-0 top-0 h-full w-[3px] rounded-l-2xl bg-gradient-to-b from-primary/80 to-primary/20" />
            <div className="relative pl-2">
              <div className="mb-2.5 flex items-center gap-2">
                <Sparkles size={13} className="text-primary shrink-0" />
                <span className="font-mono-app text-[.68rem] font-medium uppercase tracking-[.16em] text-primary">Estado personal</span>
              </div>
              <p className="break-words [overflow-wrap:anywhere] text-sm font-medium leading-relaxed text-foreground">{sanitizeSingleLineForDisplay(profile.estado_personal)}</p>
            </div>
          </div>
        )}

         {canViewWall ? <section className="panel min-w-0 p-5">
           <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
             <div className="min-w-0">
               <div className="eyebrow mb-2">Fotos</div>
               <h3 className="font-display text-lg font-bold">Galería</h3>
               <p className="mt-1 text-xs leading-5 text-muted-foreground">Tus últimas fotos, sin deformarlas y listas para explorar.</p>
             </div>
              <div className="flex shrink-0 items-center gap-2">
                {isSelf && <div className="flex flex-col items-end gap-2"><Button type="button" variant="outline" className="text-xs" onClick={() => setGalleryUploadChoiceOpen((value) => !value)} disabled={mediaUploading === 'gallery'}>{mediaUploading === 'gallery' ? <Spinner /> : <><Upload size={13} /> Añadir</>}</Button>{galleryUploadChoiceOpen && <div className="w-48 rounded-xl border border-border bg-card p-2 shadow-xl"><p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Subir como</p><button type="button" className="media-menu-item" onClick={() => chooseGalleryUpload('public')}><Eye size={14} /> Pública</button><button type="button" className="media-menu-item" onClick={() => chooseGalleryUpload('private')}><LockKeyhole size={14} /> Privada</button></div>}</div>}
                {galleryPhotos.length > 0 && <Link href={`/profile/${profile.username}/galeria`} className="text-xs font-semibold text-primary hover:text-accent">Ver galería completa <ChevronRight size={13} className="inline" /></Link>}
              </div>
           </div>
           <input ref={galleryInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(event) => onMediaInput(event, 'gallery')} />
           {galleryError && <div className="mb-4 break-words rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs leading-5 text-accent">{galleryError}</div>}
            {!galleryLoading && !galleryPhotos.length && <div className="panel-subtle px-4 py-8 text-center"><ImageIcon size={22} className="mx-auto mb-2 text-primary/60" /><p className="text-xs text-muted-foreground">{isSelf ? 'Añade hasta las fotos que quieras para construir tu galería.' : 'Este perfil todavía no tiene fotos públicas.'}</p>{isSelf && <Button type="button" variant="outline" className="mt-4 text-xs" onClick={() => galleryInputRef.current?.click()} disabled={mediaUploading === 'gallery'}><Upload size={13} /> Subir primera foto</Button>}</div>}
            {galleryPhotos.length > 0 && <div className="grid grid-cols-4 gap-1.5 sm:gap-2">{galleryPhotos.slice(0, 4).map((photo) => <Link key={photo.id} href={`/foto/${photo.id}`} className={`media-gallery-tile group relative min-w-0 overflow-hidden rounded-lg border bg-black/20 ${photo.visibilidad === 'private' ? 'border-yellow-300/50' : 'border-border'}`}><img src={photo.url} alt={`Foto de ${profile.username}`} className={`aspect-square w-full object-cover ${photo.visibilidad === 'private' ? 'opacity-75' : ''}`} loading="lazy" /><span className="absolute bottom-1 left-1 hidden rounded-full bg-black/65 px-1.5 py-0.5 text-[9px] font-semibold text-white sm:inline-flex">{photo.visibilidad === 'private' ? <><LockKeyhole size={9} className="mr-1 inline" />Privada</> : 'Pública'}</span></Link>)}</div>}
          </section> : <section className="panel min-w-0 p-5">
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <div className="grid h-12 w-12 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary"><LockKeyhole size={22} /></div>
              <h3 className="font-display text-lg font-bold">Galería y muro privados</h3>
              <p className="max-w-sm text-xs leading-5 text-muted-foreground">Conecta con {profile.username} para ver sus fotos y comentarios. Las estadísticas y los regalos siguen disponibles.</p>
              {!isSelf && inviteStatus === 'none' && <Button onClick={sendInvite} disabled={actionBusy}><UserRoundPlus size={15} /> {actionBusy ? <Spinner /> : 'Enviar invitación'}</Button>}
              {!isSelf && inviteStatus === 'pending' && <span className="text-xs font-semibold text-accent">{inviteDirection === 'incoming' ? 'Ya tienes una invitación pendiente de este usuario.' : 'Invitación pendiente.'}</span>}
            </div>
          </section>}

        {/* Rastros en tu red — solo en mi propio perfil */}
        {isSelf && <Link href="/visitantes" className="panel block p-5 transition-colors hover:border-primary/45">
          <div className="eyebrow mb-3">Visitas recientes</div>
          <div className="mb-4 flex items-center justify-between gap-3">
            <h3 className="font-display text-base font-bold">Quién ha mirado tu perfil</h3>
            <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
          </div>
          {recentVisitors.length > 0
            ? <div className="flex -space-x-2">
              {recentVisitors.slice(0, 5).map((visitor) => <span key={visitor.id} title="Visitante reciente" className="rounded-full border-2 border-card">
                <Avatar username={visitor.username} size="sm" imageUrl={visitor.avatarUrl} />
              </span>)}
            </div>
            : <div className="panel-subtle px-4 py-6 text-center text-xs text-muted-foreground">Todavía no hay visitas recientes.</div>}
        </Link>}
      </section>

      {/* Right column — wall */}
       {canViewWall && <section className="mt-4 min-w-0">
        <div className="mb-6 flex items-end justify-between">
          <div><div className="eyebrow mb-2">Muro</div><h2 className="font-display text-2xl font-bold">Comentarios</h2></div>
          <span className="font-mono-app text-[10px] text-muted-foreground">{totalComments} entradas</span>
        </div>

        {/* Wall locked — not a friend of private profile */}
        {!canViewWall && <div className="mb-6 flex items-center gap-4 rounded-xl border border-primary/25 bg-primary/[.06] p-5">
          <div className="rounded-lg bg-primary/10 p-3 text-primary"><LockKeyhole size={19} /></div>
          <div><div className="font-display font-bold">Perfil privado.</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Agrega a esta persona para interactuar.</p></div>
        </div>}

        {/* Anti-spam lock */}
        {canViewWall && !isBlockedByThem && isSpamLocked && (
          <div className="mb-5 rounded-xl border border-accent/25 bg-accent/[.05] p-4 text-sm text-accent">
            Espera a que alguien más comente para seguir la conversación
          </div>
        )}

        {notice && <div className="mb-5 rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs text-accent">{notice}</div>}

        {canViewWall && <>
          <StateMsg empty={!loading && !comments.length} />
          <div className="space-y-4">
            {comments.map((item) => (
              <article className="border-b border-border/60 pb-4 last:border-0 last:pb-0" key={item.id}>
                <div className="flex gap-2">
                  <div className={item.authorVip ? 'vip-avatar-ring' : 'shrink-0'}><Avatar username={item.authorUsername} size="sm" imageUrl={item.authorAvatarUrl} /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Link href={`/profile/${item.authorUsername}`} className="text-sm font-bold hover:text-primary">{item.authorUsername}</Link>
                      {item.authorVip && <VipBadge compact />}
                      <span className="font-mono-app text-[10px] text-muted-foreground">{relativeDate(item.fecha)}</span>
                      {(item.authorId === session.id || isSelf) && (
                        <button type="button" aria-label="Eliminar comentario" className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => void deleteComment(item.id)}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                     <p className="mt-2 break-words text-sm leading-6 text-foreground/80">{renderCustomEmojiText(sanitizeSingleLineForDisplay(item.content))}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>

          {/* Paginación */}
          {commentPhase === 'initial' && totalComments > PAGE_INITIAL && (
            <button className="mt-5 w-full rounded-lg border border-border bg-white/[.025] py-2.5 text-xs font-semibold text-muted-foreground hover:border-primary/50 hover:text-foreground transition-colors" onClick={() => void handleShowMore()}>
              Mostrar más comentarios ({totalComments - PAGE_INITIAL} restantes)
            </button>
          )}
          {showPagination && (
            <div className="mt-5 flex items-center justify-between gap-2">
              <Button variant="outline" onClick={() => void handlePrevPage()} disabled={commentPage === 0} className="gap-1 px-3 py-1.5 text-xs"><ChevronLeft size={14} /> Anterior</Button>
              <span className="font-mono-app text-[10px] text-muted-foreground">{commentPage + 1} / {totalPages}</span>
              <Button variant="outline" onClick={() => void handleNextPage()} disabled={commentPage >= totalPages - 1} className="gap-1 px-3 py-1.5 text-xs">Siguiente <ChevronRight size={14} /></Button>
            </div>
          )}
          {/* Borrar todos mis comentarios — visible al expandir paginación */}
          {commentPhase === 'paged' && comments.some((c) => c.authorId === session.id) && (
            <button className="mt-4 w-full rounded-lg border border-destructive/25 bg-destructive/[.05] py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 transition-colors" onClick={() => void deleteAllMyComments()}>
              <Trash2 size={13} className="inline mr-1.5" />Borrar todos mis comentarios aquí
            </button>
          )}

          {/* Comment form at bottom */}
          {canComment && (
            <form onSubmit={sendComment} className="media-comments-form min-w-0 space-y-2">
              <input ref={commentInputRef} className="field w-full" value={comment} onChange={(e) => setComment(e.target.value.slice(0, 256))} maxLength={256} placeholder={isSelf ? 'Escribe en tu muro…' : 'Escribe un comentario…'} />
              <EmojiPicker value={comment} onChange={setComment} inputRef={commentInputRef} maxLength={256}>
                    <Button type="submit" className="w-full min-w-0 sm:w-auto sm:px-4" disabled={submitting || !comment.trim()}>{submitting ? <Spinner /> : <><Send size={15} /> Enviar comentario</>}</Button>
              </EmojiPicker>
            </form>
          )}
        </>}
       </section>}
     </div>}

  </div>;
}

// ─── Amigos / Invitaciones ────────────────────────────────────────────────────

type InvitationView = {
  id: string;
  fromUsername: string;
  fromId: string;
  fromAvatarUrl?: string | null;
  estado: Friendship['estado'];
  direction: 'incoming' | 'outgoing';
};
type FriendView = { id: string; userId: string; username: string; avatarUrl?: string | null };
type FriendsClientSnapshot = {
  invitations: InvitationView[];
  friends: FriendView[];
  blockedByThemIds: string[];
  myBlockMap: Array<[string, string]>;
};

function SearchResults({ search, sessionId }: { search: string; sessionId: string }) {
  const [results, setResults] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!search) return;
    let cancelled = false;
    setLoading(true);
    supabase.from('perfiles_dk').select('id, username, es_publico, fecha_creacion, avatar_url, es_vip, is_vip')
      .ilike('username', `%${search}%`)
      .eq('es_publico', true)
      .neq('id', sessionId)
      .limit(15)
      .then(async ({ data, error }) => {
        if (error?.code !== '42703') {
          if (!cancelled) { setResults((data ?? []) as Profile[]); setLoading(false); }
          return;
        }
        const fallback = await supabase.from('perfiles_dk')
          .select('id, username, es_publico, fecha_creacion, avatar_url, es_vip')
          .ilike('username', `%${search}%`)
          .eq('es_publico', true)
          .neq('id', sessionId)
          .limit(15);
        if (!cancelled) { setResults((fallback.data ?? []) as Profile[]); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [search, sessionId]);

  return <div className="mt-3 space-y-2">
    {results.map((p) => <Link href={`/profile/${p.username}`} className="panel-subtle flex items-center gap-3 p-3 transition-colors hover:border-primary/50" key={p.id}>
       <Avatar username={p.username} size="sm" imageUrl={p.avatar_url} />
       <div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2 text-sm font-bold"><span className="truncate">{p.username}</span>{profileIsVip(p) && <VipBadge compact />}</div><div className="font-mono-app text-[9px] text-muted-foreground">{p.es_publico ? 'perfil público' : 'perfil privado'}</div></div>
      <ChevronRight size={15} className="text-muted-foreground" />
    </Link>)}
    {!loading && results.length === 0 && search.length > 0 && <p className="p-3 text-xs text-muted-foreground">No encontramos a esa persona.</p>}
  </div>;
}

function FriendsPage({ session, onlineUsers }: { session: Session; onlineUsers: OnlineUser[] }) {
  const cachedFriends = readClientCache<FriendsClientSnapshot>(`friends:${session.id}`);
  const [invitations, setInvitations] = useState<InvitationView[]>(() => cachedFriends?.invitations ?? []);
  const [friends, setFriends] = useState<FriendView[]>(() => cachedFriends?.friends ?? []);
  const [blockedByThemIds, setBlockedByThemIds] = useState<Set<string>>(() => new Set(cachedFriends?.blockedByThemIds ?? []));
  // Map de userId -> blockRowId para los que el USUARIO ACTUAL ha bloqueado
  const [myBlockMap, setMyBlockMap] = useState<Map<string, string>>(() => new Map(cachedFriends?.myBlockMap ?? []));
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(() => !cachedFriends);
  const [error, setError] = useState('');
  const [notice, showNotice] = useTransientNotice();
  const [responding, setResponding] = useState<string | null>(null);

  const onlineIds = new Set(onlineUsers.map(u => u.id));

  const load = useCallback(async () => {
    if (!cachedFriends) setLoading(true);
    setError('');
    try {
      const [
        { data: rows, error: relationError },
        { data: profileRows, error: profileError },
        { data: blockRows, error: blockError },
      ] = await Promise.all([
        supabase.from('amigos').select('id, usuario_id, amigo_id, estado, fecha')
          .or(`usuario_id.eq.${session.id},amigo_id.eq.${session.id}`),
        supabase.from('perfiles_dk').select('id, username, avatar_url').neq('id', session.id),
        supabase.from('bloqueos').select('id, bloqueador_id, bloqueado_id')
          .or(`bloqueador_id.eq.${session.id},bloqueado_id.eq.${session.id}`),
      ]);
      if (relationError) throw relationError;
      if (profileError) throw profileError;
      if (blockError) throw blockError;

      const profileMap = new Map<string, { username: string; avatarUrl?: string | null }>();
      (profileRows ?? []).forEach((p: { id: string; username: string; avatar_url?: string | null }) => profileMap.set(String(p.id), { username: p.username, avatarUrl: p.avatar_url }));
      const relations = (rows ?? []) as Friendship[];
      const uniqueFriends = new Map<string, FriendView>();
      relations.filter((r) => r.estado === 'aceptada').forEach((r) => {
        const otherId = String(r.usuario_id) === String(session.id) ? String(r.amigo_id) : String(r.usuario_id);
        const friendProfile = profileMap.get(otherId);
        if (!uniqueFriends.has(otherId)) uniqueFriends.set(otherId, { id: String(r.id), userId: otherId, username: friendProfile?.username ?? 'usuario', avatarUrl: friendProfile?.avatarUrl ?? null });
      });
      const nextFriends = [...uniqueFriends.values()];
      // Quién me bloqueó a mí
      const nextBlockedByThemIds = new Set(
        (blockRows ?? [])
          .filter((row: { id: string; bloqueador_id: string; bloqueado_id: string }) => String(row.bloqueado_id) === String(session.id))
          .map((row: { bloqueador_id: string }) => String(row.bloqueador_id)),
      );
      // A quién he bloqueado yo (userId -> blockRowId)
      const blockMap = new Map<string, string>();
      (blockRows ?? [])
        .filter((row: { id: string; bloqueador_id: string }) => String(row.bloqueador_id) === String(session.id))
        .forEach((row: { id: string; bloqueado_id: string }) => blockMap.set(String(row.bloqueado_id), String(row.id)));
      const nextInvitations = relations.filter((r) => r.estado === 'pendiente').map((r) => {
        const incoming = String(r.amigo_id) === String(session.id);
        const otherId = incoming ? String(r.usuario_id) : String(r.amigo_id);
        const otherProfile = profileMap.get(otherId);
        return { id: String(r.id), fromId: otherId, fromUsername: otherProfile?.username ?? 'usuario', fromAvatarUrl: otherProfile?.avatarUrl ?? null, estado: r.estado, direction: (incoming ? 'incoming' : 'outgoing') as InvitationView['direction'] };
      });
      setFriends(nextFriends);
      setBlockedByThemIds(nextBlockedByThemIds);
      setMyBlockMap(blockMap);
      setInvitations(nextInvitations);
      writeClientCache<FriendsClientSnapshot>(`friends:${session.id}`, {
        friends: nextFriends,
        invitations: nextInvitations,
        blockedByThemIds: [...nextBlockedByThemIds],
        myBlockMap: [...blockMap.entries()],
      });
    } catch (e) { setError(extractError(e)); }
    finally { setLoading(false); }
  }, [session.id]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onFriendshipUpdate = () => void load();
    window.addEventListener('konekto:friendships-updated', onFriendshipUpdate);
    const channel = supabase.channel(`konekto:friends:${session.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'amigos',
      }, () => void load())
      .subscribe();
    return () => {
      window.removeEventListener('konekto:friendships-updated', onFriendshipUpdate);
      void supabase.removeChannel(channel);
    };
  }, [load, session.id]);

  const respond = async (invitation: InvitationView, estado: 'aceptada' | 'rechazada') => {
    if (invitation.direction !== 'incoming') return;
    setResponding(invitation.id);
    const { error: err } = await supabase.from('amigos').update({ estado }).eq('id', invitation.id);
    setResponding(null);
    if (err) { showNotice(err.message); return; }
    setInvitations((current) => current.filter((item) => item.id !== invitation.id));
    if (estado === 'aceptada') {
      setFriends((current) => current.some((friend) => friend.userId === invitation.fromId)
        ? current
        : [...current, { id: invitation.id, userId: invitation.fromId, username: invitation.fromUsername, avatarUrl: invitation.fromAvatarUrl }]);
      window.dispatchEvent(new Event('konekto:friendships-updated'));
      if (session.token) {
        const { data: autoMessage, error: autoMessageError } = await supabase.rpc('notificar_aceptacion_amistad_segura', {
          p_session_token: session.token,
          p_invitacion_id: invitation.id,
        });
        const autoMessageResult = autoMessage as { ok?: boolean } | null;
        showNotice(autoMessageError || !autoMessageResult?.ok
          ? `${invitation.fromUsername} ahora está en tus amigos, pero no se pudo enviar el aviso automático.`
          : `${invitation.fromUsername} ahora está en tus amigos.`);
      } else {
        showNotice(`${invitation.fromUsername} ahora está en tus amigos.`);
      }
    } else {
      window.dispatchEvent(new Event('konekto:friendships-updated'));
      showNotice('Invitación rechazada.');
    }
  };

  const cancelInvitation = async (invitation: InvitationView) => {
    setResponding(invitation.id);
    const { error: err } = await supabase.from('amigos').delete().eq('id', invitation.id);
    setResponding(null);
    if (err) { showNotice(err.message); return; }
    setInvitations((current) => current.filter((item) => item.id !== invitation.id));
    window.dispatchEvent(new Event('konekto:friendships-updated'));
    showNotice('Invitación cancelada.');
  };

  const deleteFriend = async (friend: FriendView) => {
    setResponding(friend.id);
    const { error: err } = await supabase.from('amigos').delete().eq('id', friend.id);
    setResponding(null);
    if (err) { showNotice(err.message); return; }
    setFriends((current) => current.filter((item) => item.id !== friend.id));
    window.dispatchEvent(new Event('konekto:friendships-updated'));
  };

  const blockFriend = async (friend: FriendView) => {
    setResponding(friend.id);
    const { data: blockRow, error: blockError } = await supabase.from('bloqueos')
      .insert({ bloqueador_id: session.id, bloqueado_id: friend.userId })
      .select('id').single();
    setResponding(null);
    if (blockError) { showNotice(blockError.message); return; }
    // Bloquear es unidireccional: la amistad se conserva intacta.
    if (blockRow) {
      setMyBlockMap((prev) => new Map(prev).set(friend.userId, String((blockRow as { id: string }).id)));
    }
  };

  const unblockFriend = async (friend: FriendView) => {
    const blockRowId = myBlockMap.get(friend.userId);
    if (!blockRowId) return;
    setResponding(friend.id);
    const { error: err } = await supabase.from('bloqueos').delete().eq('id', blockRowId);
    setResponding(null);
    if (err) { showNotice(err.message); return; }
    setMyBlockMap((prev) => { const next = new Map(prev); next.delete(friend.userId); return next; });
  };

  const pending = invitations.filter((i) => i.estado === 'pendiente');

  return <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    <PageHeader eyebrow="Comunidad" title="Amigos." description="Encuentra personas, acepta invitaciones y mantén el contacto." />
    {notice && <div className="mb-5 rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs text-accent">{notice}</div>}
    <div className="space-y-6">
      <section id="friends" className="panel p-6">
        <div className="mb-6 flex items-center justify-between">
          <div><div className="eyebrow mb-2">Mis amigos</div><h2 className="font-display text-xl font-bold">Amigos agregados</h2></div>
          <div className="rounded-lg bg-primary/10 px-3 py-2 font-mono-app text-xs text-primary">{friends.length}</div>
        </div>
        <StateMsg loading={loading} error={error || null} empty={!loading && !error && !friends.length} onRetry={load} />
        {!loading && friends.length > 0 && <div className="space-y-3">
          {friends.map((friend) => {
            const isOnline = onlineIds.has(friend.userId);
            return <div className="panel-subtle flex items-center gap-3 p-3" key={friend.id}>
              <Avatar username={friend.username} online={isOnline} imageUrl={friend.avatarUrl} />
              <Link href={`/profile/${friend.username}`} className="min-w-0 flex-1">
                <div className="break-words text-sm font-bold leading-snug hover:text-primary">{friend.username}</div>
                <div className={`mt-0.5 text-[10px] ${isOnline ? 'text-emerald-400' : 'text-muted-foreground'}`}>{isOnline ? 'En línea' : 'Desconectado'}</div>
              </Link>
              <div className="flex shrink-0 items-center">
                <Link href={`/chat/nuevo/${friend.userId}`} aria-label={`Enviar mensaje a ${friend.username}`} title="Enviar mensaje" className="icon-action shrink-0"><MessageCircle size={15} /></Link>
              </div>
            </div>;
          })}
        </div>}
      </section>
      <section id="invitations" className="panel p-6">
        <div className="mb-6 flex items-center justify-between">
          <div><div className="eyebrow mb-2">Solicitudes</div><h2 className="font-display text-xl font-bold">Invitaciones pendientes</h2></div>
          <div className="rounded-lg bg-accent/10 px-3 py-2 font-mono-app text-xs text-accent">{pending.length}</div>
        </div>
        <StateMsg loading={loading} error={error || null} empty={!loading && !error && !pending.length} onRetry={load} />
        {!loading && pending.length > 0 && <div className="space-y-3">
          {pending.map((item) => <div className="panel-subtle p-4" key={item.id}>
            <div className="flex items-center gap-3"><Avatar username={item.fromUsername} imageUrl={item.fromAvatarUrl} /><div className="min-w-0 flex-1"><Link href={`/profile/${item.fromUsername}`} className="font-bold hover:text-primary">{item.fromUsername}</Link><p className="mt-1 text-xs text-muted-foreground">{item.direction === 'incoming' ? 'quiere conectar contigo' : 'invitación enviada'}</p></div></div>
             <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              {item.direction === 'incoming'
                 ? <><Button className="w-full flex-1" onClick={() => void respond(item, 'aceptada')} disabled={responding === item.id}><Check size={15} /> Aceptar</Button><Button className="w-full flex-1" variant="outline" onClick={() => void respond(item, 'rechazada')} disabled={responding === item.id}><X size={15} /> Rechazar</Button></>
                : <Button className="w-full" variant="outline" onClick={() => void cancelInvitation(item)} disabled={responding === item.id}><X size={15} /> Cancelar invitación</Button>}
            </div>
          </div>)}
        </div>}
      </section>
      <section id="explore" className="panel p-5">
        <div className="eyebrow mb-2">Buscar personas</div>
        <input className="field" aria-label="Buscar personas" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="encuentra tu próxima conexión" />
        {search.length > 0 && <SearchResults search={search} sessionId={session.id} />}
      </section>
    </div>
  </div>;
}

type InboxSnapshot = {
  messages: PrivateMessage[];
  senderAvatars: Array<[string, string | null]>;
};

type ChatSnapshot = {
  otherId: string;
  otherUsername: string;
  messages: PrivateMessage[];
  hasMore: boolean;
  totalMessages?: number;
};

type ChatPageSnapshot = {
  messages: PrivateMessage[];
  hasMore: boolean;
  totalMessages: number;
};

const CHAT_INITIAL_SIZE = 2;
const CHAT_PAGE_SIZE = 5;
const INBOX_PAGE_SIZE = 10;

function latestConversationMessages(messages: PrivateMessage[]) {
  return [...(Array.isArray(messages) ? messages : [])]
    .sort((a, b) => {
      const dateDiff = new Date(b.creado_en ?? 0).getTime() - new Date(a.creado_en ?? 0).getTime();
      return dateDiff || Number(b.id) - Number(a.id);
    });
}

function messageError(code?: string) {
  if (code === 'INVALID_SESSION') return 'Tu sesión segura expiró. Vuelve a entrar.';
  if (code === 'NOT_FRIEND') return 'Solo puedes enviar mensajes a amigos aceptados.';
  if (code === 'MESSAGE_NOT_FOUND') return 'Este chat ya no está disponible.';
  return 'No se pudo completar la operación.';
}

function InboxPage({ session }: { session: Session }) {
  const [location, setLocation] = useLocation();
  const inboxPath = location.split('?')[0] || '/bandeja';
  const currentPageParam = new URLSearchParams(location.split('?')[1]?.split('#')[0] ?? '').get('page');
  const requestedPage = Number.parseInt(currentPageParam ?? '1', 10);
  const currentPage = Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const cached = readClientCache<InboxSnapshot>(`inbox:v3:${session.id}`);
  const [messages, setMessages] = useState<PrivateMessage[]>(() => latestConversationMessages(cached?.messages ?? []));
  const [senderAvatars, setSenderAvatars] = useState<Map<string, string | null>>(() => new Map(cached?.senderAvatars ?? []));
  const messagesRef = useRef(messages);
  const senderAvatarsRef = useRef(senderAvatars);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, showNotice] = useTransientNotice();
  const [confirmNode, showConfirm] = useConfirmDialog();

  const persist = useCallback((nextMessages: PrivateMessage[], nextAvatars = senderAvatarsRef.current) => {
    writeClientCache<InboxSnapshot>(`inbox:v3:${session.id}`, {
      messages: nextMessages,
      senderAvatars: [...nextAvatars.entries()],
    });
  }, [session.id]);

  const load = useCallback(async () => {
    if (!session.token) {
      setError('Cierra sesión y vuelve a entrar para abrir tu bandeja segura.');
      return;
    }
    setError('');
    const { data, error: inboxError } = await supabase.rpc('obtener_bandeja_segura', { p_session_token: session.token });
    if (inboxError) {
      if (!messagesRef.current.length) setError(extractError(inboxError));
      return;
    }
    const result = data as { ok?: boolean; code?: string; messages?: PrivateMessage[] } | null;
    if (!result?.ok) {
      if (!messagesRef.current.length) setError(messageError(result?.code));
      return;
    }
    const nextMessages = latestConversationMessages(Array.isArray(result.messages) ? result.messages : []);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setSelectedIds(new Set());
    setIsSelecting(false);
    setLoading(false);
    persist(nextMessages);
    window.dispatchEvent(new Event('konekto:inbox-updated'));

    const senderIds = [...new Set(nextMessages.map((item) => item.contacto_alias ?? item.remitente_alias).filter(Boolean))];
    if (senderIds.length) {
      const { data: senderProfiles } = await supabase.from('perfiles_dk').select('username, avatar_url').in('username', senderIds);
      const nextAvatars = new Map((senderProfiles ?? []).map((item: { username: string; avatar_url?: string | null }) => [item.username, item.avatar_url ?? null] as [string, string | null]));
      senderAvatarsRef.current = nextAvatars;
      setSenderAvatars(nextAvatars);
      persist(nextMessages, nextAvatars);
    }
  }, [persist, session.token]);

  useEffect(() => { void load(); }, [load]);

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const deleteSelected = async () => {
    if (!session.token || !selectedIds.size || busy) return;
    const ok = await showConfirm({ title: '¿Eliminar conversaciones seleccionadas?', message: 'Se borrarán completas las conversaciones que selecciones.', confirmLabel: 'Sí, eliminar', danger: true });
    if (!ok) return;
    setBusy(true);
    const deleteResults = await Promise.all([...selectedIds].map((selectedId) =>
      supabase.rpc('eliminar_chat_seguro', { p_session_token: session.token, p_mensaje_id: selectedId })
    ));
    setBusy(false);
    const failedDelete = deleteResults.find(({ data, error }) => {
      const result = data as { ok?: boolean } | null;
      return Boolean(error) || !result?.ok;
    });
    if (failedDelete) {
      const result = failedDelete.data as { code?: string } | null;
      showNotice(extractError(failedDelete.error) || messageError(result?.code));
      return;
    }
    const next = (Array.isArray(messages) ? messages : []).filter((message) => !selectedIds.has(String(message.id)));
    messagesRef.current = next;
    setMessages(next);
    setSelectedIds(new Set());
    setIsSelecting(false);
    persist(next);
    window.dispatchEvent(new Event('konekto:inbox-updated'));
    showNotice('Mensajes eliminados.');
  };

  const deleteAll = async () => {
    if (!session.token || !messages.length || busy) return;
     const ok = await showConfirm({ title: '¿Borrar toda la bandeja?', message: 'Esta acción eliminará todos los mensajes de tus conversaciones.', confirmLabel: 'Sí, borrar todo', danger: true });
    if (!ok) return;
    setBusy(true);
    const { data, error: deleteError } = await supabase.rpc('borrar_bandeja_segura', { p_session_token: session.token });
    setBusy(false);
    const result = data as { ok?: boolean; code?: string } | null;
    if (deleteError || !result?.ok) { showNotice(extractError(deleteError) || messageError(result?.code)); return; }
    setMessages([]);
    messagesRef.current = [];
    setSelectedIds(new Set());
    setIsSelecting(false);
    persist([]);
    window.dispatchEvent(new Event('konekto:inbox-updated'));
    showNotice('Bandeja vaciada.');
  };

  const totalPages = Math.max(1, Math.ceil(messages.length / INBOX_PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const pageStart = (safePage - 1) * INBOX_PAGE_SIZE;
  const visibleMessages = messages.slice(pageStart, pageStart + INBOX_PAGE_SIZE);
  const pageHref = (page: number) => page <= 1 ? inboxPath : `${inboxPath}?page=${page}`;

  useEffect(() => {
    if (currentPage > totalPages) setLocation(pageHref(totalPages), { replace: true });
  }, [currentPage, setLocation, totalPages]);

  const unreadCount = messages.reduce((total, message) => total + Number(message.mensajes_no_leidos ?? 0), 0);
  return <div className="mx-auto w-full min-w-0 max-w-4xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    {confirmNode}
    <PageHeader eyebrow="Mensajes" title="Bandeja de entrada." action={unreadCount > 0 ? <div className="panel-subtle flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><Mail size={14} className="text-accent" />{unreadCount} sin leer</div> : undefined} />
    {notice && <div className="mb-5 rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs text-accent" role="status">{notice}</div>}
    {error && <StateMsg error={error} onRetry={() => void load()} />}
    {!error && !loading && !messages.length && <div className="panel flex min-h-[300px] flex-col items-center justify-center px-6 text-center"><div className="mb-4 grid h-14 w-14 place-items-center rounded-2xl border border-primary/25 bg-primary/10 text-primary"><MessageCircle size={25} /></div><h2 className="font-display text-xl font-bold">Tu bandeja está en silencio.</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Cuando alguien te envíe un mensaje o regalo, aparecerá aquí.</p></div>}
    {(messages.length > 0 || loading) && <section className="min-w-0">
      {messages.length > 0 && <div className="space-y-2">
        {visibleMessages.map((message) => {
          const id = String(message.id);
          const contactAlias = message.contacto_alias ?? message.remitente_alias;
          const contactAvatar = message.contacto_avatar_url ?? senderAvatars.get(contactAlias);
          return <div key={id} className="flex min-w-0 flex-wrap items-center gap-3 border-b border-border/50 py-3 last:border-0 transition-colors hover:bg-white/[.02]">
             {isSelecting && <input type="checkbox" aria-label={`Seleccionar conversación con ${contactAlias}`} checked={selectedIds.has(id)} onChange={() => toggleSelected(id)} className="h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" />}
            <Avatar username={contactAlias} size="sm" imageUrl={contactAvatar} />
             <div className="flex min-w-0 flex-1 flex-col justify-center">
               <div className="flex min-w-0 items-center gap-2">
                  <Link href={`/profile/${contactAlias}`} className="min-w-0 truncate text-sm font-bold hover:text-primary">{contactAlias}</Link>
                 {message.direccion === 'recibido'
                   ? <span className="inline-flex shrink-0 items-center text-primary" title="Mensaje recibido" aria-label="Mensaje recibido"><Mail size={14} /></span>
                   : <span className="inline-flex shrink-0 items-center text-muted-foreground" title="Mensaje enviado" aria-label="Mensaje enviado"><Send size={14} /></span>}
                 {Number(message.mensajes_no_leidos ?? 0) > 0 && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 font-mono-app text-[10px] font-bold text-accent"><Mail size={11} />{message.mensajes_no_leidos}</span>}
               </div>
               <div className="mt-1 font-mono-app text-[10px] text-muted-foreground">{inboxRelativeDate(message.creado_en)}</div>
            </div>
            <Link href={`/chat/${id}`} className="button-lift mt-1 inline-flex min-h-9 w-full shrink-0 items-center justify-center gap-1.5 rounded-lg border border-primary/30 px-3 text-[11px] font-bold text-primary hover:border-primary/60 hover:bg-primary/10 sm:mt-0 sm:w-auto">Leer mensaje <ChevronRight size={13} /></Link>
          </div>;
        })}
      </div>}
      {totalPages > 1 && <nav className="mt-5 flex flex-wrap items-center justify-center gap-2 border-t border-border pt-4" aria-label="Paginación de la bandeja">
        {safePage > 1
          ? <Link href={pageHref(safePage - 1)} className="button-lift inline-flex min-h-9 items-center gap-1 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:border-primary/45 hover:text-primary"><ChevronLeft size={14} /> Anterior</Link>
          : <span className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border/50 px-3 text-xs font-semibold text-muted-foreground/40"><ChevronLeft size={14} /> Anterior</span>}
        {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => page === safePage
          ? <span key={page} aria-current="page" className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-primary/60 bg-primary/15 px-2 text-xs font-bold text-primary">{page}</span>
          : <Link key={page} href={pageHref(page)} aria-label={`Ir a la página ${page}`} className="button-lift inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-border px-2 text-xs font-semibold text-muted-foreground hover:border-primary/45 hover:text-primary">{page}</Link>)}
        {safePage < totalPages
          ? <Link href={pageHref(safePage + 1)} className="button-lift inline-flex min-h-9 items-center gap-1 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:border-primary/45 hover:text-primary">Siguiente <ChevronRight size={14} /></Link>
          : <span className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-border/50 px-3 text-xs font-semibold text-muted-foreground/40">Siguiente <ChevronRight size={14} /></span>}
       </nav>}
       <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border/70 bg-white/[.02] p-4 sm:flex-row sm:items-center sm:justify-between">
         <div>
           <div className="text-xs font-semibold text-foreground">Gestionar mensajes</div>
           <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Estas acciones están separadas de tus conversaciones para evitar confusiones.</p>
         </div>
         <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
           {!isSelecting && <Button variant="outline" className="w-full text-xs sm:w-auto" onClick={() => setIsSelecting(true)} disabled={!messages.length || busy}>Seleccionar mensajes</Button>}
           {isSelecting && <Button variant="outline" className="w-full text-xs sm:w-auto" onClick={() => void deleteSelected()} disabled={!selectedIds.size || busy}>Eliminar seleccionados</Button>}
           {isSelecting && <Button variant="ghost" className="w-full text-xs sm:w-auto" onClick={() => { setSelectedIds(new Set()); setIsSelecting(false); }} disabled={busy}>Cancelar</Button>}
           <Button variant="danger" className="w-full text-xs sm:w-auto" onClick={() => void deleteAll()} disabled={!messages.length || busy}>Borrar todos</Button>
         </div>
       </div>
    </section>}
  </div>;
}

function NewChatPage({ session }: { session: Session }) {
  const params = useParams<{ userId?: string }>();
  const [, setLocation] = useLocation();
  const [recipient, setRecipient] = useState<Profile | null>(null);
  const [message, setMessage] = useState('');
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!params.userId) return;
    let active = true;
    void profileById(params.userId).then(({ data, error: profileError }) => {
      if (!active) return;
      setRecipient(data);
      if (profileError || !data) setError('No encontramos a ese usuario.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [params.userId]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!session.token || !recipient || !message.trim() || sending) return;
    setSending(true);
    const { data, error: sendError } = await supabase.rpc('enviar_mensaje_seguro', {
      p_session_token: session.token,
      p_receptor_id: recipient.id,
      p_mensaje: censorProfanity(replaceEmojiCommands(normalizeSingleLine(message).trim())),
    });
    setSending(false);
    const result = data as { ok?: boolean; code?: string; message_id?: string | number } | null;
    if (sendError || !result?.ok || !result.message_id) {
      setError(extractError(sendError) || messageError(result?.code));
      return;
    }
    window.dispatchEvent(new Event('konekto:inbox-updated'));
    setLocation('/bandeja');
  };

  return <div className="mx-auto w-full min-w-0 max-w-3xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    <PageHeader eyebrow="Nueva conversación" title={recipient ? `Mensaje para ${recipient.username}.` : 'Nuevo mensaje.'} description="Escribe directamente en la página, sin abrir ventanas superpuestas." />
    {error && <StateMsg error={error} />}
    {!error && !loading && recipient && <section className="panel p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-3 border-b border-border pb-5"><Avatar username={recipient.username} size="md" imageUrl={recipient.avatar_url} /><div><div className="font-display text-lg font-bold">{recipient.username}</div><div className="text-xs text-muted-foreground">Conversación privada</div></div></div>
      <form onSubmit={send} className="flex flex-col gap-3"><textarea ref={messageInputRef} rows={3} className="field min-h-20 resize-none" value={message} onChange={(event) => setMessage(event.target.value.slice(0, 1000))} placeholder="Escribe tu mensaje..." autoFocus /><EmojiPicker value={message} onChange={setMessage} inputRef={messageInputRef} maxLength={1000}><Button type="submit" className="w-full sm:w-auto" disabled={!message.trim() || sending}>{sending ? <Spinner /> : <><Send size={15} /> Enviar mensaje</>}</Button></EmojiPicker></form>
    </section>}
  </div>;
}

function ChatPage({ session }: { session: Session }) {
  const params = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const messageId = params.id ?? '';
  const cached = readClientCache<ChatSnapshot>(`chat:v2:${messageId}`);
  const [otherId, setOtherId] = useState(() => cached?.otherId ?? '');
  const [otherUsername, setOtherUsername] = useState(() => cached?.otherUsername ?? '');
  const [messages, setMessages] = useState<PrivateMessage[]>(() => (cached?.messages ?? []).slice(-CHAT_INITIAL_SIZE));
  const messagesRef = useRef(messages);
  const [hasMore, setHasMore] = useState(() => cached?.hasMore ?? (cached?.messages?.length ?? 0) > CHAT_INITIAL_SIZE);
  const [totalMessages, setTotalMessages] = useState(() => cached?.totalMessages ?? cached?.messages?.length ?? 0);
  const [expanded, setExpanded] = useState(false);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageHistory, setPageHistory] = useState<ChatPageSnapshot[]>([]);
  const [loadingPage, setLoadingPage] = useState(false);
  const [message, setMessage] = useState('');
  const messageInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(() => !cached);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePhotos, setSharePhotos] = useState<GalleryPhoto[]>([]);
  const [shareLoading, setShareLoading] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<GalleryPhoto | null>(null);
  const [notice, showNotice] = useTransientNotice();
  const [confirmNode, showConfirm] = useConfirmDialog();

  const load = useCallback(async () => {
    if (!session.token || !messageId) return;
    const { data, error: chatError } = await supabase.rpc('obtener_chat_seguro', {
      p_session_token: session.token,
      p_mensaje_id: messageId,
      p_limite: CHAT_INITIAL_SIZE,
      p_antes_de: null,
    });
    if (chatError) { if (!messagesRef.current.length) setError(extractError(chatError)); return; }
    const result = data as { ok?: boolean; code?: string; other_id?: string; other_username?: string; messages?: PrivateMessage[]; total_count?: number; has_more?: boolean } | null;
    if (!result?.ok) { if (!messagesRef.current.length) setError(messageError(result?.code)); return; }
    const nextMessages = Array.isArray(result.messages) ? result.messages : [];
    messagesRef.current = nextMessages;
    setOtherId(String(result.other_id ?? ''));
    setOtherUsername(result.other_username ?? '');
    setMessages(nextMessages);
    setHasMore(Boolean(result.has_more));
    setTotalMessages(Number(result.total_count ?? nextMessages.length));
    setExpanded(false);
    setPageIndex(0);
    setPageHistory([]);
    setLoading(false);
    writeClientCache<ChatSnapshot>(`chat:v2:${messageId}`, { otherId: String(result.other_id ?? ''), otherUsername: result.other_username ?? '', messages: nextMessages, hasMore: Boolean(result.has_more), totalMessages: Number(result.total_count ?? nextMessages.length) });
    window.dispatchEvent(new Event('konekto:inbox-updated'));
  }, [messageId, session.token]);

  useEffect(() => { void load(); }, [load]);

  const requestChatPage = async (limit: number, beforeId: string | number | null) => {
    if (!session.token || !messageId) return null;
    const { data, error: olderError } = await supabase.rpc('obtener_chat_seguro', {
      p_session_token: session.token,
      p_mensaje_id: messageId,
      p_limite: limit,
      p_antes_de: beforeId,
    });
    const result = data as { ok?: boolean; code?: string; messages?: PrivateMessage[]; total_count?: number; has_more?: boolean } | null;
    if (olderError || !result?.ok) {
      showNotice(extractError(olderError) || messageError(result?.code));
      return null;
    }
    return {
      messages: Array.isArray(result.messages) ? result.messages : [],
      hasMore: Boolean(result.has_more),
      totalMessages: Number(result.total_count ?? result.messages?.length ?? 0),
    };
  };

  const showMore = async () => {
    if (loadingPage || !hasMore) return;
    setLoadingPage(true);
    const nextPage = await requestChatPage(CHAT_PAGE_SIZE, null);
    setLoadingPage(false);
    if (!nextPage) return;
    messagesRef.current = nextPage.messages;
    setMessages(nextPage.messages);
    setHasMore(nextPage.hasMore);
    setTotalMessages(nextPage.totalMessages);
    setExpanded(true);
    setPageIndex(0);
    setPageHistory([nextPage]);
    writeClientCache<ChatSnapshot>(`chat:v2:${messageId}`, { otherId, otherUsername, messages: nextPage.messages, hasMore: nextPage.hasMore, totalMessages: nextPage.totalMessages });
  };

  const loadNextPage = async () => {
    if (!expanded || loadingPage || !hasMore) return;
    const oldestId = messagesRef.current[0]?.id;
    if (!oldestId) return;
    setLoadingPage(true);
    const nextPage = await requestChatPage(CHAT_PAGE_SIZE, oldestId);
    setLoadingPage(false);
    if (!nextPage) return;
    messagesRef.current = nextPage.messages;
    setMessages(nextPage.messages);
    setHasMore(nextPage.hasMore);
    setTotalMessages(nextPage.totalMessages);
    setPageHistory((current) => [...current, nextPage]);
    setPageIndex((current) => current + 1);
    writeClientCache<ChatSnapshot>(`chat:v2:${messageId}`, { otherId, otherUsername, messages: nextPage.messages, hasMore: nextPage.hasMore, totalMessages: nextPage.totalMessages });
  };

  const loadPreviousPage = () => {
    if (pageIndex <= 0 || loadingPage) return;
    const previousPage = pageHistory[pageIndex - 1];
    if (!previousPage) return;
    messagesRef.current = previousPage.messages;
    setMessages(previousPage.messages);
    setHasMore(previousPage.hasMore);
    setPageIndex((current) => current - 1);
  };

  const sendReply = async (event: FormEvent) => {
    event.preventDefault();
    if (!session.token || !otherId || (!message.trim() && !pendingPhoto) || sending) return;
    const content = censorProfanity(replaceEmojiCommands(normalizeSingleLine(message).trim()));
    setSending(true);
    if (pendingPhoto) {
      const { data, error: shareError } = await supabase.rpc('compartir_foto_segura', {
        p_session_token: session.token,
        p_receptor_id: otherId,
        p_foto_id: pendingPhoto.id,
          p_mensaje: content || null,
      });
      const result = data as { ok?: boolean; code?: string; message_id?: string | number } | null;
      if (shareError || !result?.ok || !result.message_id) {
        setSending(false);
        showNotice(extractError(shareError) || messageError(result?.code));
        return;
      }
    } else {
      const { data, error: sendError } = await supabase.rpc('enviar_mensaje_seguro', {
        p_session_token: session.token,
        p_receptor_id: otherId,
        p_mensaje: content,
      });
      const result = data as { ok?: boolean; code?: string; message_id?: string | number } | null;
      if (sendError || !result?.ok || !result.message_id) {
        setSending(false);
        showNotice(extractError(sendError) || messageError(result?.code));
        return;
      }
    }
    setSending(false);
    setMessage('');
    setPendingPhoto(null);
    setLocation('/bandeja');
  };

  const deleteChat = async () => {
    if (!session.token || !messageId || deleting) return;
    const ok = await showConfirm({ title: '¿Eliminar este chat?', message: 'Se borrará toda la conversación de tu bandeja.', confirmLabel: 'Sí, eliminar chat', danger: true });
    if (!ok) return;
    setDeleting(true);
    const { data, error: deleteError } = await supabase.rpc('eliminar_chat_seguro', { p_session_token: session.token, p_mensaje_id: messageId });
    setDeleting(false);
    const result = data as { ok?: boolean; code?: string } | null;
    if (deleteError || !result?.ok) { showNotice(extractError(deleteError) || messageError(result?.code)); return; }
    setLocation('/bandeja');
  };

  const openShare = async () => {
    setShareOpen((current) => !current);
    if (shareOpen || sharePhotos.length || !otherId || !session.token) return;
    setShareLoading(true);
    const { data, error: photosError } = await supabase.rpc('obtener_galeria_segura', { p_session_token: session.token, p_perfil_id: session.id, p_offset: 0, p_limit: 24 });
    setShareLoading(false);
    const result = data as { ok?: boolean; photos?: GalleryPhoto[] } | null;
    if (photosError || !result?.ok) { showNotice(extractError(photosError) || 'No se pudo abrir tu galería.'); return; }
    setSharePhotos(result.photos ?? []);
  };

  const choosePhoto = (photo: GalleryPhoto) => {
    setPendingPhoto(photo);
    setShareOpen(false);
  };

  return <div className="mx-auto w-full min-w-0 max-w-4xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    {confirmNode}
    <div className="mb-6 flex items-center gap-3"><Link href="/bandeja" className="icon-action" aria-label="Volver a la bandeja"><ArrowLeft size={17} /></Link><div className="min-w-0 flex-1"><div className="eyebrow mb-1">Conversación privada</div><h1 className="truncate font-display text-2xl font-bold">{otherUsername || 'Chat'}</h1></div></div>
    {notice && <div className="mb-4 rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs text-accent" role="status">{notice}</div>}
    {error && <StateMsg error={error} onRetry={() => void load()} />}
    {!error && <section className="panel min-w-0 p-4 sm:p-6">
      {totalMessages > 0 && <div className="mb-4 text-center font-mono-app text-[10px] text-muted-foreground">Mostrando {Math.min(messages.length, totalMessages)} de {totalMessages} mensajes guardados</div>}
      {messages.length > 0 && <div className="space-y-3">
        {messages.map((item) => {
          const isMine = item.remitente_alias === session.username;
          const isGift = Boolean(item.tipo_regalo) || item.tipo_mensaje === 'regalo';
          return <article key={String(item.id)} className="flex w-full min-w-0">
             <div className={`w-full min-w-0 overflow-hidden rounded-2xl border p-3 ${isGift ? 'border-yellow-300/45 bg-[linear-gradient(145deg,rgba(126,88,13,.42),rgba(55,39,13,.56))] text-yellow-50 shadow-lg shadow-yellow-950/20' : isMine ? 'border-primary/30 bg-primary/[.10]' : 'border-border bg-white/[.03]'}`}>
               <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground"><span className={`font-bold ${isMine ? 'text-primary' : 'text-foreground'}`}>{isMine ? 'Tú' : item.remitente_alias}</span><span>{relativeDate(item.creado_en)}</span>{isGift && <Gift size={12} className="text-yellow-200" />}</div>
             {item.tipo_mensaje === 'foto' && item.foto_id && (
               item.foto_visibilidad === 'private' && !isMine
                 ? <div className="chat-photo-preview mb-2 overflow-hidden rounded-xl border border-yellow-300/20 bg-yellow-300/[.04]" aria-label="Foto privada compartida en esta conversación">
                     <img src={item.imagen_url ?? ''} alt="Foto privada compartida contigo" className="max-h-52 max-w-full object-contain" />
                     <div className="flex items-center gap-1.5 border-t border-yellow-300/15 px-3 py-2 text-[10px] text-yellow-100/60"><LockKeyhole size={12} /> Foto privada · solo visible en esta conversación</div>
                   </div>
                 : <Link href={`/foto/${item.foto_id}`} className="chat-photo-preview mb-2 block overflow-hidden rounded-xl border border-white/10"><img src={item.imagen_url ?? ''} alt="Foto compartida" className="max-h-52 max-w-full object-contain" /></Link>
             )}
              {isGift && item.tipo_regalo && <GiftPreview item={giftItem(item.tipo_regalo)} imageUrl={item.imagen_url} className="chat-gift-preview mb-2 h-28 w-40 max-w-full rounded-xl" />}
              {item.mensaje && <p className="break-words text-sm leading-6">{renderCustomEmojiText(sanitizeSingleLineForDisplay(item.mensaje), 'message')}</p>}
            </div>
          </article>;
        })}
      </div>}
      {!loading && !messages.length && <div className="py-12 text-center text-sm text-muted-foreground">Esta conversación todavía no tiene mensajes.</div>}
      {(hasMore || pageIndex > 0) && <div className="mt-5 flex flex-wrap items-center justify-center gap-2 border-t border-border pt-4">
        {pageIndex > 0 && <Button type="button" variant="outline" className="text-xs" onClick={loadPreviousPage} disabled={loadingPage}><ChevronLeft size={14} /> Anterior</Button>}
        {!expanded && hasMore && <Button type="button" variant="outline" className="text-xs" onClick={() => void showMore()} disabled={loadingPage}>{loadingPage ? <Spinner /> : <>Ver más <ChevronRight size={14} /></>}</Button>}
        {expanded && hasMore && <Button type="button" variant="outline" className="text-xs" onClick={() => void loadNextPage()} disabled={loadingPage}>{loadingPage ? <Spinner /> : <>Siguiente <ChevronRight size={14} /></>}</Button>}
      </div>}
      {pendingPhoto && <div className="mt-4 flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/[.06] p-2"><img src={pendingPhoto.url} alt="Foto lista para compartir" className="h-16 w-16 rounded-lg object-cover" /><div className="min-w-0 flex-1"><div className="text-xs font-bold">Foto lista para compartir</div><div className="truncate text-[10px] text-muted-foreground">Puedes añadir un mensaje antes de enviarla.</div></div><button type="button" className="icon-action" aria-label="Quitar foto del mensaje" onClick={() => setPendingPhoto(null)}><X size={15} /></button></div>}
      <form onSubmit={sendReply} className="mt-5 border-t border-border pt-4"><input ref={messageInputRef} className="field min-w-0 w-full" value={message} onChange={(event) => setMessage(event.target.value.slice(0, 1000))} placeholder={pendingPhoto ? 'Añade un mensaje opcional...' : 'Escribe una respuesta...'} /><EmojiPicker value={message} onChange={setMessage} inputRef={messageInputRef} maxLength={1000} className="mt-3"><Button type="submit" disabled={(!message.trim() && !pendingPhoto) || sending}>{sending ? <Spinner /> : <Send size={15} />}</Button></EmojiPicker></form>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4"><Button variant="outline" className="text-xs" onClick={() => void openShare()}><ImageIcon size={14} /> Compartir foto</Button><Button variant="danger" className="text-xs" onClick={() => void deleteChat()} disabled={deleting}><Trash2 size={14} /> Eliminar mensaje</Button></div>
      {shareOpen && <div className="mt-4 rounded-xl border border-primary/20 bg-primary/[.05] p-3"><div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold">Elige una foto de tu galería</span><button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShareOpen(false)}>Cerrar</button></div>{shareLoading && <p className="text-xs text-muted-foreground">Tu galería aparecerá aquí.</p>}{!shareLoading && !sharePhotos.length && <p className="text-xs text-muted-foreground">Todavía no tienes fotos para compartir.</p>}{!shareLoading && sharePhotos.length > 0 && <div className="grid grid-cols-4 gap-2">{sharePhotos.map((photo) => <button type="button" key={photo.id} className="overflow-hidden rounded-lg border border-border hover:border-primary" onClick={() => choosePhoto(photo)}><img src={photo.url} alt="Compartir foto" className="aspect-square w-full object-cover" /></button>)}</div>}</div>}
    </section>}
  </div>;
}

// ─── Usuarios en línea ────────────────────────────────────────────────────────

function OnlinePage({ session, onlineUsers }: { session: Session; onlineUsers: OnlineUser[] }) {
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(onlineUsers.length / PAGE_SIZE));
  const pageUsers = onlineUsers.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  useEffect(() => {
    if (page >= totalPages) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  return <div className="mx-auto w-full min-w-0 max-w-5xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    <PageHeader
      eyebrow="Presencia en tiempo real"
      title="Usuarios en línea."
      description="Personas conectadas ahora mismo a Konekto."
      action={<div className="panel-subtle flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {onlineUsers.length} conectados</div>}
    />
    {onlineUsers.length === 0
      ? <div className="panel flex min-h-[300px] flex-col items-center justify-center px-6 text-center">
        <Wifi size={28} className="mb-4 text-muted-foreground" />
        <h2 className="font-display text-xl font-bold">No hay otros usuarios conectados.</h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Cuando alguien se conecte, aparecerá aquí automáticamente.</p>
      </div>
      : <section className="panel p-6">
        <div className="mb-6 flex items-center justify-between">
          <div><div className="eyebrow mb-2">Red activa</div><h2 className="font-display text-xl font-bold">Personas conectadas</h2></div>
          <div className="rounded-lg bg-emerald-400/10 px-3 py-2 font-mono-app text-xs text-emerald-400">{onlineUsers.length}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {pageUsers.map((user) => <Link key={user.id} href={`/profile/${user.username}`} className="panel-subtle flex items-center gap-3 p-4 transition-colors hover:border-primary/50">
            <Avatar username={user.username} size="md" online imageUrl={user.avatarUrl} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{user.username}</div>
              <div className="mt-1 text-[10px] text-emerald-400">{user.id === session.id ? 'Tu sesión · En línea' : 'En línea'}</div>
            </div>
            <ChevronRight size={15} className="text-muted-foreground" />
          </Link>)}
        </div>
        {totalPages > 1 && <div className="mt-6 flex items-center justify-between gap-2">
          <Button variant="outline" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0} className="gap-1 text-xs"><ChevronLeft size={14} /> Anterior</Button>
          <span className="font-mono-app text-[10px] text-muted-foreground">{page + 1} / {totalPages}</span>
          <Button variant="outline" onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))} disabled={page >= totalPages - 1} className="gap-1 text-xs">Siguiente <ChevronRight size={14} /></Button>
        </div>}
      </section>}
  </div>;
}

type VisitorPageRow = {
  id: string;
  username: string;
  avatarUrl?: string | null;
  visitedAt: string | null;
};

function VisitorsPage({ session }: { session: Session }) {
  const PAGE_SIZE = 10;
  const [page, setPage] = useState(0);
  const [visitors, setVisitors] = useState<VisitorPageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async () => {
    if (!session.id) return;
    setError('');
    setLoading(true);
    const from = page * PAGE_SIZE;
    const { data: visitorRows, count, error: visitorsError } = await supabase
      .from('visitas_perfil')
      .select('visitante_id, visitado_en', { count: 'exact' })
      .eq('perfil_id', session.id)
      .neq('visitante_id', session.id)
      .order('visitado_en', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (visitorsError) {
      setError(extractError(visitorsError));
      setLoading(false);
      return;
    }
    const rows = (visitorRows ?? []) as { visitante_id: string; visitado_en: string | null }[];
    const ids = rows.map((row) => String(row.visitante_id));
    const { data: profiles, error: profilesError } = ids.length
      ? await supabase.from('perfiles_dk').select('id, username, avatar_url').in('id', ids)
      : { data: [], error: null };
    if (profilesError) {
      setError(extractError(profilesError));
      setLoading(false);
      return;
    }
    const profileMap = new Map<string, { username: string; avatarUrl?: string | null }>();
    (profiles ?? []).forEach((profile: { id: string; username: string; avatar_url?: string | null }) => {
      profileMap.set(String(profile.id), { username: profile.username, avatarUrl: profile.avatar_url ?? null });
    });
    setVisitors(rows.map((row) => ({
      id: String(row.visitante_id),
      username: profileMap.get(String(row.visitante_id))?.username ?? 'usuario',
      avatarUrl: profileMap.get(String(row.visitante_id))?.avatarUrl ?? null,
      visitedAt: row.visitado_en,
    })).filter((visitor) => visitor.username !== 'usuario'));
    setTotal(count ?? 0);
    setLoading(false);
  }, [page, session.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (page >= totalPages) setPage(Math.max(0, totalPages - 1));
  }, [page, totalPages]);

  return <div className="mx-auto w-full min-w-0 max-w-4xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    <PageHeader eyebrow="Visitas recientes" title="Quién ha mirado tu perfil." description="Consulta tus visitantes, empezando por la visita más reciente." action={<Link href={`/profile/${session.username}`} className="text-xs font-semibold text-muted-foreground hover:text-foreground">← volver al perfil</Link>} />
    <StateMsg error={error || null} onRetry={() => void load()} />
    {!error && !loading && !visitors.length && <div className="panel flex min-h-[260px] items-center justify-center px-6 text-center text-sm text-muted-foreground">Todavía no hay visitantes registrados.</div>}
    {!error && visitors.length > 0 && <section className="panel p-4 sm:p-6">
      <div className="space-y-2">
        {visitors.map((visitor) => <Link key={visitor.id} href={`/profile/${visitor.username}`} className="panel-subtle flex items-center gap-3 p-3 transition-colors hover:border-primary/50">
          <Avatar username={visitor.username} size="md" imageUrl={visitor.avatarUrl} />
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{visitor.username}</div><div className="mt-1 text-[10px] text-muted-foreground">{relativeDate(visitor.visitedAt)}</div></div>
          <ChevronRight size={15} className="shrink-0 text-muted-foreground" />
        </Link>)}
      </div>
      {totalPages > 1 && <div className="mt-6 flex items-center justify-between gap-2">
        <Button variant="outline" className="text-xs" onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}><ChevronLeft size={14} /> Anterior</Button>
        <span className="font-mono-app text-[10px] text-muted-foreground">{page + 1} / {totalPages}</span>
        <Button variant="outline" className="text-xs" onClick={() => setPage((current) => Math.min(totalPages - 1, current + 1))} disabled={page >= totalPages - 1}>Siguiente <ChevronRight size={14} /></Button>
      </div>}
    </section>}
  </div>;
}

// ─── Amigos de un perfil ──────────────────────────────────────────────────────

function ProfileFriendsPage({ session, onlineUsers }: { session: Session; onlineUsers: OnlineUser[] }) {
  const params = useParams<{ username?: string }>();
  const targetUsername = params.username === 'me' ? session.username : (params.username ?? session.username);
  const isSelf = targetUsername === session.username;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [friends, setFriends] = useState<FriendView[]>([]);
  const [privateList, setPrivateList] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const onlineIds = new Set(onlineUsers.map((user) => user.id));

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setPrivateList(false);
    try {
      const { data: target, error: profileError } = await profileByUsername(targetUsername);
      if (profileError || !target) throw new Error('Perfil no encontrado.');
      setProfile(target);

       let confirmedFriend = isSelf;
       if (!isSelf) {
         const { data: viewerRelation, error: viewerRelationError } = await supabase.from('amigos')
           .select('id')
           .or(`and(usuario_id.eq.${session.id},amigo_id.eq.${target.id}),and(usuario_id.eq.${target.id},amigo_id.eq.${session.id})`)
           .eq('estado', 'aceptada')
           .limit(1);
         if (viewerRelationError) throw viewerRelationError;
         confirmedFriend = Boolean(viewerRelation?.length);
       }

       if (!isSelf && !Boolean(target.es_publico) && !confirmedFriend) {
         setPrivateList(true);
         return;
       }
       if (!isSelf && Boolean(target.ocultar_amigos) && !confirmedFriend) {
        setPrivateList(true);
        return;
      }

      const { data: relationRows, error: relationError } = await supabase.from('amigos')
        .select('id, usuario_id, amigo_id, estado')
        .or(`usuario_id.eq.${target.id},amigo_id.eq.${target.id}`)
        .eq('estado', 'aceptada');
      if (relationError) throw relationError;

      const friendIds = [...new Set((relationRows ?? []).map((row: Friendship) =>
        String(row.usuario_id) === String(target.id) ? String(row.amigo_id) : String(row.usuario_id),
      ))];
      if (friendIds.length === 0) {
        setFriends([]);
        return;
      }
       const { data: friendProfiles, error: friendsError } = await supabase.from('perfiles_dk')
         .select('id, username, avatar_url')
        .in('id', friendIds);
      if (friendsError) throw friendsError;
       const names = new Map<string, { username: string; avatarUrl?: string | null }>();
       (friendProfiles ?? []).forEach((friend: { id: string; username: string; avatar_url?: string | null }) => names.set(String(friend.id), { username: friend.username, avatarUrl: friend.avatar_url }));
      setFriends(friendIds
         .map((id) => ({ id, userId: id, username: names.get(id)?.username ?? 'usuario', avatarUrl: names.get(id)?.avatarUrl ?? null }))
         .filter((friend) => friend.username !== 'usuario'));
    } catch (e) {
      setError(extractError(e));
    } finally {
      setLoading(false);
    }
   }, [isSelf, session.id, targetUsername]);

  useEffect(() => { void load(); }, [load]);

  return <div className="mx-auto w-full min-w-0 max-w-5xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    <PageHeader
      eyebrow="Lista de amigos"
      title={profile ? `Amigos de ${profile.username}.` : 'Amigos.'}
      description="Los amigos que este perfil comparte."
      action={<Link href={`/profile/${targetUsername}`} className="text-xs font-semibold text-muted-foreground hover:text-foreground">← volver al perfil</Link>}
    />
    <StateMsg loading={loading} error={error || null} onRetry={load} />
    {!loading && !error && privateList && <div className="panel flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
      <LockKeyhole size={27} className="mb-4 text-primary" />
      <h2 className="font-display text-xl font-bold">Lista de amigos privada</h2>
      <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Este perfil decidió ocultar su lista de amigos.</p>
    </div>}
    {!loading && !error && !privateList && <section className="panel p-6">
      <div className="mb-6 flex items-center justify-between">
        <div><div className="eyebrow mb-2">Mis amigos</div><h2 className="font-display text-xl font-bold">Amigos agregados</h2></div>
        <div className="rounded-lg bg-primary/10 px-3 py-2 font-mono-app text-xs text-primary">{friends.length}</div>
      </div>
      <StateMsg empty={!friends.length} />
      {friends.length > 0 && <div className="grid gap-3 sm:grid-cols-2">
        {friends.map((friend) => {
          const online = onlineIds.has(friend.userId);
          return <Link key={friend.id} href={`/profile/${friend.username}`} className="panel-subtle flex items-center gap-3 p-3 transition-colors hover:border-primary/50">
             <Avatar username={friend.username} online={online} imageUrl={friend.avatarUrl} />
            <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{friend.username}</div><div className={`mt-1 text-[10px] ${online ? 'text-emerald-400' : 'text-muted-foreground'}`}>{online ? 'En línea' : 'Desconectado'}</div></div>
            <ChevronRight size={15} className="text-muted-foreground" />
          </Link>;
        })}
      </div>}
    </section>}
  </div>;
}

// ─── Privacidad ───────────────────────────────────────────────────────────────

function PrivacyPage({ session }: { session: Session }) {
  // ── Visibilidad ──
  const [isPublic, setIsPublic] = useState<boolean | null>(null);
  const [hideFriends, setHideFriends] = useState(false);
  const [blocks, setBlocks] = useState<Array<{ id: string; blockedId: string; blockedUsername: string; blockedAvatarUrl?: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [notice, showNotice] = useTransientNotice();
  const [updating, setUpdating] = useState(false);
  const [unblocking, setUnblocking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: profile }, { data: blockRows, error: blocksError }] = await Promise.all([
      profileById(session.id),
      supabase.from('bloqueos').select('id, bloqueado_id, fecha').eq('bloqueador_id', session.id).order('fecha', { ascending: false }),
    ]);
    if (profile) {
      setIsPublic(Boolean(profile.es_publico));
      setHideFriends(Boolean(profile.ocultar_amigos ?? false));
    }
    if (blocksError) { showNotice(blocksError.message); setLoading(false); return; }

    const uniqueRows = new Map<string, { id: string; bloqueado_id: string }>();
    (blockRows ?? []).forEach((row: { id: string; bloqueado_id: string }) => {
      const blockedId = String(row.bloqueado_id);
      if (!uniqueRows.has(blockedId)) uniqueRows.set(blockedId, { id: String(row.id), bloqueado_id: blockedId });
    });
    const normalizedRows = [...uniqueRows.values()];
    const blockedIds = normalizedRows.map((row) => row.bloqueado_id);
    const idMap = new Map<string, { username: string; avatarUrl?: string | null }>();
    if (blockedIds.length > 0) {
      const { data: profiles } = await supabase.from('perfiles_dk').select('id, username, avatar_url').in('id', blockedIds);
      (profiles ?? []).forEach((p: { id: string; username: string; avatar_url?: string | null }) => idMap.set(String(p.id), { username: p.username, avatarUrl: p.avatar_url }));
    }
    setBlocks(normalizedRows.map((row) => ({ id: row.id, blockedId: row.bloqueado_id, blockedUsername: idMap.get(row.bloqueado_id)?.username ?? 'usuario', blockedAvatarUrl: idMap.get(row.bloqueado_id)?.avatarUrl ?? null })));
    setLoading(false);
  }, [session.id]);

  useEffect(() => { void load(); }, [load]);

  const changePrivacy = async (value: boolean) => {
    setUpdating(true);
    const { error } = await supabase.from('perfiles_dk').update({ es_publico: value }).eq('id', session.id);
    setUpdating(false);
    if (error) { showNotice(error.message); return; }
    setIsPublic(value);
    showNotice('Preferencia actualizada.');
  };

  const changeFriendsVisibility = async (value: boolean) => {
    setUpdating(true);
    const { error } = await supabase.from('perfiles_dk').update({ ocultar_amigos: value }).eq('id', session.id);
    setUpdating(false);
    if (error) {
      showNotice(error.code === '42703' ? 'Ejecuta la migración SQL de privacidad para activar esta opción.' : error.message);
      return;
    }
    setHideFriends(value);
    showNotice(value ? 'Tu lista de amigos quedó oculta.' : 'Tu lista de amigos vuelve a ser visible.');
  };

  const unblock = async (block: { id: string; blockedId: string }) => {
    setUnblocking(block.id);
    const { error } = await supabase.from('bloqueos').delete()
      .eq('bloqueador_id', session.id).eq('bloqueado_id', block.blockedId);
    setUnblocking(null);
    if (error) { showNotice(error.message); return; }
    setBlocks((current) => current.filter((item) => item.blockedId !== block.blockedId));
  };

  const currentPublic = isPublic ?? true;

  return <div className="mx-auto w-full min-w-0 max-w-5xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    <PageHeader eyebrow="Privacidad" title="Privacidad." description="Elige quién puede ver tu perfil y tu lista de amigos." />
    {notice && <div className="mb-5 rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs text-accent">{notice}</div>}
    <StateMsg loading={loading} />
    {!loading && <div className="space-y-6">

      {/* Fila 1: Visibilidad + Bloqueados */}
      <div className="grid gap-6 lg:grid-cols-[1.2fr_.8fr]">
        <section className="panel p-6">
          <div className="mb-7 flex items-start gap-4"><div className="rounded-xl bg-primary/10 p-3 text-primary"><Settings2 size={20} /></div><div><h2 className="font-display text-xl font-bold">Visibilidad del perfil</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Decide si otras personas pueden encontrarte y dejar comentarios.</p></div></div>
          <div className="space-y-3">
            <button disabled={updating} onClick={() => changePrivacy(true)} className={`flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-colors ${currentPublic ? 'border-primary/70 bg-primary/10' : 'border-border bg-white/[.02] hover:bg-white/[.04]'}`}>
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/10 text-accent"><Compass size={17} /></div>
              <div className="flex-1"><div className="text-sm font-bold">Perfil público</div><div className="mt-1 text-xs text-muted-foreground">Tu nombre de usuario puede aparecer en búsquedas y recibir comentarios.</div></div>
              {currentPublic && <Check size={17} className="text-primary shrink-0" />}
            </button>
            <button disabled={updating} onClick={() => changePrivacy(false)} className={`flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-colors ${!currentPublic ? 'border-primary/70 bg-primary/10' : 'border-border bg-white/[.02] hover:bg-white/[.04]'}`}>
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-secondary/10 text-secondary"><LockKeyhole size={17} /></div>
              <div className="flex-1"><div className="text-sm font-bold">Perfil privado</div><div className="mt-1 text-xs text-muted-foreground">Tu perfil queda fuera de la búsqueda pública.</div></div>
              {!currentPublic && <Check size={17} className="text-primary shrink-0" />}
            </button>
          </div>
          <div className="mt-7 flex gap-3 rounded-lg border border-border bg-white/[.02] p-4 text-xs leading-5 text-muted-foreground"><ShieldCheck size={16} className="shrink-0 text-accent" />Usa un nombre de usuario y una contraseña para entrar a tu cuenta.</div>
          {/* Toggle ocultar amigos */}
          <div className="mt-5 overflow-hidden rounded-xl border border-border bg-white/[.02]">
            <button type="button" role="switch" aria-checked={hideFriends} aria-label="Ocultar mi lista de amigos" disabled={updating} onClick={() => void changeFriendsVisibility(!hideFriends)} className="flex w-full min-w-0 items-center gap-3 p-4 text-left transition-colors hover:bg-white/[.03] disabled:opacity-60">
              <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${hideFriends ? 'bg-primary/10 text-primary' : 'bg-white/[.05] text-muted-foreground'}`}>{hideFriends ? <EyeOff size={17} /> : <Eye size={17} />}</div>
              <div className="min-w-0 flex-1"><div className="text-sm font-bold leading-snug">Ocultar mi lista de amigos al público</div><p className="mt-1 text-xs leading-5 text-muted-foreground">Solo tú podrás consultar el detalle de tus amigos.</p></div>
              <div className={`relative ml-3 h-6 w-11 shrink-0 rounded-full border transition-colors ${hideFriends ? 'border-primary bg-primary/70' : 'border-border bg-white/[.08]'}`} aria-hidden="true">
                <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform ${hideFriends ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
              </div>
            </button>
          </div>
        </section>
        <section id="blocked" className="panel p-6">
          <div className="mb-6 flex items-center justify-between"><div><div className="eyebrow mb-2">Lista de bloqueo</div><h2 className="font-display text-xl font-bold">Personas bloqueadas</h2></div><Ban size={18} className="text-destructive" /></div>
          <StateMsg empty={!blocks.length} />
          {blocks.length > 0 && <div className="space-y-2">{blocks.map((item) => <div className="panel-subtle flex items-center gap-3 p-3" key={item.blockedId}><Avatar username={item.blockedUsername} size="sm" imageUrl={item.blockedAvatarUrl} /><Link href={`/profile/${item.blockedUsername}`} className="min-w-0 flex-1 text-sm font-bold hover:text-primary">{item.blockedUsername}</Link><button type="button" className="icon-action text-destructive hover:bg-destructive/10" aria-label={`Desbloquear a ${item.blockedUsername}`} title="Desbloquear" disabled={unblocking === item.id} onClick={() => void unblock(item)}>{unblocking === item.id ? <Spinner /> : <Ban size={14} />}</button></div>)}</div>}
        </section>
      </div>

    </div>}
  </div>;
}

// ─── Configuración ────────────────────────────────────────────────────────────

function SettingsPage({ session }: { session: Session }) {
  const [loading, setLoading] = useState(true);
  const [notice, showNotice] = useTransientNotice();
  const [saving, setSaving] = useState(false);
  // Datos biográficos — bloqueados una vez registrados
  const [fechaNacimiento, setFechaNacimiento] = useState('');
  const [pais, setPais] = useState('');
  const [genero, setGenero] = useState('No definido');
  const [fechaLocked, setFechaLocked] = useState(false);
  const [paisLocked, setPaisLocked] = useState(false);
  const [generoLocked, setGeneroLocked] = useState(false);
  // Datos siempre editables
  const [estadoCivil, setEstadoCivil] = useState('No definido');
  const [mostrarEstadoCivil, setMostrarEstadoCivil] = useState(false);
  // Blindaje y estatus VIP
  const [pinRecuperacion, setPinRecuperacion] = useState('');
  const [preguntaSecreta, setPreguntaSecreta] = useState('');
  const [respuestaSecreta, setRespuestaSecreta] = useState('');
  const [modoFantasma, setModoFantasma] = useState(false);
  const [isVip, setIsVip] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: profile } = await profileById(session.id);
    if (profile) {
      const fn = profile.fecha_nacimiento ?? '';
      const p  = profile.pais ?? '';
      const g  = profile.genero ?? 'No definido';
      setFechaNacimiento(fn);
      setPais(p);
      setGenero(g);
      setFechaLocked(Boolean(fn));
      setPaisLocked(Boolean(p));
      setGeneroLocked(g !== 'No definido' && Boolean(g));
      setEstadoCivil(profile.estado_civil ?? 'No definido');
      setMostrarEstadoCivil(Boolean(profile.mostrar_estado_civil ?? false));
      setModoFantasma(Boolean(profile.modo_fantasma ?? false));
      setIsVip(profileIsVip(profile));
    }
    if (session.token) {
      const { data: secureConfig } = await supabase.rpc('obtener_configuracion_segura', { p_session_token: session.token });
      const secure = secureConfig as { ok?: boolean; pin_recuperacion?: string | null; pregunta_secreta?: string | null; respuesta_secreta?: string | null; modo_fantasma?: boolean; is_vip?: boolean } | null;
      if (secure?.ok) {
        setPinRecuperacion(secure.pin_recuperacion ?? '');
        setPreguntaSecreta(secure.pregunta_secreta ?? '');
        setRespuestaSecreta(secure.respuesta_secreta ?? '');
        setModoFantasma(Boolean(secure.modo_fantasma));
        setIsVip(Boolean(secure.is_vip));
      }
    }
    setLoading(false);
  }, [session.id, session.token]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (pinRecuperacion && !/^\d{4}$/.test(pinRecuperacion)) {
      showNotice('El PIN debe tener exactamente 4 dígitos.');
      return;
    }
    if (!session.token) {
      showNotice('Cierra sesión y vuelve a entrar para guardar los datos de seguridad.');
      return;
    }
    setSaving(true);
    const payload: Record<string, unknown> = {
      estado_civil: estadoCivil || null,
      mostrar_estado_civil: mostrarEstadoCivil,
    };
    // Solo guardar campos bloqueables si aún no habían sido registrados
    if (!fechaLocked && fechaNacimiento) payload.fecha_nacimiento = fechaNacimiento;
    if (!paisLocked && pais)             payload.pais = pais;
    if (!generoLocked && genero && genero !== 'No definido') payload.genero = genero;

    const { error } = await supabase.from('perfiles_dk').update(payload).eq('id', session.id);
    if (error) {
      setSaving(false);
      if (error.code === '42703') showNotice('Ejecuta la migración mega de Fase 3 en Supabase primero.');
      else if (error.code === '23514') showNotice('Fecha inválida. Debes tener al menos 18 años.');
      else showNotice(error.message);
      return;
    }
    const { data: secureResult, error: secureError } = await supabase.rpc('guardar_configuracion_segura', {
      p_session_token: session.token,
      p_pin: pinRecuperacion || null,
      p_pregunta: preguntaSecreta.trim() || null,
      p_respuesta: respuestaSecreta.trim() || null,
      p_modo_fantasma: modoFantasma,
    });
    setSaving(false);
    if (secureError) { showNotice(extractError(secureError)); return; }
    const secure = secureResult as { ok?: boolean; code?: string; modo_fantasma?: boolean } | null;
    if (!secure?.ok) { showNotice(secure?.code === 'INVALID_PIN' ? 'El PIN debe tener exactamente 4 dígitos.' : 'No se pudo guardar la configuración de seguridad.'); return; }
    setModoFantasma(Boolean(secure.modo_fantasma));
    // Bloquear los campos recién guardados por primera vez
    if (!fechaLocked && fechaNacimiento) setFechaLocked(true);
    if (!paisLocked && pais)             setPaisLocked(true);
    if (!generoLocked && genero && genero !== 'No definido') setGeneroLocked(true);
    showNotice('Configuración guardada correctamente.');
  };

  const currentCountry = COUNTRIES.find(c => c.code === pais);

  return <div className="mx-auto w-full min-w-0 max-w-5xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    <PageHeader
      eyebrow="Mi configuración"
      title="Configuración."
      description="Administra tus datos de perfil y recuperación."
    />
    {notice && <div className="mb-5 rounded-lg border border-accent/25 bg-accent/5 p-3 text-xs text-accent">{notice}</div>}
    <StateMsg loading={loading} />
    {!loading && <div className="space-y-6">
      <section className="panel min-w-0 p-5 sm:p-6">
        <div className="mb-7 flex items-start gap-3 sm:gap-4">
          <div className="rounded-xl bg-primary/10 p-3 text-primary"><Sparkles size={20} /></div>
          <div>
            <h2 className="font-display text-xl font-bold">Datos biográficos</h2>
            <p className="mt-1 break-words text-sm leading-6 text-muted-foreground">
              Algunos datos quedan fijos una vez guardados.
            </p>
          </div>
        </div>
        <div className="grid gap-5 sm:grid-cols-2">

          {/* Fecha de nacimiento */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Calendar size={11} />Fecha de nacimiento&nbsp;<span className="font-normal opacity-60">(≥ 18 años)</span>
              {fechaLocked && <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-primary"><Lock size={9} /> Fijo</span>}
            </label>
            {fechaLocked ? (
              <div className="field flex cursor-not-allowed items-center gap-2 opacity-60">
                <Calendar size={14} className="text-muted-foreground shrink-0" />
                <span className="text-sm">
                  {(() => { const z = calcularZodiacal(fechaNacimiento); const age = calcularEdad(fechaNacimiento); return `${z.icono} ${z.signo} · ${age} años`; })()}
                </span>
              </div>
            ) : (
              <>
                <input type="date" className="field" max={maxBirthDate()} value={fechaNacimiento} onChange={e => setFechaNacimiento(e.target.value)} />
                {fechaNacimiento && (() => {
                  const z = calcularZodiacal(fechaNacimiento);
                  const age = calcularEdad(fechaNacimiento);
                  return <p className="mt-1.5 font-mono-app text-[10px] text-accent">{z.icono} {z.signo} · {age} años — calculado automáticamente</p>;
                })()}
              </>
            )}
          </div>

          {/* País */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              <Globe size={11} />País de origen
              {paisLocked && <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-primary"><Lock size={9} /> Fijo</span>}
            </label>
            {paisLocked ? (
              <div className="field flex cursor-not-allowed items-center gap-2 opacity-60">
                {pais && pais !== 'OTHER'
                  ? <img src={`https://flagcdn.com/24x18/${pais.toLowerCase()}.png`} alt={currentCountry?.name ?? pais} className="h-4 w-auto rounded-[2px] shrink-0" />
                  : <Globe size={14} className="text-muted-foreground" />
                }
                <span className="text-sm">{currentCountry?.name ?? pais}</span>
              </div>
            ) : (
              <select className="field" value={pais} onChange={e => setPais(e.target.value)}>
                <option value="">— Sin especificar —</option>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
              </select>
            )}
          </div>

          {/* Género */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
              Género
              {generoLocked && <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-primary"><Lock size={9} /> Fijo</span>}
            </label>
            {generoLocked ? (
              <div className="field flex cursor-not-allowed items-center gap-2 opacity-60">
                <span className="text-sm">{GENERO_ICON[genero] ?? '⬡'} {genero}</span>
              </div>
            ) : (
              <select className="field" value={genero} onChange={e => setGenero(e.target.value)}>
                <option value="No definido">⬡ No definido</option>
                <option value="Masculino">♂ Masculino</option>
                <option value="Femenino">♀ Femenino</option>
              </select>
            )}
          </div>

          {/* Estado civil — siempre editable */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Estado civil</label>
            <select className="field" value={estadoCivil} onChange={e => setEstadoCivil(e.target.value)}>
              <option value="No definido">— No definido</option>
              <option value="Soltero">🔓 Soltero/a</option>
              <option value="En una relación">💞 En una relación</option>
              <option value="Casado">💍 Casado/a</option>
              <option value="Divorciado">💔 Divorciado/a</option>
              <option value="Viudo">🕊 Viudo/a</option>
            </select>
          </div>

          {/* Toggle mostrar estado civil — sin tarjeta, solo texto + switch */}
          <button
            type="button"
            role="switch"
            aria-checked={mostrarEstadoCivil}
            aria-label="Mostrar estado civil en el perfil"
            onClick={() => setMostrarEstadoCivil(v => !v)}
            className="sm:col-span-2 flex w-full min-w-0 items-start gap-4 py-2 text-left"
          >
            <div className="min-w-0 flex-1">
              <div className="break-words text-sm font-bold leading-relaxed">Mostrar estado civil en mi perfil</div>
              <p className="mt-1.5 break-words text-xs leading-relaxed text-muted-foreground">Si está apagado, el estado civil no aparece en tu perfil público. Solo se ven el zodiaco y el género.</p>
            </div>
            <div className={`relative mt-1 ml-auto h-6 w-11 shrink-0 rounded-full border transition-colors ${mostrarEstadoCivil ? 'border-primary bg-primary/70' : 'border-border bg-white/[.08]'}`} aria-hidden="true">
              <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow transition-transform ${mostrarEstadoCivil ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
            </div>
          </button>
        </div>

        <div className="mt-8 border-t border-border pt-6">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="eyebrow mb-2">Seguridad de la cuenta</div>
              <h3 className="font-display text-lg font-bold">Recuperación de cuenta</h3>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Guarda estos datos para recuperar tu contraseña.</p>
            </div>
            <div className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${isVip ? 'border-yellow-300/30 bg-yellow-300/10 text-yellow-200' : 'border-border bg-white/[.03] text-muted-foreground'}`}>
              <Crown size={12} /> {isVip ? 'Estatus VIP' : 'Estatus estándar'}
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="block text-xs font-semibold text-muted-foreground">PIN de 4 dígitos
              <input className="field mt-2" value={pinRecuperacion} onChange={e => setPinRecuperacion(e.target.value.replace(/\D/g, '').slice(0, 4))} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="0000" autoComplete="one-time-code" />
            </label>
            <label className="block text-xs font-semibold text-muted-foreground">Pregunta de recuperación
              <input className="field mt-2" value={preguntaSecreta} onChange={e => setPreguntaSecreta(e.target.value)} maxLength={160} placeholder="Tu juego favorito..." />
            </label>
            <label className="block text-xs font-semibold text-muted-foreground sm:col-span-2">Respuesta de recuperación
              <input className="field mt-2" value={respuestaSecreta} onChange={e => setRespuestaSecreta(e.target.value)} maxLength={160} placeholder="Una respuesta que solo tú recuerdes" autoComplete="off" />
            </label>
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11px] text-muted-foreground leading-5 sm:max-w-[60%]">
            Los campos marcados con <Lock size={9} className="inline text-primary" /> <span className="text-primary font-medium">Fijo</span> no podrán modificarse después de guardar.
          </p>
          <Button onClick={() => void save()} disabled={saving} className="w-full sm:w-auto sm:min-w-[160px] shrink-0">
            {saving ? <Spinner /> : <><Check size={15} /> Guardar configuración</>}
          </Button>
        </div>
      </section>
    </div>}
  </div>;
}

// ─── Salas públicas ──────────────────────────────────────────────────────────

function roomError(code?: string) {
  if (code === 'INVALID_SESSION') return 'Tu sesión segura expiró. Vuelve a entrar.';
  if (code === 'ROOM_NOT_FOUND') return 'Esta sala ya no está disponible.';
  if (code === 'EMPTY_MESSAGE') return 'Escribe algo antes de enviar tu comentario.';
  if (code === 'MESSAGE_TOO_LONG') return 'El comentario no puede superar los 250 caracteres.';
  if (code === 'TOO_FAST') return 'Espera 5 segundos antes de enviar otro comentario en cualquier sala.';
  return 'No se pudo completar la operación.';
}

const ROOM_CATEGORY_ORDER = ['Romance y Citas', 'Regionales', 'Desmadre y Social', 'Diversidad', 'General'];
const MAIN_ROOM_NAMES = ['Español', 'Planeta Latino', 'Más de 30'];
const LAST_ROOM_CACHE_PREFIX = 'konekto_last_room:';

type LastVisitedRoom = {
  id: string;
  nombre: string;
};

type RoomPresenceUser = {
  id: string;
  username: string;
  avatarUrl?: string | null;
};

function roomLastVisitKey(sessionId: string) {
  return `${LAST_ROOM_CACHE_PREFIX}${sessionId}`;
}

function readLastVisitedRoom(sessionId: string): LastVisitedRoom | null {
  try {
    return JSON.parse(localStorage.getItem(roomLastVisitKey(sessionId)) || 'null') as LastVisitedRoom | null;
  } catch {
    return null;
  }
}

function useRoomPresence(session: Session, roomId: number): RoomPresenceUser[] {
  const [users, setUsers] = useState<RoomPresenceUser[]>([]);

  useEffect(() => {
    if (!session.token || !Number.isInteger(roomId) || roomId <= 0) {
      setUsers([]);
      return;
    }

    const channel = supabase.channel(`konekto:room-presence:${roomId}`, {
      config: { presence: { key: session.id } },
    });

    const syncPresence = () => {
      const state = channel.presenceState<{ id: string; username: string; avatarUrl?: string | null }>();
      const nextUsers: RoomPresenceUser[] = [];
      for (const presences of Object.values(state)) {
        for (const presence of presences) {
          if (presence.id && !nextUsers.some((user) => user.id === presence.id)) {
            nextUsers.push({
              id: presence.id,
              username: presence.username,
              avatarUrl: presence.avatarUrl ?? null,
            });
          }
        }
      }
      setUsers(nextUsers.sort((a, b) => a.username.localeCompare(b.username)));
    };

    channel
      .on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'join' }, syncPresence)
      .on('presence', { event: 'leave' }, syncPresence)
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') return;
        const { data: ownProfile } = await profileById(session.id);
        await channel.track({
          id: session.id,
          username: session.username,
          avatarUrl: ownProfile?.avatar_url ?? session.avatarUrl ?? null,
        });
      });

    return () => {
      setUsers([]);
      void supabase.removeChannel(channel);
    };
  }, [roomId, session.avatarUrl, session.id, session.token, session.username]);

  return users;
}

function RoomListRow({ room, favoriteBusy, onToggleFavorite }: {
  room: ChatRoom;
  favoriteBusy: string | null;
  onToggleFavorite: (room: ChatRoom) => void;
}) {
  const roomId = String(room.id);
  return <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border bg-white/[.02] p-2 transition-colors hover:border-primary/35 hover:bg-white/[.04]">
    <Link href={`/salas/${roomId}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary"><MessageSquare size={17} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold">{room.nombre}</span>
        <span className="mt-1 flex items-center gap-1.5 font-mono-app text-[10px] text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{Number(room.usuarios_activos ?? 0)} activos</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-muted-foreground" />
    </Link>
    <button type="button" aria-label={room.es_favorita ? `Quitar ${room.nombre} de favoritos` : `Agregar ${room.nombre} a favoritos`} title={room.es_favorita ? 'Quitar de favoritos' : 'Agregar a favoritos'} className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg border transition-colors ${room.es_favorita ? 'border-yellow-300/35 bg-yellow-300/10 text-yellow-200' : 'border-border text-muted-foreground hover:border-yellow-300/35 hover:text-yellow-200'}`} onClick={() => onToggleFavorite(room)} disabled={favoriteBusy === roomId}>
      {favoriteBusy === roomId ? <Spinner /> : <Star size={16} fill={room.es_favorita ? 'currentColor' : 'none'} />}
    </button>
  </div>;
}

function RoomsPage({ session }: { session: Session }) {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [favoriteBusy, setFavoriteBusy] = useState<string | null>(null);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    if (!session.token) {
      setError('Cierra sesión y vuelve a entrar para abrir las salas.');
      setLoading(false);
      return;
    }
    setError('');
    const { data, error: roomsError } = await supabase.rpc('obtener_salas_chat', { p_session_token: session.token });
    if (roomsError) {
      setError(extractError(roomsError));
      setLoading(false);
      return;
    }
    const result = data as { ok?: boolean; code?: string; rooms?: ChatRoom[] } | null;
    if (!result?.ok) {
      setError(roomError(result?.code));
      setLoading(false);
      return;
    }
    setRooms(Array.isArray(result.rooms) ? result.rooms : []);
    setLoading(false);
  }, [session.token]);

  useEffect(() => { void load(); }, [load]);

  const toggleFavorite = async (room: ChatRoom) => {
    if (!session.token || favoriteBusy) return;
    const roomId = String(room.id);
    setFavoriteBusy(roomId);
    const { data, error: favoriteError } = await supabase.rpc('alternar_favorito_sala', {
      p_session_token: session.token,
      p_sala_id: Number(room.id),
    });
    const result = data as { ok?: boolean; code?: string; es_favorita?: boolean } | null;
    if (favoriteError || !result?.ok) {
      setError(extractError(favoriteError) || roomError(result?.code));
    } else {
      setRooms((current) => current.map((item) => String(item.id) === roomId
        ? { ...item, es_favorita: Boolean(result.es_favorita) }
        : item));
    }
    setFavoriteBusy(null);
  };

  const favoriteRooms = rooms.filter((room) => room.es_favorita);
  const mainRooms = rooms.filter((room) => MAIN_ROOM_NAMES.includes(room.nombre));
  const categorizedRooms = ROOM_CATEGORY_ORDER.map((category) => ({
    category,
    rooms: rooms.filter((room) => !room.es_favorita && !MAIN_ROOM_NAMES.includes(room.nombre) && (room.categoria ?? 'General') === category),
  })).filter((group) => group.rooms.length > 0);

  return <div className="mx-auto w-full min-w-0 max-w-5xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    <PageHeader eyebrow="Canales" title="Salas." description="Encuentra tu frecuencia y entra a conversar." />
    {error && <div className="mb-5"><StateMsg error={error} onRetry={() => void load()} /></div>}
    {loading && <section className="panel-subtle p-5 text-sm text-muted-foreground">Cargando salas…</section>}
    {!loading && !error && !rooms.length && <section className="panel flex min-h-[280px] flex-col items-center justify-center px-6 text-center"><MessageSquare size={25} className="mb-4 text-primary" /><h2 className="font-display text-xl font-bold">No hay salas activas.</h2><p className="mt-2 text-sm text-muted-foreground">Vuelve a actualizar en un momento.</p></section>}
    {!loading && !error && rooms.length > 0 && <section className="panel min-w-0 p-3 sm:p-5">
      <div className="mb-4 flex items-center justify-between gap-3 px-1">
        <div><div className="eyebrow mb-1">Frecuencias disponibles</div><h2 className="font-display text-xl font-bold">Entra a una sala</h2></div>
        <span className="font-mono-app text-[10px] text-muted-foreground">{rooms.length} canales</span>
      </div>
      <div className="space-y-6">
        {favoriteRooms.length > 0 && <section>
          <div className="mb-2 flex items-center gap-2 px-1"><Star size={14} className="text-yellow-200" fill="currentColor" /><h3 className="font-display text-sm font-bold">Tus Salas Favoritas</h3><span className="font-mono-app text-[10px] text-muted-foreground">({favoriteRooms.length})</span></div>
          <div className="space-y-2">{favoriteRooms.map((room) => <RoomListRow key={String(room.id)} room={room} favoriteBusy={favoriteBusy} onToggleFavorite={toggleFavorite} />)}</div>
        </section>}
        {mainRooms.length > 0 && <section>
          <div className="mb-2 flex items-center gap-2 px-1"><span className="h-1.5 w-1.5 rounded-full bg-accent" /><h3 className="font-display text-sm font-bold">Salas Principales</h3><span className="font-mono-app text-[10px] text-muted-foreground">({mainRooms.length})</span></div>
          <div className="space-y-2">{mainRooms.map((room) => <RoomListRow key={String(room.id)} room={room} favoriteBusy={favoriteBusy} onToggleFavorite={toggleFavorite} />)}</div>
        </section>}
        {categorizedRooms.map(({ category, rooms: categoryRooms }) => <section key={category}>
          <div className="overflow-hidden rounded-xl border border-border bg-white/[.015]">
            <button type="button" aria-expanded={Boolean(openCategories[category])} className="flex min-h-12 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-white/[.04]" onClick={() => setOpenCategories((current) => ({ ...current, [category]: !current[category] }))}>
              <span className="h-1.5 w-1.5 rounded-full bg-primary" /><span className="min-w-0 flex-1 font-display text-sm font-bold">{category}</span><span className="font-mono-app text-[10px] text-muted-foreground">({categoryRooms.length})</span><ChevronRight size={15} className={`text-muted-foreground transition-transform ${openCategories[category] ? 'rotate-90' : ''}`} />
            </button>
            {openCategories[category] && <div className="space-y-2 border-t border-border p-2">{categoryRooms.map((room) => <RoomListRow key={String(room.id)} room={room} favoriteBusy={favoriteBusy} onToggleFavorite={toggleFavorite} />)}</div>}
          </div>
        </section>)}
      </div>
    </section>}
  </div>;
}

function RoomPage({ session }: { session: Session }) {
  const params = useParams<{ id?: string }>();
  const roomId = Number(params.id);
  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [favoriteBusy, setFavoriteBusy] = useState(false);
  const [previousRoom, setPreviousRoom] = useState<LastVisitedRoom | null>(null);
  const roomRef = useRef<ChatRoom | null>(null);
  const messagesRef = useRef<RoomMessage[]>([]);
  const visitRecordedRef = useRef(false);
  const presenceUsers = useRoomPresence(session, roomId);

  const load = useCallback(async (background = false) => {
    if (!Number.isInteger(roomId) || roomId <= 0) {
      setError('Esta sala no es válida.');
      setLoading(false);
      return;
    }
    if (!session.token) {
      setError('Cierra sesión y vuelve a entrar para abrir esta sala.');
      setLoading(false);
      return;
    }
    if (background) setRefreshing(true); else if (!roomRef.current) setLoading(true);
    const { data, error: chatError } = await supabase.rpc('obtener_sala_chat', {
      p_session_token: session.token,
      p_sala_id: roomId,
    });
    const result = data as { ok?: boolean; code?: string; room?: ChatRoom; messages?: RoomMessage[] } | null;
    if (chatError || !result?.ok) {
      if (!roomRef.current) setError(extractError(chatError) || roomError(result?.code));
    } else {
      const nextRoom = result.room ?? null;
      const nextMessages = Array.isArray(result.messages) ? result.messages : [];
      if (JSON.stringify(roomRef.current) !== JSON.stringify(nextRoom)) {
        roomRef.current = nextRoom;
        setRoom(nextRoom);
      }
      if (JSON.stringify(messagesRef.current) !== JSON.stringify(nextMessages)) {
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
      }
      setError('');
      if (!visitRecordedRef.current && roomRef.current) {
        const currentRoom = { id: String(roomRef.current.id), nombre: roomRef.current.nombre };
        const lastRoom = readLastVisitedRoom(session.id);
        setPreviousRoom(lastRoom && lastRoom.id !== currentRoom.id ? lastRoom : null);
        try {
          localStorage.setItem(roomLastVisitKey(session.id), JSON.stringify(currentRoom));
        } catch {
          // La última sala es una mejora de navegación, no debe bloquear el chat.
        }
        visitRecordedRef.current = true;
      }
    }
    setLoading(false);
    setRefreshing(false);
  }, [roomId, session.token]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFavorite = async () => {
    if (!session.token || !room || favoriteBusy) return;
    setFavoriteBusy(true);
    const { data, error: favoriteError } = await supabase.rpc('alternar_favorito_sala', {
      p_session_token: session.token,
      p_sala_id: roomId,
    });
    const result = data as { ok?: boolean; code?: string; es_favorita?: boolean } | null;
    if (favoriteError || !result?.ok) setError(extractError(favoriteError) || roomError(result?.code));
    else setRoom((current) => current ? { ...current, es_favorita: Boolean(result.es_favorita) } : current);
    setFavoriteBusy(false);
  };

  const activeUsers = presenceUsers.length > 0 ? presenceUsers.length : Number(room?.usuarios_activos ?? 0);

  return <div className="mx-auto min-h-[calc(100dvh-3.75rem)] w-full min-w-0 max-w-5xl px-4 py-5 sm:min-h-[100dvh] sm:px-8 sm:py-8 lg:px-12">
    <div className="shrink-0">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{room?.nombre ?? 'Sala'}</h1>
      <div className="mt-4 flex items-center justify-between gap-3">
        <button type="button" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-xs font-semibold text-muted-foreground hover:border-primary/45 hover:text-primary" onClick={() => void load(false)} disabled={loading || refreshing}>{refreshing ? <Spinner /> : <MessageSquare size={14} />} Actualizar</button>
        {room && <Link href={`/salas/${roomId}/comentar`} className="button-lift inline-flex min-h-10 items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 text-xs font-bold text-primary hover:border-primary/70 hover:bg-primary/15"><Pencil size={14} /> Comentar</Link>}
      </div>
      {room && <p className="mt-1.5 flex items-center gap-2 text-sm text-muted-foreground"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />{activeUsers} usuarios activos</p>}
    </div>
    {error && <div className="mt-4 shrink-0"><StateMsg error={error} onRetry={() => void load(false)} /></div>}
    {loading && !room && <section className="panel-subtle mt-4 shrink-0 p-5 text-sm text-muted-foreground">Cargando sala…</section>}
    {!loading && !error && room && !messages.length && <section className="panel mt-4 flex min-h-[280px] flex-col items-center justify-center px-6 text-center"><MessageSquare size={25} className="mb-4 text-primary" /><h2 className="font-display text-xl font-bold">La sala está en silencio.</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Sé la primera persona en dejar un comentario.</p></section>}
    {!error && room && messages.length > 0 && <section className="room-messages-mobile room-messages-edge mt-4 min-w-0 py-1 sm:panel sm:rounded-xl sm:py-0 sm:p-5">
      <div className="space-y-0 sm:space-y-4">
        {messages.map((message) => <article key={String(message.id)} className="flex w-full min-w-0 items-start gap-3 border-b border-border/60 pl-1 pr-4 py-3 text-left last:border-0 sm:gap-4 sm:pl-0 sm:pr-0 sm:py-4 sm:border-border">
          <div className={message.es_vip ? 'shrink-0 rounded-xl border border-yellow-300/65 bg-yellow-300/10 p-0.5 shadow-[0_0_14px_rgba(250,204,21,.18)]' : 'shrink-0'}>
            <Avatar username={message.autor_alias} size="sm" imageUrl={message.avatar_url} />
          </div>
          <div className="w-full min-w-0 flex-1">
            <div className="mb-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={`/profile/${message.autor_alias}`} className={`truncate text-sm font-bold hover:text-primary ${message.es_vip ? 'text-yellow-100' : ''}`}>{message.autor_alias}</Link>
              {message.es_vip && <VipBadge compact />}
              {message.fecha_nacimiento ? (() => {
                 const zodiac = calcularZodiacal(message.fecha_nacimiento);
                 return <span className="font-mono-app text-[10px] text-muted-foreground">{zodiac.icono} {calcularEdad(message.fecha_nacimiento)}</span>;
               })() : <span className="font-mono-app text-[10px] text-muted-foreground">{relativeDate(message.creado_en)}</span>}
            </div>
            <p className="w-full break-words text-left text-sm leading-6 text-foreground/90">{renderCustomEmojiText(sanitizeSingleLineForDisplay(message.contenido), 'message')}</p>
          </div>
        </article>)}
      </div>
    </section>}
    {room && <div className="mt-5 grid grid-cols-3 gap-2">
      <Link href="/salas" className="inline-flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-lg border border-border px-2 text-center text-[10px] font-semibold text-muted-foreground hover:border-primary/45 hover:text-primary sm:gap-2 sm:px-3 sm:text-xs"><ArrowLeft size={14} /><span className="hidden sm:inline">Volver a salas</span><span className="sm:hidden">Volver</span></Link>
      <Link href={`/salas/${roomId}/usuarios`} className="inline-flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-lg border border-border px-2 text-center text-[10px] font-semibold text-muted-foreground hover:border-primary/45 hover:text-primary sm:gap-2 sm:px-3 sm:text-xs"><Users size={14} /><span className="hidden sm:inline">Ver usuarios en línea</span><span className="sm:hidden">En línea</span></Link>
      <button type="button" className={`inline-flex min-h-10 min-w-0 items-center justify-center gap-1 rounded-lg border px-2 text-center text-[10px] font-semibold transition-colors sm:gap-2 sm:px-3 sm:text-xs ${room.es_favorita ? 'border-yellow-300/35 bg-yellow-300/10 text-yellow-200' : 'border-border text-muted-foreground hover:border-yellow-300/35 hover:text-yellow-200'}`} onClick={() => void toggleFavorite()} disabled={favoriteBusy}><Star size={14} fill={room.es_favorita ? 'currentColor' : 'none'} /><span className="hidden sm:inline">{room.es_favorita ? 'En favoritos' : 'Agregar a Favoritos'}</span><span className="sm:hidden">{room.es_favorita ? 'Favorito' : 'Favoritos'}</span></button>
    </div>}
    {previousRoom && <Link href={`/salas/${previousRoom.id}`} className="mt-3 inline-flex shrink-0 items-center justify-center gap-2 text-center text-xs font-semibold text-primary hover:text-primary/80">← Regresar a {previousRoom.nombre}</Link>}
  </div>;
}

function RoomUsersPage({ session }: { session: Session }) {
  const params = useParams<{ id?: string }>();
  const roomId = Number(params.id);
  const users = useRoomPresence(session, roomId);
  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!Number.isInteger(roomId) || roomId <= 0 || !session.token) {
      setError('No se pudo abrir esta sala.');
      setLoading(false);
      return;
    }
    void supabase.rpc('obtener_sala_chat', { p_session_token: session.token, p_sala_id: roomId }).then(({ data, error: roomLoadError }) => {
      const result = data as { ok?: boolean; code?: string; room?: ChatRoom } | null;
      if (roomLoadError || !result?.ok) setError(extractError(roomLoadError) || roomError(result?.code));
      else setRoom(result.room ?? null);
      setLoading(false);
    });
  }, [roomId, session.token]);

  return <div className="mx-auto flex h-[calc(100dvh-3.75rem)] min-h-0 w-full min-w-0 max-w-3xl flex-col overflow-hidden px-4 py-5 sm:h-[100dvh] sm:px-8 sm:py-8 lg:px-12">
    <div className="shrink-0 text-center">
      <Link href={`/salas/${roomId}`} className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary"><ArrowLeft size={14} /> Volver a la sala</Link>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{room?.nombre ?? 'Usuarios en línea'}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{users.length} usuarios detectados ahora</p>
    </div>
    {error && <div className="mt-4 shrink-0"><StateMsg error={error} /></div>}
    {loading && <section className="panel-subtle mt-4 shrink-0 p-5 text-sm text-muted-foreground">Cargando usuarios…</section>}
    {!loading && !error && <section className="panel mt-4 min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      {!users.length && <div className="flex h-full min-h-[220px] flex-col items-center justify-center px-5 text-center"><Users size={28} className="mb-4 text-primary" /><h2 className="font-display text-xl font-bold">Todavía no hay usuarios visibles.</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">Las personas que estén mirando o conversando en esta sala aparecerán aquí.</p></div>}
      {users.length > 0 && <div className="space-y-2">{users.map((user) => <div key={user.id} className="flex items-center gap-3 rounded-xl border border-border bg-white/[.02] p-3"><Avatar username={user.username} size="sm" online imageUrl={user.avatarUrl} /><span className="min-w-0 flex-1 truncate text-sm font-bold">{user.username}</span><span className="font-mono-app text-[10px] text-emerald-400">en línea</span></div>)}</div>}
    </section>}
    <Link href="/salas" className="mt-4 inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border px-4 text-xs font-semibold text-muted-foreground hover:border-primary/45 hover:text-primary"><ArrowLeft size={14} /> Volver a salas</Link>
  </div>;
}

function RoomCommentPage({ session }: { session: Session }) {
  const params = useParams<{ id?: string }>();
  const [, setLocation] = useLocation();
  const roomId = Number(params.id);
  const [room, setRoom] = useState<ChatRoom | null>(null);
  const [message, setMessage] = useState('');
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!Number.isInteger(roomId) || roomId <= 0 || !session.token) {
      setError('No se pudo abrir el formulario de la sala.');
      setLoading(false);
      return;
    }
    void supabase.rpc('obtener_sala_chat', { p_session_token: session.token, p_sala_id: roomId }).then(({ data, error: roomLoadError }) => {
      const result = data as { ok?: boolean; code?: string; room?: ChatRoom } | null;
      if (roomLoadError || !result?.ok) setError(extractError(roomLoadError) || roomError(result?.code));
      else setRoom(result.room ?? null);
      setLoading(false);
    });
  }, [roomId, session.token]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanMessage = censorProfanity(replaceEmojiCommands(normalizeSingleLine(message).trim()));
    if (!cleanMessage) {
      setError(roomError('EMPTY_MESSAGE'));
      return;
    }
    if (cleanMessage.length > 250) {
      setError(roomError('MESSAGE_TOO_LONG'));
      return;
    }
    if (!session.token) {
      setError(roomError('INVALID_SESSION'));
      return;
    }
    setSending(true);
    setError('');
    const { data, error: sendError } = await supabase.rpc('enviar_mensaje_sala_seguro', {
      p_session_token: session.token,
      p_sala_id: roomId,
      p_contenido: cleanMessage,
    });
    const result = data as { ok?: boolean; code?: string } | null;
    setSending(false);
    if (sendError || !result?.ok) {
      setError(extractError(sendError) || roomError(result?.code));
      return;
    }
    setLocation(`/salas/${roomId}`);
  };

  return <div className="mx-auto min-h-[100dvh] w-full min-w-0 max-w-3xl px-4 py-6 sm:px-8 sm:py-8 lg:px-12">
    <div className="shrink-0">
      <Link href={room ? `/salas/${roomId}` : '/salas'} className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-muted-foreground hover:text-primary"><ArrowLeft size={14} /> Volver a la sala</Link>
      <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{room ? `Comentar en ${room.nombre}.` : 'Escribir comentario.'}</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">Escribe con calma. Puedes usar saltos de línea y tienes un máximo de 250 caracteres.</p>
    </div>
    {loading && <section className="panel-subtle mt-4 shrink-0 p-5 text-sm text-muted-foreground">Cargando sala…</section>}
    {!loading && <form className="mt-5" onSubmit={(event) => void submit(event)}>
      {error && <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs leading-5 text-destructive" role="alert">{error}</div>}
      <label className="block text-xs font-semibold text-muted-foreground" htmlFor="room-comment">Tu comentario</label>
      <textarea id="room-comment" ref={messageInputRef} rows={4} className="field mt-2 min-h-24 max-h-[35dvh] resize-y leading-6" value={message} onChange={(event) => setMessage(event.target.value.slice(0, 250))} maxLength={250} placeholder="Escribe algo para la sala…" autoFocus />
      <div className="mt-2 flex items-center justify-end"><span className={`font-mono-app text-[11px] ${message.length >= 250 ? 'text-accent' : 'text-muted-foreground'}`}>{message.length}/250</span></div>
      <EmojiPicker value={message} onChange={setMessage} inputRef={messageInputRef} maxLength={250} className="mt-3"><Button type="submit" className="w-full min-w-0 sm:w-auto sm:px-4" disabled={sending || loading || !room}>{sending ? <Spinner /> : <><Send size={15} /> Enviar comentario</>}</Button></EmojiPicker>
    </form>}
  </div>;
}

// ─── Router principal ─────────────────────────────────────────────────────────

function AppRouter({ session, onSignOut, onlineUsers, onAvatarChange }: {
  session: Session;
  onSignOut: () => void;
  onlineUsers: OnlineUser[];
  onAvatarChange: (avatarUrl: string | null) => void;
}) {
  const [location] = useLocation();
  const isAuth = location === '/';
  if (isAuth) return null;
  return <Shell session={session} onSignOut={onSignOut} onlineUsers={onlineUsers}>
    <Switch>
      <Route path="/dashboard" component={() => <DashboardPage session={session} onlineUsers={onlineUsers} />} />
      <Route path="/vip" component={() => <VipBenefitsPage session={session} />} />
      <Route path="/regalar/:userId" component={() => <GiftPage session={session} />} />
      <Route path="/regalos" component={() => <GiftHistoryPage session={session} />} />
      <Route path="/online" component={() => <OnlinePage session={session} onlineUsers={onlineUsers} />} />
      <Route path="/foto/:fotoId/compartir" component={() => <PhotoSharePage session={session} />} />
      <Route path="/foto/:fotoId" component={() => <PhotoPage session={session} />} />
      <Route path="/profile/:username/galeria" component={() => <GalleryPage session={session} onAvatarChange={onAvatarChange} />} />
      <Route path="/profile/:username/amigos" component={() => <ProfileFriendsPage session={session} onlineUsers={onlineUsers} />} />
      <Route path="/profile/:username/regalos" component={() => <GiftHistoryPage session={session} />} />
      <Route path="/profile/:username" component={() => <ProfilePage session={session} onlineUsers={onlineUsers} onAvatarChange={onAvatarChange} />} />
      <Route path="/friends" component={() => <FriendsPage session={session} onlineUsers={onlineUsers} />} />
      <Route path="/visitantes" component={() => <VisitorsPage session={session} />} />
      <Route path="/mensajes" component={() => <InboxPage session={session} />} />
      <Route path="/bandeja" component={() => <InboxPage session={session} />} />
      <Route path="/chat/nuevo/:userId" component={() => <NewChatPage session={session} />} />
      <Route path="/chat/:id" component={() => <ChatPage session={session} />} />
      <Route path="/messages" component={() => <InboxPage session={session} />} />
      <Route path="/privacy" component={() => <PrivacyPage session={session} />} />
      <Route path="/settings" component={() => <SettingsPage session={session} />} />
      <Route path="/salas/:id/comentar" component={() => <RoomCommentPage session={session} />} />
      <Route path="/salas/:id/usuarios" component={() => <RoomUsersPage session={session} />} />
      <Route path="/salas/:id" component={() => <RoomPage session={session} />} />
      <Route path="/salas" component={() => <RoomsPage session={session} />} />
      <Route path="/rooms" component={() => <RoomsPage session={session} />} />
      <Route component={NotFound} />
    </Switch>
  </Shell>;
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession] = useState<Session | null>(() => readSession());
  const [, setLocation] = useLocation();
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const presenceChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Supabase Presence — track this session globally
  useEffect(() => {
    if (!session) return;
    const channel = supabase.channel('konekto:global-presence', {
      config: { presence: { key: session.id } },
    });
    presenceChannelRef.current = channel;

    const syncPresence = () => {
      const state = channel.presenceState<{ id: string; username: string; avatarUrl?: string | null }>();
      const users: OnlineUser[] = [];
      for (const presences of Object.values(state)) {
        for (const p of presences) {
          if (!users.some(u => u.id === p.id)) {
            users.push({ id: p.id, username: p.username, avatarUrl: p.avatarUrl ?? null });
          }
        }
      }
      setOnlineUsers(users);
    };

    channel
      .on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'join' }, syncPresence)
      .on('presence', { event: 'leave' }, syncPresence)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          const { data: ownProfile } = await profileById(session.id);
          const avatarUrl = ownProfile?.avatar_url ?? session.avatarUrl ?? null;
          if (avatarUrl !== (session.avatarUrl ?? null)) {
              setSession((current) => {
                if (!current || current.avatarUrl === avatarUrl) return current;
                const next = { ...current, avatarUrl };
                saveSession(next);
                return next;
              });
          }
          await channel.track({ id: session.id, username: session.username, avatarUrl });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
      presenceChannelRef.current = null;
    };
  }, [session]);

  const updateSessionAvatar = useCallback((avatarUrl: string | null) => {
    setSession((current) => {
      if (!current || current.avatarUrl === avatarUrl) return current;
      const next = { ...current, avatarUrl };
      saveSession(next);
      return next;
    });
  }, []);

  const handleLogin = (s: Session) => {
    setSession(s);
    setLocation('/dashboard');
    void profileById(s.id).then(({ data }) => {
      if (data) updateSessionAvatar(data.avatar_url ?? null);
    });
  };
  const handleSignOut = () => {
    if (presenceChannelRef.current) {
      void presenceChannelRef.current.untrack();
    }
    clearSession();
    setSession(null);
    setLocation('/');
  };

  if (!session) {
    return <TooltipProvider>
      <AuthPage onLogin={handleLogin} />
      <Toaster />
    </TooltipProvider>;
  }

  return <TooltipProvider>
    <ErrorBoundary resetKey={session.id}>
      <AppRouter session={session} onSignOut={handleSignOut} onlineUsers={onlineUsers} onAvatarChange={updateSessionAvatar} />
    </ErrorBoundary>
    <Toaster />
  </TooltipProvider>;
}

function AppRoot() {
  return <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
    <App />
  </WouterRouter>;
}

export { AppRoot };
