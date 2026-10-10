'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, List, ListPlus, Plus, Send, Sparkles, Trash2 } from 'lucide-react';
import { api, getCategoria, podePerm, podeVerFinanceiro } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import { faltaMarca, linhasDoPedido, marcaDaLinha, marcasDe, segundaMarcaDaLinha } from '@/lib/produto-compra';
import { ConferirCompra } from './compra-conferir';
import { GerarListaDoQueFaltou, VerItensDaCompra } from './compra-itens';
import { EscolhaProdutos, type Escolha } from './escolha-produtos';
import { EnviarPedido, textoDoEnvio } from './pedido-enviar';
import { PreviaDoPedido } from './pedido-previa';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, PERIODOS, PERIODO_PADRAO, Selo, Situacoes, TituloLista, Vazio,
  brl, consultaDoPeriodo, dataBr, diasAte, distintos, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
const recebida = (l: any) => l.status === 'recebida';
const atrasada = (l: any) => !recebida(l) && !!l.dataRecebimento && diasAte(l.dataRecebimento) < 0;
// Itens da lista RECEBIDA que vieram a menos do que o pedido (uma parte, ou nada).
const comFalta = (l: any) => (recebida(l) ? Number(l.itensComFalta) || 0 : 0);
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Aguardando', filtro: (l) => !recebida(l), tom: 'aviso' },
  { rotulo: 'Atrasados', filtro: atrasada, tom: 'critico' },
  { rotulo: 'Recebidos', filtro: recebida },
  { rotulo: 'Com falta', filtro: (l) => comFalta(l) > 0, tom: 'aviso' },
];
const ID_TITULO = 'compras-titulo';

// Aba Pedidos (até 10/10/2026 se chamava "Compras"; a chave e as rotas continuam `compras`): os
// pedidos de compra — os que aguardam (sempre à vista, com os atrasados) e os recebidos no período,
// com a falta de cada um à vista. O novo pedido abre na gaveta, com a prévia ao lado; enviar ao
// fornecedor (`pedido-enviar.tsx`), conferir e receber (`compra-conferir.tsx`), ver os itens,
// gerar o pedido do que faltou (`compra-itens.tsx`) e excluir, em diálogo.
export function ComprasSecao({ itens, fornecedores, aoMudarEstoque }: { itens: any[]; fornecedores: any[]; aoMudarEstoque?: () => void }) {
  const [listas, setListas] = useState<any[] | null>(null);
  const [colabs, setColabs] = useState<any[]>([]);
  const [erro, setErro] = useState('');
  const [periodo, setPeriodo] = useState<string>(PERIODO_PADRAO);
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [fornecedor, setFornecedor] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [novo, setNovo] = useState(false);
  const [conferindo, setConferindo] = useState<any>(null);
  const [vendo, setVendo] = useState<any>(null);
  // Pedido recebido com falta, aberto no diálogo "gerar pedido com o que faltou".
  const [faltou, setFaltou] = useState<any>(null);
  // Pedido aberto no diálogo "enviar ao fornecedor".
  const [enviando, setEnviando] = useState<any>(null);
  const [excluir, setExcluir] = useState<any>(null);
  const [excluindo, setExcluindo] = useState(false);
  const pedido = useRef(0);
  const verFin = podeVerFinanceiro();

  const carregar = useCallback(async () => {
    const meu = ++pedido.current; // trocar o período depressa: só a última resposta vale
    setErro('');
    try {
      const [ls, cs] = await Promise.all([api.get(`/compras/listas${consultaDoPeriodo(periodo)}`), api.colaboradores().catch(() => [])]);
      if (meu !== pedido.current) return;
      setListas(Array.isArray(ls) ? (ls as any[]) : []);
      setColabs(Array.isArray(cs) ? (cs as any[]) : []);
    } catch (e) {
      if (meu !== pedido.current) return;
      setListas([]);
      setErro(e instanceof Error ? e.message : 'Erro ao carregar os pedidos');
    }
  }, [periodo]);
  useEffect(() => { carregar(); }, [carregar]);

  async function abrir(l: any, para: 'conferir' | 'ver' | 'faltou') {
    try {
      const det: any = await api.compraLista(l.id);
      if (para === 'conferir') setConferindo(det);
      else if (para === 'faltou') setFaltou(det);
      else setVendo(det);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao abrir o pedido');
    }
  }
  async function confirmarExclusao() {
    if (!excluir || excluindo) return;
    setExcluindo(true);
    try {
      await api.removerCompraLista(excluir.id);
      toast.success('Pedido excluído.');
      setExcluir(null);
      await carregar();
      document.getElementById(ID_TITULO)?.focus(); // a linha (e o botão que abriu) saiu da tela
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao excluir');
    } finally {
      setExcluindo(false);
    }
  }

  if (listas === null) return <SkeletonList rows={4} />;

  // O servidor é quem autoriza; aqui só não se oferece o que ele recusaria.
  const gestao = ['presidente', 'gerente', 'supervisao', 'suporte'].includes(getCategoria() ?? '');
  const podeCriar = gestao && podePerm('estoque', 'criar');
  const podeExcluir = gestao && podePerm('estoque', 'excluir');
  const podeReceber = podePerm('estoque', 'editar');

  const nomeForn = (l: any) => l.fornecedorNome ?? 'Sem fornecedor';
  const nomeResp = (l: any) => l.delegadoNome ?? 'Sem conferente';
  const b = semAcento(busca);
  const base = listas.filter(
    (l) => (!b || semAcento(`${l.nome} ${nomeForn(l)}`).includes(b)) && (!fornecedor || nomeForn(l) === fornecedor) && (!responsavel || nomeResp(l) === responsavel),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || fornecedor || responsavel || sit >= 0);
  const limpar = () => { setBusca(''); setFornecedor(''); setResponsavel(''); setSit(-1); };
  const aReceber = linhas.filter((l) => !recebida(l)).reduce((s, l) => s + Number(l.valorEstimado ?? 0), 0);
  const prazo = (l: any) => {
    if (!l.dataRecebimento) return 'sem data marcada';
    const d = diasAte(l.dataRecebimento);
    return d === 0 ? 'hoje' : d > 0 ? `em ${d} dia(s)` : `atrasado ${-d} dia(s)`;
  };

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista id={ID_TITULO} titulo="Pedidos" total={listas.length} mostrando={linhas.length} um="pedido" varios="pedidos"
        extra={[periodo ? `recebidos nos ${PERIODOS.find((p) => p.v === periodo)?.rotulo.toLowerCase()}` : 'todo o período', verFin ? `${brl(aReceber)} a receber` : ''].filter(Boolean).join(' · ')}>
        {podeCriar && <Button type="button" onClick={() => setNovo(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Novo pedido</Button>}
      </TituloLista>
      {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="compras-busca" valor={busca} aoMudar={setBusca} placeholder="Nome do pedido ou fornecedor" />
        <FiltroSelect id="compras-periodo" rotulo="Recebidos no período" opcoes={PERIODOS} valor={periodo} aoMudar={setPeriodo} />
        <FiltroSelect id="compras-fornecedor" rotulo="Fornecedor" todos="Todos os fornecedores" opcoes={distintos(listas, nomeForn)} valor={fornecedor} aoMudar={setFornecedor} />
        <FiltroSelect id="compras-responsavel" rotulo="Conferente" todos="Todos os conferentes" opcoes={distintos(listas, nomeResp)} valor={responsavel} aoMudar={setResponsavel} />
      </Filtros>

      {listas.length === 0 ? (
        <Vazio>Nenhum pedido de compra. Faça um com os produtos e as quantidades — o que está abaixo do mínimo já vem sugerido.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Pedidos de compra"
          linhas={linhas}
          chave={(l) => l.id}
          nome={(l) => l.nome}
          colunas={[
            { titulo: 'Pedido', celula: (l) => <NomeComApoio nome={l.nome} apoio={[nomeForn(l), textoDoEnvio(l)].filter(Boolean).join(' · ')} /> },
            { titulo: 'Itens', celula: (l) => <span className="font-mono">{l.itens}</span> },
            {
              titulo: 'Receber em',
              celula: (l) => (
                <>
                  <span className="font-mono">{l.dataRecebimento ? dataBr(l.dataRecebimento) : '—'}</span>
                  {!recebida(l) && <span className={`block text-xs ${atrasada(l) ? 'font-semibold text-foreground' : texto2}`}>{prazo(l)}</span>}
                </>
              ),
            },
            { titulo: 'Conferente', celula: (l) => l.delegadoNome ?? '—' },
            ...(verFin
              ? [{
                  titulo: 'Valor estimado',
                  celula: (l: any) => (
                    <>
                      <span className="whitespace-nowrap font-mono">{Number(l.valorEstimado) > 0 ? brl(l.valorEstimado) : '—'}</span>
                      {Number(l.itensSemCusto) > 0 && <span className={`block text-xs ${texto2}`}>{l.itensSemCusto} sem custo</span>}
                    </>
                  ),
                }]
              : []),
            {
              titulo: 'Situação',
              celula: (l) => (
                <>
                  {recebida(l) ? <Selo tom="ok">recebido</Selo> : atrasada(l) ? <Selo tom="critico">atrasado</Selo> : <Selo tom="aviso">aguardando</Selo>}
                  {comFalta(l) > 0 && (
                    <span className="mt-0.5 block text-xs font-semibold">
                      {comFalta(l)} {comFalta(l) === 1 ? 'item' : 'itens'} com falta{l.temListaDoQueFaltou ? ' · já pedido de novo' : ''}
                    </span>
                  )}
                </>
              ),
            },
          ]}
          acoes={(l) => [
            ...(!recebida(l) && podeReceber ? [{ rotulo: 'Conferir e receber', icone: Check, aoClicar: (x: any) => abrir(x, 'conferir'), tom: 'primaria' as const }] : []),
            ...(comFalta(l) > 0 && !l.temListaDoQueFaltou && podeCriar ? [{ rotulo: 'Gerar pedido com o que faltou', icone: ListPlus, aoClicar: (x: any) => abrir(x, 'faltou') }] : []),
            ...(!recebida(l) && podeCriar ? [{ rotulo: 'Enviar ao fornecedor', icone: Send, aoClicar: setEnviando }] : []),
            { rotulo: 'Ver itens', icone: List, aoClicar: (x: any) => abrir(x, 'ver') },
            ...(podeExcluir ? [{ rotulo: 'Excluir', icone: Trash2, aoClicar: setExcluir, tom: 'perigo' as const }] : []),
          ]}
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}

      {novo && (
        <NovaListaForm itens={itens} fornecedores={fornecedores} colabs={colabs} verFin={verFin}
          aoFechar={() => setNovo(false)}
          aoSalvar={(criado) => {
            setNovo(false);
            carregar();
            // Pedido com fornecedor: a tela já oferece enviar a ele (não é obrigatório).
            if (criado?.id && criado.fornecedorId) setEnviando(criado);
          }} />
      )}
      {conferindo && (
        <ConferirCompra lista={conferindo} aoFechar={() => setConferindo(null)}
          aoReceber={async (itensComFalta) => {
            const recebidaAgora = conferindo;
            setConferindo(null);
            await carregar();
            document.getElementById(ID_TITULO)?.focus(); // o botão "Conferir e receber" da linha deixou de existir
            aoMudarEstoque?.();
            // Veio a menos: a falta fica na lista e a tela já oferece pedir de novo.
            if (itensComFalta > 0 && podeCriar) abrir(recebidaAgora, 'faltou');
          }} />
      )}
      {vendo && (
        <VerItensDaCompra lista={vendo} verFin={verFin} podeGerar={podeCriar} aoFechar={() => setVendo(null)}
          aoGerar={() => { setFaltou(vendo); setVendo(null); }} />
      )}
      {faltou && (
        <GerarListaDoQueFaltou lista={faltou} voltarPara={ID_TITULO} aoFechar={() => setFaltou(null)}
          aoGerar={async () => { setFaltou(null); await carregar(); document.getElementById(ID_TITULO)?.focus(); }} />
      )}
      {enviando && (
        <EnviarPedido pedido={enviando} voltarPara={ID_TITULO} aoFechar={() => setEnviando(null)}
          aoMarcar={async () => { setEnviando(null); await carregar(); document.getElementById(ID_TITULO)?.focus(); }} />
      )}
      {excluir && (
        <Dialogo alerta titulo="Excluir pedido de compra" aoFechar={() => setExcluir(null)} voltarPara={ID_TITULO}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial onClick={() => setExcluir(null)} disabled={excluindo}>Cancelar</Button>
              <Button type="button" variant="destructive" onClick={confirmarExclusao} disabled={excluindo}>{excluindo ? 'Excluindo…' : 'Excluir pedido'}</Button>
            </>
          }>
          <div className="space-y-3 text-sm">
            <p>Excluir <b>{excluir.nome}</b>?</p>
            <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">
              {recebida(excluir)
                ? 'O pedido sai da tela. O que entrou no estoque por ele e a conta a pagar continuam valendo.'
                : 'O pedido sai da tela e ninguém mais é avisado do recebimento. Nada entrou no estoque por ele.'}{' '}
              Não dá para desfazer por aqui.
            </p>
          </div>
        </Dialogo>
      )}
    </section>
  );
}

// ── novo pedido (gaveta larga, com a prévia ao lado) ────────────────────────────────────────
function NovaListaForm({ itens, fornecedores, colabs, verFin, aoFechar, aoSalvar }: { itens: any[]; fornecedores: any[]; colabs: any[]; verFin: boolean; aoFechar: () => void; aoSalvar: (criado: any) => void }) {
  const formId = useId();
  const [nome, setNome] = useState('');
  const [fornecedorId, setFornecedorId] = useState('');
  const [dataRecebimento, setDataRecebimento] = useState('');
  const [vencimento, setVencimento] = useState('');
  const [delegadoId, setDelegadoId] = useState('');
  const [enviarKds, setEnviarKds] = useState(true);
  const [enviarDashboard, setEnviarDashboard] = useState(true);
  const [escolha, setEscolha] = useState<Escolha>({});
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);

  const comQtd = Object.entries(escolha).filter(([id, l]) => Number(l.quantidade) > 0 && itens.some((i) => i.id === id));
  const total = comQtd.reduce((s, [, l]) => s + Number(l.quantidade) * (Number(l.custoUnitario) || 0), 0);
  // Produto com duas ou mais marcas: o pedido só sai com a marca escolhida (o servidor recusa sem).
  const porId = new Map<string, any>(itens.map((i) => [i.id, i]));
  const semMarca = comQtd.filter(([id, l]) => faltaMarca(marcasDe(porId.get(id)), l.marca));
  const falta = nome.trim().length < 2 || comQtd.length === 0 || semMarca.length > 0;

  async function sugerir() {
    try {
      const s: any[] = await api.comprasSugestao();
      if (!s.length) { toast.info('Nenhum produto abaixo do mínimo.'); return; }
      const n: Escolha = { ...escolha };
      // Mantém o custo e a marca que a pessoa já tinha informado para o produto.
      for (const r of s) n[r.itemId] = { ...n[r.itemId], quantidade: String(r.sugerido), custoUnitario: n[r.itemId]?.custoUnitario ?? '' };
      setEscolha(n);
      toast.success(`${s.length} produto(s) abaixo do mínimo marcados, com a quantidade sugerida.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao sugerir');
    }
  }
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (falta || salvando) return;
    setErro('');
    setSalvando(true);
    try {
      const criado: any = await api.criarCompraLista({
        nome: nome.trim(),
        fornecedorId: fornecedorId || undefined,
        dataRecebimento: dataRecebimento || undefined,
        vencimento: vencimento || undefined,
        delegadoId: delegadoId || undefined,
        enviarKds,
        enviarDashboard,
        itens: comQtd.map(([itemId, l]) => ({
          itemId,
          quantidade: Number(l.quantidade),
          custoUnitario: l.custoUnitario ? Number(l.custoUnitario) : undefined,
          marca: marcaDaLinha(marcasDe(porId.get(itemId)), l.marca) || undefined,
          marcaAlternativa: segundaMarcaDaLinha(marcasDe(porId.get(itemId)), l.marca, l.marcaAlternativa) || undefined,
        })),
      });
      toast.success('Pedido criado.');
      aoSalvar(criado);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao criar');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      larga
      titulo="Novo pedido de compra"
      aoFechar={aoFechar}
      rodape={
        <>
          <span className={`mr-auto self-center text-sm ${texto2}`} role="status" aria-live="polite">
            {comQtd.length} produto(s) com quantidade{verFin && total > 0 ? ` · ${brl(total)} estimado` : ''}
            {semMarca.length > 0 && <b className="block text-foreground">Falta escolher a marca de {semMarca.length} produto(s).</b>}
          </span>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={falta || salvando}>{salvando ? 'Criando…' : 'Criar pedido'}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="compra-nome">Nome do pedido</Label>
            <Input id="compra-nome" data-foco-inicial value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} placeholder="Ex.: Compra da semana" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="compra-forn">Fornecedor (opcional)</Label>
            <Select id="compra-forn" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)} aria-describedby="compra-forn-ajuda">
              <option value="">— sem fornecedor —</option>
              {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </Select>
            <p id="compra-forn-ajuda" className={`text-xs ${texto2}`}>Com fornecedor, ao criar o pedido a tela oferece enviar a ele por WhatsApp ou e-mail.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="compra-resp">Conferente (opcional)</Label>
            <Select id="compra-resp" value={delegadoId} onChange={(e) => setDelegadoId(e.target.value)} aria-describedby="compra-resp-ajuda">
              <option value="">— ninguém —</option>
              {colabs.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
            <p id="compra-resp-ajuda" className={`text-xs ${texto2}`}>Quem confere o pedido quando ele chegar na loja.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="compra-data">Data de recebimento</Label>
            <Input id="compra-data" type="date" value={dataRecebimento} onChange={(e) => setDataRecebimento(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="compra-venc">Data de pagamento</Label>
            <Input id="compra-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} aria-describedby="compra-venc-ajuda" />
            <p id="compra-venc-ajuda" className={`text-xs ${texto2}`}>Pode ficar para a conferência. Em branco nos dois, usa o prazo do fornecedor.</p>
          </div>
        </div>
        <div>
          <Button type="button" variant="outline" onClick={sugerir}><Sparkles className="h-4 w-4" aria-hidden="true" /> Sugerir do estoque baixo</Button>
        </div>
        {/* A escolha dos produtos e, ao lado, a prévia do pedido (abaixo dela no celular). */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <EscolhaProdutos itens={itens} valor={escolha} aoMudar={setEscolha} comQuantidade deCompra rotulo="Produtos e quantidades" />
          <PreviaDoPedido linhas={linhasDoPedido(itens, escolha)} verFin={verFin}
            aoTirar={(id) => setEscolha((e) => { const n = { ...e }; delete n[id]; return n; })} />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={enviarKds} onChange={(e) => setEnviarKds(e.target.checked)} /> Avisar no KDS ao receber
          </label>
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={enviarDashboard} onChange={(e) => setEnviarDashboard(e.target.checked)} /> Avisar no painel
          </label>
        </div>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}
