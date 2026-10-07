'use client';

import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

// Peças comuns das listas do Estoque (modelo aprovado em Produtos e nas 8 abas seguintes — mockup
// `mockups/regem-estoque-abas.html`). Toda aba monta a tela com as mesmas partes:
//   TituloLista  → o título com a CONTAGEM ("3 de 12 fichas") e as ações da aba
//   Situacoes    → as situações com a quantidade de cada uma; clicar filtra
//   Filtros      → busca, período e os filtros próprios
//   ListaDados   → tabela a partir de 1280 px, cartões abaixo, com as ações na linha
// Criar/editar vai na Gaveta e confirmar/conferir no Dialogo (`ui/sobreposto.tsx`).

/** Texto de apoio legível (o `muted-foreground` é claro demais para ler). */
export const texto2 = 'text-secondary-foreground';

export const brl = (n: unknown) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const num = (n: unknown) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
export const semAcento = (s: unknown) =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Hoje no fuso da loja (yyyy-mm-dd). `toISOString()` daria UTC: à noite já seria amanhã. */
export const hojeIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
/** "2026-10-07" → "07/10" (com o ano quando não é o corrente). */
export function dataBr(iso: unknown): string {
  const s = String(iso ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  return `${s.slice(8, 10)}/${s.slice(5, 7)}${s.slice(0, 4) === hojeIso().slice(0, 4) ? '' : `/${s.slice(0, 4)}`}`;
}
/** Dias de hoje até a data (negativo = já passou). */
export function diasAte(iso: unknown): number {
  const s = String(iso ?? '').slice(0, 10);
  return Math.round((Date.parse(`${s}T12:00:00Z`) - Date.parse(`${hojeIso()}T12:00:00Z`)) / 86400000);
}

// ── período: o corte é feito no SERVIDOR (a lista não cresce para sempre) ───────────────────
export const PERIODOS = [
  { v: '7', rotulo: 'Últimos 7 dias' },
  { v: '30', rotulo: 'Últimos 30 dias' },
  { v: '90', rotulo: 'Últimos 90 dias' },
  { v: '', rotulo: 'Todo o período' },
] as const;
export const PERIODO_PADRAO = '30';
/** `?inicio=…&fim=…` do período escolhido ('' = todo o período → sem consulta). */
export function consultaDoPeriodo(v: string): string {
  if (!v) return '';
  const fim = hojeIso();
  const inicio = new Date(Date.parse(`${fim}T12:00:00Z`) - Number(v) * 86400000).toISOString().slice(0, 10);
  return `?inicio=${inicio}&fim=${fim}`;
}

/** Tela larga = tabela; estreita = cartões. As abas só são desenhadas no navegador, após a carga. */
export function useTelaLarga(): boolean {
  const consulta = '(min-width: 1280px)';
  const [larga, setLarga] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches);
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const ouvir = () => setLarga(mq.matches);
    ouvir();
    mq.addEventListener('change', ouvir);
    return () => mq.removeEventListener('change', ouvir);
  }, []);
  return larga;
}

// ── selo de situação: o fundo dá a cor, o texto fica em tinta (contraste) ───────────────────
const TOM = {
  ok: ['bg-ok/15', 'bg-ok'],
  aviso: ['bg-warn/15', 'bg-warn'],
  critico: ['bg-destructive/15', 'bg-destructive'],
  info: ['bg-info/15', 'bg-info'],
  neutro: ['bg-secondary', ''],
} as const;
export type Tom = keyof typeof TOM;
export function Selo({ tom = 'neutro', children }: { tom?: Tom; children: React.ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold', TOM[tom][0], tom === 'neutro' ? texto2 : 'text-foreground')}>
      {TOM[tom][1] && <span className={cn('h-2 w-2 flex-none rounded-full', TOM[tom][1])} aria-hidden="true" />}
      {children}
    </span>
  );
}

// ── título com a contagem ───────────────────────────────────────────────────────────────────
export function TituloLista({
  id,
  titulo,
  total,
  mostrando,
  um,
  varios,
  extra,
  children,
}: {
  id: string;
  titulo: string;
  /** Quantos existem (no período, quando a aba tem período). */
  total: number;
  /** Quantos estão na tela depois dos filtros. */
  mostrando: number;
  um: string;
  varios: string;
  /** Complemento do resumo: "últimos 30 dias · perda de R$ 141,68". */
  extra?: string;
  /** Ações da aba (botão de criar etc.). */
  children?: React.ReactNode;
}) {
  const nome = total === 1 ? um : varios;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 id={id} tabIndex={-1} className="font-display text-xl font-bold outline-none">{titulo}</h2>
        <p className={`text-sm ${texto2}`} role="status" aria-live="polite">
          {mostrando === total ? `${total} ${nome}` : `${mostrando} de ${total} ${nome}`}
          {extra ? ` · ${extra}` : ''}
        </p>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

// ── situações com quantidade ────────────────────────────────────────────────────────────────
export type Situacao<T> = { rotulo: string; filtro: (r: T) => boolean; tom?: 'aviso' | 'critico' };
export function Situacoes<T>({
  base,
  opcoes,
  valor,
  aoMudar,
}: {
  /** Linhas já passadas pela busca e pelos outros filtros — é sobre elas que cada situação conta. */
  base: T[];
  opcoes: Situacao<T>[];
  /** Índice da situação ligada; -1 = todas. */
  valor: number;
  aoMudar: (i: number) => void;
}) {
  const ficha = (ligada: boolean) =>
    cn(
      'inline-flex min-h-10 items-center gap-2 whitespace-nowrap rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      ligada ? 'border-foreground bg-foreground text-background' : `border-input bg-card ${texto2} hover:border-secondary-foreground hover:text-foreground`,
    );
  const conta = (ligada: boolean, tom?: 'aviso' | 'critico') =>
    cn(
      'rounded-full px-2 py-px font-mono text-xs',
      ligada ? 'bg-background/20 text-background' : tom === 'critico' ? 'bg-destructive/15 text-foreground' : tom === 'aviso' ? 'bg-warn/15 text-foreground' : 'bg-secondary text-foreground',
    );
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Situação">
      <button type="button" aria-pressed={valor < 0} className={ficha(valor < 0)} onClick={() => aoMudar(-1)}>
        Todas <span className={conta(valor < 0)}>{base.length}</span>
      </button>
      {opcoes.map((o, i) => (
        <button key={o.rotulo} type="button" aria-pressed={valor === i} className={ficha(valor === i)} onClick={() => aoMudar(valor === i ? -1 : i)}>
          {o.rotulo} <span className={conta(valor === i, o.tom)}>{base.filter(o.filtro).length}</span>
        </button>
      ))}
    </div>
  );
}

// ── filtros ─────────────────────────────────────────────────────────────────────────────────
export function Filtros({ children }: { children: React.ReactNode }) {
  return <Card className="grid grid-cols-2 gap-3 p-3 md:grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">{children}</Card>;
}
export function FiltroBusca({ id, valor, aoMudar, placeholder = 'Digite parte do nome' }: { id: string; valor: string; aoMudar: (v: string) => void; placeholder?: string }) {
  return (
    <div className="col-span-2 space-y-1">
      <Label htmlFor={id}>Buscar</Label>
      <Input id={id} type="search" value={valor} onChange={(e) => aoMudar(e.target.value)} placeholder={placeholder} autoComplete="off" />
    </div>
  );
}
export function FiltroSelect({
  id,
  rotulo,
  todos,
  opcoes,
  valor,
  aoMudar,
}: {
  id: string;
  rotulo: string;
  /** Texto da opção "sem filtro" ("Todos os fornecedores"); ausente = não há essa opção. */
  todos?: string;
  opcoes: readonly (string | { v: string; rotulo: string })[];
  valor: string;
  aoMudar: (v: string) => void;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <Label htmlFor={id}>{rotulo}</Label>
      <Select id={id} value={valor} onChange={(e) => aoMudar(e.target.value)}>
        {todos !== undefined && <option value="">{todos}</option>}
        {opcoes.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.v} value={o.v}>{o.rotulo}</option>))}
      </Select>
    </div>
  );
}
/** Valores distintos de um campo, em ordem alfabética — as opções de um filtro. */
export function distintos<T>(linhas: T[], campo: (r: T) => string | null | undefined): string[] {
  return [...new Set(linhas.map(campo).filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// ── a lista: tabela (≥ 1280 px) ou cartões ──────────────────────────────────────────────────
export type Coluna<T> = { titulo: string; celula: (r: T) => React.ReactNode; classe?: string };
export type Acao<T> = {
  rotulo: string;
  icone: LucideIcon;
  aoClicar: (r: T) => void;
  /** `primaria` = botão cheio, sempre com o texto; `perigo` = vermelho ao passar. */
  tom?: 'primaria' | 'perigo';
  /** Desligada para esta linha (ex.: outra ação da mesma linha em andamento). */
  ocupada?: (r: T) => boolean;
};
export function ListaDados<T>({
  legenda,
  linhas,
  chave,
  nome,
  colunas,
  acoes,
}: {
  /** Descrição da tabela para leitor de tela. */
  legenda: string;
  linhas: T[];
  chave: (r: T) => string;
  /** Nome da linha para o rótulo das ações ("Editar X-burger"). */
  nome: (r: T) => string;
  /** A 1ª coluna é o título do cartão no celular. */
  colunas: Coluna<T>[];
  acoes?: (r: T) => Acao<T>[];
}) {
  const larga = useTelaLarga();
  const botoes = (r: T, noCartao: boolean) => {
    const lista = acoes?.(r) ?? [];
    if (!lista.length) return null;
    return (
      <div className={cn('flex gap-1', noCartao ? 'flex-wrap' : 'justify-end')}>
        {lista.map((a) => {
          const Icone = a.icone;
          const base = 'inline-flex min-h-10 min-w-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
          const cor =
            a.tom === 'primaria'
              ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
              : a.tom === 'perigo'
                ? `${noCartao ? 'border-input' : 'border-transparent'} ${texto2} hover:border-destructive hover:bg-destructive/10 hover:text-foreground`
                : `${noCartao ? 'border-input' : 'border-transparent'} ${texto2} hover:border-input hover:bg-secondary hover:text-foreground`;
          return (
            <button key={a.rotulo} type="button" title={a.rotulo} aria-label={`${a.rotulo}: ${nome(r)}`} disabled={a.ocupada?.(r)}
              className={cn(base, cor, noCartao && 'flex-1')} onClick={() => a.aoClicar(r)}>
              <Icone className="h-4 w-4" aria-hidden="true" />
              {/* Na tabela, a ação secundária mostra o texto só na tela bem larga; a primária, sempre. */}
              <span className={noCartao || a.tom === 'primaria' ? '' : 'hidden 2xl:inline'}>{a.rotulo}</span>
            </button>
          );
        })}
      </div>
    );
  };

  if (larga)
    return (
      <Card className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{legenda}</caption>
          <thead>
            <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
              {colunas.map((c) => <th key={c.titulo} scope="col" className="px-3 py-2.5 font-bold">{c.titulo}</th>)}
              {acoes && <th scope="col" className="px-3 py-2.5"><span className="sr-only">Ações</span></th>}
            </tr>
          </thead>
          <tbody>
            {linhas.map((r) => (
              <tr key={chave(r)} className="border-b border-border last:border-b-0 hover:bg-secondary/60">
                {colunas.map((c, i) => <td key={c.titulo} className={cn('px-3 py-2.5 align-middle', i === 0 && 'max-w-80', c.classe)}>{c.celula(r)}</td>)}
                {acoes && <td className="px-2 py-1.5">{botoes(r, false)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    );
  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2" aria-label={legenda}>
      {linhas.map((r) => (
        <li key={chave(r)}>
          <Card className="space-y-2 p-3">
            <div>{colunas[0].celula(r)}</div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              {colunas.slice(1).map((c) => (
                <div key={c.titulo} className="contents">
                  <dt className={`text-xs font-bold ${texto2}`}>{c.titulo}</dt>
                  <dd className="text-right">{c.celula(r)}</dd>
                </div>
              ))}
            </dl>
            {botoes(r, true)}
          </Card>
        </li>
      ))}
    </ul>
  );
}

/** Nome em destaque com uma linha de apoio embaixo — a 1ª coluna típica. */
export function NomeComApoio({ nome, apoio, children }: { nome: React.ReactNode; apoio?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <>
      <span className="flex flex-wrap items-center gap-1.5 font-bold"><span className="min-w-0 break-words">{nome}</span>{children}</span>
      {apoio && <span className={`block text-xs ${texto2}`}>{apoio}</span>}
    </>
  );
}

/** Lista vazia: sem nada cadastrado (texto próprio) ou sem nada com os filtros (oferece limpar). */
export function Vazio({ aoLimpar, children }: { aoLimpar?: () => void; children?: React.ReactNode }) {
  return (
    <Card className={`flex flex-wrap items-center justify-center gap-3 p-8 text-center text-sm ${texto2}`}>
      {aoLimpar ? (
        <>
          Nada com esses filtros.
          <Button type="button" variant="outline" size="sm" onClick={aoLimpar}>Limpar filtros</Button>
        </>
      ) : (
        children
      )}
    </Card>
  );
}
