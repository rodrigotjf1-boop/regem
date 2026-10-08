'use client';

import { useState } from 'react';
import { FiltroBusca, FiltroSelect, Filtros, Situacoes, Vazio, semAcento, texto2, type Coluna, type Situacao } from '@/components/ui/lista';
import { Bloco, BotaoCsv, SemDados, TabelaCurta } from '@/components/relatorios/bloco';
import { plural, rs } from '@/components/relatorios/formatos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CURVA ABC DE PRODUTOS (aba Vendas) — `GET /relatorios/produtos`: cada produto vendido no período
// com quantidade, preço cheio, desconto da loja rateado, faturamento, custo e lucro. A classe vem
// do servidor (A = até 80% do faturamento acumulado, B = até 95%, C = o resto).

const CLASSES: Situacao<any>[] = [
  { rotulo: 'A — 80% do faturamento', filtro: (p) => p.classe === 'A' },
  { rotulo: 'B — os 15% seguintes', filtro: (p) => p.classe === 'B' },
  { rotulo: 'C — os 5% finais', filtro: (p) => p.classe === 'C' },
];
const ORDENS = [
  { v: 'valor', rotulo: 'Faturamento' },
  { v: 'qtd', rotulo: 'Quantidade' },
  { v: 'produto', rotulo: 'Nome do produto' },
] as const;
const TOM_DA_CLASSE: Record<string, string> = { A: 'bg-ok/15', B: 'bg-warn/15', C: 'bg-secondary' };

export function CurvaAbc({ itens, verFin }: { itens: any[]; verFin: boolean }) {
  const [busca, setBusca] = useState('');
  const [classe, setClasse] = useState(-1);
  const [ordem, setOrdem] = useState<string>('valor');

  const b = semAcento(busca);
  const base = itens.filter((p) => !b || semAcento(p.descricao).includes(b));
  const linhas = (classe < 0 ? base : base.filter(CLASSES[classe].filtro)).sort((x, y) =>
    ordem === 'qtd' ? Number(y.qtd) - Number(x.qtd) : ordem === 'produto' ? String(x.descricao).localeCompare(String(y.descricao), 'pt-BR') : Number(y.pct) - Number(x.pct),
  );
  const limpar = () => { setBusca(''); setClasse(-1); };

  const dinheiro = (titulo: string, celula: Coluna<any>['celula']): Coluna<any>[] => (verFin ? [{ titulo, celula, classe: 'whitespace-nowrap font-mono' }] : []);
  const colunas: Coluna<any>[] = [
    {
      titulo: 'Produto',
      celula: (p) => (
        <span className="flex items-center gap-2">
          <span className={`inline-flex h-6 w-6 flex-none items-center justify-center rounded text-xs font-bold ${TOM_DA_CLASSE[p.classe] ?? 'bg-secondary'}`} aria-label={`classe ${p.classe}`}>{p.classe}</span>
          <span className="min-w-0 break-words font-bold">{p.descricao}</span>
        </span>
      ),
    },
    { titulo: 'Qtd', celula: (p) => `${p.qtd}×`, classe: 'whitespace-nowrap font-mono' },
    ...dinheiro('Preço cheio', (p) => rs(p.bruto)),
    ...dinheiro('Desconto', (p) => (Number(p.desconto) > 0 ? `−${rs(p.desconto)}` : '—')),
    ...dinheiro('Faturamento', (p) => <b>{rs(p.faturamento)}</b>),
    ...dinheiro('Custo', (p) => (p.custo != null ? rs(p.custo) : <span className={`font-sans text-xs ${texto2}`}>sem custo cadastrado</span>)),
    ...dinheiro('Lucro', (p) => (p.lucro != null ? <>{rs(p.lucro)}{p.margemPct != null && <span className={`ml-1 text-xs ${texto2}`}>{String(p.margemPct).replace('.', ',')}%</span>}</> : '—')),
    { titulo: '% do total', celula: (p) => `${String(p.pct).replace('.', ',')}%`, classe: 'whitespace-nowrap font-mono' },
  ];
  const csv = itens.map((p) => ({
    classe: p.classe, produto: p.descricao, quantidade: p.qtd,
    ...(verFin ? { 'preço cheio': p.bruto, desconto: p.desconto, faturamento: p.faturamento, custo: p.custo ?? '', lucro: p.lucro ?? '', 'margem %': p.margemPct ?? '' } : {}),
    '% do total': p.pct,
  }));

  return (
    <Bloco id="abc-titulo" titulo="Curva ABC de produtos" apoio={itens.length ? plural(itens.length, 'produto vendido', 'produtos vendidos') : undefined} acoes={<BotaoCsv nome="curva-abc" linhas={csv} />}>
      {itens.length === 0 ? (
        <SemDados>Sem vendas neste período. A curva ABC aparece com a primeira venda.</SemDados>
      ) : (
        <div className="space-y-3">
          <Situacoes base={base} opcoes={CLASSES} valor={classe} aoMudar={setClasse} />
          <Filtros>
            <FiltroBusca id="abc-busca" valor={busca} aoMudar={setBusca} placeholder="Digite parte do nome do produto" />
            <FiltroSelect id="abc-ordem" rotulo="Ordenar por" opcoes={ORDENS} valor={ordem} aoMudar={setOrdem} />
          </Filtros>
          {linhas.length === 0 ? (
            <Vazio aoLimpar={limpar} />
          ) : (
            <TabelaCurta legenda="Curva ABC de produtos" linhas={linhas} chave={(p, i) => `${p.descricao}-${i}`} nome={(p) => p.descricao} colunas={colunas} oQue="produtos" />
          )}
        </div>
      )}
    </Bloco>
  );
}
