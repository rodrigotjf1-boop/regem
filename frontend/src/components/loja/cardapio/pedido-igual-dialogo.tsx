'use client';

import { useEffect, useRef } from 'react';
import { textoDoRepetido, tituloDoRepetido, type PedidoRepetidoPergunta } from './pedido-igual';

// A pergunta do PEDIDO IGUAL no checkout (mig 360; protótipo `mockups/regem-alteracao-pedido.html`, aba "Cardápio
// online"): folha de baixo, como a do "Cheguei". Nada é enviado antes da resposta; "Não, foi engano" (ou Esc, ou tocar
// fora) fecha sem enviar e o carrinho continua.
export function PedidoIgualDialogo({
  pergunta,
  itens,
  enviando,
  onSim,
  onNao,
}: {
  pergunta: PedidoRepetidoPergunta;
  itens: { chave: string; texto: string }[];
  enviando: boolean;
  onSim: () => void;
  onNao: () => void;
}) {
  const primeiro = useRef<HTMLButtonElement | null>(null);
  // O foco vai ao primeiro botão UMA vez (a tela de trás redesenha a cada consulta e não pode puxar o foco de volta).
  const naoAtual = useRef(onNao);
  naoAtual.current = onNao;
  useEffect(() => {
    primeiro.current?.focus();
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') naoAtual.current();
    };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={(e) => e.target === e.currentTarget && onNao()}
      data-pedido-igual
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="igual-titulo"
        aria-describedby="igual-texto"
        className="w-full max-w-md space-y-3 rounded-t-2xl bg-white p-4 pb-6 text-neutral-900 shadow-2xl"
      >
        <p id="igual-titulo" className="text-lg font-extrabold">
          {tituloDoRepetido(pergunta)}
        </p>
        <p id="igual-texto" className="text-[15px]">
          {textoDoRepetido(pergunta)}
        </p>
        {itens.length > 0 && (
          <ul className="space-y-0.5 rounded-xl bg-neutral-100 px-3 py-2 text-sm" aria-label="Itens do pedido">
            {itens.map((i) => (
              <li key={i.chave} className="break-words">
                {i.texto}
              </li>
            ))}
          </ul>
        )}
        <p className="font-bold">Quer fazer outro pedido igual?</p>
        <div className="grid gap-2">
          <button
            ref={primeiro}
            type="button"
            onClick={onNao}
            className="min-h-[48px] w-full rounded-xl px-4 text-base font-extrabold"
            style={{ background: '#E2A340', color: '#281B06' }}
          >
            Não, foi engano
          </button>
          <button
            type="button"
            onClick={onSim}
            disabled={enviando}
            className="min-h-[48px] w-full rounded-xl border border-neutral-300 bg-white px-4 text-base font-bold"
          >
            {enviando ? 'Enviando…' : 'Sim, fazer outro igual'}
          </button>
        </div>
        {!pergunta.provado && (
          <p className="text-xs text-neutral-600">Para ver o outro pedido, use o link que chegou no seu WhatsApp.</p>
        )}
      </div>
    </div>
  );
}
