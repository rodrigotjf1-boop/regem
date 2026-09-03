'use client';

// Fronteira de erro GLOBAL (raiz): captura falhas no próprio layout raiz. Precisa renderizar o
// seu próprio <html>/<body> pois SUBSTITUI o layout. É a última rede antes da tela branca do Next.
// Estilos inline (sem depender de Tailwind/tema, que podem não ter carregado num erro de raiz).
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="pt-BR">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#EDF0F4',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          color: '#0F2230',
        }}
      >
        <div
          style={{
            maxWidth: 420,
            width: '100%',
            margin: 16,
            padding: 24,
            background: '#fff',
            borderRadius: 16,
            textAlign: 'center',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          <div style={{ fontSize: 28 }}>⚠️</div>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: '8px 0 4px' }}>Algo deu errado</h1>
          <p style={{ fontSize: 14, color: 'rgba(15,34,48,0.6)', margin: 0 }}>
            Recarregue a página. Se o problema continuar, feche e abra o app de novo.
          </p>
          {error?.digest && (
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(15,34,48,0.4)', marginTop: 12 }}>
              Código: {error.digest}
            </p>
          )}
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 20,
              background: '#E2A340',
              color: '#fff',
              border: 0,
              borderRadius: 8,
              padding: '10px 18px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Recarregar
          </button>
        </div>
      </body>
    </html>
  );
}
