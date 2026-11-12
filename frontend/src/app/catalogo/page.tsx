'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Calculator, ImageOff, Pause, Pencil, Play } from 'lucide-react';
import { api, getCategoria, getToken, podeVerFinanceiro } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';
import { PrecoNoLugar } from '@/components/catalogo/preco-no-lugar';
import { ChipPausa } from '@/components/catalogo/chip-pausa';
import { EditarProduto } from '@/components/catalogo/editar-produto';
import { ComplementosGestao } from '@/components/catalogo/complementos-gestao';
import { ConferirApps } from '@/components/catalogo/conferir-apps';
import { TaxasEMargem } from '@/components/catalogo/taxas-e-margem';
import { CalculadoraPreco, type ItemDaCalculadora } from '@/components/catalogo/calculadora-preco';
import type { CanalCalc, RespostaDasTaxas } from '@/lib/calculadora-preco';
import { fotosDoProduto, situacaoDaFoto, type FotosDaLoja } from '@/lib/conferencia-apps';
import { UltimoEnvioIfood } from '@/components/produtos/ultimo-envio-ifood';
import {
  agruparPorCategoria, esgotado, pausaNoRegem, pausadoEmAlgumCanal, pausadoNa99, pausadoNoIfood, semPrecoNa99, semPrecoNoIfood,
  type CanalDaGestao, type CategoriaDaGestao,
} from '@/lib/catalogo-gestao';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ID_TITULO = 'catalogo-titulo';
type Canal = CanalDaGestao;

// DELIVERY › GESTÃO DO CATÁLOGO › "Produtos e preços" (R3 F1/F2; protótipo aprovado pelo dono em 11/11/2026 —
// `mockups/regem-conciliacao-ifood.html`): cada produto com o preço e a pausa de cada canal — o Regem (balcão e cardápio
// digital), o iFood (pelo Orzuni, só com ele ligado) e a 99 (só com o "Preço e pausa na 99" ligado) —, agrupado por
// categoria na ordem do cardápio. O lápis muda o preço ali mesmo; o "No ar / Pausado" pausa só aquele canal; Editar abre
// a gaveta com o resto. Criar produto, ficha, estoque, fiscal e complementos ficam em Cadastros › Cardápio.
export default function CatalogoPage() {
  const router = useRouter();
  const [produtos, setProdutos] = useState<any[] | null>(null);
  const [categorias, setCategorias] = useState<CategoriaDaGestao[]>([]);
  const [comIfood, setComIfood] = useState(false);
  const [com99, setCom99] = useState(false);
  const [podeMudarPreco, setPodeMudarPreco] = useState(false);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [cat, setCat] = useState('');
  const [sit, setSit] = useState(-1);
  const [editando, setEditando] = useState<any | null>(null);
  const [vista, setVista] = useState<'produtos' | 'complementos'>('produtos');
  // As abas do protótipo: "Produtos e preços" | "Conferir com os apps" (R3 F4a; a 2ª só com o direito ligado na empresa).
  const [aba, setAba] = useState<'produtos' | 'conferir'>('produtos');
  const [conferirLigada, setConferirLigada] = useState(false);
  // A calculadora de preço e as taxas da loja (R3 F5).
  const [taxas, setTaxas] = useState<RespostaDasTaxas | null>(null);
  const [abrirTaxasGaveta, setAbrirTaxasGaveta] = useState(false);
  const [calc, setCalc] = useState<{ produtoId: string; canal: CanalCalc } | null>(null);
  const [versaoConf, setVersaoConf] = useState(0);
  // As fotos dos apps pela última leitura (R3 F6).
  const [fotos, setFotos] = useState<FotosDaLoja | null>(null);
  const [ocupado, setOcupado] = useState<Set<string>>(new Set());
  const [enviados, setEnviados] = useState<Set<string>>(new Set()); // produtos com mudança ao iFood nesta visita
  const [enviados99, setEnviados99] = useState<Set<string>>(new Set()); // produtos com mudança à 99 nesta visita
  const leitura = useRef(0);

  const carregar = useCallback(async () => {
    const minha = ++leitura.current; // só a leitura mais nova vale (V64)
    setErro('');
    try {
      const [ps, cs, ifood, n99, conferir, fts] = await Promise.all([
        api.produtos(),
        api.produtoCategorias(),
        api.ifoodPeloOrzuni().catch(() => ({ ligado: false })),
        api.precosNa99().catch(() => ({ ligado: false })),
        api.conferenciaLigada().catch(() => ({ ligada: false })),
        // As fotos dos apps pela última leitura da conferência (R3 F6): sem a conferência (ou sem acesso), nada.
        api.conferenciaFotos().catch(() => null),
      ]);
      if (minha !== leitura.current) return;
      setProdutos(Array.isArray(ps) ? (ps as any[]) : []);
      setCategorias(Array.isArray(cs) ? (cs as CategoriaDaGestao[]) : []);
      setComIfood(ifood?.ligado === true);
      setCom99(n99?.ligado === true);
      setConferirLigada(conferir?.ligada === true);
      setFotos(fts);
    } catch (e) {
      if (minha !== leitura.current) return;
      // Erro não é "nenhum produto": a tela diz que não leu e oferece de novo.
      setProdutos((l) => l ?? []);
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar os produtos.');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    // A permissão vem do token: lida depois da carga (o primeiro desenho é igual no servidor e no navegador).
    setPodeMudarPreco(getCategoria() === 'presidente' || podeVerFinanceiro());
    // R3 F7: "Preço e pausa" do Cadastros › Cardápio abre aqui com o produto na busca (`?busca=`), lida depois da carga.
    const vinda = new URLSearchParams(window.location.search).get('busca');
    if (vinda) setBusca(vinda.slice(0, 120));
    void carregar();
  }, [carregar, router]);

  const situacoes = useMemo<Situacao<any>[]>(
    () => [
      { rotulo: 'Pausados em algum canal', filtro: (p) => pausadoEmAlgumCanal(p, comIfood, com99), tom: 'aviso' },
      { rotulo: 'Esgotados pelo estoque', filtro: esgotado, tom: 'aviso' },
      ...(comIfood ? [{ rotulo: 'Sem preço no iFood', filtro: semPrecoNoIfood, tom: 'critico' as const }] : []),
      ...(com99 ? [{ rotulo: 'Sem preço na 99', filtro: semPrecoNa99, tom: 'critico' as const }] : []),
      { rotulo: 'Sem código PDV', filtro: (p: any) => !(p.codigo ?? '').trim() },
      // R3 F6: a foto que falta num app (ou só existe lá), pela última leitura da conferência.
      ...(fotos && (fotos.canais.ifood || fotos.canais['99food'])
        ? [{ rotulo: 'Foto faltando num app', filtro: (p: any) => fotoFaltando(p), tom: 'aviso' as const }]
        : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comIfood, com99, fotos],
  );
  // A lista de situações muda com o iFood e a 99: a escolhida que sumiu volta para "Todos".
  useEffect(() => {
    if (sit >= situacoes.length) setSit(-1);
  }, [sit, situacoes.length]);

  const trocar = (id: string, m: Record<string, unknown>) => setProdutos((l) => (l ?? []).map((p) => (p.id === id ? { ...p, ...m } : p)));
  const marcar = (k: string, sim: boolean) =>
    setOcupado((s) => {
      const n = new Set(s);
      if (sim) n.add(k);
      else n.delete(k);
      return n;
    });
  const marcarEnviado = (id: string) => setEnviados((s) => new Set(s).add(id));
  const marcarEnviado99 = (id: string) => setEnviados99((s) => new Set(s).add(id));
  const ligaAoIfood = (p: any) => comIfood && p.noIfood === true && !!(p.codigo ?? '').trim();
  const ligaA99 = (p: any) => com99 && p.na99 === true && !!(p.codigo ?? '').trim();
  // O nome de cada canal nas frases.
  const NO: Record<Canal, string> = { regem: 'no Regem', ifood: 'no iFood', '99food': 'na 99' };

  async function salvarPreco(p: any, canal: Canal, valor: string | null) {
    const r = await api.precoDoCanal(p.id, canal, valor);
    trocar(p.id, canal === 'regem' ? { precoVenda: r.valor } : canal === 'ifood' ? { precoIfood: r.valor } : { preco99: r.valor });
    if (!r.mudou) return void toast.success('O preço já era esse.');
    if (canal === 'ifood' && ligaAoIfood(p)) marcarEnviado(p.id);
    if (canal === '99food' && ligaA99(p)) marcarEnviado99(p.id);
    toast.success(
      canal === 'regem'
        ? `Preço de venda de "${p.nome}" salvo.`
        : canal === 'ifood'
          ? valor === null
            ? `"${p.nome}": preço do iFood em branco — o Regem não mexe mais no preço de lá.`
            : `Preço no iFood de "${p.nome}" salvo: vai em instantes pelo Orzuni.`
          : valor === null
            ? `"${p.nome}": preço da 99 em branco — o Regem não mexe mais no preço de lá.`
            : `Preço na 99 de "${p.nome}" salvo: vai em instantes à 99.`,
    );
  }

  // ── A calculadora de preço e as taxas da loja (R3 F5): carregadas só quando se abre uma das duas gavetas. ──
  async function lerTaxas(): Promise<RespostaDasTaxas | null> {
    if (taxas) return taxas;
    try {
      const r = await api.taxas();
      setTaxas(r);
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível ler as taxas da loja.');
      return null;
    }
  }
  async function abrirTaxas() {
    if (await lerTaxas()) setAbrirTaxasGaveta(true);
  }
  async function abrirCalculadora(produtoId: string, canal: CanalCalc) {
    const p = (produtos ?? []).find((x) => x.id === produtoId);
    if (!p || p.custoEfetivo == null) return void toast.error('Este produto não tem custo (ficha técnica, item de estoque ou custo manual): a calculadora parte do custo.');
    if (await lerTaxas()) setCalc({ produtoId, canal });
  }
  const itemDaCalculadora = (p: any, canal: CanalCalc): ItemDaCalculadora => {
    const custo = Number(p.custoEfetivo) || 0;
    const delivery = p.custoEfetivoDelivery != null ? Number(p.custoEfetivoDelivery) : custo;
    const hoje = canal === 'ifood' ? p.precoIfood : p.preco99;
    return {
      id: p.id,
      nome: p.nome,
      custo,
      emb: Math.max(0, Math.round((delivery - custo) * 100) / 100),
      precoHoje: hoje != null && hoje !== '' ? Number(hoje) : null,
      fonteDoCusto: p.custoFonte === 'ficha' ? 'da ficha técnica, com a perda' : p.custoFonte === 'estoque' ? 'custo médio do estoque' : p.custoFonte === 'manual' ? 'custo manual' : null,
    };
  };
  // R3 F6: a foto do produto num app (pela última leitura da conferência) — falta lá ou só existe lá.
  function fotoFaltando(p: any) {
    const f = fotosDoProduto(fotos, p.id);
    const tem = !!String(p.imagemRef ?? '').trim();
    return (comIfood && p.noIfood === true && situacaoDaFoto(tem, f.ifood) != null) || (com99 && p.na99 === true && situacaoDaFoto(tem, f['99food']) != null);
  }
  const seloDaFoto = (p: any, canal: CanalCalc) => {
    const s = situacaoDaFoto(!!String(p.imagemRef ?? '').trim(), fotosDoProduto(fotos, p.id)[canal]);
    if (!s) return null;
    const onde = canal === 'ifood' ? 'no iFood' : 'na 99';
    return <span className={`w-full text-xs ${texto2}`}>{s === 'faltaNoApp' ? `sem foto ${onde}` : `foto só ${onde}`}</span>;
  };
  const botaoCalcular = (p: any, canal: CanalCalc) =>
    podeMudarPreco && p.custoEfetivo != null ? (
      <button
        type="button"
        className="inline-flex min-h-8 items-center gap-1 rounded-md border border-input px-2 text-xs font-semibold hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`Calcular o preço ${canal === 'ifood' ? 'no iFood' : 'na 99'} de ${p.nome}`}
        onClick={() => void abrirCalculadora(p.id, canal)}
      >
        <Calculator className="h-3.5 w-3.5" aria-hidden="true" /> Calcular
      </button>
    ) : null;

  async function pausar(p: any, canal: Canal, pausado: boolean, calado = false) {
    const k = `${p.id}|${canal}`;
    marcar(k, true);
    try {
      const r = await api.pausaDoCanal(p.id, canal, pausado);
      trocar(p.id, { disponivelBalcao: r.disponivelBalcao, disponivelCardapio: r.disponivelCardapio, canaisPausados: r.canaisPausados });
      if (canal === 'ifood' && r.mudou && ligaAoIfood(p)) marcarEnviado(p.id);
      if (canal === '99food' && r.mudou && ligaA99(p)) marcarEnviado99(p.id);
      if (!calado)
        toast.success(
          canal === 'regem'
            ? `"${p.nome}" ${pausado ? 'pausado no balcão e no cardápio digital' : 'de volta ao balcão e ao cardápio digital'}.`
            : canal === 'ifood'
              ? `"${p.nome}" ${pausado ? 'pausado' : 'reativado'} no iFood: vai em instantes pelo Orzuni.`
              : `"${p.nome}" ${pausado ? 'pausado' : 'reativado'} na 99: vai em instantes à 99.`,
        );
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível mudar a pausa.');
      return false;
    } finally {
      marcar(k, false);
    }
  }

  // "Pausar em todos" / "Reativar em todos": o Regem e, com eles ligados e o produto lá, o iFood e a 99.
  const canaisDe = (p: any): Canal[] => [
    'regem',
    ...(comIfood && p.noIfood ? (['ifood'] as const) : []),
    ...(com99 && p.na99 ? (['99food'] as const) : []),
  ];
  const pausadoNo = (p: any, k: Canal) => (k === 'regem' ? pausaNoRegem(p).pausado : k === 'ifood' ? pausadoNoIfood(p) : pausadoNa99(p));
  const tudoPausado = (p: any) => canaisDe(p).every((k) => pausadoNo(p, k));
  async function pausarTudo(p: any) {
    const pausado = !tudoPausado(p);
    const oks = await Promise.all(canaisDe(p).filter((k) => pausadoNo(p, k) !== pausado).map((k) => pausar(p, k, pausado, true)));
    if (oks.every(Boolean)) {
      const onde = canaisDe(p).map((k) => NO[k]);
      const lista = onde.length > 1 ? `${onde.slice(0, -1).join(', ')} e ${onde[onde.length - 1]}` : onde[0];
      toast.success(`"${p.nome}" ${pausado ? 'pausado' : 'reativado'} ${lista}.`);
    }
  }

  if (produtos === null)
    return (
      <Shell eyebrow="Delivery" title="Gestão do catálogo">
        <SkeletonList rows={5} />
      </Shell>
    );

  const existeCat = (id: unknown) => categorias.some((c) => c.id === id);
  const b = semAcento(busca.trim());
  const base = produtos.filter(
    (p) =>
      (!b || semAcento(`${p.nome} ${p.codigo ?? ''} ${p.descricao ?? ''}`).includes(b)) &&
      (!cat || (cat === '-' ? !existeCat(p.categoriaId) : p.categoriaId === cat)),
  );
  const filtrados = sit < 0 || !situacoes[sit] ? base : base.filter(situacoes[sit].filtro);
  const grupos = agruparPorCategoria(filtrados, categorias);
  const linhas = grupos.flatMap((g) => g.produtos);
  const grupoDoProduto = new Map(grupos.flatMap((g) => g.produtos.map((p) => [p.id, g.nome] as const)));
  const filtrando = !!(busca.trim() || cat || sit >= 0);
  const limpar = () => {
    setBusca('');
    setCat('');
    setSit(-1);
  };
  const temSemCategoria = produtos.some((p) => !existeCat(p.categoriaId));
  const nPausados = produtos.filter((p) => pausadoEmAlgumCanal(p, comIfood, com99)).length;
  const onde = ['no Regem', ...(comIfood ? ['no iFood'] : []), ...(com99 ? ['na 99'] : [])];
  const ondeTexto = onde.length > 1 ? `${onde.slice(0, -1).join(', ')} e ${onde[onde.length - 1]}` : onde[0];

  const colunaRegem = (p: any) => {
    const pz = pausaNoRegem(p);
    return (
      <span className="inline-flex max-w-full flex-wrap items-center justify-end gap-1.5 xl:justify-start">
        <PrecoNoLugar valor={p.precoVenda} qual="de venda" nome={p.nome} podeEditar={podeMudarPreco} aoSalvar={(v) => salvarPreco(p, 'regem', v)} />
        <ChipPausa pausado={pz.pausado} onde="no Regem" nome={p.nome} ocupado={ocupado.has(`${p.id}|regem`)} aoMudar={() => void pausar(p, 'regem', !pz.pausado)} />
        {pz.parcial && <span className={`w-full text-xs ${texto2}`}>{pz.parcial}</span>}
      </span>
    );
  };
  const colunaIfood = (p: any) => {
    if (!p.noIfood) return <span className={`text-xs ${texto2}`}>não está no iFood</span>;
    if (!(p.codigo ?? '').trim()) return <span className={`text-xs ${texto2}`}>sem código PDV: não liga ao iFood</span>;
    const pz = pausadoNoIfood(p);
    return (
      <span className="inline-flex max-w-full flex-wrap items-center justify-end gap-1.5 xl:justify-start">
        <PrecoNoLugar valor={p.precoIfood} qual="no iFood" nome={p.nome} permiteVazio podeEditar={podeMudarPreco} aoSalvar={(v) => salvarPreco(p, 'ifood', v)} />
        <ChipPausa pausado={pz} onde="no iFood" nome={p.nome} ocupado={ocupado.has(`${p.id}|ifood`)} aoMudar={() => void pausar(p, 'ifood', !pz)} />
        {botaoCalcular(p, 'ifood')}
        {seloDaFoto(p, 'ifood')}
        {esgotado(p) && !pz && <span className={`w-full text-xs ${texto2}`}>pausado pelo estoque</span>}
        {enviados.has(p.id) && (
          <span className="block w-full min-w-0 text-left">
            <UltimoEnvioIfood alvo="produto" id={p.id} />
          </span>
        )}
      </span>
    );
  };
  const coluna99 = (p: any) => {
    if (!p.na99) return <span className={`text-xs ${texto2}`}>não está na 99</span>;
    if (!(p.codigo ?? '').trim()) return <span className={`text-xs ${texto2}`}>sem código PDV: não liga à 99</span>;
    const pz = pausadoNa99(p);
    return (
      <span className="inline-flex max-w-full flex-wrap items-center justify-end gap-1.5 xl:justify-start">
        <PrecoNoLugar valor={p.preco99} qual="na 99" nome={p.nome} permiteVazio podeEditar={podeMudarPreco} aoSalvar={(v) => salvarPreco(p, '99food', v)} />
        <ChipPausa pausado={pz} onde="na 99" nome={p.nome} ocupado={ocupado.has(`${p.id}|99food`)} aoMudar={() => void pausar(p, '99food', !pz)} />
        {botaoCalcular(p, '99food')}
        {seloDaFoto(p, '99food')}
        {esgotado(p) && !pz && <span className={`w-full text-xs ${texto2}`}>pausado pelo estoque</span>}
        {enviados99.has(p.id) && (
          <span className="block w-full min-w-0 text-left">
            <UltimoEnvioIfood alvo="produto" id={p.id} canal="99food" />
          </span>
        )}
      </span>
    );
  };

  return (
    <Shell eyebrow="Delivery" title="Gestão do catálogo">
      {conferirLigada && (
        <div role="tablist" aria-label="Gestão do catálogo" className="mb-4 flex flex-wrap gap-x-1 gap-y-2 border-b border-border">
          {(
            [
              ['produtos', 'Produtos e preços'],
              ['conferir', 'Conferir com os apps'],
            ] as const
          ).map(([k, rotulo]) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`aba-${k}`}
              aria-selected={aba === k}
              aria-controls={`painel-${k}`}
              onClick={() => {
                setAba(k);
                // Voltar a "Produtos e preços" relê a lista: o que a conferência mudou (preço, código, fotos lidas) aparece.
                if (k === 'produtos' && aba !== 'produtos') void carregar();
              }}
              className={`-mb-px min-h-10 border-b-2 px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                aba === k ? 'border-primary text-foreground' : `border-transparent ${texto2} hover:text-foreground`
              }`}
            >
              {rotulo}
            </button>
          ))}
        </div>
      )}
      {conferirLigada && aba === 'conferir' ? (
        <div role="tabpanel" id="painel-conferir" aria-labelledby="aba-conferir">
          <ConferirApps
            podeMudarPreco={podeMudarPreco}
            aoMudarRegem={() => void carregar()}
            produtos={produtos}
            categorias={categorias}
            comIfood={comIfood}
            com99={com99}
            aoNovaCategoria={(c) => setCategorias((l) => [...l, c])}
            aoCalcular={(id, canal) => void abrirCalculadora(id, canal)}
            aoAbrirTaxas={() => void abrirTaxas()}
            versao={versaoConf}
          />
        </div>
      ) : (
      <div role={conferirLigada ? 'tabpanel' : undefined} id="painel-produtos" aria-labelledby={conferirLigada ? 'aba-produtos' : undefined}>
      {/* Produtos | Complementos (protótipo: o seletor acima da lista; R3 F3a). */}
      <div role="group" aria-label="O que mostrar" className="mb-3 flex flex-wrap gap-2">
        {(
          [
            ['produtos', `Produtos · ${produtos.length}`],
            ['complementos', 'Complementos'],
          ] as const
        ).map(([k, rotulo]) => (
          <Button key={k} type="button" size="sm" variant={vista === k ? 'default' : 'outline'} aria-pressed={vista === k} onClick={() => setVista(k)}>
            {rotulo}
          </Button>
        ))}
      </div>
      {vista === 'complementos' ? (
        <ComplementosGestao comIfood={comIfood} com99={com99} podeMudarPreco={podeMudarPreco} />
      ) : (
      <section className="space-y-3" aria-labelledby={ID_TITULO}>
        <TituloLista
          id={ID_TITULO}
          titulo="Produtos e preços"
          total={produtos.length}
          mostrando={linhas.length}
          um="produto"
          varios="produtos"
          extra={`${nPausados} pausado${nPausados === 1 ? '' : 's'} em algum canal${
            comIfood && com99
              ? ' · o que você muda no iFood (pelo Orzuni) e na 99 vai na hora'
              : comIfood
                ? ' · o que você muda no iFood vai na hora pelo Orzuni'
                : com99
                  ? ' · o que você muda na 99 vai na hora'
                  : ''
          }`}
        >
          {podeMudarPreco && (comIfood || com99) && (
            <Button type="button" variant="outline" onClick={() => void abrirTaxas()}>
              ％ Taxas e margem
            </Button>
          )}
        </TituloLista>
        <p className={`text-sm ${texto2}`}>
          Criar produto, ficha técnica, estoque, fiscal e complementos: em{' '}
          <button
            type="button"
            className="font-semibold text-foreground underline decoration-primary decoration-2 underline-offset-2"
            onClick={() => router.push('/produtos')}
          >
            Cadastros › Cardápio
          </button>
          .
          {!comIfood && ' A coluna do iFood aparece quando o iFood pelo Orzuni está ligado na sua empresa (a ligação é feita pela distribuição Regem: fale com o suporte).'}
          {!com99 && ' A coluna da 99 aparece quando o preço e a pausa na 99 estão ligados na sua empresa (quem liga é a distribuição Regem: fale com o suporte).'}
        </p>

        {erro ? (
          <Card className="flex flex-wrap items-center justify-center gap-3 p-8 text-center text-sm">
            <span role="alert">{erro}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void carregar()}>Tentar de novo</Button>
          </Card>
        ) : (
          <>
            <Situacoes base={base} opcoes={situacoes} valor={sit} aoMudar={setSit} />
            <Filtros>
              <FiltroBusca id="catalogo-busca" valor={busca} aoMudar={setBusca} placeholder="Nome, código ou descrição" />
              <FiltroSelect
                id="catalogo-categoria"
                rotulo="Categoria"
                todos="Todas"
                opcoes={[...categorias.map((c) => ({ v: c.id, rotulo: c.nome })), ...(temSemCategoria ? [{ v: '-', rotulo: 'Sem categoria' }] : [])]}
                valor={cat}
                aoMudar={setCat}
              />
            </Filtros>
            {produtos.length === 0 ? (
              <Vazio>Nenhum produto ainda. Cadastre o primeiro em Cadastros › Cardápio.</Vazio>
            ) : linhas.length === 0 ? (
              <Vazio aoLimpar={limpar} />
            ) : (
              <ListaDados
                legenda={`Produtos por categoria, com o preço e a pausa ${ondeTexto}`}
                linhas={linhas}
                chave={(p) => p.id}
                nome={(p) => p.nome}
                grupoDe={(p) => grupoDoProduto.get(p.id) ?? ''}
                colunas={[
                  {
                    titulo: 'Produto',
                    celula: (p) => (
                      <span className="flex min-w-0 items-start gap-2.5">
                        {p.imagemRef ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imagemRef} alt="" className="h-11 w-11 flex-none rounded-md object-cover" loading="lazy" />
                        ) : (
                          <span className="grid h-11 w-11 flex-none place-items-center rounded-md bg-secondary" title="Sem foto">
                            <ImageOff className={`h-4 w-4 ${texto2}`} aria-hidden="true" />
                            <span className="sr-only">Sem foto</span>
                          </span>
                        )}
                        <span className="min-w-0">
                          <NomeComApoio
                            nome={p.nome}
                            apoio={`${(p.codigo ?? '').trim() ? `código ${p.codigo}` : 'sem código PDV'}${p.descricao ? ` · ${p.descricao}` : ''}`}
                          >
                            {esgotado(p) && <Selo tom="aviso">Esgotado pelo estoque</Selo>}
                          </NomeComApoio>
                        </span>
                      </span>
                    ),
                  },
                  { titulo: 'Regem', celula: colunaRegem },
                  ...(comIfood ? [{ titulo: 'iFood', celula: colunaIfood }] : []),
                  ...(com99 ? [{ titulo: '99', celula: coluna99 }] : []),
                ]}
                acoes={(p) => [
                  { rotulo: 'Editar', icone: Pencil, aoClicar: setEditando, tom: 'primaria' as const },
                  {
                    rotulo: tudoPausado(p) ? 'Reativar em todos' : 'Pausar em todos',
                    icone: tudoPausado(p) ? Play : Pause,
                    aoClicar: (r: any) => void pausarTudo(r),
                    ocupada: (r: any) => canaisDe(r).some((k) => ocupado.has(`${r.id}|${k}`)),
                  },
                ]}
              />
            )}
            {filtrando && linhas.length > 0 && (
              <p>
                <Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button>
              </p>
            )}
          </>
        )}
      </section>
      )}
      </div>
      )}

      {editando && (
        <EditarProduto
          produto={editando}
          categorias={categorias}
          outros={produtos}
          comIfood={comIfood}
          com99={com99}
          podeMudarPreco={podeMudarPreco}
          voltarPara={ID_TITULO}
          aoFechar={() => setEditando(null)}
          aoNovaCategoria={(c) => setCategorias((l) => [...l, c])}
          aoSalvar={(fechar, foiAoIfood, foiA99) => {
            if (foiAoIfood) marcarEnviado(editando.id);
            if (foiA99) marcarEnviado99(editando.id);
            if (fechar) setEditando(null);
            void carregar();
          }}
          fotosDosApps={fotosDoProduto(fotos, editando.id)}
          aoUsarFotoDoApp={async (canal) => {
            try {
              const r = await api.conferenciaUsarFoto(editando.id, canal);
              toast.success(r.frase);
              return r.url;
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Não foi possível trazer a foto do app.');
              return null;
            }
          }}
          aoMandarFotoIfood={async (imagem?: string) => {
            try {
              const r = await api.conferenciaFotoIfood(editando.id, imagem);
              toast.success(r.frase);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Não foi possível mandar a foto ao iFood.');
            }
          }}
          aoMandarFoto99={async () => {
            try {
              const r = await api.conferenciaFoto99(editando.id);
              toast.success(r.frase);
              marcarEnviado99(editando.id);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Não foi possível mandar a foto à 99.');
            }
          }}
        />
      )}
      {calc && taxas && (() => {
        const p = produtos.find((x) => x.id === calc.produtoId);
        if (!p) return null;
        return (
          <CalculadoraPreco
            item={itemDaCalculadora(p, calc.canal)}
            canal={calc.canal}
            dados={taxas}
            podeUsar={podeMudarPreco}
            aoFechar={() => setCalc(null)}
            aoAbrirTaxas={() => setAbrirTaxasGaveta(true)}
            aoUsar={async (valor) => {
              try {
                await salvarPreco(p, calc.canal, valor.toFixed(2));
                setCalc(null);
                setVersaoConf((v) => v + 1);
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Não foi possível salvar o preço.');
              }
            }}
          />
        );
      })()}
      {abrirTaxasGaveta && taxas && (
        <TaxasEMargem
          dados={taxas}
          canais={[...(comIfood ? (['ifood'] as const) : []), ...(com99 ? (['99food'] as const) : [])]}
          aoFechar={() => setAbrirTaxasGaveta(false)}
          aoSalvar={(r) => {
            setTaxas(r);
            setAbrirTaxasGaveta(false);
          }}
        />
      )}
    </Shell>
  );
}
