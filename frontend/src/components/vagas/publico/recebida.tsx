'use client';

import type { PaginaPublica } from '@/lib/vagas-ficha';
import { LogoDaLoja } from './capa';

// Ficha recebida: confete, o selo da loja, o protocolo em blocos (com hífen no meio, para ler ao telefone), o que acontece
// agora e "indicar um amigo" — o link das vagas marcado como indicação (`?o=indicacao`).

/** Confete fixo (posições por índice, sem sorteio: a mesma marcação no servidor e no navegador). */
const CONFETE = Array.from({ length: 24 }, (_, i) => ({
  left: `${(i * 37) % 100}%`,
  delay: `${((i * 0.53) % 3.2).toFixed(2)}s`,
  dur: `${(2.6 + ((i * 0.37) % 1.6)).toFixed(2)}s`,
  cor: ['var(--vg-d)', 'var(--vg-p)', '#ffffff', 'var(--vg-ok)'][i % 4],
}));
export function Recebida({ p, protocolo, nome, whatsapp, codigo, aoVoltar }: {
  p: PaginaPublica; protocolo: string; nome: string; whatsapp: string; codigo: string; aoVoltar: () => void;
}) {
  const primeiro = nome.trim().split(/\s+/)[0] ?? '';
  const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/v/${codigo}?o=indicacao`;
  const texto = `Tem vaga na ${p.loja.nome}! Veja e se candidate: ${link}`;
  const prot = protocolo.length === 6 ? `${protocolo.slice(0, 3)}-${protocolo.slice(3)}` : protocolo;
  return (
    <section className="vg-ok" aria-live="polite">
      <div className="vg-confete" aria-hidden="true">
        {CONFETE.map((c, i) => (
          <i key={i} style={{ left: c.left, background: c.cor, animationDelay: c.delay, animationDuration: c.dur }} />
        ))}
      </div>
      <div className="vg-ok-selo" aria-hidden="true">
        <LogoDaLoja p={p} classe="" />
        <span className="vg-ok-check">✓</span>
      </div>
      <h2>{primeiro ? `Pronto, ${primeiro}! Ficha recebida.` : 'Ficha recebida!'}</h2>
      <p>Guarde o número da sua inscrição:</p>
      <span className="vg-sr">Número da inscrição: {prot}</span>
      <div className="vg-protocolo" aria-hidden="true">
        {prot.split('').map((ch, i) => (
          <span key={i} className={ch === '-' ? 'vg-hifen' : undefined}>
            {ch === '-' ? '–' : ch}
          </span>
        ))}
      </div>
      <div className="vg-cartao">
        <h2>O que acontece agora</h2>
        <ol className="vg-passos">
          <li>
            <span>
              <b>A gerência analisa as fichas</b>
            </span>
          </li>
          <li>
            <span>
              <b>Chamamos você no WhatsApp</b>
              <span>{whatsapp}, se o seu perfil combinar com uma vaga.</span>
            </span>
          </li>
          <li>
            <span>
              <b>Ficha guardada por {p.pagina.guardaMeses} meses</b>
              <span>Para as próximas vagas.</span>
            </span>
          </li>
        </ol>
      </div>
      <div className="vg-cartao">
        <h2>
          <span aria-hidden="true">🤝</span> Conhece alguém que também quer trabalhar aqui?
        </h2>
        <p>Mande o link das vagas para um amigo.</p>
        <a className="vg-zap" href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener noreferrer">
          Compartilhar no WhatsApp
        </a>
      </div>
      <button type="button" className="vg-cta" onClick={aoVoltar}>
        Voltar ao início
      </button>
      <p className="vg-mini">Mandou algo errado? Preencha de novo com o mesmo WhatsApp — a ficha nova substitui a anterior.</p>
    </section>
  );
}
