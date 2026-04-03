import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || 'Unknown error';
      return (
        <div className="error-boundary-fallback" role="alert">
          <h1 className="error-boundary-fallback__title">Something went wrong</h1>
          <p className="error-boundary-fallback__message">{msg}</p>
          <button
            type="button"
            className="error-boundary-fallback__retry"
            onClick={this.handleRetry}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
