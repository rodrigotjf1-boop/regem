'use client';

import { useParams } from 'next/navigation';
import { PremioDoPedido } from '@/components/rastreio/premio-do-pedido';

// O LINK PESSOAL DO PRÊMIO (`/p/<código>`, sem login; fase A1b do Clube): o prêmio que não vem de um pedido — o de
// desculpas que a equipe manda pelo caso do Atendimento (depois a classificação do marketing e a campanha). O código do
// link (128 bits) é a chave; a raspadinha e a roleta são as mesmas da página do pedido (`/r/…`).

const NAVY = '#0F2230';

export default function PaginaDoPremio() {
  const params = useParams<{ codigo: string }>();
  const codigo = String(params?.codigo ?? '');
  return (
    <main style={{ minHeight: '100dvh', background: '#eef1f5', color: NAVY, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '18px 16px 40px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontSize: 22 }} aria-hidden="true">
            🎁
          </span>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.08em', color: '#5b6b7c', textTransform: 'uppercase' }}>Clube da loja</div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800 }}>Um prêmio para você</h1>
          </div>
        </div>
        <PremioDoPedido
          caminho={`/clube/premio/${encodeURIComponent(codigo)}`}
          seNaoAchar={
            <div style={{ background: '#fff', border: '1px solid #d9e0e8', borderRadius: 14, padding: 24, marginTop: 12, textAlign: 'center' }}>
              <p style={{ margin: 0, fontWeight: 700 }}>Não achamos este prêmio.</p>
              <p style={{ margin: '6px 0 0', fontSize: 13.5, color: '#48586a' }}>Confira se o link chegou inteiro na mensagem da loja.</p>
            </div>
          }
        />
      </div>
    </main>
  );
}
