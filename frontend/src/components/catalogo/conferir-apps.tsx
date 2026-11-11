'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, EyeOff, Hash, HelpCircle, Link2, MinusCircle, Plus, RefreshCw, Send, Undo2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, Vazio, texto2, type Acao, type Situacao,
} from '@/components/ui/lista';
import { PrecoNoLugar } from '@/components/catalogo/preco-no-lugar';
import { UltimoEnvioIfood } from '@/components/produtos/ultimo-envio-ifood';
import { ConferenciaComoCorrigir } from '@/components/catalogo/conferencia-como-corrigir';
import { ConferenciaUsarPrecos } from '@/components/catalogo/conferencia-usar-precos';
import { ConferenciaLigar } from '@/components/catalogo/conferencia-ligar';
import { ConferenciaCorrigirCodigo } from '@/components/catalogo/conferencia-corrigir-codigo';
import { ConferenciaCriar } from '@/components/catalogo/conferencia-criar';
import { ConferenciaCriarOpcao } from '@/components/catalogo/conferencia-criar-opcao';
import type { CategoriaDaGestao } from '@/lib/catalogo-gestao';
import {
  APP, bateNaBusca, entraNoUsarEmMassa, pendente, precoNoApp, quandoLido, reais, seloDa, situacoesDa,
  type CanalConferido, type LinhaConferida, type ProdutoParaLigar, type RespostaDaConferencia, type TipoConferido,
} from '@/lib/conferencia-apps';

const ID_TITULO = 'conferir-titulo';
const CANAIS: CanalConferido[] = ['ifood', '99food'];
/** "Lendo" pela 1ª vez em outra tela: pergunta de novo a cada 3 s, no máximo 10 vezes. */
const ESPERA_LENDO_MS = 3_000;
const VOLTAS_LENDO = 10;
const contar = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// DELIVERY › GESTÃO DO CATÁLOGO › "CONFERIR COM OS APPS" (R3 F4a; mig 405; protótipo `mockups/regem-conciliacao-ifood.html`,
// aprovado em 11/11/2026): o cardápio do iFood (lido pelo Orzuni) ou da 99 desta loja × o Regem, pelo código PDV. Lê ao
// abrir (no máximo uma leitura automática por dia) e pelo "Ler agora". Na linha: usar o preço do app, mandar o do Regem,
// tirar o "Está no", ignorar e desfazer, "Como corrigir"; e (F4b) criar no Regem, ligar a um produto e corrigir o código.
// "Criar a opção no Regem" do complemento (F4c). A calculadora chega na F5.
export function ConferirApps({
  podeMudarPreco,
  aoMudarRegem,
  produtos,
  categorias,
  comIfood,
  com99,
  aoNovaCategoria,
}: {
  podeMudarPreco: boolean;
  aoMudarRegem: () => void;
  produtos: ProdutoParaLigar[];
  categorias: CategoriaDaGestao[];
  comIfood: boolean;
  com99: boolean;
  aoNovaCategoria: (c: CategoriaDaGestao) => void;
}) {
  const [canal, setCanal] = useState<CanalConferido>('ifood');
  const [escolheuCanal, setEscolheuCanal] = useState(false);
  const [vista, setVista] = useState<TipoConferido>('item');
  const [dados, setDados] = useState<RespostaDaConferencia | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<{ msg: string; loja: boolean } | null>(null);
  const [sit, setSit] = useState(-1);
  const [busca, setBusca] = useState('');
  const [grupo, setGrupo] = useState('');
  const [ocupado, setOcupado] = useState<Set<string>>(new Set());
  const [enviados, setEnviados] = useState<Set<string>>(new Set()); // "<canal>|<tipo>|<id>" mandados ao app nesta visita
  const [corrigir, setCorrigir] = useState<LinhaConferida | null>(null);
  const [emMassa, setEmMassa] = useState(false);
  const [criar, setCriar] = useState<LinhaConferida | null>(null);
  const [criarOpcao, setCriarOpcao] = useState<LinhaConferida | null>(null);
  const [ligarA, setLigarA] = useState<LinhaConferida | null>(null);
  const [corrigirCodigo, setCorrigirCodigo] = useState<LinhaConferida | null>(null);
  const pedido = useRef(0);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voltas = useRef(0);

  const carregar = useCallback(
    async (c: CanalConferido, ler: boolean) => {
      const meu = ++pedido.current; // só a resposta mais nova vale (V64)
      if (espera.current) clearTimeout(espera.current);
      setLendo(true);
      setErro(null);
      try {
        const r = await api.conferencia(c, ler);
        if (meu !== pedido.current) return;
        // Sem a escolha da pessoa: o app desligado nesta loja cede ao outro, se ele está ligado.
        const outro = c === 'ifood' ? '99food' : 'ifood';
        if (!escolheuCanal && !ler && r.estado === 'semLigacao' && r.canais[outro]?.ligado) {
          setCanal(outro);
          void carregar(outro, false);
          return;
        }
        setDados(r);
        if (r.estado === 'lendo' && voltas.current < VOLTAS_LENDO) {
          voltas.current++;
          espera.current = setTimeout(() => void carregar(c, false), ESPERA_LENDO_MS);
        } else voltas.current = 0;
      } catch (e) {
        if (meu !== pedido.current) return;
        const loja = e instanceof ApiError && e.code === 'ESCOLHA_A_LOJA';
        setErro({ msg: e instanceof Error ? e.message : 'Não foi possível abrir a conferência.', loja });
      } finally {
        if (meu === pedido.current) setLendo(false);
      }
    },
    [escolheuCanal],
  );

  useEffect(() => {
    void carregar(canal, false);
    return () => {
      if (espera.current) clearTimeout(espera.current);
    };
    // Só ao abrir; a troca de app chama `carregar` direto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const a = APP[canal];
  const trocarCanal = (c: CanalConferido) => {
    if (c === canal) return;
    setEscolheuCanal(true);
    setCanal(c);
    setSit(-1);
    setGrupo('');
    setBusca('');
    setDados(null);
    void carregar(c, false);
  };
  const lerAgora = () => void carregar(canal, true);
  const marcar = (k: string, sim: boolean) =>
    setOcupado((s) => {
      const n = new Set(s);
      if (sim) n.add(k);
      else n.delete(k);
      return n;
    });

  async function agir(l: LinhaConferida, chave: string, fazer: () => Promise<string | null>, mudaRegem = false) {
    marcar(chave, true);
    try {
      const msg = await fazer();
      if (msg) toast.success(msg);
      if (mudaRegem) aoMudarRegem();
      await carregar(canal, false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Não deu para fazer isso com "${l.nome}".`);
    } finally {
      marcar(chave, false);
    }
  }
  const ignorar = (l: LinhaConferida) =>
    agir(l, `${l.chave}|ignorar`, async () => {
      await api.conferenciaIgnorar({ canal, tipo: l.tipo, chave: l.chave, nome: l.nome });
      return `"${l.nome}" ignorado ${a.no} nesta loja.`;
    });
  const desfazer = (l: LinhaConferida) =>
    agir(l, `${l.chave}|desfazer`, async () => {
      await api.conferenciaDesfazer({ canal, tipo: l.tipo, chave: l.chave });
      return `"${l.nome}" volta às contagens.`;
    });
  const usarDoApp = (l: LinhaConferida) =>
    agir(
      l,
      `${l.chave}|usar`,
      async () => {
        const r = await api.conferenciaUsarPreco({ canal, tipo: l.tipo, chaves: [l.chave] });
        if (r.recusas.length) throw new Error(r.recusas[0].motivo);
        return `Preço ${a.do} no Regem: ${precoNoApp(l)} (era ${reais(l.regem?.preco)}).`;
      },
      true,
    );
  const mandarAoApp = (l: LinhaConferida) =>
    agir(l, `${l.chave}|mandar`, async () => {
      const r = await api.conferenciaMandarPreco({ canal, tipo: l.tipo, chave: l.chave });
      if (l.regem) setEnviados((s) => new Set(s).add(`${canal}|${l.tipo}|${l.regem!.id}`));
      return r.frase;
    });
  const tirarDoApp = (l: LinhaConferida) =>
    agir(
      l,
      `${l.chave}|tirar`,
      async () => {
        await api.conferenciaTirarDoApp({ canal, chave: l.chave });
        return `"${l.nome}" não está mais marcado "${a.marca}".`;
      },
      true,
    );
  // O lápis no preço do app (itens que ligam): muda o preço daquele app no Regem, e a fila manda ao app.
  async function salvarPrecoDoApp(l: LinhaConferida, valor: string | null) {
    if (!l.regem) return;
    try {
      const r = await api.precoDoCanal(l.regem.id, canal, valor);
      setEnviados((s) => new Set(s).add(`${canal}|item|${l.regem!.id}`));
      toast.success(r.mudou ? `Preço ${a.do} de "${l.regem.nome}": ${valor ? reais(Number(valor)) : 'em branco'} — vai ${a.ao} agora.` : 'O preço já era esse.');
      aoMudarRegem();
      await carregar(canal, false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar o preço.');
      throw e;
    }
  }
  // "Ligar a um produto" (do item "só no app") e "Corrigir o código" (do produto "só no Regem"): a mesma ligação.
  async function ligar(alvo: LinhaConferida, produtoId: string) {
    try {
      const r = await api.conferenciaLigar({ canal, chave: alvo.chave, produtoId });
      toast.success(r.frase);
      setLigarA(null);
      setCorrigirCodigo(null);
      aoMudarRegem();
      await carregar(canal, false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível ligar o produto.');
    }
  }
  async function usarEmMassa(linhas: LinhaConferida[]) {
    try {
      const r = await api.conferenciaUsarPreco({ canal, tipo: 'item', chaves: linhas.map((l) => l.chave) });
      if (r.feitos) toast.success(`${r.feitos} preço${r.feitos === 1 ? '' : 's'} ${a.do} ${r.feitos === 1 ? 'passou' : 'passaram'} para o Regem.`);
      if (r.recusas.length) toast.error(`${r.recusas.length} ficou de fora: ${r.recusas[0].motivo}`, 9000);
      setEmMassa(false);
      aoMudarRegem();
      await carregar(canal, false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível usar os preços.');
    }
  }

  // ── estados da tela ───────────────────────────────────────────────────────────────────────────────────────
  if (erro && !dados)
    return (
      <Card className="space-y-3 p-6 text-sm" role="alert">
        <h2 className="font-display text-lg font-bold">{erro.loja ? 'Escolha a loja' : 'Não deu para abrir a conferência'}</h2>
        <p className={texto2}>{erro.loja ? 'A conferência com os apps é por loja: escolha a loja no topo da tela.' : erro.msg}</p>
        {!erro.loja && (
          <Button type="button" onClick={() => void carregar(canal, false)}>
            Tentar de novo
          </Button>
        )}
      </Card>
    );
  if (!dados) return <SkeletonList rows={6} />;

  const ligados = CANAIS.filter((c) => dados.canais[c]?.ligado || c === canal);
  const botoesDosApps = (
    <div role="group" aria-label="Qual app conferir" className="flex flex-wrap gap-2">
      {ligados.map((c) => {
        const p = dados.canais[c]?.pendentes;
        const dica = !dados.canais[c]?.ligado ? 'sem ligação' : p == null ? 'não lido' : p === 0 ? 'tudo certo' : `${p} a resolver`;
        return (
          <Button key={c} type="button" size="sm" variant={c === canal ? 'default' : 'outline'} aria-pressed={c === canal} onClick={() => trocarCanal(c)}>
            {APP[c].nome} <span className="ml-1 text-xs font-normal opacity-80">{dica}</span>
          </Button>
        );
      })}
    </div>
  );

  const estadoDaTela = (titulo: string, texto: string, tentar: boolean) => (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      {botoesDosApps}
      <Card className="space-y-3 p-6 text-sm" role={tentar ? 'alert' : undefined}>
        <h2 id={ID_TITULO} className="font-display text-lg font-bold">
          {titulo}
        </h2>
        <p className={texto2}>{texto}</p>
        {tentar && (
          <Button type="button" onClick={lerAgora} disabled={lendo}>
            {lendo ? 'Lendo…' : 'Tentar de novo'}
          </Button>
        )}
      </Card>
    </section>
  );
  if (dados.estado === 'semConexao') return estadoDaTela('Sem conexão com a nuvem', dados.motivo ?? '', true);
  if (dados.estado === 'semLigacao')
    return estadoDaTela(canal === 'ifood' ? 'Esta loja não está ligada ao iFood pelo Orzuni' : 'Esta loja não está conectada à 99', dados.motivo ?? '', false);
  if (dados.estado === 'semLeitura')
    return estadoDaTela(canal === 'ifood' ? 'O Orzuni não respondeu agora' : 'A 99 não respondeu agora', `${dados.motivo ?? ''} Nada foi mudado.`, true);
  if (dados.estado === 'lendo')
    return (
      <section className="space-y-3" aria-labelledby={ID_TITULO} aria-busy="true">
        {botoesDosApps}
        <h2 id={ID_TITULO} className="font-display text-xl font-bold">
          Cardápio {a.do} × Regem
        </h2>
        <p className={`text-sm ${texto2}`} role="status">
          Lendo o cardápio {a.do} {a.pelo}…
        </p>
        <SkeletonList rows={6} />
      </section>
    );

  // ── a lista ────────────────────────────────────────────────────────────────────────────────────────────────
  const todas = vista === 'item' ? dados.itens : dados.opcoes;
  const pendItens = dados.itens.filter(pendente).length;
  const pendOpcoes = dados.opcoes.filter(pendente).length;
  const grupos = [...new Set(todas.flatMap((l) => l.grupos))].sort((x, y) => x.localeCompare(y, 'pt-BR'));
  const base = todas.filter((l) => bateNaBusca(l, busca) && (!grupo || l.grupos.includes(grupo)));
  const opcoesDeSit = situacoesDa(canal, vista);
  const situacoes: Situacao<LinhaConferida>[] = opcoesDeSit.map((s) => ({ rotulo: s.rotulo, filtro: (l) => l.situacao === s.k, tom: s.tom }));
  const linhas = sit < 0 || !situacoes[sit] ? base : base.filter(situacoes[sit].filtro);
  const paraUsar = dados.itens.filter(entraNoUsarEmMassa);
  const filtrando = !!(busca.trim() || grupo || sit >= 0);
  const limpar = () => {
    setBusca('');
    setGrupo('');
    setSit(-1);
  };
  const enviadoAgora = (l: LinhaConferida) => !!l.regem && enviados.has(`${canal}|${l.tipo}|${l.regem.id}`);

  const acoes = (l: LinhaConferida): Acao<LinhaConferida>[] => {
    const ocupada = () => [...ocupado].some((k) => k.startsWith(`${l.chave}|`));
    const ignorarA: Acao<LinhaConferida> = { rotulo: 'Ignorar', icone: EyeOff, aoClicar: () => void ignorar(l), ocupada };
    switch (l.situacao) {
      case 'soApp':
        // Item: criar no Regem ou ligar a um produto que já existe (F4b). Opção: criar a opção no Regem (F4c).
        if (l.tipo === 'item' && l.pdv)
          return [
            { rotulo: 'Criar no Regem', icone: Plus, tom: 'primaria', aoClicar: () => setCriar(l), ocupada },
            ...(podeMudarPreco ? [{ rotulo: 'Ligar a um produto', icone: Link2, aoClicar: () => setLigarA(l), ocupada }] : []),
            ignorarA,
          ];
        if (l.tipo === 'opcao' && l.pdv)
          return [{ rotulo: 'Criar a opção no Regem', icone: Plus, tom: 'primaria', aoClicar: () => setCriarOpcao(l), ocupada }, ignorarA];
        return [{ rotulo: 'Como resolver', icone: HelpCircle, tom: 'primaria', aoClicar: () => setCorrigir(l), ocupada }, ignorarA];
      case 'soRegem':
        return [
          { rotulo: `Tirar "${a.marca}"`, icone: MinusCircle, tom: 'primaria', aoClicar: () => void tirarDoApp(l), ocupada },
          ...(podeMudarPreco
            ? [{ rotulo: 'Corrigir o código', icone: Hash, aoClicar: () => setCorrigirCodigo(l), ocupada }]
            : [{ rotulo: 'Como resolver', icone: HelpCircle, aoClicar: () => setCorrigir(l), ocupada }]),
          ignorarA,
        ];
      case 'preco': {
        const lista: Acao<LinhaConferida>[] = [];
        if (podeMudarPreco && l.precos.length === 1)
          lista.push({
            rotulo: l.motivo === 'semPrecoNoRegem' ? `Guardar ${precoNoApp(l)} no Regem` : `Usar ${precoNoApp(l)} (${a.nome})`,
            icone: Check,
            tom: 'primaria',
            aoClicar: () => void usarDoApp(l),
            ocupada,
          });
        if (podeMudarPreco && l.regem?.preco != null)
          lista.push({ rotulo: `Mandar ${reais(l.regem.preco)} ${a.ao}`, icone: Send, tom: lista.length ? undefined : 'primaria', aoClicar: () => void mandarAoApp(l), ocupada });
        return [...lista, ignorarA];
      }
      case 'naoLiga':
        return [{ rotulo: 'Como corrigir', icone: HelpCircle, tom: 'primaria', aoClicar: () => setCorrigir(l), ocupada }, ignorarA];
      case 'ignorada':
        return [{ rotulo: 'Desfazer', icone: Undo2, aoClicar: () => void desfazer(l), ocupada }];
      default:
        return [];
    }
  };

  const colunaDoApp = (l: LinhaConferida) => {
    if (l.situacao === 'soRegem') return <span className={`text-xs ${texto2}`}>não está</span>;
    const preco =
      vista === 'item' && l.regem && podeMudarPreco && l.precos.length === 1 && l.situacao !== 'ignorada' ? (
        <PrecoNoLugar valor={l.precos[0]} qual={a.no} nome={l.regem.nome} podeEditar aoSalvar={(v) => salvarPrecoDoApp(l, v)} />
      ) : (
        <span className="font-mono">{precoNoApp(l)}</span>
      );
    return (
      <span className="inline-flex max-w-full flex-wrap items-center justify-end gap-1.5 xl:justify-start">
        {preco}
        {l.promoDe != null && <span className={`text-xs ${texto2}`}>de {reais(l.promoDe)}</span>}
        {l.pausado && <Selo tom="aviso">pausado {a.no}</Selo>}
        {enviadoAgora(l) && (
          <span className="block w-full min-w-0 text-left">
            <UltimoEnvioIfood alvo={l.tipo === 'item' ? 'produto' : 'opcao'} id={l.regem!.id} canal={canal} />
          </span>
        )}
      </span>
    );
  };

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      {botoesDosApps}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id={ID_TITULO} tabIndex={-1} className="font-display text-xl font-bold outline-none">
            Cardápio {a.do} × Regem
          </h2>
          <p className={`text-sm ${texto2}`} role="status" aria-live="polite">
            Lido {a.do} {quandoLido(dados.lidoEm)}, {a.pelo}
            {dados.loja ? ` · loja ${dados.loja.nome}` : ''} · {contar(dados.itens.filter((l) => l.situacao !== 'soRegem').length, 'item', 'itens')} e{' '}
            {contar(dados.opcoes.length, 'opção', 'opções')} {a.no}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {vista === 'item' && podeMudarPreco && paraUsar.length > 0 && (
            <Button type="button" variant="outline" onClick={() => setEmMassa(true)}>
              Usar os preços {a.do} ({paraUsar.length})
            </Button>
          )}
          <Button type="button" onClick={lerAgora} disabled={lendo}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${lendo ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />
            {lendo ? 'Lendo…' : `Ler ${a.o} agora`}
          </Button>
        </div>
      </div>

      {dados.erro && (
        <p role="alert" className="rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-sm">
          <b>A última leitura não deu certo:</b> {dados.erro} Esta lista é a leitura de {quandoLido(dados.lidoEm)}.
        </p>
      )}
      {dados.lendoAgora && (
        <p role="status" className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm">
          Outra tela está lendo {a.o} agora: esta lista é a leitura anterior. Toque em &quot;Ler {a.o} agora&quot; em instantes.
        </p>
      )}

      <div role="group" aria-label="O que conferir" className="flex flex-wrap gap-2">
        {(
          [
            ['item', `Itens · ${pendItens} a resolver`],
            ['opcao', `Opções · ${pendOpcoes} a resolver`],
          ] as const
        ).map(([k, rotulo]) => (
          <Button
            key={k}
            type="button"
            size="sm"
            variant={vista === k ? 'default' : 'outline'}
            aria-pressed={vista === k}
            onClick={() => {
              setVista(k);
              setSit(-1);
              setGrupo('');
            }}
          >
            {rotulo}
          </Button>
        ))}
      </div>

      <Situacoes base={base} opcoes={situacoes} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="conferir-busca" valor={busca} aoMudar={setBusca} placeholder="Ex.: bacon, 2051" />
        <FiltroSelect
          id="conferir-grupo"
          rotulo={vista === 'item' ? `Categoria ${a.no}` : 'Grupo de complementos'}
          todos="Todas"
          opcoes={grupos}
          valor={grupo}
          aoMudar={setGrupo}
        />
      </Filtros>

      {todas.length > 0 && todas.every((l) => !pendente(l)) && (
        <p role="status" className="rounded-md border border-ok/40 bg-ok/10 px-3 py-2 text-sm">
          <b>Tudo certo: {a.o} e o Regem batem.</b> Todos os {vista === 'item' ? 'itens' : 'complementos'} com código têm o mesmo preço nos dois lados. A
          próxima leitura automática é amanhã; o botão lê na hora.
        </p>
      )}

      {linhas.length === 0 ? (
        filtrando ? (
          <Vazio aoLimpar={limpar} />
        ) : (
          <Vazio>{vista === 'item' ? `Nenhum item ${a.no} nem marcado "${a.marca}".` : `Nenhum complemento ${a.no}.`}</Vazio>
        )
      ) : (
        <ListaDados
          legenda={vista === 'item' ? `Itens ${a.do} e produtos do Regem, com a situação e o que fazer` : `Opções dos complementos ${a.do} e do Regem, com a situação e o que fazer`}
          linhas={linhas}
          chave={(l) => l.chave}
          nome={(l) => l.nome}
          colunas={[
            {
              titulo: vista === 'item' ? 'Item' : 'Opção',
              celula: (l) => (
                <NomeComApoio
                  nome={l.nome}
                  apoio={[
                    l.situacao === 'soRegem' ? 'no Regem' : l.grupos.join(' · '),
                    l.regem && l.regem.nome !== l.nome ? `no Regem: ${l.regem.nome}` : '',
                    l.regem && !l.regem.ativo ? 'inativo no Regem' : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                />
              ),
            },
            {
              titulo: 'Código PDV',
              celula: (l) =>
                l.pdv ? (
                  <span className="break-all font-mono">{l.ligaPeloId ? 'id do produto' : l.pdv}</span>
                ) : (
                  <span className={`text-xs ${texto2}`}>sem código</span>
                ),
            },
            { titulo: a.nome === '99' ? 'Na 99' : 'No iFood', celula: colunaDoApp },
            {
              titulo: `No Regem (preço ${a.do})`,
              celula: (l) =>
                l.regem ? (
                  l.regem.preco == null ? (
                    <span className={`text-xs ${texto2}`}>em branco</span>
                  ) : (
                    <span className="font-mono">{reais(l.regem.preco)}</span>
                  )
                ) : (
                  <span className={`text-xs ${texto2}`}>não tem</span>
                ),
            },
            {
              titulo: 'Situação',
              celula: (l) => {
                const s = seloDa(l, canal);
                return (
                  <span className="block min-w-0 text-left">
                    <Selo tom={s.tom}>{s.rotulo}</Selo>
                    <span className={`mt-0.5 block text-xs ${texto2}`}>{s.frase}</span>
                  </span>
                );
              },
            },
          ]}
          acoes={acoes}
        />
      )}

      {corrigir && (
        <ConferenciaComoCorrigir
          linha={corrigir}
          canal={canal}
          aoFechar={() => setCorrigir(null)}
          aoLerDeNovo={() => {
            setCorrigir(null);
            lerAgora();
          }}
        />
      )}
      {emMassa && <ConferenciaUsarPrecos canal={canal} linhas={paraUsar} aoFechar={() => setEmMassa(false)} aoConfirmar={() => usarEmMassa(paraUsar)} />}
      {criar && (
        <ConferenciaCriar
          linha={criar}
          canal={canal}
          categorias={categorias}
          produtos={produtos}
          comIfood={comIfood}
          com99={com99}
          aoNovaCategoria={aoNovaCategoria}
          aoFechar={() => setCriar(null)}
          aoCriar={() => {
            setCriar(null);
            aoMudarRegem();
            void carregar(canal, false);
          }}
        />
      )}
      {criarOpcao && (
        <ConferenciaCriarOpcao
          linha={criarOpcao}
          canal={canal}
          produtos={produtos}
          comIfood={comIfood}
          aoFechar={() => setCriarOpcao(null)}
          aoCriar={() => {
            setCriarOpcao(null);
            void carregar(canal, false);
          }}
        />
      )}
      {ligarA && <ConferenciaLigar linha={ligarA} canal={canal} produtos={produtos} aoFechar={() => setLigarA(null)} aoLigar={(id) => ligar(ligarA, id)} />}
      {corrigirCodigo && corrigirCodigo.regem && (
        <ConferenciaCorrigirCodigo
          linha={corrigirCodigo}
          canal={canal}
          itens={dados.itens}
          aoFechar={() => setCorrigirCodigo(null)}
          aoSalvar={(alvo) => ligar(alvo, corrigirCodigo.regem!.id)}
        />
      )}
    </section>
  );
}
