import React from 'react';
import * as Sentry from '@sentry/react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Always log in dev; report to Sentry in production
    if (import.meta.env.DEV) console.error('ErrorBoundary caught:', error, errorInfo);
    try {
      Sentry.captureException(error, { extra: { componentStack: errorInfo?.componentStack } });
    } catch { /* Sentry not initialized — ignore */ }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
          <h1>Something went wrong.</h1>
          <p>An unexpected error occurred.</p>
          <button onClick={() => window.location.reload()} style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
