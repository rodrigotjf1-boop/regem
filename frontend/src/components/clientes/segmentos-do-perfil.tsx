'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS ABAS "PELO PERFIL" de Delivery › Clientes (F7 parte 1 do docs/plano-perfil-cliente.md, §6.3; protótipo, aba
// "Marketing" — público pelo perfil). Só para presidente e gerente com o módulo "Perfil do cliente" ligado (quem mostra é a
// página; o servidor recusa de novo — `conferirSegmentoDoPerfil`). As chaves são as do servidor (`common/segmentos-do-perfil.ts`).

export const SEGS_DO_PERFIL: { k: string; t: string; conta: (r: any) => number | undefined }[] = [
  { k: 'perfil_campeoes', t: 'Campeões', conta: (r) => r?.segmentos?.campeoes },
  { k: 'perfil_leais', t: 'Leais', conta: (r) => r?.segmentos?.leais },
  { k: 'perfil_recentes', t: 'Recentes', conta: (r) => r?.segmentos?.recentes },
  { k: 'perfil_atencao', t: 'Precisam de atenção', conta: (r) => r?.segmentos?.atencao },
  { k: 'perfil_em_risco', t: 'Em risco', conta: (r) => r?.segmentos?.em_risco },
  { k: 'perfil_inativos', t: 'Inativos', conta: (r) => r?.segmentos?.inativos },
  { k: 'perfil_atrasado', t: 'Atrasados no próprio ritmo', conta: (r) => r?.etiquetas?.atrasado },
  { k: 'perfil_dinheiro', t: 'Pedem no dinheiro no bolso', conta: (r) => r?.selos?.dinheiro },
  { k: 'perfil_feriado', t: 'Pedem em feriado', conta: (r) => r?.selos?.feriado },
  { k: 'perfil_comemorativa', t: 'Pedem em data comemorativa', conta: (r) => r?.selos?.comemorativa },
  { k: 'perfil_loja', t: 'Pedem nos eventos da loja', conta: (r) => r?.selos?.loja },
  { k: 'perfil_olhou', t: 'Olharam e não pediram', conta: (r) => r?.olharam },
];

const RFM = /^perfil_(campeoes|leais|recentes|atencao|em_risco|inativos)$/;

/** O nome da aba "pelo perfil" (para o título da campanha e do histórico). */
export const nomeDoSegmentoDoPerfil = (k: string) => SEGS_DO_PERFIL.find((s) => s.k === k)?.t;

export function SegmentosDoPerfil({ seg, aoEscolher }: { seg: string; aoEscolher: (k: string) => void }) {
  const [resumo, setResumo] = useState<any>(null);
  useEffect(() => {
    let vivo = true;
    api
      .perfilClienteResumo()
      .then((r: any) => vivo && setResumo(r))
      .catch(() => vivo && setResumo({}));
    return () => {
      vivo = false;
    };
  }, []);
  // Os segmentos (os 6 do RFM) sempre; o ritmo e os selos só quando há alguém neles.
  const abas = SEGS_DO_PERFIL.filter((s) => RFM.test(s.k) || Number(s.conta(resumo)) > 0);
  return (
    <div className="space-y-1.5" role="group" aria-labelledby="segmentos-do-perfil">
      <p id="segmentos-do-perfil" className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        Pelo perfil
      </p>
      <div className="flex flex-wrap gap-2">
        {abas.map((s) => {
          const n = s.conta(resumo);
          const ativo = seg === s.k;
          return (
            <button
              key={s.k}
              type="button"
              onClick={() => aoEscolher(s.k)}
              aria-pressed={ativo}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                ativo ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted/50'
              }`}
            >
              {s.t}
              <span className="ml-1.5 font-mono text-xs text-muted-foreground">{resumo ? Number(n ?? 0) : '…'}</span>
            </button>
          );
        })}
      </div>
      {seg.startsWith('perfil_') && (
        <p className="text-xs text-muted-foreground">
          Na campanha, os segmentos pelo perfil só alcançam quem aceitou receber ofertas com um clique (a caixa que já vem
          marcada no checkout não conta). Quem pediu só pelo iFood ou pela 99 não tem perfil.
        </p>
      )}
      {seg === 'perfil_olhou' && (
        <p className="text-xs text-muted-foreground">
          Abriram o mesmo produto 2 vezes ou mais nos últimos 30 dias e não pediram. Só entra quem entrou no cardápio com o
          código do WhatsApp e não desligou as “Recomendações”.
        </p>
      )}
    </div>
  );
}
