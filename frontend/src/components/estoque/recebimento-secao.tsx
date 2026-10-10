'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Eye, Plus } from 'lucide-react';
import { api, getCategoria, podePerm, podeVerFinanceiro } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo } from '@/components/ui/sobreposto';
import { RecebimentoForm } from '@/components/recebimento/recebimento-form';
import { ConferirCompra } from './compra-conferir';
import { GerarListaDoQueFaltou, VerItensDaCompra } from './compra-itens';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, PERIODOS, PERIODO_PADRAO, Selo, Situacoes, TituloLista, Vazio,
  consultaDoPeriodo, dataBr, diasAte, distintos, num, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Uma linha da aba: um PEDIDO de compra (o que foi pedido na aba Pedidos e está para chegar, ou já
// chegou) ou uma NOTA AVULSA (mercadoria que chegou sem pedido). As duas se conferem aqui.
type Linha = {
  chave: string;
  tipo: 'pedido' | 'nota';
  id: string;
  titulo: string;
  fornecedorNome: string | null;
  conferenteNome: string | null;
  /** Pedido que aguarda: a data combinada; recebido: o dia em que chegou. Nota: a data do recebimento. */
  data: string | null;
  itens: number;
  /** Pedido: itens que vieram a menos. Nota: divergências anotadas. */
  divergencias: number;
  conferido: boolean;
  atrasado: boolean;
  bruto: any;
};
const ORIGEM = { pedido: 'Pedido', nota: 'Nota avulsa' } as const;
const diaDe = (instante: string): string => new Date(instante).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

function dePedido(l: any): Linha {
  const conferido = l.status === 'recebida';
  const data = conferido && l.recebidaEm ? diaDe(l.recebidaEm) : l.dataRecebimento ? String(l.dataRecebimento).slice(0, 10) : null;
  return {
    chave: `pedido:${l.id}`, tipo: 'pedido', id: l.id, titulo: l.nome,
    fornecedorNome: l.fornecedorNome ?? null, conferenteNome: l.delegadoNome ?? null,
    data, itens: Number(l.itens) || 0, divergencias: conferido ? Number(l.itensComFalta) || 0 : 0,
    conferido, atrasado: !conferido && !!data && diasAte(data) < 0, bruto: l,
  };
}
function deNota(r: any): Linha {
  return {
    chave: `nota:${r.id}`, tipo: 'nota', id: r.id, titulo: r.notaRef ? `Nota ${r.notaRef}` : 'Nota sem número',
    fornecedorNome: r.fornecedorNome ?? null, conferenteNome: null,
    data: r.data ? String(r.data).slice(0, 10) : null, itens: Number(r.itens) || 0, divergencias: Number(r.divergencias) || 0,
    conferido: r.status === 'conferido', atrasado: false, bruto: r,
  };
}
// O que falta conferir vem primeiro (o mais antigo no topo, sem data por último); depois o conferido,
// do mais novo para o mais antigo.
function ordenar(a: Linha, b: Linha): number {
  if (a.conferido !== b.conferido) return a.conferido ? 1 : -1;
  if (!a.conferido) return (a.data ?? '9999').localeCompare(b.data ?? '9999');
  return (b.data ?? '').localeCompare(a.data ?? '');
}

const SITUACOES: Situacao<Linha>[] = [
  { rotulo: 'A conferir', filtro: (r) => !r.conferido, tom: 'aviso' },
  { rotulo: 'Conferidos', filtro: (r) => r.conferido },
  { rotulo: 'Com divergência', filtro: (r) => r.divergencias > 0, tom: 'critico' },
];
const DIVERGENCIA: Record<string, string> = { ok: 'ok', parcial: 'parcial / faltou', nao_veio: 'não veio', danificado: 'danificado', excedente: 'excedente' };
const ID_TITULO = 'recebimento-titulo';

// Aba Recebimento: TUDO o que chega na loja, numa lista só (decisão do dono, 10/10/2026) — os pedidos
// de compra que aguardam conferência (e os já conferidos no período) e as notas avulsas. O pedido se
// confere aqui, com o marcador e os valores da nota (`compra-conferir.tsx`); a nota avulsa abre na
// gaveta e confirmar pede a confirmação num diálogo (é o passo que entra no estoque e gera a conta).
export function RecebimentoSecao({ itens, fornecedores, aoMudarEstoque }: { itens: any[]; fornecedores: any[]; aoMudarEstoque: () => void }) {
  const [lista, setLista] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState('');
  const [periodo, setPeriodo] = useState<string>(PERIODO_PADRAO);
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [fornecedor, setFornecedor] = useState('');
  const [origem, setOrigem] = useState('');
  const [novo, setNovo] = useState(false);
  const [confirmar, setConfirmar] = useState<any>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [ver, setVer] = useState<any>(null);
  // Pedido aberto para conferir, para ver os itens ou para gerar o pedido do que faltou.
  const [conferindo, setConferindo] = useState<any>(null);
  const [vendoPedido, setVendoPedido] = useState<any>(null);
  const [faltou, setFaltou] = useState<any>(null);
  const pedido = useRef(0);
  const verFin = podeVerFinanceiro();

  const carregar = useCallback(async () => {
    const meu = ++pedido.current; // trocar o período depressa: só a última resposta vale
    setErro('');
    // As duas listas são independentes: uma que falhe não esconde a outra (e a falha é dita).
    const [notas, pedidos] = await Promise.allSettled([
      api.get(`/recebimentos${consultaDoPeriodo(periodo)}`),
      api.get(`/compras/listas${consultaDoPeriodo(periodo)}`),
    ]);
    if (meu !== pedido.current) return;
    const lidas = (r: PromiseSettledResult<unknown>) => (r.status === 'fulfilled' && Array.isArray(r.value) ? (r.value as any[]) : []);
    setLista([...lidas(pedidos).map(dePedido), ...lidas(notas).map(deNota)].sort(ordenar));
    const falhas = [pedidos.status === 'rejected' ? 'os pedidos' : '', notas.status === 'rejected' ? 'as notas avulsas' : ''].filter(Boolean);
    if (falhas.length) setErro(`Não consegui carregar ${falhas.join(' nem ')}. Recarregue a tela.`);
  }, [periodo]);
  useEffect(() => { carregar(); }, [carregar]);

  async function abrirPedido(l: { id: string }, para: 'conferir' | 'ver' | 'faltou') {
    try {
      const det: any = await api.compraLista(l.id);
      if (para === 'conferir') setConferindo(det);
      else if (para === 'faltou') setFaltou(det);
      else setVendoPedido(det);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao abrir o pedido');
    }
  }
  // Trava de duplo clique: confirmar duas vezes dava entrada em dobro no estoque E criava
  // duas contas a pagar. O servidor recusa a segunda, mas o botão não pode nem deixar tentar.
  async function confirmarRecebimento() {
    if (!confirmar || confirmando) return;
    setConfirmando(true);
    try {
      await api.confirmarRecebimento(confirmar.id);
      toast.success('Recebimento confirmado — estoque atualizado.');
      setConfirmar(null);
      await carregar();
      // O botão "Confirmar" da linha deixou de existir: o foco vai para o título.
      document.getElementById(ID_TITULO)?.focus();
      aoMudarEstoque();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao confirmar');
    } finally {
      setConfirmando(false);
    }
  }

  if (lista === null) return <SkeletonList rows={5} />;

  const nomeForn = (r: Linha) => r.fornecedorNome ?? 'Sem fornecedor';
  const b = semAcento(busca);
  const base = lista.filter(
    (r) => (!b || semAcento(`${r.titulo} ${nomeForn(r)}`).includes(b)) && (!fornecedor || nomeForn(r) === fornecedor) && (!origem || ORIGEM[r.tipo] === origem),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || fornecedor || origem || sit >= 0);
  const limpar = () => { setBusca(''); setFornecedor(''); setOrigem(''); setSit(-1); };
  const rotuloPeriodo = PERIODOS.find((p) => p.v === periodo)?.rotulo.toLowerCase() ?? '';
  const aConferir = linhas.filter((r) => !r.conferido).length;
  // O servidor é quem autoriza; aqui só não se oferece o que ele recusaria.
  const gestao = ['presidente', 'gerente', 'supervisao', 'suporte'].includes(getCategoria() ?? '');
  const podeLancar = podePerm('estoque', 'criar');
  const podeConfirmar = ['presidente', 'gerente', 'suporte'].includes(getCategoria() ?? '') && podePerm('estoque', 'editar');
  const podeConferirPedido = podePerm('estoque', 'editar');
  const podeGerarPedido = gestao && podePerm('estoque', 'criar');
  const prazo = (r: Linha) => {
    if (!r.data) return 'sem data marcada';
    const d = diasAte(r.data);
    return d === 0 ? 'hoje' : d > 0 ? `em ${d} dia(s)` : `atrasado ${-d} dia(s)`;
  };

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista id={ID_TITULO} titulo="Recebimento" total={lista.length} mostrando={linhas.length} um="recebimento" varios="recebimentos"
        extra={[rotuloPeriodo ? `conferidos nos ${rotuloPeriodo}` : 'todo o período', `${aConferir} a conferir`].join(' · ')}>
        {podeLancar && (
          <Button type="button" onClick={() => setNovo(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Nota avulsa</Button>
        )}
      </TituloLista>
      <p className={`text-sm ${texto2}`}>Os pedidos feitos na aba Pedidos aparecem aqui para conferir quando chegam. Mercadoria que chegou sem pedido entra como nota avulsa.</p>
      {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="recebimento-busca" valor={busca} aoMudar={setBusca} placeholder="Pedido, fornecedor ou número da nota" />
        <FiltroSelect id="recebimento-periodo" rotulo="Conferidos no período" opcoes={PERIODOS} valor={periodo} aoMudar={setPeriodo} />
        <FiltroSelect id="recebimento-origem" rotulo="Origem" todos="Pedidos e notas avulsas" opcoes={Object.values(ORIGEM)} valor={origem} aoMudar={setOrigem} />
        <FiltroSelect id="recebimento-fornecedor" rotulo="Fornecedor" todos="Todos os fornecedores" opcoes={distintos(lista, nomeForn)} valor={fornecedor} aoMudar={setFornecedor} />
      </Filtros>

      {lista.length === 0 ? (
        <Vazio>Nenhum pedido para conferir e nenhuma nota {periodo ? `nos ${rotuloPeriodo}` : 'registrada'}.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Pedidos e notas para receber"
          linhas={linhas}
          chave={(r) => r.chave}
          nome={(r) => (r.tipo === 'pedido' ? `o pedido ${r.titulo}` : `${r.titulo} de ${nomeForn(r)}`)}
          colunas={[
            { titulo: 'Origem', celula: (r) => <Selo>{ORIGEM[r.tipo]}</Selo> },
            {
              titulo: 'O quê',
              celula: (r) => <NomeComApoio nome={r.titulo} apoio={[nomeForn(r), r.conferenteNome ? `conferente: ${r.conferenteNome}` : ''].filter(Boolean).join(' · ')} />,
            },
            {
              titulo: 'Data',
              celula: (r) => (
                <>
                  <span className="font-mono">{r.data ? dataBr(r.data) : '—'}</span>
                  {r.tipo === 'pedido' && !r.conferido && <span className={`block text-xs ${r.atrasado ? 'font-semibold text-foreground' : texto2}`}>{prazo(r)}</span>}
                </>
              ),
            },
            { titulo: 'Itens', celula: (r) => <span className="font-mono">{r.itens}</span> },
            {
              titulo: 'Situação',
              celula: (r) => (
                <>
                  {r.conferido ? <Selo tom="ok">conferido</Selo> : r.atrasado ? <Selo tom="critico">atrasado</Selo> : <Selo tom="aviso">a conferir</Selo>}
                  {r.divergencias > 0 && (
                    <span className="mt-0.5 block text-xs font-semibold">
                      {r.tipo === 'pedido' ? `${r.divergencias} ${r.divergencias === 1 ? 'item' : 'itens'} com falta` : `${r.divergencias} divergência(s)`}
                    </span>
                  )}
                </>
              ),
            },
          ]}
          acoes={(r) =>
            r.tipo === 'pedido'
              ? [
                  ...(!r.conferido && podeConferirPedido ? [{ rotulo: 'Conferir', icone: Check, aoClicar: (x: Linha) => abrirPedido(x, 'conferir'), tom: 'primaria' as const }] : []),
                  { rotulo: 'Ver', icone: Eye, aoClicar: (x: Linha) => abrirPedido(x, 'ver') },
                ]
              : [
                  ...(!r.conferido && podeConfirmar ? [{ rotulo: 'Confirmar', icone: Check, aoClicar: (x: Linha) => setConfirmar(x.bruto), tom: 'primaria' as const }] : []),
                  { rotulo: 'Ver', icone: Eye, aoClicar: (x: Linha) => setVer(x.bruto) },
                ]
          }
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}

      {novo && (
        <RecebimentoForm fornecedores={fornecedores} itens={itens} onCancel={() => setNovo(false)} onCreated={() => { setNovo(false); carregar(); }} />
      )}
      {conferindo && (
        <ConferirCompra lista={conferindo} aoFechar={() => setConferindo(null)}
          aoReceber={async (itensComFalta) => {
            const recebidoAgora = conferindo;
            setConferindo(null);
            await carregar();
            document.getElementById(ID_TITULO)?.focus(); // o botão "Conferir" da linha deixou de existir
            aoMudarEstoque();
            // Veio a menos: a falta fica no pedido e a tela já oferece pedir de novo.
            if (itensComFalta > 0 && podeGerarPedido) abrirPedido(recebidoAgora, 'faltou');
          }} />
      )}
      {vendoPedido && (
        <VerItensDaCompra lista={vendoPedido} verFin={verFin} podeGerar={podeGerarPedido} aoFechar={() => setVendoPedido(null)}
          aoGerar={() => { setFaltou(vendoPedido); setVendoPedido(null); }} />
      )}
      {faltou && (
        <GerarListaDoQueFaltou lista={faltou} voltarPara={ID_TITULO} aoFechar={() => setFaltou(null)}
          aoGerar={async () => { setFaltou(null); await carregar(); document.getElementById(ID_TITULO)?.focus(); }} />
      )}
      {confirmar && (
        <Dialogo alerta titulo="Confirmar o recebimento" aoFechar={() => setConfirmar(null)}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial onClick={() => setConfirmar(null)} disabled={confirmando}>Cancelar</Button>
              <Button type="button" onClick={confirmarRecebimento} disabled={confirmando}>{confirmando ? 'Confirmando…' : 'Confirmar recebimento'}</Button>
            </>
          }>
          <div className="space-y-3 text-sm">
            <p>Confirmar o recebimento de <b>{confirmar.fornecedorNome ?? 'Sem fornecedor'}</b> de {dataBr(confirmar.data)} ({confirmar.itens} {Number(confirmar.itens) === 1 ? 'item' : 'itens'})?</p>
            <p className="rounded-md border-l-4 border-info bg-info/10 px-3 py-2">
              A quantidade recebida entra no estoque, os lotes com validade são criados e a conta a pagar do fornecedor é gerada. Não dá para desfazer por aqui.
            </p>
          </div>
        </Dialogo>
      )}
      {ver && <VerRecebimento resumo={ver} aoFechar={() => setVer(null)} />}
    </section>
  );
}

// Título da coluna antes do valor: só aparece quando a tabela está empilhada (abaixo de 640 px).
function RotuloNaLinha({ children }: { children: React.ReactNode }) {
  return <><span className={`font-sans text-xs font-bold sm:hidden ${texto2}`}>{children}:</span>{' '}</>;
}

function VerRecebimento({ resumo, aoFechar }: { resumo: any; aoFechar: () => void }) {
  const [det, setDet] = useState<any>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let vivo = true;
    api.recebimento(resumo.id)
      .then((r: any) => { if (vivo) setDet(r); })
      .catch((e: unknown) => { if (vivo) setErro(e instanceof Error ? e.message : 'Não consegui abrir o recebimento.'); });
    return () => { vivo = false; };
  }, [resumo.id]);
  // O cabeçalho vem direto da tabela (nomes do banco): aceita os dois jeitos de escrever.
  const campo = (a: string, b: string) => det?.[a] ?? det?.[b];
  const foto = campo('notaFotoRef', 'nota_foto_ref');
  const itens: any[] = det?.itens ?? [];
  return (
    <Dialogo largura="lg" titulo={`${resumo.fornecedorNome ?? 'Sem fornecedor'} · ${dataBr(resumo.data)}`} aoFechar={aoFechar}
      rodape={<Button type="button" data-foco-inicial onClick={aoFechar}>Fechar</Button>}>
      <div className="space-y-3 text-sm">
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erro}</p>}
        {!det && !erro && <p className={texto2}>Abrindo o recebimento…</p>}
        {det && (
          <>
            <p className={texto2}>
              {resumo.notaRef ? `Nota ${resumo.notaRef}` : 'Sem nota informada'} · {resumo.status === 'conferido' ? 'conferido' : 'a conferir'}
              {campo('obs', 'observacao') ? ` · ${campo('obs', 'observacao')}` : ''}
            </p>
            {foto && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={foto} alt="Foto da nota" className="max-h-64 rounded-lg object-contain" />
            )}
            <div className="overflow-x-auto rounded-lg border border-border">
              {/* Abaixo de 640 px cada item vira um bloco, com o título da coluna antes do valor. */}
              <table className="block w-full border-collapse sm:table sm:min-w-[520px]">
                <caption className="sr-only">Itens do recebimento</caption>
                <thead className="hidden sm:table-header-group">
                  <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                    <th scope="col" className="px-3 py-2">Produto</th>
                    <th scope="col" className="px-3 py-2">Esperado</th>
                    <th scope="col" className="px-3 py-2">Recebido</th>
                    <th scope="col" className="px-3 py-2">Validade</th>
                    <th scope="col" className="px-3 py-2">Conferência</th>
                  </tr>
                </thead>
                <tbody className="block sm:table-row-group">
                  {itens.map((i) => (
                    <tr key={i.id} className="block space-y-1 border-b border-border p-3 last:border-b-0 sm:table-row sm:space-y-0 sm:p-0">
                      <td className="block break-words font-semibold sm:table-cell sm:px-3 sm:py-2">{i.itemNome}</td>
                      <td className="block font-mono sm:table-cell sm:px-3 sm:py-2"><RotuloNaLinha>Esperado</RotuloNaLinha>{num(i.qtdEsperada)} {i.unidade}</td>
                      <td className="block font-mono sm:table-cell sm:px-3 sm:py-2"><RotuloNaLinha>Recebido</RotuloNaLinha>{num(i.qtdRecebida)} {i.unidade}</td>
                      <td className="block font-mono sm:table-cell sm:px-3 sm:py-2"><RotuloNaLinha>Validade</RotuloNaLinha>{i.validade ? dataBr(i.validade) : '—'}</td>
                      <td className="block sm:table-cell sm:px-3 sm:py-2"><RotuloNaLinha>Conferência</RotuloNaLinha>{i.divergencia && i.divergencia !== 'ok' ? <Selo tom="critico">{DIVERGENCIA[i.divergencia] ?? i.divergencia}</Selo> : <Selo tom="ok">ok</Selo>}</td>
                    </tr>
                  ))}
                  {itens.length === 0 && <tr className="block sm:table-row"><td colSpan={5} className={`block px-3 py-6 text-center sm:table-cell ${texto2}`}>Sem itens.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Dialogo>
  );
}
