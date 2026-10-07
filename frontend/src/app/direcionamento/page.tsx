'use client';

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, RotateCcw } from 'lucide-react';
import { api, getCategoria, getToken, podePerm } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chave } from '@/components/ui/chave';
import { Partes } from '@/components/ui/partes';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, distintos, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Parte = 'produtos' | 'cupom';
const ID_PRODUTOS = 'direcionamento-titulo';
const ID_CUPOM = 'cupom-titulo';
const tipoDe = (p: any) => (p.preparado ? 'Produzido (com ficha)' : 'Pronto (sem ficha)');
const tipoEquip = (e: any) => (e.tipo === 'impressora' ? 'Impressora' : 'KDS');
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
// Uma impressora só tem "alvo" imprimível se: rede → tem IP; local → tem nome no Windows.
const alvoDe = (e: any) => (e.conexao === 'local' ? (e.dispositivo ? `USB: ${e.dispositivo}` : '') : e.host ? `rede: ${e.host}` : '');

// Configurações → Direcionamento do catálogo (mockup `mockups/regem-configuracoes.html`). Duas partes:
//  • Produtos — para onde vai cada produto ao ser vendido (KDS e/ou impressoras). Uma lista só:
//    marque os produtos, "Direcionar marcados" e escolha os destinos na gaveta. Sem destino próprio,
//    o produto segue o padrão do setor.
//  • Cupom do cliente — quais impressoras imprimem a via com valores.
export default function DirecionamentoPage() {
  const router = useRouter();
  const [parte, setParte] = useState<Parte>('produtos');
  const [podeDirecionar, setPodeDirecionar] = useState(false);
  const [podeCupom, setPodeCupom] = useState(false);
  const [produtos, setProdutos] = useState<any[] | null>(null);
  const [erroProdutos, setErroProdutos] = useState('');
  // KDS e impressoras: `null` = a leitura falhou (o motivo fica em `erroEquip`). Falha NÃO vira
  // "nenhum equipamento cadastrado" — a rota deles tem permissão própria.
  const [equipamentos, setEquipamentos] = useState<any[] | null>(null);
  const [erroEquip, setErroEquip] = useState('');
  const [carregouEquip, setCarregouEquip] = useState(false);

  // filtros dos produtos
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [categoria, setCategoria] = useState('');
  const [setor, setSetor] = useState('');
  const [tipo, setTipo] = useState('');
  const [destino, setDestino] = useState('');
  // marcação e painéis
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [direcionando, setDirecionando] = useState<any[] | null>(null);
  const [voltando, setVoltando] = useState<any | null>(null);
  // cupom do cliente
  const [buscaCupom, setBuscaCupom] = useState('');
  const [sitCupom, setSitCupom] = useState(-1);
  const [gravando, setGravando] = useState<string | null>(null);

  const lerProdutos = useCallback(async () => {
    setErroProdutos('');
    try {
      const p: any = await api.direcionamento();
      setProdutos(Array.isArray(p) ? p : []);
    } catch (e) {
      setErroProdutos(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);
  const lerEquipamentos = useCallback(async () => {
    setErroEquip('');
    try {
      const e: any = await api.equipamentos();
      setEquipamentos((Array.isArray(e) ? e : []).filter((x: any) => x.tipo === 'kds' || x.tipo === 'impressora'));
    } catch (e) {
      setEquipamentos(null);
      setErroEquip(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setCarregouEquip(true);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    // Espelho do servidor: direcionar = presidente, gerente e supervisão; o papel de cupom da
    // impressora = presidente e gerente. Os dois pedem a permissão de direcionamento.
    const cat = getCategoria() ?? '';
    const perm = podePerm('direcionamento_impressao');
    setPodeDirecionar(['presidente', 'gerente', 'supervisao', 'suporte'].includes(cat) && perm);
    setPodeCupom(['presidente', 'gerente', 'suporte'].includes(cat) && perm);
    void lerProdutos();
    void lerEquipamentos();
  }, [router, lerProdutos, lerEquipamentos]);

  const equip = useMemo(() => new Map((equipamentos ?? []).map((e) => [e.id, e])), [equipamentos]);
  const nomeDestino = useCallback((id: string) => equip.get(id)?.nome ?? 'Destino fora da lista', [equip]);
  const lista = useMemo(() => produtos ?? [], [produtos]);

  // ── parte "Produtos" ──
  const SITUACOES: Situacao<any>[] = [
    { rotulo: 'Com destino próprio', filtro: (p) => (p.destinos ?? []).length > 0 },
    { rotulo: 'Herdando o padrão do setor', filtro: (p) => !(p.destinos ?? []).length },
  ];
  const categoriaDe = (p: any) => p.categoriaNome ?? 'Sem categoria';
  const setorDe = (p: any) => p.setorNome ?? 'Sem setor';
  const b = semAcento(busca);
  const base = lista.filter(
    (p) =>
      (!b || semAcento(p.nome).includes(b)) &&
      (!categoria || categoriaDe(p) === categoria) &&
      (!setor || setorDe(p) === setor) &&
      (!tipo || tipoDe(p) === tipo) &&
      (!destino || (p.destinos ?? []).some((d: string) => nomeDestino(d) === destino)),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || categoria || setor || tipo || destino || sit >= 0);
  const limpar = () => { setBusca(''); setCategoria(''); setSetor(''); setTipo(''); setDestino(''); setSit(-1); };

  // Só conta o que ainda existe na lista; o que está marcado e fora do filtro continua marcado —
  // e a tela DIZ quantos são, porque eles entram no envio.
  const marcadosDaLista = lista.filter((p) => marcados.has(p.id));
  const aVista = new Set(linhas.map((p) => p.id));
  const foraDoFiltro = marcadosDaLista.filter((p) => !aVista.has(p.id)).length;
  const todosAVista = linhas.length > 0 && linhas.every((p) => marcados.has(p.id));
  const alternar = (id: string) =>
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const marcarAVista = () =>
    setMarcados((m) => {
      const n = new Set(m);
      for (const p of linhas) if (todosAVista) n.delete(p.id); else n.add(p.id);
      return n;
    });

  // ── parte "Cupom do cliente" ──
  const impressoras = (equipamentos ?? []).filter((e) => e.tipo === 'impressora');
  const SITUACOES_CUPOM: Situacao<any>[] = [
    { rotulo: 'Imprimem o cupom', filtro: (e) => !!e.fazCupom },
    { rotulo: 'Não imprimem', filtro: (e) => !e.fazCupom },
    { rotulo: 'Sem alvo configurado', filtro: (e) => !alvoDe(e), tom: 'aviso' },
  ];
  const bc = semAcento(buscaCupom);
  const baseCupom = impressoras.filter((e) => !bc || semAcento(`${e.nome} ${alvoDe(e)}`).includes(bc));
  const linhasCupom = sitCupom < 0 ? baseCupom : baseCupom.filter(SITUACOES_CUPOM[sitCupom].filtro);
  const limparCupom = () => { setBuscaCupom(''); setSitCupom(-1); };

  async function alternarCupom(imp: any, fazCupom: boolean) {
    setGravando(imp.id);
    try {
      const novo: any = await api.setPapeisImpressora(imp.id, { fazCupom });
      setEquipamentos((prev) => (prev ?? []).map((e) => (e.id === imp.id ? { ...e, ...novo } : e)));
      toast.success(novo.fazCupom ? `${imp.nome} passa a imprimir o cupom do cliente.` : `${imp.nome} não imprime mais o cupom.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setGravando(null);
    }
  }

  const falhou = (titulo: string, msg: string, tentar: () => void) => (
    <Card className="space-y-3 p-5 text-sm">
      <p className="font-display text-base font-bold">{titulo}</p>
      <p role="alert">{msg}</p>
      <Button type="button" variant="outline" size="sm" onClick={tentar}>Tentar de novo</Button>
    </Card>
  );
  const semEquipamentos = carregouEquip && equipamentos === null;

  return (
    <Shell eyebrow="Configurações" title="Direcionamento do catálogo">
      <div className="space-y-4">
        <Partes<Parte>
          rotulo="Partes de Direcionamento do catálogo"
          ativa={parte}
          aoEscolher={setParte}
          partes={[
            { key: 'produtos', label: 'Produtos', conta: produtos?.length ?? null },
            { key: 'cupom', label: 'Cupom do cliente', conta: equipamentos ? impressoras.length : null },
          ]}
        />

        {parte === 'produtos' &&
          (erroProdutos ? (
            falhou('Para onde vai cada produto', erroProdutos, () => void lerProdutos())
          ) : !produtos ? (
            <SkeletonList rows={6} />
          ) : (
            <section className="space-y-3" aria-labelledby={ID_PRODUTOS}>
              <TituloLista id={ID_PRODUTOS} titulo="Para onde vai cada produto" total={lista.length} mostrando={linhas.length} um="produto" varios="produtos" extra="sem destino próprio, o produto segue o padrão do setor" />
              <p className={`max-w-3xl text-sm ${texto2}`}>
                Define para onde cada produto vai ao ser vendido: um ou mais <strong>KDS</strong> e/ou <strong>impressoras</strong>. Produto sem destino
                herda o padrão do setor — e se a loja tiver só uma impressora, ela é usada automaticamente.
              </p>
              {semEquipamentos && (
                <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm" role="status">
                  Não deu para carregar os KDS e as impressoras: <b>{erroEquip}</b>. Sem eles a lista mostra só quantos destinos cada produto tem, e não dá
                  para escolher destino. <button type="button" className="font-semibold underline" onClick={() => void lerEquipamentos()}>Tentar de novo</button>
                </p>
              )}
              {equipamentos?.length === 0 && (
                <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm">Nenhum KDS/impressora cadastrado. Cadastre em Configurações → Equipamentos.</p>
              )}
              <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
              <Filtros>
                <FiltroBusca id="direcionamento-busca" valor={busca} aoMudar={setBusca} placeholder="Nome do produto" />
                <FiltroSelect id="direcionamento-categoria" rotulo="Categoria" todos="Todas as categorias" opcoes={distintos(lista, categoriaDe)} valor={categoria} aoMudar={setCategoria} />
                <FiltroSelect id="direcionamento-setor" rotulo="Setor" todos="Todos os setores" opcoes={distintos(lista, setorDe)} valor={setor} aoMudar={setSetor} />
                <FiltroSelect id="direcionamento-tipo" rotulo="Tipo" todos="Produzidos e prontos" opcoes={distintos(lista, tipoDe)} valor={tipo} aoMudar={setTipo} />
                {equipamentos && equipamentos.length > 0 && (
                  <FiltroSelect id="direcionamento-destino" rotulo="Destino" todos="Qualquer destino" opcoes={distintos(lista.flatMap((p) => p.destinos ?? []), (d: string) => nomeDestino(d))} valor={destino} aoMudar={setDestino} />
                )}
              </Filtros>

              {podeDirecionar && lista.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
                  <Button type="button" variant="outline" size="sm" onClick={marcarAVista} disabled={!linhas.length} aria-pressed={todosAVista}>
                    {todosAVista ? `Desmarcar os ${linhas.length} à vista` : `Marcar os ${linhas.length} à vista`}
                  </Button>
                  <span className="text-sm" role="status" aria-live="polite" id="direcionamento-marcados">
                    <b className="font-mono">{marcadosDaLista.length}</b> {marcadosDaLista.length === 1 ? 'marcado' : 'marcados'}
                    {foraDoFiltro > 0 && <span className="font-medium"> — {foraDoFiltro === 1 ? '1 está fora' : `${foraDoFiltro} estão fora`} do filtro atual e {foraDoFiltro === 1 ? 'entra' : 'entram'} no envio</span>}
                  </span>
                  <span className="ml-auto flex flex-wrap gap-2">
                    {marcadosDaLista.length > 0 && <Button type="button" variant="outline" size="sm" onClick={() => setMarcados(new Set())}>Limpar marcação</Button>}
                    <Button type="button" size="sm" disabled={!marcadosDaLista.length || !equipamentos?.length} onClick={() => setDirecionando(marcadosDaLista)}>Direcionar marcados</Button>
                  </span>
                </div>
              )}

              {lista.length === 0 ? (
                <Vazio>Nenhum produto ativo no catálogo.</Vazio>
              ) : linhas.length === 0 ? (
                <Vazio aoLimpar={limpar} />
              ) : (
                <ListaDados
                  legenda="Produtos e seus destinos de produção"
                  linhas={linhas}
                  chave={(p) => p.id}
                  nome={(p) => p.nome}
                  colunas={[
                    {
                      titulo: 'Produto',
                      celula: (p) =>
                        podeDirecionar ? (
                          <label className="flex min-h-10 cursor-pointer items-center gap-3">
                            <input type="checkbox" className="h-5 w-5 flex-none accent-primary" checked={marcados.has(p.id)} onChange={() => alternar(p.id)} aria-label={`Marcar ${p.nome}`} />
                            <span className="min-w-0"><NomeComApoio nome={p.nome} apoio={`${categoriaDe(p)} · ${setorDe(p)}`} /></span>
                          </label>
                        ) : (
                          <NomeComApoio nome={p.nome} apoio={`${categoriaDe(p)} · ${setorDe(p)}`} />
                        ),
                    },
                    { titulo: 'Tipo', celula: tipoDe },
                    {
                      titulo: 'Destinos',
                      celula: (p) => {
                        const ds: string[] = p.destinos ?? [];
                        if (!ds.length) return <span className={`text-xs ${texto2}`}>padrão do setor</span>;
                        if (!equipamentos) return <Selo>{plural(ds.length, 'destino', 'destinos')}</Selo>;
                        return <span className="inline-flex flex-wrap justify-end gap-1 xl:justify-start">{ds.map((d) => <Selo key={d} tom="info">{nomeDestino(d)}</Selo>)}</span>;
                      },
                    },
                  ]}
                  acoes={(p) =>
                    podeDirecionar
                      ? [
                          ...(equipamentos?.length ? [{ rotulo: 'Destinos', icone: Pencil, aoClicar: (x: any) => setDirecionando([x]) }] : []),
                          ...((p.destinos ?? []).length ? [{ rotulo: 'Voltar ao padrão', icone: RotateCcw, aoClicar: setVoltando }] : []),
                        ]
                      : []
                  }
                />
              )}
              {filtrando && linhas.length > 0 && (
                <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
              )}
            </section>
          ))}

        {parte === 'cupom' &&
          (!carregouEquip ? (
            <SkeletonList rows={3} />
          ) : equipamentos === null ? (
            falhou('Impressoras que imprimem o cupom do cliente', erroEquip, () => { setCarregouEquip(false); void lerEquipamentos(); })
          ) : (
            <section className="space-y-3" aria-labelledby={ID_CUPOM}>
              <TituloLista id={ID_CUPOM} titulo="Impressoras que imprimem o cupom do cliente" total={impressoras.length} mostrando={linhasCupom.length} um="impressora" varios="impressoras" />
              <p className={`max-w-3xl text-sm ${texto2}`}>
                Ligue as impressoras que imprimem o <strong>cupom do cliente</strong> (via com valores). É o que sai ao aceitar/reimprimir um pedido. A
                produção da cozinha usa o direcionamento por produto, na parte “Produtos”.
              </p>
              <Situacoes base={baseCupom} opcoes={SITUACOES_CUPOM} valor={sitCupom} aoMudar={setSitCupom} />
              <Filtros>
                <FiltroBusca id="cupom-busca" valor={buscaCupom} aoMudar={setBuscaCupom} placeholder="Nome da impressora" />
              </Filtros>
              {impressoras.length === 0 ? (
                <Vazio>Nenhuma impressora cadastrada. Cadastre em Configurações → Equipamentos.</Vazio>
              ) : linhasCupom.length === 0 ? (
                <Vazio aoLimpar={limparCupom} />
              ) : (
                <ListaDados
                  legenda="Impressoras e o cupom do cliente"
                  linhas={linhasCupom}
                  chave={(e) => e.id}
                  nome={(e) => e.nome}
                  colunas={[
                    { titulo: 'Impressora', celula: (e) => <span className="font-bold">{e.nome}</span> },
                    { titulo: 'Ligação', celula: (e) => (alvoDe(e) ? <span className="font-mono text-xs">{alvoDe(e)}</span> : <Selo tom="aviso">sem alvo — configure em Equipamentos</Selo>) },
                    {
                      titulo: 'Imprime o cupom',
                      celula: (e) =>
                        podeCupom ? (
                          <Chave ligada={!!e.fazCupom} rotulo={`${e.nome} imprime o cupom do cliente`} ocupada={gravando === e.id} aoMudar={(v) => void alternarCupom(e, v)} />
                        ) : e.fazCupom ? 'sim' : 'não',
                    },
                  ]}
                />
              )}
            </section>
          ))}
      </div>

      {direcionando && (
        <GavetaDestinos
          produtos={direcionando}
          equipamentos={equipamentos ?? []}
          aoFechar={() => setDirecionando(null)}
          aoSalvar={async () => {
            setDirecionando(null);
            setMarcados(new Set());
            await lerProdutos();
          }}
        />
      )}
      {voltando && (
        <VoltarAoPadrao
          produto={voltando}
          aoFechar={() => setVoltando(null)}
          aoVoltar={async () => {
            setVoltando(null);
            await lerProdutos();
          }}
        />
      )}
    </Shell>
  );
}

function GavetaDestinos({ produtos, equipamentos, aoFechar, aoSalvar }: { produtos: any[]; equipamentos: any[]; aoFechar: () => void; aoSalvar: () => void }) {
  const formId = useId();
  const um = produtos.length === 1;
  // Um produto: abre com os destinos dele marcados. Vários: começa em branco.
  const [ids, setIds] = useState<string[]>(() => (um ? (produtos[0].destinos ?? []).filter((d: string) => equipamentos.some((e) => e.id === d)) : []));
  const [modo, setModo] = useState<'substituir' | 'adicionar'>('substituir');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const alternar = (id: string) => setIds((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  // Adicionar sem destino marcado não muda nada: não há o que confirmar.
  const semEfeito = modo === 'adicionar' && ids.length === 0;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando || semEfeito) return;
    setErro('');
    setSalvando(true);
    try {
      // Uma chamada para todos os produtos marcados.
      await api.setDirecionamento(produtos.map((p) => p.id), ids, modo);
      toast.success(
        ids.length
          ? `Direcionamento salvo em ${plural(produtos.length, 'produto', 'produtos')}.`
          : `${plural(produtos.length, 'produto', 'produtos')} sem destino próprio (${um ? 'volta' : 'voltam'} a herdar o padrão do setor).`,
      );
      aoSalvar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
      setSalvando(false);
    }
  }
  const opcao = (ligada: boolean) =>
    `min-h-11 border-r border-input px-2 text-sm font-semibold last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
      ligada ? 'bg-foreground text-background' : 'bg-card text-foreground hover:bg-secondary'
    }`;

  return (
    <Gaveta
      titulo={um ? `Destinos de ${produtos[0].nome}` : `Direcionar ${produtos.length} produtos`}
      aoFechar={aoFechar}
      voltarPara={ID_PRODUTOS}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={salvando || semEfeito}>{salvando ? 'Salvando…' : 'Confirmar direcionamento'}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="space-y-4" noValidate>
        <p className="rounded-md bg-secondary px-3 py-2 text-sm font-semibold" role="status" aria-live="polite">
          {plural(produtos.length, 'produto', 'produtos')} · {plural(ids.length, 'destino', 'destinos')}
        </p>
        {!um && (
          <p className={`text-sm ${texto2}`}>
            {produtos.slice(0, 4).map((p) => p.nome).join(' · ')}
            {produtos.length > 4 ? ` · e mais ${produtos.length - 4}` : ''}
          </p>
        )}
        <fieldset>
          <legend className="text-sm font-medium">Destinos</legend>
          <ul className="mt-1 space-y-1.5">
            {equipamentos.map((e, i) => (
              <li key={e.id}>
                <label className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 py-1.5 text-sm ${ids.includes(e.id) ? 'border-foreground bg-secondary' : 'border-input'}`}>
                  <input type="checkbox" className="h-5 w-5 flex-none accent-primary" checked={ids.includes(e.id)} onChange={() => alternar(e.id)} {...(i === 0 ? { 'data-foco-inicial': true } : {})} />
                  <span className="min-w-0 flex-1 break-words font-semibold">{e.nome}</span>
                  <Selo>{tipoEquip(e)}</Selo>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <div>
          <span className="mb-1 block text-sm font-medium">Como aplicar</span>
          <div className="grid grid-cols-2 overflow-hidden rounded-md border border-input" role="group" aria-label="Como aplicar">
            <button type="button" aria-pressed={modo === 'substituir'} className={opcao(modo === 'substituir')} onClick={() => setModo('substituir')}>Substituir destinos</button>
            <button type="button" aria-pressed={modo === 'adicionar'} className={opcao(modo === 'adicionar')} onClick={() => setModo('adicionar')}>Adicionar aos atuais</button>
          </div>
          <p className={`mt-1 text-xs ${texto2}`}>
            {modo === 'substituir' ? 'Os produtos ficam só com os destinos marcados aqui.' : 'Os destinos marcados aqui se somam aos que cada produto já tem.'}
          </p>
        </div>
        {ids.length === 0 && (
          <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm" role="status">
            {modo === 'substituir'
              ? `Sem nenhum destino marcado, ${um ? 'o produto volta' : `os ${produtos.length} produtos voltam`} a herdar o padrão do setor.`
              : 'Marque ao menos um destino para adicionar.'}
          </p>
        )}
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}

function VoltarAoPadrao({ produto, aoFechar, aoVoltar }: { produto: any; aoFechar: () => void; aoVoltar: () => void }) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');
  async function confirmar() {
    if (gravando) return;
    setErro('');
    setGravando(true);
    try {
      await api.setDirecionamento([produto.id], [], 'substituir');
      toast.success('Produto de volta ao padrão do setor.');
      aoVoltar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
      setGravando(false);
    }
  }
  return (
    <Dialogo titulo="Voltar ao padrão do setor?" aoFechar={aoFechar} voltarPara={ID_PRODUTOS}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar} disabled={gravando}>Cancelar</Button>
          <Button type="button" onClick={confirmar} disabled={gravando}>{gravando ? 'Salvando…' : 'Voltar ao padrão'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p>
          <b>{produto.nome}</b> deixa de ter destino próprio
          {produto.setorNome ? <> e passa a seguir o padrão do setor <b>{produto.setorNome}</b>.</> : <>. Como não tem setor, vai para a impressora padrão da loja.</>}
        </p>
        {erro && <p role="alert" className="font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
