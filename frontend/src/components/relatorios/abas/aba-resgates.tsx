'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { baixarCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { SkeletonList } from '@/components/ui/skeleton';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, Situacoes, TituloLista, Vazio, brl, distintos, semAcento, type Situacao,
} from '@/components/ui/lista';
import { AvisoDeLimite, ErroDeLeitura } from '@/components/relatorios/pecas';
import type { Leitura } from '@/components/relatorios/leitura';
import { SemDados } from '@/components/relatorios/bloco';
import { dataHora } from '@/components/relatorios/formatos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ABAS FIDELIDADES e CASHBACKS — os resgates do período da TELA (antes cada uma tinha um período
// próprio, que não acompanhava o de cima). As rotas (`/fidelidade/relatorio/periodo` e
// `/cashback/relatorio`) pedem gerência e a permissão do módulo, e devolvem os 500 mais recentes.

const LIMITE = 500;

export type TipoDeResgate = {
  id: string;
  titulo: string;
  arquivo: string;
  oQue: string;
  /** O que falta a quem não entra: "a permissão “Fidelidade” e o nível de gerência". */
  pede: string;
  vazio: string;
  coluna: string;
  quando: (r: any) => unknown;
  item: (r: any) => string;
  detalhe: (r: any) => string;
  situacoes: Situacao<any>[];
  /** Filtro pelo item (o prêmio), quando faz sentido. */
  filtroDoItem?: { rotulo: string; todos: string };
};

export const FIDELIDADE: TipoDeResgate = {
  id: 'fidelidade',
  titulo: 'Prêmios de fidelidade resgatados',
  arquivo: 'premios-fidelidade',
  oQue: 'os prêmios resgatados',
  pede: 'a permissão “Fidelidade” e o nível de gerência',
  vazio: 'Nenhum prêmio resgatado neste período.',
  coluna: 'Prêmio',
  quando: (r) => r.resgatadoEm,
  item: (r) => String(r.premio ?? '—'),
  detalhe: (r) => String(r.detalhe ?? ''),
  situacoes: [],
  filtroDoItem: { rotulo: 'Prêmio', todos: 'Todos os prêmios' },
};
export const CASHBACK: TipoDeResgate = {
  id: 'cashback',
  titulo: 'Cashbacks resgatados',
  arquivo: 'cashbacks',
  oQue: 'os cashbacks resgatados',
  pede: 'a permissão “Cashback” e o nível de gerência',
  vazio: 'Nenhum cashback resgatado neste período.',
  coluna: 'Uso',
  quando: (r) => r.criadoEm,
  item: (r) => (r.tipo === 'valor' ? 'Saldo (R$)' : 'Pontos'),
  detalhe: (r) => (r.tipo === 'valor' ? brl(r.valor) : `${r.valor} pts`),
  situacoes: [
    { rotulo: 'Saldo em R$', filtro: (r) => r.tipo === 'valor' },
    { rotulo: 'Pontos', filtro: (r) => r.tipo !== 'valor' },
  ],
};

export function AbaResgates({ tipo, pode, leitura }: { tipo: TipoDeResgate; pode: boolean; leitura: Leitura<any[]> }) {
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [item, setItem] = useState('');
  const idTitulo = `${tipo.id}-aba-titulo`;

  // Sem acesso não é "0 resgates": a tela diz o que falta.
  if (!pode || leitura.semAcesso)
    return (
      <div className="space-y-3">
        <h2 id={idTitulo} tabIndex={-1} className="font-display text-xl font-bold outline-none">{tipo.titulo}</h2>
        <SemDados>Seu perfil não tem acesso a esta parte: ela pede {tipo.pede}.</SemDados>
      </div>
    );
  if (leitura.erro) return <ErroDeLeitura oQue={tipo.oQue} motivo={leitura.erro} aoTentar={leitura.recarregar} ocupado={leitura.carregando} />;
  if (!leitura.dados) return <SkeletonList rows={4} />;

  const todos = Array.isArray(leitura.dados) ? leitura.dados : [];
  const b = semAcento(busca);
  const base = todos.filter((r) => (!b || semAcento(`${r.telefone ?? ''} ${tipo.item(r)} ${tipo.detalhe(r)}`).includes(b)) && (!item || tipo.item(r) === item));
  const linhas = sit < 0 ? base : base.filter(tipo.situacoes[sit].filtro);
  const filtrando = !!(busca.trim() || item || sit >= 0);
  const limpar = () => { setBusca(''); setItem(''); setSit(-1); };
  const exportar = () => baixarCsv(tipo.arquivo, linhas.map((r) => ({ cliente: r.telefone ?? '', quando: dataHora(tipo.quando(r)), [tipo.coluna.toLowerCase()]: tipo.item(r), detalhe: tipo.detalhe(r) })));

  return (
    <section className="space-y-3" aria-labelledby={idTitulo}>
      <TituloLista id={idTitulo} titulo={tipo.titulo} total={todos.length} mostrando={linhas.length} um="resgate" varios="resgates">
        {linhas.length > 0 && <Button type="button" variant="outline" onClick={exportar}><Download className="h-4 w-4" aria-hidden="true" /> Exportar CSV</Button>}
      </TituloLista>
      <AvisoDeLimite linhas={todos.length} limite={LIMITE} oQue="os resgates" />
      {tipo.situacoes.length > 0 && <Situacoes base={base} opcoes={tipo.situacoes} valor={sit} aoMudar={setSit} />}
      <Filtros>
        <FiltroBusca id={`${tipo.id}-aba-busca`} valor={busca} aoMudar={setBusca} placeholder={`Telefone do cliente ou ${tipo.coluna.toLowerCase()}`} />
        {tipo.filtroDoItem && <FiltroSelect id={`${tipo.id}-aba-item`} rotulo={tipo.filtroDoItem.rotulo} todos={tipo.filtroDoItem.todos} opcoes={distintos(todos, tipo.item)} valor={item} aoMudar={setItem} />}
      </Filtros>
      {todos.length === 0 ? (
        <Vazio>{tipo.vazio}</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda={tipo.titulo}
          linhas={linhas}
          chave={(r) => String(r.id ?? `${r.telefone}-${tipo.quando(r)}-${tipo.item(r)}`)}
          nome={(r) => `resgate de ${r.telefone ?? 'cliente'}`}
          colunas={[
            { titulo: 'Cliente', celula: (r) => <span className="whitespace-nowrap font-mono font-bold">{r.telefone ?? '—'}</span> },
            { titulo: 'Quando', celula: (r) => <span className="whitespace-nowrap font-mono">{dataHora(tipo.quando(r))}</span> },
            { titulo: tipo.coluna, celula: (r) => <span className="break-words">{tipo.item(r)}</span> },
            { titulo: 'Detalhe', celula: (r) => <b className="break-words">{tipo.detalhe(r) || '—'}</b> },
          ]}
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}
    </section>
  );
}
