'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, KeyRound, Plus, Printer, Settings2 } from 'lucide-react';
import { api, getCategoria, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Partes } from '@/components/ui/partes';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo } from '@/components/ui/sobreposto';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, distintos, semAcento, texto2, type Acao, type Situacao,
} from '@/components/ui/lista';
import { CodigoDePareamento, RevogarEquipamento, TokenDoEquipamento } from '@/components/equipamentos/equipamento-dialogos';
import { EquipamentoForm } from '@/components/equipamentos/equipamento-form';
import { FilaDeImpressao } from '@/components/equipamentos/fila-impressao';
import { HistoricoEquipamentos } from '@/components/equipamentos/historico-equipamentos';
import { SITUACAO, ehGogem, ligacaoDe, situacaoDe, tipoDe, vistoDe } from '@/components/equipamentos/equipamento';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Parte = 'equipamentos' | 'fila' | 'historico';
const ID_TITULO = 'equipamentos-titulo';
const motivo = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);

// Configurações → Equipamentos & apps (mockup `mockups/regem-configuracoes.html`). Três partes:
//  • Equipamentos — a lista (terminais, KDS, impressoras, servidor), com "Novo equipamento" e
//    "Configurar" na gaveta, o token e o código de pareamento em diálogos, e revogar com aviso.
//  • Fila de impressão — o que espera, o que falhou (reimprimir) e as impressas recentes.
//  • Histórico — quem mexeu no cadastro (auditoria).
export default function EquipamentosPage() {
  const router = useRouter();
  const [parte, setParte] = useState<Parte>('equipamentos');
  const [pode, setPode] = useState(false);
  const [lista, setLista] = useState<any[] | null>(null);
  const [erroLista, setErroLista] = useState('');
  const [unidades, setUnidades] = useState<any[]>([]);
  const [setores, setSetores] = useState<any[]>([]);
  // Estado de cada impressora (última impressão / sem responder); `null` = não deu para ler.
  const [estado, setEstado] = useState<Record<string, any> | null>(null);
  const [avisosRota, setAvisosRota] = useState<any[]>([]);
  const [peloServidorLocal, setPeloServidorLocal] = useState(false);
  const [fila, setFila] = useState<any[] | null>(null);
  const [erroFila, setErroFila] = useState('');

  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroUnidade, setFiltroUnidade] = useState('');
  const [filtroSetor, setFiltroSetor] = useState('');
  const [form, setForm] = useState<{ item: any | null } | null>(null);
  const [tokenNovo, setTokenNovo] = useState<{ nome: string; token: string; aviso: string } | null>(null);
  const [codigoDe, setCodigoDe] = useState<any | null>(null);
  const [revogando, setRevogando] = useState<any | null>(null);
  const [verAvisos, setVerAvisos] = useState(false);
  const [testando, setTestando] = useState<string | null>(null);
  const [publicando, setPublicando] = useState(false);

  const lerFila = useCallback(async () => {
    setErroFila('');
    try {
      setFila(((await api.impressaoFila()) as any[]) ?? []);
    } catch (e) {
      setErroFila(motivo(e, 'Não foi possível carregar a fila de impressão.'));
    }
  }, []);
  const lerEstado = useCallback(() => {
    api.impressorasEstado().then((r: any) => setEstado(Object.fromEntries(((r as any[]) ?? []).map((x) => [x.id, x])))).catch(() => setEstado(null));
  }, []);
  const reload = useCallback(async () => {
    setErroLista('');
    try {
      setLista(((await api.equipamentos()) as any[]) ?? []);
    } catch (e) {
      setErroLista(motivo(e, 'Erro ao carregar'));
      return;
    }
    // Apoio da tela: nomes das unidades e dos setores, estado das impressoras e avisos. Nenhum derruba a lista.
    api.unidades().then((u) => setUnidades((u as any[]) ?? [])).catch(() => setUnidades([]));
    api.setores().then((s) => setSetores((s as any[]) ?? [])).catch(() => setSetores([]));
    api.edgeAtivo().then((r: any) => setPeloServidorLocal(!!r?.ativo)).catch(() => {});
    api.avisosRoteamento().then((r: any) => setAvisosRota((r as any[]) ?? [])).catch(() => setAvisosRota([]));
    lerEstado();
    void lerFila();
  }, [lerEstado, lerFila]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    // O servidor só aceita presidente e gerente no cadastro de equipamentos (o suporte entra como eles).
    setPode(['presidente', 'gerente', 'suporte'].includes(getCategoria() ?? ''));
    void reload();
  }, [reload, router]);

  async function imprimirTeste(e: any) {
    if (testando) return;
    setTestando(e.id);
    try {
      const r: any = await api.impressoraTeste(e.id);
      // Com servidor local ativo, quem imprime é ele — e a resposta diz isso.
      toast.success(r?.edge ? r.aviso || 'Impressão gerenciada pelo servidor local.' : 'Página de teste enviada. Se o servidor local estiver ativo, sai em segundos.');
      lerEstado();
      void lerFila();
    } catch (err) {
      toast.error(motivo(err, 'Erro ao enviar teste'));
    } finally {
      setTestando(null);
    }
  }
  async function publicarGogem() {
    setPublicando(true);
    try {
      const r: any = await api.post('/integracoes/gogem/publicar', {});
      toast.success(r?.alterados != null ? `Publicado no GoGeM: ${r.alterados} produto(s) sincronizado(s).` : 'Publicado no GoGeM.');
    } catch (err) {
      toast.error(motivo(err, 'Erro ao publicar no GoGeM'));
    } finally {
      setPublicando(false);
    }
  }

  if (erroLista)
    return (
      <Shell eyebrow="Configurações" title="Equipamentos & apps">
        <Card className="space-y-3 p-5 text-sm">
          <p role="alert">{erroLista}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>Tentar de novo</Button>
        </Card>
      </Shell>
    );
  if (!lista)
    return (
      <Shell eyebrow="Configurações" title="Equipamentos & apps">
        <SkeletonList rows={6} />
      </Shell>
    );

  const est = estado ?? {};
  const unidadeDe = (e: any) => (e.unidadeId ? unidades.find((u) => u.id === e.unidadeId)?.nome ?? 'Unidade fora da lista' : 'Sem unidade');
  const setorDe = (e: any) => (e.setorId ? setores.find((s) => s.id === e.setorId)?.nome ?? 'Setor fora da lista' : '');
  const SITUACOES: Situacao<any>[] = [
    { rotulo: 'Ativos', filtro: (e) => situacaoDe(e, est) === 'ativo' },
    { rotulo: 'Nunca conectaram', filtro: (e) => situacaoDe(e, est) === 'nunca', tom: 'aviso' },
    { rotulo: 'Sem responder', filtro: (e) => situacaoDe(e, est) === 'mudo', tom: 'critico' },
    { rotulo: 'Revogados', filtro: (e) => situacaoDe(e, est) === 'revogado' },
  ];
  const b = semAcento(busca);
  const base = lista.filter(
    (e) =>
      (!b || semAcento(e.nome).includes(b)) &&
      (!filtroTipo || tipoDe(e) === filtroTipo) &&
      (!filtroUnidade || unidadeDe(e) === filtroUnidade) &&
      (!filtroSetor || setorDe(e) === filtroSetor),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || filtroTipo || filtroUnidade || filtroSetor || sit >= 0);
  const limpar = () => { setBusca(''); setFiltroTipo(''); setFiltroUnidade(''); setFiltroSetor(''); setSit(-1); };
  const mudos = lista.filter((e) => situacaoDe(e, est) === 'mudo').length;
  // Com servidor local, impressora e KDS são configurados nele: a nuvem recusa, então nem oferece.
  const configuravel = (e: any) => !(peloServidorLocal && (e.tipo === 'impressora' || e.tipo === 'kds'));
  const acoesDe = (e: any): Acao<any>[] =>
    !pode || !e.ativo
      ? []
      : [
          ...(e.tipo === 'impressora' ? [{ rotulo: 'Imprimir teste', icone: Printer, aoClicar: (x: any) => void imprimirTeste(x), ocupada: (x: any) => testando === x.id }] : []),
          ...(['pdv', 'salao'].includes(e.tipo) && !ehGogem(e) ? [{ rotulo: 'Gerar código', icone: KeyRound, aoClicar: setCodigoDe }] : []),
          ...(configuravel(e) ? [{ rotulo: 'Configurar', icone: Settings2, aoClicar: (x: any) => setForm({ item: x }) }] : []),
          ...(e.padrao ? [] : [{ rotulo: 'Revogar', icone: Ban, aoClicar: setRevogando, tom: 'perigo' as const }]),
        ];

  return (
    <Shell eyebrow="Configurações" title="Equipamentos & apps">
      <div className="space-y-4">
        <Partes<Parte>
          rotulo="Partes de Equipamentos"
          ativa={parte}
          aoEscolher={setParte}
          partes={[
            { key: 'equipamentos', label: 'Equipamentos', conta: lista.length },
            { key: 'fila', label: 'Fila de impressão', conta: fila?.length ?? null },
            { key: 'historico', label: 'Histórico' },
          ]}
        />

        {parte === 'equipamentos' && (
          <section className="space-y-3" aria-labelledby={ID_TITULO}>
            <TituloLista id={ID_TITULO} titulo="Equipamentos" total={lista.length} mostrando={linhas.length} um="equipamento" varios="equipamentos"
              extra={mudos ? `${mudos} ${mudos === 1 ? 'impressora sem responder' : 'impressoras sem responder'}` : estado ? 'nenhuma impressora sem responder' : undefined}>
              {pode && <Button type="button" onClick={() => setForm({ item: null })}><Plus className="h-4 w-4" aria-hidden="true" /> Novo equipamento</Button>}
            </TituloLista>
            <p className={`max-w-3xl text-sm ${texto2}`}>
              Registre os apps satélites (KDS e Terminal de Ponto) que se conectam ao Regem. Cada aparelho recebe um token único usado no pareamento.
            </p>
            {peloServidorLocal && (
              <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm" role="status">
                Esta loja tem <strong>servidor local (edge) ativo</strong> — a configuração de impressão é gerenciada por ele. Aqui na nuvem ela fica{' '}
                <strong>somente leitura</strong>; edite as impressoras e os KDS, e teste, no servidor local da loja.
              </p>
            )}
            {avisosRota.length > 0 && (
              <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm">
                <span>
                  <strong>{avisosRota.length} {avisosRota.length === 1 ? 'produto com setor' : 'produtos com setor'} que não existe na loja</strong> — a via de produção{' '}
                  {avisosRota.length === 1 ? 'dele' : 'deles'} sai na impressora padrão da loja.
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => setVerAvisos(true)}>Ver produtos</Button>
              </div>
            )}
            <p className="rounded-md border-l-4 border-input bg-secondary px-3 py-2 text-sm">
              <strong>Trocou o servidor local de máquina?</strong> Reinstale/repareie os equipamentos (impressoras, KDS e Terminais de Ponto){' '}
              <strong>um a um</strong> no novo servidor. Cada aparelho gera um token/pareamento novo — não reaproveite os antigos, para evitar conflito.
            </p>
            {pode && (
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <h3 className="font-display text-base font-bold">Integração GoGeM (autoatendimento)</h3>
                  <p className={`mt-1 text-sm ${texto2}`}>Pausou ou editou um produto? Publique para o GoGeM refletir na hora (preço, nome e disponibilidade dos itens linkados).</p>
                </div>
                <Button type="button" variant="outline" onClick={() => void publicarGogem()} disabled={publicando}>{publicando ? 'Publicando…' : 'Publicar no GoGeM'}</Button>
              </Card>
            )}

            <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
            <Filtros>
              <FiltroBusca id="equipamentos-busca" valor={busca} aoMudar={setBusca} placeholder="Nome do equipamento" />
              <FiltroSelect id="equipamentos-tipo" rotulo="Tipo" todos="Todos os tipos" opcoes={distintos(lista, tipoDe)} valor={filtroTipo} aoMudar={setFiltroTipo} />
              <FiltroSelect id="equipamentos-unidade" rotulo="Unidade" todos="Todas as unidades" opcoes={distintos(lista, unidadeDe)} valor={filtroUnidade} aoMudar={setFiltroUnidade} />
              <FiltroSelect id="equipamentos-setor" rotulo="Setor" todos="Todos os setores" opcoes={distintos(lista, setorDe)} valor={filtroSetor} aoMudar={setFiltroSetor} />
            </Filtros>

            {lista.length === 0 ? (
              <Vazio>Nenhum equipamento cadastrado ainda.</Vazio>
            ) : linhas.length === 0 ? (
              <Vazio aoLimpar={limpar} />
            ) : (
              <ListaDados
                legenda="Equipamentos"
                linhas={linhas}
                chave={(e) => e.id}
                nome={(e) => e.nome}
                colunas={[
                  {
                    titulo: 'Equipamento',
                    celula: (e) => (
                      <NomeComApoio nome={e.nome} apoio={[unidadeDe(e), setorDe(e)].filter(Boolean).join(' · ')}>
                        {ehGogem(e) && <Selo tom="info">Integração GoGeM</Selo>}
                        {e.padrao && <Selo>{e.tipo === 'terminal_ponto' ? 'REP-Software' : 'padrão'}</Selo>}
                      </NomeComApoio>
                    ),
                  },
                  { titulo: 'Tipo', celula: tipoDe },
                  { titulo: 'Ligação', celula: (e) => <span className="break-words">{ligacaoDe(e, lista)}</span> },
                  { titulo: 'Último acesso', celula: (e) => <span className="font-mono text-xs">{vistoDe(e, est)}</span> },
                  { titulo: 'Situação', celula: (e) => { const s = SITUACAO[situacaoDe(e, est)]; return <Selo tom={s.tom}>{s.rotulo}</Selo>; } },
                ]}
                acoes={acoesDe}
              />
            )}
            {filtrando && linhas.length > 0 && (
              <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
            )}
          </section>
        )}

        {parte === 'fila' && (
          <FilaDeImpressao fila={fila} erro={erroFila} impressoras={lista.filter((e) => e.tipo === 'impressora')} podeReimprimir recarregar={lerFila} />
        )}
        {parte === 'historico' && <HistoricoEquipamentos />}
      </div>

      {form && (
        <EquipamentoForm
          item={form.item}
          todos={lista}
          unidades={unidades}
          setores={setores}
          peloServidorLocal={peloServidorLocal}
          voltarPara={ID_TITULO}
          aoFechar={() => setForm(null)}
          aoCadastrar={(novo, aviso) => { setForm(null); setTokenNovo({ ...novo, aviso }); void reload(); }}
          aoSalvar={() => { setForm(null); toast.success('Equipamento atualizado.'); void reload(); }}
        />
      )}
      {tokenNovo && <TokenDoEquipamento nome={tokenNovo.nome} token={tokenNovo.token} aviso={tokenNovo.aviso} voltarPara={ID_TITULO} aoFechar={() => setTokenNovo(null)} />}
      {codigoDe && <CodigoDePareamento equipamento={codigoDe} voltarPara={ID_TITULO} aoFechar={() => setCodigoDe(null)} />}
      {revogando && <RevogarEquipamento equipamento={revogando} voltarPara={ID_TITULO} aoFechar={() => setRevogando(null)} aoRevogar={() => { setRevogando(null); void reload(); }} />}
      {verAvisos && (
        <Dialogo titulo="Produtos com setor que não existe na loja" aoFechar={() => setVerAvisos(false)} voltarPara={ID_TITULO} largura="lg"
          rodape={<Button type="button" data-foco-inicial onClick={() => setVerAvisos(false)}>Fechar</Button>}>
          <div className="space-y-3 text-sm">
            <p>A via de produção destes produtos sai na impressora padrão da loja. Crie o setor com o mesmo nome na loja para direcionar.</p>
            <ul className="space-y-1">
              {avisosRota.map((a: any) => (
                <li key={`${a.unidadeId}-${a.produtoId}`} className="rounded-md border border-border px-3 py-1.5">
                  <b>{a.produto}</b> <span className={texto2}>— {a.loja} · setor “{a.setor}”</span>
                </li>
              ))}
            </ul>
          </div>
        </Dialogo>
      )}
    </Shell>
  );
}
