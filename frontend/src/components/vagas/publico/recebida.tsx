'use client';

import type { PaginaPublica } from '@/lib/vagas-ficha';
import { LogoDaLoja } from './capa';

// Ficha recebida: o protocolo (com hífen no meio, para ler ao telefone), o que acontece agora e "indicar um amigo" — o
// link das vagas marcado como indicação (`?o=indicacao`).
export function Recebida({ p, protocolo, nome, whatsapp, codigo, aoVoltar }: {
  p: PaginaPublica; protocolo: string; nome: string; whatsapp: string; codigo: string; aoVoltar: () => void;
}) {
  const primeiro = nome.trim().split(/\s+/)[0] ?? '';
  const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/v/${codigo}?o=indicacao`;
  const texto = `Tem vaga na ${p.loja.nome}! Veja e se candidate: ${link}`;
  return (
    <section className="vg-ok" aria-live="polite">
      <div className="vg-ok-selo" aria-hidden="true">
        <LogoDaLoja p={p} classe="" />
        <span className="vg-ok-check">✓</span>
      </div>
      <h2>{primeiro ? `Pronto, ${primeiro}! Ficha recebida.` : 'Ficha recebida!'}</h2>
      <p>Guarde o número da sua inscrição:</p>
      <div className="vg-protocolo">{protocolo.length === 6 ? `${protocolo.slice(0, 3)}-${protocolo.slice(3)}` : protocolo}</div>
      <div className="vg-cartao">
        <h2>O que acontece agora</h2>
        <ol className="vg-passos">
          <li>A gerência analisa as fichas.</li>
          <li>Se o seu perfil combinar com uma vaga, chamamos você no WhatsApp {whatsapp}.</li>
          <li>Sua ficha fica guardada por {p.pagina.guardaMeses} meses para as próximas vagas.</li>
        </ol>
      </div>
      <div className="vg-cartao">
        <h2>
          <span aria-hidden="true">🤝</span> Conhece alguém que também quer trabalhar aqui?
        </h2>
        <p style={{ textAlign: 'left' }}>Mande o link das vagas para um amigo.</p>
        <a className="vg-zap" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer">
          💬 Compartilhar no WhatsApp
        </a>
      </div>
      <button type="button" className="vg-cta" onClick={aoVoltar}>
        Voltar ao início
      </button>
      <p className="vg-mini">Mandou algo errado? Preencha de novo com o mesmo WhatsApp — a ficha nova substitui a anterior.</p>
    </section>
  );
}
