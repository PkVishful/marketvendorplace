import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <p className="text-lg font-semibold text-ink">Something went wrong</p>
          <p className="mt-2 text-sm text-ink-2">
            The page hit an unexpected error. Reload to try again.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg border border-hair bg-surface px-4 py-2 text-sm font-semibold text-ink hover:border-ink-3"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
