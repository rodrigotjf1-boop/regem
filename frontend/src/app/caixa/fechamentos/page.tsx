'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Eye, Scale } from 'lucide-react';
import { api, getCategoria, getToken } from '@/lib/api';
import { baixarCsv } from '@/lib/csv';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio,
  brl, distintos, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';
import { BarraPeriodo, usePeriodo } from '@/components/relatorios/periodo';
import { useEscopoDeLoja } from '@/components/relatorios/escopo';
import { AvisoDeLimite, ErroDeLeitura, Indicadores } from '@/components/relatorios/pecas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TURNOS — os fechamentos de caixa do PDV e do delivery, com o que foi contado e a diferença.
// Mockup `mockups/regem-relatorios.html` (aprovado em 07/10/2026). A lista vem de
// `GET /financeiro/caixa/fechamentos` (presidente e gerente, permissão "Turnos"), que já obedece
// a loja em uso e devolve os 300 fechamentos mais recentes do período.

const LIMITE = 300;
const ID_TITULO = 'turnos-titulo';
const numero = (r: any) => String(r.turnoNumero ?? '—').padStart(2, '0');
const origemDe = (r: any) => (r.origem === 'delivery' ? 'Delivery' : 'PDV');
const dif = (r: any) => Number(r.diferenca || 0);
const quando = (iso: unknown) =>
  iso ? new Date(String(iso)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const comSinal = (v: number) => `${v > 0 ? '+' : '−'}${brl(Math.abs(v))}`;
/** As formas de pagamento em que a diferença não é zero, em ordem alfabética (o banco não guarda ordem). */
const diferencasPorForma = (m: unknown): [string, number][] =>
  Object.entries((m as Record<string, number>) ?? {})
    .map(([f, v]) => [f, Number(v)] as [string, number])
    .filter(([, v]) => Math.abs(v) > 0.001)
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));

const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Bateu', filtro: (r) => Math.abs(dif(r)) < 0.005 },
  { rotulo: 'Faltou dinheiro', filtro: (r) => dif(r) <= -0.005, tom: 'critico' },
  { rotulo: 'Sobrou dinheiro', filtro: (r) => dif(r) >= 0.005, tom: 'aviso' },
];

function SeloDiferenca({ valor }: { valor: number }) {
  if (Math.abs(valor) < 0.005) return <Selo tom="ok">bateu</Selo>;
  return <Selo tom={valor < 0 ? 'critico' : 'aviso'}><span className="font-mono">{comSinal(valor)}</span></Selo>;
}

export default function TurnosPage() {
  const router = useRouter();
  const periodo = usePeriodo('30');
  const loja = useEscopoDeLoja();
  const [rows, setRows] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [papel, setPapel] = useState('');
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [origem, setOrigem] = useState('');
  const [operador, setOperador] = useState('');
  const [vendo, setVendo] = useState<any | null>(null);
  const [aReconciliar, setAReconciliar] = useState<any | null>(null);
  const [reconciliando, setReconciliando] = useState(false);
  const [erroReconc, setErroReconc] = useState('');
  const [resultado, setResultado] = useState<{ turno: any; r: any } | null>(null);

  const { de, ate, pronto } = periodo;
  const carregar = useCallback(async () => {
    if (!pronto) return;
    setCarregando(true);
    setErro('');
    try {
      const r: any = await api.fechamentosCaixa(de, ate, loja.total);
      setRows(Array.isArray(r) ? r : []);
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Tente de novo em instantes.');
    } finally {
      setCarregando(false);
    }
  }, [de, ate, pronto, loja.total]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    // Só presidência e gerência veem (o servidor também barra, com a permissão "Turnos").
    const cat = getCategoria() ?? '';
    if (!['presidente', 'gerente'].includes(cat)) {
      router.replace('/meu-dia');
      return;
    }
    setPapel(cat);
    void carregar();
  }, [router, carregar]);

  async function reconciliar(turno: any) {
    setReconciliando(true);
    setErroReconc('');
    try {
      const r: any = await api.reconciliarCaixa(turno.id);
      setAReconciliar(null);
      setResultado({ turno, r });
    } catch (e) {
      setErroReconc(e instanceof Error ? e.message : 'Não foi possível reconciliar agora. Tente de novo.');
    } finally {
      setReconciliando(false);
    }
  }

  const todos = rows ?? [];
  const b = semAcento(busca);
  const base = todos.filter(
    (r) =>
      (!b || semAcento(`${numero(r)} ${r.operador ?? ''} ${origemDe(r)} ${r.obs ?? ''}`).includes(b)) &&
      (!origem || origemDe(r) === origem) &&
      (!operador || r.operador === operador),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || origem || operador || sit >= 0);
  const limpar = () => { setBusca(''); setOrigem(''); setOperador(''); setSit(-1); };
  const somada = linhas.reduce((s, r) => s + dif(r), 0);
  const exportar = () =>
    baixarCsv('turnos', linhas.map((r) => ({
      turno: numero(r), origem: origemDe(r), operador: r.operador ?? '', 'fechado em': quando(r.fechadaEm),
      abertura: Number(r.valorAbertura || 0), esperado: Number(r.valorEsperado || 0), contado: Number(r.valorInformado || 0), diferenca: dif(r), observacao: r.obs ?? '',
    })));

  return (
    <Shell eyebrow="Relatórios" title="Turnos">
      <div className="space-y-4">
        <p className={`text-sm ${texto2}`}>Fechamentos de caixa do PDV e do delivery, com o que foi contado e a diferença.</p>
        <BarraPeriodo periodo={periodo} escopo={loja.texto} total={loja.opcao} atualizadoEm={atualizadoEm} carregando={carregando} aoAtualizar={() => void carregar()} />

        {erro ? (
          <ErroDeLeitura oQue="os turnos fechados" motivo={erro} aoTentar={() => void carregar()} ocupado={carregando} />
        ) : rows === null ? (
          <SkeletonList rows={4} />
        ) : (
          <section className="space-y-3" aria-labelledby={ID_TITULO}>
            <TituloLista id={ID_TITULO} titulo="Turnos fechados" total={todos.length} mostrando={linhas.length} um="turno" varios="turnos"
              extra={linhas.length ? `diferença somada ${somada < -0.005 ? '−' : ''}${brl(Math.abs(somada))}` : undefined}>
              {linhas.length > 0 && <Button type="button" variant="outline" onClick={exportar}><Download className="h-4 w-4" aria-hidden="true" /> Exportar CSV</Button>}
            </TituloLista>
            <AvisoDeLimite linhas={todos.length} limite={LIMITE} oQue="os fechamentos" />
            <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
            <Filtros>
              <FiltroBusca id="turnos-busca" valor={busca} aoMudar={setBusca} placeholder="Operador, número do turno ou observação" />
              <FiltroSelect id="turnos-origem" rotulo="Origem" todos="PDV e delivery" opcoes={distintos(todos, origemDe)} valor={origem} aoMudar={setOrigem} />
              <FiltroSelect id="turnos-operador" rotulo="Operador" todos="Todos os operadores" opcoes={distintos(todos, (r) => r.operador)} valor={operador} aoMudar={setOperador} />
            </Filtros>

            {todos.length === 0 ? (
              <Vazio>Nenhum turno fechado neste período. O turno aparece aqui quando o caixa é fechado no PDV ou no delivery.</Vazio>
            ) : linhas.length === 0 ? (
              <Vazio aoLimpar={limpar} />
            ) : (
              <ListaDados
                legenda="Turnos fechados"
                linhas={linhas}
                chave={(r) => r.id}
                nome={(r) => `turno ${numero(r)}`}
                colunas={[
                  { titulo: 'Turno', celula: (r) => <NomeComApoio nome={`Turno ${numero(r)}`} apoio={`fechado em ${quando(r.fechadaEm)}`}><Selo>{origemDe(r)}</Selo></NomeComApoio> },
                  { titulo: 'Operador', celula: (r) => r.operador ?? '—' },
                  { titulo: 'Esperado', celula: (r) => <span className="whitespace-nowrap font-mono">{brl(r.valorEsperado)}</span> },
                  { titulo: 'Contado', celula: (r) => <span className="whitespace-nowrap font-mono">{brl(r.valorInformado)}</span> },
                  {
                    titulo: 'Diferença',
                    celula: (r) => {
                      const formas = diferencasPorForma(r.diferencaPorForma);
                      return (
                        <>
                          <SeloDiferenca valor={dif(r)} />
                          {formas.length > 0 && <span className={`mt-0.5 block text-xs ${texto2}`}>{formas.map(([f, v]) => `${f} ${comSinal(v)}`).join(' · ')}</span>}
                        </>
                      );
                    },
                  },
                ]}
                acoes={() => [
                  { rotulo: 'Ver fechamento', icone: Eye, aoClicar: setVendo },
                  // Só o presidente confere o fechamento contra o histórico do dinheiro (é a regra do servidor).
                  ...(papel === 'presidente' ? [{ rotulo: 'Reconciliar', icone: Scale, aoClicar: (r: any) => { setErroReconc(''); setAReconciliar(r); } }] : []),
                ]}
              />
            )}
            {filtrando && linhas.length > 0 && (
              <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
            )}
          </section>
        )}
      </div>

      {vendo && (
        <Gaveta
          titulo={`Fechamento do turno ${numero(vendo)}`}
          aoFechar={() => setVendo(null)}
          fecharNoFundo
          voltarPara={ID_TITULO}
          rodape={
            <>
              {papel === 'presidente' && (
                // Um painel por vez: a gaveta fecha e o diálogo abre.
                <Button type="button" variant="outline" onClick={() => { const t = vendo; setVendo(null); setErroReconc(''); setAReconciliar(t); }}>Reconciliar</Button>
              )}
              <Button type="button" data-foco-inicial onClick={() => setVendo(null)}>Fechar</Button>
            </>
          }
        >
          <div className="space-y-4 text-sm">
            <p className={texto2}>
              {origemDe(vendo)} · aberto em {quando(vendo.abertaEm)} · fechado em {quando(vendo.fechadaEm)} por <b className="text-foreground">{vendo.operador ?? '—'}</b>
            </p>
            <Indicadores itens={[
              { rotulo: 'Abertura', valor: brl(vendo.valorAbertura) },
              { rotulo: 'Esperado', valor: brl(vendo.valorEsperado) },
              { rotulo: 'Contado', valor: brl(vendo.valorInformado) },
              { rotulo: 'Diferença', valor: <SeloDiferenca valor={dif(vendo)} /> },
            ]} />
            <div className="space-y-1.5">
              <p className={`text-xs font-bold ${texto2}`}>Diferença por forma de pagamento</p>
              {diferencasPorForma(vendo.diferencaPorForma).length === 0 ? (
                <p className={texto2}>{Math.abs(dif(vendo)) < 0.005 ? 'Todas as formas bateram com o esperado.' : 'Este fechamento não guardou a diferença separada por forma de pagamento.'}</p>
              ) : (
                <dl className="divide-y divide-border rounded-md border border-border">
                  {diferencasPorForma(vendo.diferencaPorForma).map(([f, v]) => (
                    <div key={f} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-2">
                      <dt className="font-semibold">{f}</dt>
                      <dd className="font-mono">
                        {comSinal(v)}{' '}
                        {vendo.esperadoPorForma?.[f] != null && <span className={`ml-1 text-xs ${texto2}`}>esperado {brl(vendo.esperadoPorForma[f])}</span>}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
            {vendo.obs && (
              <div className="space-y-1">
                <p className={`text-xs font-bold ${texto2}`}>Observação de quem fechou</p>
                <p className="whitespace-pre-wrap break-words">{vendo.obs}</p>
              </div>
            )}
          </div>
        </Gaveta>
      )}

      {aReconciliar && (
        <Dialogo
          titulo={`Reconciliar o turno ${numero(aReconciliar)}?`}
          aoFechar={() => { if (!reconciliando) setAReconciliar(null); }}
          voltarPara={ID_TITULO}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial onClick={() => setAReconciliar(null)} disabled={reconciliando}>Cancelar</Button>
              <Button type="button" onClick={() => void reconciliar(aReconciliar)} disabled={reconciliando}>{reconciliando ? 'Conferindo…' : 'Reconciliar'}</Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <p>O esperado é recalculado pelo histórico do dinheiro (cada lançamento do turno) e comparado com o que ficou gravado no fechamento.</p>
            <p className="rounded-md border-l-4 border-l-info bg-info/10 px-3 py-2">Só confere — não altera o fechamento. Se houver divergência, fica registrado na Auditoria.</p>
            {erroReconc && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erroReconc}</p>}
          </div>
        </Dialogo>
      )}

      {resultado && (
        <Dialogo
          titulo={resultado.r?.ok ? 'Reconciliação conferida' : 'Divergência encontrada'}
          aoFechar={() => setResultado(null)}
          voltarPara={ID_TITULO}
          largura={resultado.r?.ok ? 'md' : 'lg'}
          alerta={!resultado.r?.ok}
          rodape={<Button type="button" data-foco-inicial onClick={() => setResultado(null)}>Fechar</Button>}
        >
          {resultado.r?.ok ? (
            <p className="rounded-md border-l-4 border-l-ok bg-ok/10 px-3 py-2 text-sm">
              O caixa do turno {numero(resultado.turno)} bate com o histórico do dinheiro em todas as formas de pagamento.
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="rounded-md border-l-4 border-l-destructive bg-destructive/10 px-3 py-2">
                O histórico do dinheiro e o fechamento do turno {numero(resultado.turno)} diferem em <b>{brl(resultado.r?.totalDivergencia)}</b>. Ficou registrado na Auditoria.
              </p>
              <dl className="grid gap-2 sm:grid-cols-2">
                {(resultado.r?.porForma ?? []).map((f: any) => (
                  <div key={f.forma} className="space-y-1 rounded-md border border-border p-3">
                    <dt className="flex flex-wrap items-center justify-between gap-2 font-bold">
                      {f.forma}
                      {Math.abs(Number(f.divergencia)) < 0.005 ? <Selo tom="ok">bate</Selo> : <Selo tom="critico"><span className="font-mono">{comSinal(Number(f.divergencia))}</span></Selo>}
                    </dt>
                    <dd className="flex justify-between gap-3"><span className={texto2}>Gravado no fechamento</span><span className="font-mono">{brl(f.gravado)}</span></dd>
                    <dd className="flex justify-between gap-3"><span className={texto2}>Recalculado</span><span className="font-mono">{brl(f.recalculado)}</span></dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </Dialogo>
      )}
    </Shell>
  );
}
