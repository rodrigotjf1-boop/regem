'use client';

import { useEffect, useRef, useState } from 'react';
import { useConexaoServidor } from '@/lib/conexao-servidor';
import { TEXTO_SEM_NUVEM, VOLTOU_FICA_MS, minutosDesde } from '@/lib/sem-nuvem';

// O SERVIDOR DA LOJA SEM FALAR COM A NUVEM (F1.4 do docs/plano-mister.md; protótipo
// mockups/regem-dependencias-e-qualidade.html, vista "Loja sem internet"). Só no app do servidor da loja.
//  • O servidor diz desde quando não fala com a nuvem na resposta da presença do PC (a cada 30 s — a mesma medição do
//    indicador "Servidor da loja"; nenhuma leitura a mais). A regra (2 min falhando, ou 5 sem nenhum envio certo) é do
//    servidor (`backend/src/modules/edge/conexao-nuvem.ts`).
//  • A faixa só avisa: nada é bloqueado. Quando volta, "✅ voltou" fica 1 minuto e some sozinho.
//  • Com o servidor da loja fora do ar, o aviso de servidor offline já está na tela: esta faixa não aparece junto.
const EDGE = process.env.NEXT_PUBLIC_EDGE === '1';

export function FaixaSemNuvem() {
  // EDGE é fixado na compilação: a escolha não muda entre renderizações (os ganchos ficam estáveis).
  return EDGE ? <FaixaNoServidor /> : null;
}

function FaixaNoServidor() {
  const c = useConexaoServidor();
  const desde = c.nuvem?.semConexaoDesde ?? null;
  const lida = !!c.nuvem;
  const [minutos, setMinutos] = useState<number | null>(null);
  const [voltou, setVoltou] = useState<number | null>(null);
  const caiuDesde = useRef<string | null>(null);

  // O "há 12 min" anda sozinho (a hora só fora do primeiro render — V35).
  useEffect(() => {
    if (!desde) {
      setMinutos(null);
      return;
    }
    const atualizar = () => setMinutos(minutosDesde(desde, Date.now()));
    atualizar();
    const t = setInterval(atualizar, 30_000);
    return () => clearInterval(t);
  }, [desde]);

  // Voltou: o servidor respondeu sem a falta, depois de ter avisado.
  useEffect(() => {
    if (desde) {
      caiuDesde.current = desde;
      setVoltou(null);
      return;
    }
    if (!lida || !caiuDesde.current) return;
    setVoltou(minutosDesde(caiuDesde.current, Date.now()));
    caiuDesde.current = null;
    const t = setTimeout(() => setVoltou(null), VOLTOU_FICA_MS);
    return () => clearTimeout(t);
  }, [desde, lida]);

  if (c.fase === 'caiu') return null;
  if (desde) {
    return (
      <div role="status" aria-live="polite" className="mx-5 mt-3 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border border-l-[5px] border-amber-500/40 border-l-amber-600 bg-card px-3 py-2.5">
        <div className="min-w-0 flex-[1_1_320px]">
          <p className="font-semibold">{TEXTO_SEM_NUVEM.titulo(minutos)}</p>
          <p className="text-sm text-muted-foreground">{TEXTO_SEM_NUVEM.detalhe}</p>
          <details className="mt-1.5 text-sm">
            <summary className="inline-flex min-h-10 cursor-pointer items-center rounded-md border border-border px-3 font-semibold">O que conferir</summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {TEXTO_SEM_NUVEM.conferir.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    );
  }
  if (voltou !== null) {
    return (
      <div role="status" aria-live="polite" className="mx-5 mt-3 rounded-lg border border-l-[5px] border-ok/40 border-l-ok bg-card px-3 py-2.5">
        <p className="font-semibold">{TEXTO_SEM_NUVEM.voltou(voltou)}</p>
        <p className="text-sm text-muted-foreground">{TEXTO_SEM_NUVEM.voltouDetalhe}</p>
      </div>
    );
  }
  return null;
}
