'use client';

import { Ajustes, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { Card } from '@/components/ui/card';
import { Selo, texto2 } from '@/components/ui/lista';
import { cn } from '@/lib/utils';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ONDE CADA DOCUMENTO SAI (central de impressão, fase 2; mockup `mockups/regem-impressao-onde-sai.html`).
// Cada documento tem uma lista de impressoras, cada uma com as suas vias (decisões do dono, 17/10/2026:
// "1A 2A 3A" e "mais de um local para sair"). Quem decide é o servidor (`common/regras-impressao.ts`);
// a tela só escolhe. Documento sem regra segue o caminho de sempre — e a tela diz qual é.
//
// Cada documento é um ajuste "livre" da tela de ajustes: o valor é a regra em texto (JSON, chaves em
// ordem fixa) ou "sem" (sem regra). A diferença entre o da tela e o gravado é o que está pendente.

export type Alvo = { id: string; vias: number };
type Balcao = { pdv: boolean; pdvVias: number; impressoras: Alvo[] };
type Delivery = { impressoras: Alvo[] };
/** Retirada e comanda do entregador: nas mesmas do delivery (o padrão) ou numa lista própria. */
type MesmasOuLista = { mesmasDoDelivery: boolean; impressoras: Alvo[] };
export type Documento = 'balcao' | 'delivery' | 'retirada' | 'entregador';
export const SEM = 'sem';
const VIAS_MAX = 5;

const lista = (v: any): Alvo[] => (Array.isArray(v) ? v : []).filter((a) => a && typeof a.id === 'string').map((a) => ({ id: a.id, vias: Math.min(VIAS_MAX, Math.max(1, Math.floor(Number(a.vias) || 1))) }));
/** A regra salva → o valor do ajuste (o mesmo texto para a mesma regra: chaves sempre na mesma ordem). */
export function valorDaRegra(doc: Documento, r: any): string {
  if (!r || typeof r !== 'object') return SEM;
  if (doc === 'balcao') {
    const b: Balcao = { pdv: r.pdv !== false, pdvVias: lista([{ id: 'x', vias: r.pdvVias }])[0].vias, impressoras: lista(r.impressoras) };
    return !b.pdv && !b.impressoras.length ? SEM : JSON.stringify(b);
  }
  if (doc === 'delivery') {
    const d: Delivery = { impressoras: lista(r.impressoras) };
    return d.impressoras.length ? JSON.stringify(d) : SEM;
  }
  const e: MesmasOuLista = { mesmasDoDelivery: r.mesmasDoDelivery !== false, impressoras: lista(r.impressoras) };
  return e.mesmasDoDelivery ? SEM : JSON.stringify(e); // "nas mesmas do delivery" é o padrão (2A; retirada, 20/10)
}
/** O valor do ajuste → o que vai para o servidor (`null` = volta a "sem regra"). */
export function regraDoValor(v: Valor | undefined): any {
  return !v || v === SEM ? null : JSON.parse(String(v));
}
const ler = <T,>(v: Valor | undefined, padrao: T): T => (v && v !== SEM ? (JSON.parse(String(v)) as T) : padrao);

type Impressora = { id: string; nome: string; ativo?: boolean; fazCupom?: boolean; fazEtiqueta?: boolean; conexao?: string | null; host?: string | null; estacaoId?: string | null };

/** Onde a impressora fica, em palavras: a estação do PC, o servidor da loja ou a rede. */
function onde(p: Impressora, estacoes: Map<string, string>): string {
  if (p.conexao === 'local') return p.estacaoId ? `USB · ${estacoes.get(p.estacaoId) ?? 'num PC com estação'}` : 'no servidor da loja';
  return p.host ? `rede · ${p.host}` : 'rede';
}

/** Lista de marcar: cada impressora com as suas vias. `extra` = a "impressora do PDV que vendeu". */
function Marcar({
  id,
  rotulo,
  impressoras,
  estacoes,
  marcadas,
  aoMudar,
  extra,
}: {
  id: string;
  rotulo: string;
  impressoras: Impressora[];
  estacoes: Map<string, string>;
  marcadas: Alvo[];
  aoMudar: (lista: Alvo[]) => void;
  extra?: { rotulo: string; detalhe: string; ligado: boolean; vias: number; aoMudar: (ligado: boolean, vias: number) => void };
}) {
  const vias = (n: number, mudar: (n: number) => void, idCampo: string, nome: string) => (
    <label htmlFor={idCampo} className={`flex items-center gap-1.5 text-sm ${texto2}`}>
      vias
      <select
        id={idCampo}
        aria-label={`Vias na ${nome}`}
        value={n}
        onChange={(e) => mudar(Number(e.target.value))}
        className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
      >
        {Array.from({ length: VIAS_MAX }, (_, i) => i + 1).map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
    </label>
  );
  const linha = (chave: string, nome: string, detalhe: string, ligado: boolean, n: number, mudar: (ligado: boolean, n: number) => void, fora?: boolean) => (
    <li key={chave} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2', ligado ? 'border-primary bg-primary/10' : 'border-border')}>
      <label htmlFor={`${id}-${chave}`} className="flex min-w-[12rem] flex-1 items-start gap-2">
        <input id={`${id}-${chave}`} type="checkbox" className="mt-1 h-4 w-4 flex-none accent-primary" checked={ligado} onChange={(e) => mudar(e.target.checked, n)} />
        {/* O nome com a largura toda; onde fica, embaixo (em 375 px o nome quebrava no meio da palavra). */}
        <span className="min-w-0">
          <span className="block break-words font-semibold">{nome}</span>
          <span className={`block text-xs ${texto2}`}>{detalhe}</span>
          {fora && <Selo tom="aviso">fora da lista de cupom</Selo>}
        </span>
      </label>
      {ligado && vias(n, (k) => mudar(true, k), `${id}-${chave}-vias`, nome)}
    </li>
  );
  const pega = (pid: string) => marcadas.find((a) => a.id === pid);
  const mudar = (pid: string) => (ligado: boolean, n: number) =>
    aoMudar(ligado ? [...marcadas.filter((a) => a.id !== pid), { id: pid, vias: n }] : marcadas.filter((a) => a.id !== pid));
  const naLista = new Set(impressoras.map((p) => p.id));
  return (
    <ul className="grid gap-1.5" role="group" aria-label={rotulo}>
      {extra && linha('pdv', extra.rotulo, extra.detalhe, extra.ligado, extra.vias, extra.aoMudar)}
      {impressoras.map((p) => linha(p.id, p.nome, onde(p, estacoes), !!pega(p.id), pega(p.id)?.vias ?? 1, mudar(p.id)))}
      {/* Marcada antes e que saiu da lista (desmarcaram "Cupom do cliente"): aparece para poder tirar. */}
      {marcadas.filter((a) => !naLista.has(a.id)).map((a) => linha(a.id, 'Impressora fora da lista', 'desmarque para tirar', true, a.vias, mudar(a.id), true))}
    </ul>
  );
}

export function OndeCadaDocumento({
  impressoras,
  estacoes,
  valores,
  salvos,
  aoMudar,
  aoSalvar,
  aoDescartar,
  salvando,
  erro,
  pode,
}: {
  impressoras: Impressora[];
  estacoes: Map<string, string>;
  valores: Valores;
  salvos: Valores;
  aoMudar: (chave: string, v: Valor) => void;
  aoSalvar: () => void;
  aoDescartar: () => void;
  salvando: boolean;
  erro: string;
  pode: boolean;
}) {
  // As de cupom em uso (a de etiqueta não entra): é delas que se escolhe.
  const deCupom = impressoras.filter((p) => p.ativo !== false && p.fazCupom && !p.fazEtiqueta);
  const todasDeCupom = deCupom.length;
  const nomes = (alvos: Alvo[]) => alvos.map((a) => `${impressoras.find((p) => p.id === a.id)?.nome ?? 'impressora'}${a.vias > 1 ? ` (${a.vias} vias)` : ''}`).join(', ');

  const balcao = ler<Balcao>(valores.balcao, { pdv: false, pdvVias: 1, impressoras: [] });
  const delivery = ler<Delivery>(valores.delivery, { impressoras: [] });
  const retirada = ler<MesmasOuLista>(valores.retirada, { mesmasDoDelivery: true, impressoras: [] });
  const entregador = ler<MesmasOuLista>(valores.entregador, { mesmasDoDelivery: true, impressoras: [] });
  const guardar = (doc: Documento, r: any) => aoMudar(doc, valorDaRegra(doc, r));

  const resumoBalcao =
    valores.balcao === SEM
      ? 'Sem regra: no PDV sai na impressora dele; na conta da mesa, em todas as de cupom.'
      : `Sai em: ${[balcao.pdv ? `impressora do PDV que vendeu${balcao.pdvVias > 1 ? ` (${balcao.pdvVias} vias)` : ''}` : '', nomes(balcao.impressoras)].filter(Boolean).join(', ')}.`;
  const resumoDelivery = valores.delivery === SEM ? `Sem impressora escolhida: sai em todas as de cupom (${todasDeCupom}), como hoje.` : `Sai em: ${nomes(delivery.impressoras)}.`;
  const resumoRetirada =
    valores.retirada === SEM ? 'Nas mesmas da via do delivery.' : retirada.impressoras.length ? `Sai em: ${nomes(retirada.impressoras)}.` : `Sem impressora escolhida: sai em todas as de cupom (${todasDeCupom}).`;
  const resumoEntregador =
    valores.entregador === SEM ? 'Nas mesmas da via do delivery.' : entregador.impressoras.length ? `Sai em: ${nomes(entregador.impressoras)}.` : 'Sem impressora escolhida: sai no PDV que pediu ou em todas as de cupom.';

  if (!pode)
    return (
      <section className="space-y-3" aria-labelledby="onde-titulo">
        <h2 id="onde-titulo" tabIndex={-1} className="font-display text-xl font-bold outline-none">Onde cada documento sai</h2>
        <Card className="p-4">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6">
            <dt className="font-bold">Via do cliente (balcão e mesa)</dt><dd>{resumoBalcao}</dd>
            <dt className="font-bold">Via do delivery</dt><dd>{resumoDelivery}</dd>
            <dt className="font-bold">Via da retirada</dt><dd>{resumoRetirada}</dd>
            <dt className="font-bold">Comanda do entregador</dt><dd>{resumoEntregador}</dd>
          </dl>
        </Card>
        <p className={`text-sm ${texto2}`}>Só o presidente e o gerente mudam onde cada documento sai.</p>
      </section>
    );

  const grupos: GrupoDeAjustes[] = [
    {
      titulo: 'Venda no balcão e na mesa',
      itens: [
        {
          id: 'balcao',
          rotulo: 'Via do cliente',
          ajuda: <>Sai ao fechar a venda ou a conta da mesa. {resumoBalcao}</>,
          tipo: 'livre',
          palavras: 'balcão mesa pdv via do cliente cupom',
          desenhar: () => (
            <Marcar
              id="onde-balcao"
              rotulo="Via do cliente sai em"
              impressoras={deCupom}
              estacoes={estacoes}
              marcadas={balcao.impressoras}
              aoMudar={(l) => guardar('balcao', { ...balcao, impressoras: l })}
              extra={{
                rotulo: 'Impressora do PDV que vendeu',
                detalhe: 'na mesa, a do caixa que fechou a conta',
                ligado: balcao.pdv,
                vias: balcao.pdvVias,
                aoMudar: (ligado, n) => guardar('balcao', { ...balcao, pdv: ligado, pdvVias: n }),
              }}
            />
          ),
        },
      ],
    },
    {
      titulo: 'Delivery',
      nota: 'Pedidos do iFood, 99, cardápio e telefone. O pedido do totem segue como hoje.',
      itens: [
        {
          id: 'delivery',
          rotulo: 'Via do delivery',
          // Sem regra, o aviso amarelo logo abaixo já diz para onde vai (não repete aqui).
          ajuda: <>Sai ao aceitar o pedido e leva o QR do entregador.{valores.delivery === SEM ? '' : ` ${resumoDelivery}`}</>,
          tipo: 'livre',
          palavras: 'delivery ifood 99 cardápio telefone via do caixa',
          desenhar: () => (
            <div className="space-y-2">
              {valores.delivery === SEM && (
                <p role="status" className="rounded-md border-l-4 border-warn bg-warn/10 px-2.5 py-1.5 text-sm text-foreground">
                  Ainda não escolhida: sai em todas as de cupom ({todasDeCupom}), como hoje.
                </p>
              )}
              <Marcar
                id="onde-delivery"
                rotulo="Via do delivery sai em"
                impressoras={deCupom}
                estacoes={estacoes}
                marcadas={delivery.impressoras}
                aoMudar={(l) => guardar('delivery', { impressoras: l })}
              />
            </div>
          ),
        },
        {
          // Pedido do dono (20/10/2026): a retirada (pedido de canal que o cliente busca no balcão) à
          // parte do delivery — ex.: na impressora do caixa, que entrega o pedido.
          id: 'retirada',
          rotulo: 'Via da retirada',
          ajuda: <>Pedido de canal para o cliente buscar no balcão. Sai ao aceitar o pedido, sem o QR do entregador. {resumoRetirada}</>,
          tipo: 'livre',
          palavras: 'retirada retirar buscar balcão caixa viagem takeout encomenda',
          desenhar: () => (
            <div className="space-y-2">
              <label htmlFor="onde-retirada-mesmas" className="flex items-center gap-2 text-sm font-semibold">
                <input
                  id="onde-retirada-mesmas"
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={valores.retirada === SEM}
                  onChange={(e) => guardar('retirada', e.target.checked ? null : { mesmasDoDelivery: false, impressoras: delivery.impressoras })}
                />
                Nas mesmas da via do delivery
              </label>
              {valores.retirada !== SEM && (
                <Marcar
                  id="onde-retirada"
                  rotulo="Via da retirada sai em"
                  impressoras={deCupom}
                  estacoes={estacoes}
                  marcadas={retirada.impressoras}
                  aoMudar={(l) => guardar('retirada', { mesmasDoDelivery: false, impressoras: l })}
                />
              )}
            </div>
          ),
        },
        {
          id: 'entregador',
          rotulo: 'Comanda do entregador',
          ajuda: <>Sai no botão “Cupom do entregador”. {resumoEntregador}</>,
          tipo: 'livre',
          palavras: 'entregador motoboy comanda',
          desenhar: () => (
            <div className="space-y-2">
              <label htmlFor="onde-entregador-mesmas" className="flex items-center gap-2 text-sm font-semibold">
                <input
                  id="onde-entregador-mesmas"
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={valores.entregador === SEM}
                  onChange={(e) => guardar('entregador', e.target.checked ? null : { mesmasDoDelivery: false, impressoras: delivery.impressoras })}
                />
                Nas mesmas da via do delivery
              </label>
              {valores.entregador !== SEM && (
                <Marcar
                  id="onde-entregador"
                  rotulo="Comanda do entregador sai em"
                  impressoras={deCupom}
                  estacoes={estacoes}
                  marcadas={entregador.impressoras}
                  aoMudar={(l) => guardar('entregador', { mesmasDoDelivery: false, impressoras: l })}
                />
              )}
            </div>
          ),
        },
      ],
    },
  ];

  return (
    <Ajustes
      id="onde"
      titulo="Onde cada documento sai"
      grupos={grupos}
      valores={valores}
      salvos={salvos}
      aoMudar={aoMudar}
      aoSalvar={aoSalvar}
      aoDescartar={aoDescartar}
      salvando={salvando}
      erro={erro}
      antes={
        <div className="space-y-2">
          <p className={`text-sm ${texto2}`}>
            Marque uma ou mais impressoras para cada documento, com as vias de cada uma. A produção sai pelo direcionamento de cada produto
            e setor, e a reimpressão sai sempre na impressora do PC que pediu.
          </p>
          {!todasDeCupom && (
            <p role="status" className="rounded-md border-l-4 border-warn bg-warn/10 px-2.5 py-1.5 text-sm text-foreground">
              Nenhuma impressora de cupom em uso: marque “Cupom do cliente” numa impressora, na parte Impressoras.
            </p>
          )}
        </div>
      }
    />
  );
}
