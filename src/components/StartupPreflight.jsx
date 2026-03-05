function StartupPreflight({ report }) {
  const issues = Array.isArray(report?.issues) ? report.issues : [];
  const warnings = Array.isArray(report?.warnings) ? report.warnings : [];

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
        <h1 style={{ marginTop: 0, marginBottom: '0.5rem' }}>Startup Configuration Error</h1>
        <p style={{ marginTop: 0, marginBottom: '1rem', color: '#4b5563' }}>
          The app stopped startup to prevent a white screen. Fix the items below, then restart the dev server.
        </p>

        {issues.length > 0 && (
          <>
            <h3 style={{ marginBottom: '0.5rem' }}>Required fixes</h3>
            <ul style={{ marginTop: 0, marginBottom: '1rem' }}>
              {issues.map((issue) => (
                <li key={issue} style={{ marginBottom: '0.35rem' }}>{issue}</li>
              ))}
            </ul>
          </>
        )}

        {warnings.length > 0 && (
          <>
            <h3 style={{ marginBottom: '0.5rem' }}>Warnings</h3>
            <ul style={{ marginTop: 0, marginBottom: '1rem' }}>
              {warnings.map((warning) => (
                <li key={warning} style={{ marginBottom: '0.35rem' }}>{warning}</li>
              ))}
            </ul>
          </>
        )}

        <h3 style={{ marginBottom: '0.5rem' }}>Quick steps</h3>
        <ol style={{ marginTop: 0, marginBottom: 0 }}>
          <li>Create or update your `.env` from `.env.example`.</li>
          <li>Use `VITE_AUTH_PROVIDER=firebase` for default repo setup.</li>
          <li>Run `npm install` after pull/merge if dependencies changed.</li>
          <li>Restart the dev server after env changes.</li>
        </ol>
      </div>
    </main>
  );
}

export default StartupPreflight;
