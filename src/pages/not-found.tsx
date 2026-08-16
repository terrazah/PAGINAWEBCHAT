import { AlertCircle, ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="grid min-h-[100dvh] place-items-center px-6">
      <div className="panel w-full max-w-md p-8 text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-destructive/10 text-destructive"><AlertCircle size={25} /></div>
        <div className="eyebrow mb-3">señal perdida / 404</div>
        <h1 className="font-display text-3xl font-bold">Esta ruta no existe.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">El espacio que buscas no está disponible o cambió de frecuencia.</p>
        <Link href="/dashboard" className="button-lift mt-7 inline-flex items-center gap-2 rounded-lg border border-primary/50 bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground" data-testid="link-return-dashboard"><ArrowLeft size={15} /> Volver al resumen</Link>
      </div>
    </div>
  );
}
