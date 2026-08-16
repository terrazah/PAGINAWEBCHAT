import {
  Component,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from 'react';

export interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  FallbackComponent?: ComponentType<ErrorFallbackProps>;
  /** Changing this clears a caught error. Pass the route to recover on navigation. */
  resetKey?: unknown;
}

interface ErrorBoundaryState {
  error: Error | null;
}

function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }
  if (typeof value === 'string') {
    return new Error(value);
  }
  try {
    return new Error(JSON.stringify(value));
  } catch {
    return new Error(String(value));
  }
}

function DefaultFallback({ error, resetError }: ErrorFallbackProps) {
  return (
    <div className="grid min-h-[100dvh] place-items-center p-6">
      <div className="panel w-full max-w-lg p-8 text-center">
        <div className="eyebrow mb-3">sistema / error</div>
        <h1 className="font-display text-2xl font-bold">Algo interrumpió la señal.</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Esta parte del espacio encontró un problema. Puedes intentar volver a entrar.
        </p>
        {/* Dev only: messages can carry API responses and other internals. */}
        {import.meta.env.DEV ? (
          <pre className="mt-4 overflow-x-auto rounded-lg border border-border bg-black/30 p-3 text-left text-xs text-muted-foreground">
            {error.message || String(error)}
          </pre>
        ) : null}
        <button
          type="button"
          onClick={resetError}
          className="button-lift mt-6 rounded-lg border border-primary/50 bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          data-testid="button-error-retry"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: toError(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(
      'ErrorBoundary caught an error:',
      toError(error),
      info.componentStack,
    );
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.resetError();
    }
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (error === null) {
      return this.props.children;
    }
    const Fallback = this.props.FallbackComponent ?? DefaultFallback;
    return <Fallback error={error} resetError={this.resetError} />;
  }
}
