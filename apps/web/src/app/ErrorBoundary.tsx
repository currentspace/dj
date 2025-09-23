import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);
    this.setState({
      error,
      errorInfo
    });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary">
          <div className="error-container">
            <div className="error-icon">⚠️</div>
            <h2>Something went wrong</h2>
            <p>
              We're sorry, but something unexpected happened.
              You can try reloading the page or contact support if the problem persists.
            </p>

            <div className="error-actions">
              <button
                onClick={this.handleReset}
                className="retry-button"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="reload-button"
              >
                Reload Page
              </button>
            </div>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="error-details">
                <summary>Error Details (Development)</summary>
                <pre>{this.state.error.stack}</pre>
                {this.state.errorInfo && (
                  <pre>{this.state.errorInfo.componentStack}</pre>
                )}
              </details>
            )}
          </div>

          <style jsx>{`
            .error-boundary {
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 60vh;
              padding: 2rem;
            }

            .error-container {
              text-align: center;
              max-width: 500px;
              padding: 3rem 2rem;
              border-radius: 12px;
              background: #fff;
              border: 2px solid #f56565;
              box-shadow: 0 10px 30px rgba(245, 101, 101, 0.1);
            }

            .error-icon {
              font-size: 4rem;
              margin-bottom: 1rem;
            }

            .error-container h2 {
              color: #e53e3e;
              margin-bottom: 1rem;
              font-size: 1.5rem;
            }

            .error-container p {
              color: #4a5568;
              margin-bottom: 2rem;
              line-height: 1.6;
            }

            .error-actions {
              display: flex;
              gap: 1rem;
              justify-content: center;
              flex-wrap: wrap;
            }

            .retry-button,
            .reload-button {
              padding: 0.75rem 1.5rem;
              border: none;
              border-radius: 8px;
              font-weight: 500;
              cursor: pointer;
              transition: all 0.2s ease;
            }

            .retry-button {
              background: #3182ce;
              color: white;
            }

            .retry-button:hover {
              background: #2c5282;
            }

            .reload-button {
              background: #e2e8f0;
              color: #2d3748;
            }

            .reload-button:hover {
              background: #cbd5e0;
            }

            .error-details {
              margin-top: 2rem;
              text-align: left;
              background: #f7fafc;
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              padding: 1rem;
            }

            .error-details summary {
              cursor: pointer;
              font-weight: 500;
              margin-bottom: 0.5rem;
            }

            .error-details pre {
              white-space: pre-wrap;
              font-size: 0.875rem;
              color: #e53e3e;
              margin: 0.5rem 0;
              overflow: auto;
            }
          `}</style>
        </div>
      );
    }

    return this.props.children;
  }
}

// Convenience component for playlist-specific errors
export function PlaylistErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      fallback={
        <div className="playlist-error">
          <h3>Unable to load playlist</h3>
          <p>There was an error generating or loading your playlist. Please try again.</p>
        </div>
      }
      onReset={() => {
        // Clear any cached playlist data
        localStorage.removeItem('current_playlist');
      }}
    >
      {children}
    </ErrorBoundary>
  );
}