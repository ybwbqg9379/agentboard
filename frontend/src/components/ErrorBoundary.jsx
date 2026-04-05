import { Component } from 'react';
import { RefreshCw } from 'lucide-react';
import i18n from '../i18n.js';

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
      const msg = this.state.error?.message || i18n.t('errorBoundary.unknownError');
      return (
        <div className="error-boundary-fallback" role="alert">
          <h1 className="error-boundary-fallback__title">{i18n.t('errorBoundary.title')}</h1>
          <p className="error-boundary-fallback__message">{msg}</p>
          <button
            type="button"
            className="error-boundary-fallback__retry"
            onClick={this.handleRetry}
          >
            <span className="error-boundary-fallback__retryInner">
              <RefreshCw size={14} strokeWidth={2} aria-hidden />
              {i18n.t('errorBoundary.tryAgain')}
            </span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
