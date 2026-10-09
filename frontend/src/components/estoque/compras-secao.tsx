'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, List, Plus, Sparkles, Trash2 } from 'lucide-react';
import { api, getCategoria, podePerm, podeVerFinanceiro } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import { faltaMarca, marcaDaLinha, marcasDe, nomeDeApoio, nomeDeCompra } from '@/lib/produto-compra';
import { EscolhaProdutos, type Escolha } from './escolha-produtos';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, PERIODOS, PERIODO_PADRAO, Selo, Situacoes, TituloLista, Vazio,
  brl, consultaDoPeriodo, dataBr, diasAte, distintos, num, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Conferência: o que de fato chegou, por linha da compra.
type Conf = { qtdRecebida: string; validade: string; indefinida: boolean; loteCodigo: string };

const recebida = (l: any) => l.status === 'recebida';
const atrasada = (l: any) => !recebida(l) && !!l.dataRecebimento && diasAte(l.dataRecebimento) < 0;
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Aguardando', filtro: (l) => !recebida(l), tom: 'aviso' },
  { rotulo: 'Atrasadas', filtro: atrasada, tom: 'critico' },
  { rotulo: 'Recebidas', filtro: recebida },
];
const ID_TITULO = 'compras-titulo';

// Nos diálogos, a tabela de itens vira blocos em tela estreita (nada rola para o lado) e o
// cabeçalho some: o título da coluna vai escrito junto do valor. Em cima do campo, na
// conferência (some a partir de 1024 px); na mesma linha, em "Ver itens" (some a partir de 640 px).
function RotuloDaColuna({ children }: { children: React.ReactNode }) {
  return <span className={`block font-sans text-xs font-bold uppercase tracking-wide lg:hidden ${texto2}`}>{children}</span>;
}
function RotuloNaLinha({ children }: { children: React.ReactNode }) {
  return <><span className={`font-sans text-xs font-bold sm:hidden ${texto2}`}>{children}:</span>{' '}</>;
}

// Aba Compras: as listas de compra — as que aguardam (sempre à vista, com as atrasadas) e as
// recebidas no período. Gerar a lista abre na gaveta; conferir e receber, ver os itens e
// excluir, em diálogo.
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
      setErro(e instanceof Error ? e.message : 'Erro ao carregar as compras');
    }
  }, [periodo]);
  useEffect(() => { carregar(); }, [carregar]);

  async function abrir(l: any, para: 'conferir' | 'ver') {
    try {
      const det: any = await api.compraLista(l.id);
      if (para === 'conferir') setConferindo(det);
      else setVendo(det);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao abrir a lista');
    }
  }
  async function confirmarExclusao() {
    if (!excluir || excluindo) return;
    setExcluindo(true);
    try {
      await api.removerCompraLista(excluir.id);
      toast.success('Lista excluída.');
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
  const nomeResp = (l: any) => l.delegadoNome ?? 'Sem responsável';
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
    return d === 0 ? 'hoje' : d > 0 ? `em ${d} dia(s)` : `atrasada ${-d} dia(s)`;
  };

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista id={ID_TITULO} titulo="Compras" total={listas.length} mostrando={linhas.length} um="lista" varios="listas"
        extra={[periodo ? `recebidas nos ${PERIODOS.find((p) => p.v === periodo)?.rotulo.toLowerCase()}` : 'todo o período', verFin ? `${brl(aReceber)} a receber` : ''].filter(Boolean).join(' · ')}>
        {podeCriar && <Button type="button" onClick={() => setNovo(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Gerar lista</Button>}
      </TituloLista>
      {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="compras-busca" valor={busca} aoMudar={setBusca} placeholder="Nome da lista ou fornecedor" />
        <FiltroSelect id="compras-periodo" rotulo="Recebidas no período" opcoes={PERIODOS} valor={periodo} aoMudar={setPeriodo} />
        <FiltroSelect id="compras-fornecedor" rotulo="Fornecedor" todos="Todos os fornecedores" opcoes={distintos(listas, nomeForn)} valor={fornecedor} aoMudar={setFornecedor} />
        <FiltroSelect id="compras-responsavel" rotulo="Responsável" todos="Todos os responsáveis" opcoes={distintos(listas, nomeResp)} valor={responsavel} aoMudar={setResponsavel} />
      </Filtros>

      {listas.length === 0 ? (
        <Vazio>Nenhuma lista de compras. Gere uma com os produtos e as quantidades — o que está abaixo do mínimo já vem sugerido.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Listas de compras"
          linhas={linhas}
          chave={(l) => l.id}
          nome={(l) => l.nome}
          colunas={[
            { titulo: 'Lista', celula: (l) => <NomeComApoio nome={l.nome} apoio={nomeForn(l)} /> },
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
            { titulo: 'Responsável', celula: (l) => l.delegadoNome ?? '—' },
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
            { titulo: 'Situação', celula: (l) => (recebida(l) ? <Selo tom="ok">recebida</Selo> : atrasada(l) ? <Selo tom="critico">atrasada</Selo> : <Selo tom="aviso">aguardando</Selo>) },
          ]}
          acoes={(l) => [
            ...(!recebida(l) && podeReceber ? [{ rotulo: 'Conferir e receber', icone: Check, aoClicar: (x: any) => abrir(x, 'conferir'), tom: 'primaria' as const }] : []),
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
          aoFechar={() => setNovo(false)} aoSalvar={() => { setNovo(false); carregar(); }} />
      )}
      {conferindo && (
        <ConferirDialogo lista={conferindo} aoFechar={() => setConferindo(null)}
          aoReceber={async () => {
            setConferindo(null);
            await carregar();
            document.getElementById(ID_TITULO)?.focus(); // o botão "Conferir e receber" da linha deixou de existir
            aoMudarEstoque?.();
          }} />
      )}
      {vendo && <VerItensDialogo lista={vendo} verFin={verFin} aoFechar={() => setVendo(null)} />}
      {excluir && (
        <Dialogo alerta titulo="Excluir lista de compras" aoFechar={() => setExcluir(null)} voltarPara={ID_TITULO}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial onClick={() => setExcluir(null)} disabled={excluindo}>Cancelar</Button>
              <Button type="button" variant="destructive" onClick={confirmarExclusao} disabled={excluindo}>{excluindo ? 'Excluindo…' : 'Excluir lista'}</Button>
            </>
          }>
          <div className="space-y-3 text-sm">
            <p>Excluir <b>{excluir.nome}</b>?</p>
            <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">
              {recebida(excluir)
                ? 'A lista sai da tela. O que entrou no estoque por ela e a conta a pagar continuam valendo.'
                : 'A lista sai da tela e ninguém mais é avisado do recebimento. Nada entrou no estoque por ela.'}{' '}
              Não dá para desfazer por aqui.
            </p>
          </div>
        </Dialogo>
      )}
    </section>
  );
}

// ── gerar lista (gaveta larga) ──────────────────────────────────────────────────────────────
function NovaListaForm({ itens, fornecedores, colabs, verFin, aoFechar, aoSalvar }: { itens: any[]; fornecedores: any[]; colabs: any[]; verFin: boolean; aoFechar: () => void; aoSalvar: () => void }) {
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
  // Produto com duas ou mais marcas: a lista só sai com a marca escolhida (o servidor recusa sem).
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
      await api.criarCompraLista({
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
        })),
      });
      toast.success('Lista de compras criada.');
      aoSalvar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao criar');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      larga
      titulo="Gerar lista de compras"
      aoFechar={aoFechar}
      rodape={
        <>
          <span className={`mr-auto self-center text-sm ${texto2}`} role="status" aria-live="polite">
            {comQtd.length} produto(s) com quantidade{verFin && total > 0 ? ` · ${brl(total)} estimado` : ''}
            {semMarca.length > 0 && <b className="block text-foreground">Falta escolher a marca de {semMarca.length} produto(s).</b>}
          </span>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={falta || salvando}>{salvando ? 'Criando…' : 'Criar lista'}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="compra-nome">Nome da lista</Label>
            <Input id="compra-nome" data-foco-inicial value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} placeholder="Ex.: Compra da semana" autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="compra-forn">Fornecedor</Label>
            <Select id="compra-forn" value={fornecedorId} onChange={(e) => setFornecedorId(e.target.value)}>
              <option value="">— sem fornecedor —</option>
              {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="compra-resp">Responsável pelo recebimento (opcional)</Label>
            <Select id="compra-resp" value={delegadoId} onChange={(e) => setDelegadoId(e.target.value)}>
              <option value="">— ninguém —</option>
              {colabs.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
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
        <EscolhaProdutos itens={itens} valor={escolha} aoMudar={setEscolha} comQuantidade deCompra rotulo="Produtos e quantidades" />
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

// ── conferir e receber (diálogo largo) ──────────────────────────────────────────────────────
// Receber deixou de ser um `confirm()`: a quantidade PEDIDA entrava no estoque mesmo quando
// chegava outra coisa. Aqui se confere o que chegou; só a quantidade recebida entra.
function ConferirDialogo({ lista, aoFechar, aoReceber }: { lista: any; aoFechar: () => void; aoReceber: () => void }) {
  const itens: any[] = lista.itens ?? [];
  const [conf, setConf] = useState<Record<string, Conf>>(() =>
    Object.fromEntries(
      itens.map((it) => [
        it.id,
        {
          qtdRecebida: String(it.quantidade ?? ''), // parte-se do pedido; corrige quem confere
          validade: '',
          // Memória por insumo: como ele foi conferido da última vez. A decisão continua na
          // tela para ser confirmada — só não se redigita.
          indefinida: !!it.sugestao?.validadeIndefinida,
          loteCodigo: '',
        },
      ]),
    ),
  );
  const [vencimento, setVencimento] = useState(lista.vencimento ? String(lista.vencimento).slice(0, 10) : '');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const mudar = (id: string, patch: Partial<Conf>) => setConf((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  const diferentes = itens.filter((it) => conf[it.id]?.qtdRecebida !== '' && Number(conf[it.id]?.qtdRecebida) !== Number(it.quantidade)).length;

  async function confirmar() {
    if (salvando) return;
    const pendente = itens.find((it) => {
      const c = conf[it.id];
      return !c || c.qtdRecebida === '' || !(Number(c.qtdRecebida) >= 0) || (!c.validade && !c.indefinida);
    });
    if (pendente) {
      setErro(`Confira "${nomeDeCompra(pendente)}": a quantidade recebida e a validade (ou marque "sem validade").`);
      return;
    }
    setErro('');
    setSalvando(true);
    try {
      await api.receberCompra(lista.id, {
        vencimento: vencimento || undefined,
        itens: itens.map((it) => ({
          compraItemId: it.id,
          qtdRecebida: Number(conf[it.id].qtdRecebida),
          validade: conf[it.id].indefinida ? undefined : conf[it.id].validade,
          validadeIndefinida: conf[it.id].indefinida || undefined,
          loteCodigo: conf[it.id].loteCodigo.trim() || undefined,
        })),
      });
      toast.success('Compra conferida e recebida — estoque atualizado.');
      aoReceber();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao receber');
      setSalvando(false);
    }
  }

  return (
    <Dialogo largura="lg" titulo={`Conferir e receber: ${lista.nome}`} aoFechar={aoFechar} fecharNoFundo={false}
      rodape={
        <>
          <span className={`mr-auto self-center text-sm ${texto2}`} role="status" aria-live="polite">
            {itens.length} {itens.length === 1 ? 'item' : 'itens'} · {diferentes} com diferença do pedido
          </span>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="button" onClick={confirmar} disabled={salvando}>{salvando ? 'Recebendo…' : 'Confirmar recebimento'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p className={texto2}>Confira o que realmente chegou. Só a quantidade recebida entra no estoque.</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          {/* Abaixo de 1024 px a tabela vira blocos — um por item, com o título de cada coluna em
              cima do campo: nada rola para o lado. */}
          <table className="block w-full border-collapse lg:table lg:min-w-[680px]">
            <caption className="sr-only">Conferência dos itens da compra</caption>
            <thead className="hidden lg:table-header-group">
              <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                <th scope="col" className="px-3 py-2">Item</th>
                <th scope="col" className="px-3 py-2">Pedido</th>
                <th scope="col" className="px-3 py-2">Recebido *</th>
                <th scope="col" className="px-3 py-2">Validade *</th>
                <th scope="col" className="px-3 py-2">Lote</th>
              </tr>
            </thead>
            <tbody className="block lg:table-row-group">
              {itens.map((it, n) => {
                const c = conf[it.id];
                const pedida = Number(it.quantidade);
                const rec = Number(c.qtdRecebida);
                const difere = c.qtdRecebida !== '' && rec !== pedida;
                const titulo = nomeDeCompra(it); // o que vem escrito na caixa e na nota
                return (
                  <tr key={it.id} className="grid grid-cols-2 gap-x-3 gap-y-2 border-b border-border p-3 align-top last:border-b-0 lg:table-row lg:p-0">
                    <td className="col-span-2 lg:px-3 lg:py-2">
                      <span className="break-words font-semibold">{titulo}</span>
                      {it.marca && <span className="block text-xs font-semibold">Marca: {it.marca}</span>}
                      <span className={`block break-words text-xs ${texto2}`}>{nomeDeApoio(it) ? `No estoque: ${nomeDeApoio(it)} · ` : ''}{it.unidadeMedida}</span>
                    </td>
                    <td className="font-mono lg:px-3 lg:py-2"><RotuloDaColuna>Pedido</RotuloDaColuna>{num(pedida)}</td>
                    <td className="lg:px-3 lg:py-2">
                      <RotuloDaColuna>Recebido *</RotuloDaColuna>
                      <Input type="number" min={0} step="any" inputMode="decimal" className={`w-full lg:w-28 ${difere ? 'border-warn' : ''}`} value={c.qtdRecebida}
                        {...(n === 0 ? { 'data-foco-inicial': true } : {})}
                        aria-label={`Quantidade recebida de ${titulo}`} onChange={(e) => mudar(it.id, { qtdRecebida: e.target.value })} />
                      {difere && <span className="mt-0.5 block text-xs font-semibold">{rec === 0 ? 'não veio' : rec < pedida ? 'veio menos' : 'veio mais'}</span>}
                    </td>
                    <td className="col-span-2 sm:col-span-1 lg:px-3 lg:py-2">
                      <RotuloDaColuna>Validade *</RotuloDaColuna>
                      <Input type="date" className="w-full lg:w-44" value={c.validade} disabled={c.indefinida} aria-label={`Validade de ${titulo}`} onChange={(e) => mudar(it.id, { validade: e.target.value })} />
                      <label className={`mt-1 flex min-h-8 items-center gap-1.5 text-xs ${texto2}`}>
                        <input type="checkbox" className="h-4 w-4 accent-primary" checked={c.indefinida} onChange={(e) => mudar(it.id, { indefinida: e.target.checked, validade: '' })} />
                        sem validade
                      </label>
                    </td>
                    <td className="col-span-2 sm:col-span-1 lg:px-3 lg:py-2">
                      <RotuloDaColuna>Lote</RotuloDaColuna>
                      <Input className="w-full lg:w-36" value={c.loteCodigo} placeholder="opcional" aria-label={`Código do lote de ${titulo}`} onChange={(e) => mudar(it.id, { loteCodigo: e.target.value })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={`text-xs ${texto2}`}>O código do lote é opcional, mas é ele que permite separar a mercadoria numa troca ou num recall sem abrir embalagem.</p>
        <div className="space-y-1.5 sm:max-w-xs">
          <Label htmlFor="conf-venc">Data de pagamento</Label>
          <Input id="conf-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} aria-describedby="conf-venc-ajuda" />
          <p id="conf-venc-ajuda" className={`text-xs ${texto2}`}>Gera a conta a pagar do fornecedor pelo valor CONFERIDO. Em branco, usa o prazo cadastrado do fornecedor.</p>
        </div>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}

// ── ver os itens da lista ───────────────────────────────────────────────────────────────────
function VerItensDialogo({ lista, verFin, aoFechar }: { lista: any; verFin: boolean; aoFechar: () => void }) {
  const itens: any[] = lista.itens ?? [];
  const foiRecebida = recebida(lista);
  return (
    <Dialogo largura="lg" titulo={`${lista.nome} · ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`} aoFechar={aoFechar}
      rodape={<Button type="button" data-foco-inicial onClick={aoFechar}>Fechar</Button>}>
      <div className="overflow-x-auto rounded-lg border border-border text-sm">
        {/* Abaixo de 640 px cada item vira um bloco, com o título da coluna antes do valor. */}
        <table className="block w-full border-collapse sm:table sm:min-w-[520px]">
          <caption className="sr-only">Itens da lista de compras</caption>
          <thead className="hidden sm:table-header-group">
            <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
              <th scope="col" className="px-3 py-2">Produto</th>
              <th scope="col" className="px-3 py-2">Pedido</th>
              {foiRecebida && <th scope="col" className="px-3 py-2">Recebido</th>}
              {verFin && <th scope="col" className="px-3 py-2">Custo unitário</th>}
              {foiRecebida && <th scope="col" className="px-3 py-2">Validade · lote</th>}
            </tr>
          </thead>
          <tbody className="block sm:table-row-group">
            {itens.map((it) => (
              <tr key={it.id} className="block space-y-1 border-b border-border p-3 last:border-b-0 sm:table-row sm:space-y-0 sm:p-0">
                <td className="block sm:table-cell sm:px-3 sm:py-2">
                  <span className="break-words font-semibold">{nomeDeCompra(it)}</span>
                  {it.marca && <span className="block text-xs font-semibold">Marca: {it.marca}</span>}
                  {nomeDeApoio(it) && <span className={`block break-words text-xs ${texto2}`}>No estoque: {nomeDeApoio(it)}</span>}
                </td>
                <td className="block font-mono sm:table-cell sm:whitespace-nowrap sm:px-3 sm:py-2"><RotuloNaLinha>Pedido</RotuloNaLinha>{num(it.quantidade)} {it.unidadeMedida}</td>
                {foiRecebida && (
                  <td className="block font-mono sm:table-cell sm:whitespace-nowrap sm:px-3 sm:py-2">
                    <RotuloNaLinha>Recebido</RotuloNaLinha>
                    {it.qtdRecebida != null ? `${num(it.qtdRecebida)} ${it.unidadeMedida}` : '—'}
                    {it.qtdRecebida != null && Number(it.qtdRecebida) !== Number(it.quantidade) && <span className="ml-2"><Selo tom="aviso">diferente do pedido</Selo></span>}
                  </td>
                )}
                {verFin && <td className="block font-mono sm:table-cell sm:px-3 sm:py-2"><RotuloNaLinha>Custo unitário</RotuloNaLinha>{it.custoUnitario != null ? brl(it.custoUnitario) : '—'}</td>}
                {foiRecebida && (
                  <td className="block sm:table-cell sm:px-3 sm:py-2">
                    <RotuloNaLinha>Validade · lote</RotuloNaLinha>
                    {it.validadeIndefinida ? 'sem validade' : it.validade ? dataBr(it.validade) : '—'}{it.loteCodigo ? ` · ${it.loteCodigo}` : ''}
                  </td>
                )}
              </tr>
            ))}
            {itens.length === 0 && <tr className="block sm:table-row"><td colSpan={5} className={`block px-3 py-6 text-center sm:table-cell ${texto2}`}>Lista sem itens.</td></tr>}
          </tbody>
        </table>
      </div>
    </Dialogo>
  );
}
