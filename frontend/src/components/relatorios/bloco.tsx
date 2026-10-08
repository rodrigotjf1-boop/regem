'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { baixarCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { SkeletonList } from '@/components/ui/skeleton';
import { ListaDados, texto2, type Coluna } from '@/components/ui/lista';
import { ErroDeLeitura } from '@/components/relatorios/pecas';
import type { Leitura } from '@/components/relatorios/leitura';

// Peças das abas de "Relatórios de vendas" (mockup `mockups/regem-relatorios.html`):
//   Parte       → o que depende de UMA leitura: espera, mostra ou diz que não veio
//   Bloco       → um assunto da aba, com título, apoio e ações (Exportar CSV)
//   TabelaCurta → tabela longa dentro de um bloco: as primeiras linhas, quantas são e "mostrar todas"

/** O que depende de uma leitura. A falha fica só aqui: o resto da aba continua na tela. */
export function Parte<T>({ leitura, oQue, children }: { leitura: Leitura<T>; oQue: string; children: (dados: T) => React.ReactNode }) {
  if (leitura.semAcesso) return <SemDados>Seu perfil não tem acesso a {oQue}.</SemDados>;
  if (leitura.erro)
    return <ErroDeLeitura oQue={oQue} motivo={`${leitura.erro} O resto da tela não depende disto.`} aoTentar={leitura.recarregar} ocupado={leitura.carregando} />;
  if (leitura.dados === null) return <SkeletonList rows={3} />;
  return <>{children(leitura.dados)}</>;
}

export function Bloco({ id, titulo, apoio, acoes, children }: { id: string; titulo: string; apoio?: React.ReactNode; acoes?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="min-w-0 space-y-2" aria-labelledby={id}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h3 id={id} className="font-display text-base font-bold">{titulo}</h3>
          {apoio && <p className={`text-sm ${texto2}`}>{apoio}</p>}
        </div>
        {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      {children}
    </section>
  );
}

export function BotaoCsv({ nome, linhas }: { nome: string; linhas: Record<string, unknown>[] }) {
  if (!linhas.length) return null;
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => baixarCsv(nome, linhas)}>
      <Download className="h-4 w-4" aria-hidden="true" /> Exportar CSV
    </Button>
  );
}

/** Texto de quem não tem "Ver valores em R$": os traços deixam de ficar sem explicação. */
export function AvisoSemValores() {
  return (
    <p className="rounded-md border-l-4 border-l-info bg-info/10 px-3 py-2 text-sm" role="note">
      Seu perfil não tem a permissão “Ver valores em R$”: aparecem as quantidades; os valores ficam ocultos.
    </p>
  );
}

/** Sem nada no período: diz o que falta para aparecer. */
export function SemDados({ children }: { children: React.ReactNode }) {
  return <p className={`rounded-md border border-dashed border-input bg-card px-4 py-6 text-center text-sm ${texto2}`}>{children}</p>;
}

export function TabelaCurta<T>({
  legenda,
  linhas,
  chave,
  nome,
  colunas,
  oQue,
  primeiras = 10,
}: {
  legenda: string;
  linhas: T[];
  chave: (r: T, i: number) => string;
  nome: (r: T) => string;
  colunas: Coluna<T>[];
  /** O que são as linhas, no plural: "produtos". */
  oQue: string;
  primeiras?: number;
}) {
  const [todas, setTodas] = useState(false);
  const indice = new Map(linhas.map((r, i) => [r, i]));
  const visiveis = todas ? linhas : linhas.slice(0, primeiras);
  return (
    <div className="space-y-2">
      <ListaDados legenda={legenda} linhas={visiveis} chave={(r) => chave(r, indice.get(r) ?? 0)} nome={nome} colunas={colunas} />
      {linhas.length > primeiras && (
        <p className={`flex flex-wrap items-center gap-2 text-sm ${texto2}`}>
          <span role="status">{todas ? `Mostrando os ${linhas.length} ${oQue}.` : `Mostrando ${primeiras} de ${linhas.length} ${oQue}.`}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setTodas(!todas)} aria-expanded={todas}>
            {todas ? `Mostrar só os ${primeiras} primeiros` : `Mostrar os ${linhas.length}`}
          </Button>
        </p>
      )}
    </div>
  );
}
