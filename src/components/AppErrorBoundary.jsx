import { Component } from 'react';

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: String(error?.message || 'Unexpected runtime error.'),
    };
  }

  componentDidCatch(error, info) {
    console.error('Unhandled app error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <main
          className="content"
          style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '2rem' }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 840,
              background: '#fff',
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: '1.5rem',
              boxShadow: '0 10px 25px rgba(0,0,0,0.08)',
            }}
          >
            <h1 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Something went wrong</h1>
            <p style={{ marginTop: 0, marginBottom: '0.75rem', color: '#4b5563' }}>
              A runtime error occurred. This fallback prevents a white screen.
            </p>
            <p style={{ marginTop: 0, marginBottom: '1rem', color: '#111827', fontWeight: 600 }}>
              {this.state.errorMessage}
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => window.location.reload()}
                style={{
                  border: 'none',
                  background: '#096B72',
                  color: '#fff',
                  borderRadius: 6,
                  padding: '0.65rem 1rem',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Reload App
              </button>
              <button
                type="button"
                onClick={() => {
                  localStorage.removeItem('qnext_admin_buses');
                  localStorage.removeItem('qnext_admin_attendants');
                  localStorage.removeItem('routesManagement.localRoutes');
                  localStorage.removeItem('routesManagement.localDestinations');
                  localStorage.removeItem('routesManagement.globalOrigin');
                  window.location.reload();
                }}
                style={{
                  border: '1px solid #d1d5db',
                  background: '#fff',
                  color: '#111827',
                  borderRadius: 6,
                  padding: '0.65rem 1rem',
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Clear Local Cache & Reload
              </button>
            </div>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}

export default AppErrorBoundary;
