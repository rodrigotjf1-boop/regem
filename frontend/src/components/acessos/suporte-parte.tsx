'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chave } from '@/components/ui/chave';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo } from '@/components/ui/sobreposto';
import { FiltroBusca, Filtros, ListaDados, Selo, Situacoes, TituloLista, Vazio, semAcento, texto2, type Situacao } from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ID_TITULO = 'suporte-titulo';
const dt = (v: any) => (v ? new Date(v).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
// Sessão sem fim registrado só está ATIVA enquanto não passou do prazo dela.
const ativa = (s: any) => !s.encerradaEm && new Date(s.expiraEm).getTime() > Date.now();
const expirada = (s: any) => !s.encerradaEm && !ativa(s);
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Ativas agora', filtro: ativa, tom: 'aviso' },
  { rotulo: 'Encerradas', filtro: (s) => !ativa(s) },
];
const QUEM: Record<string, string> = { loja: 'pela loja', tecnico: 'pelo técnico', expirou: 'por prazo', distribuicao: 'pela distribuição' };

// Acessos & perfis → Suporte (mockup `mockups/regem-configuracoes.html`): o que o suporte da
// distribuição pode fazer nesta empresa — bloquear a entrada e dar acesso total — e as sessões de
// suporte mais recentes. Bloquear encerra as sessões ativas; acesso total pede confirmação.
export function SuporteParte() {
  const [est, setEst] = useState<any | null>(null);
  const [sessoes, setSessoes] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [erroSessoes, setErroSessoes] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [confirmandoTotal, setConfirmandoTotal] = useState(false);
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);

  const lerSessoes = useCallback(async () => {
    setErroSessoes('');
    try {
      const s: any = await api.suporteSessoes();
      setSessoes(Array.isArray(s) ? s : []);
    } catch (e) {
      setErroSessoes(e instanceof Error ? e.message : 'Não foi possível carregar as sessões.');
    }
  }, []);
  const carregar = useCallback(async () => {
    setErro('');
    try {
      setEst(await api.suporteEstado());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar o acesso de suporte.');
      return;
    }
    void lerSessoes();
  }, [lerSessoes]);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function bloquear(v: boolean) {
    setOcupado(true);
    try {
      setEst(await api.suporteBloquear(v));
      toast.success(v ? 'Acesso de suporte bloqueado.' : 'Acesso de suporte liberado.');
      void lerSessoes(); // bloquear encerra as sessões ativas
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    } finally {
      setOcupado(false);
    }
  }
  async function acessoTotal(v: boolean) {
    setOcupado(true);
    try {
      setEst(await api.suporteAcessoTotal(v));
      toast.success(v ? 'Acesso total concedido ao suporte.' : 'Suporte voltou ao acesso mínimo (config).');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro');
    } finally {
      setOcupado(false);
      setConfirmandoTotal(false);
    }
  }

  if (erro)
    return (
      <Card className="space-y-3 p-5 text-sm">
        <p className="font-display text-base font-bold">Acesso de suporte</p>
        <p role="alert">{erro}</p>
        <Button type="button" variant="outline" size="sm" onClick={() => void carregar()}>Tentar de novo</Button>
      </Card>
    );
  if (!est) return <SkeletonList rows={4} />;

  const lista = sessoes ?? [];
  const b = semAcento(busca);
  const base = lista.filter((s) => !b || semAcento(`${s.tecnicoNome ?? ''} ${s.motivo ?? ''}`).includes(b));
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const agora: any[] = est.sessoesAtivas ?? [];
  const modo = est.bloqueado ? 'bloqueado' : est.acessoTotal ? 'acesso total' : 'acesso padrão';

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista id={ID_TITULO} titulo="Acesso de suporte" total={lista.length} mostrando={linhas.length} um="sessão" varios="sessões"
        extra={`suporte em ${modo} · as sessões mais recentes`} />
      <p className={`max-w-3xl text-sm ${texto2}`}>
        Por padrão, técnicos da distribuição acessam <strong>apenas as configurações</strong> (impressão, KDS, direcionamento, cupom) — nunca financeiro, dados de
        clientes ou vendas. Toda ação fica na sua auditoria. Você pode bloquear a qualquer momento.
      </p>
      <Card className="divide-y divide-border" aria-label="O que o suporte pode fazer na sua loja">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <span className="block text-sm font-medium">Bloquear acesso de suporte</span>
            <span className={`block text-xs ${texto2}`}>Fecha a entrada do suporte da distribuição nesta empresa e encerra as sessões que estiverem abertas.</span>
          </div>
          <Chave ligada={!!est.bloqueado} rotulo="Bloquear acesso de suporte" ocupada={ocupado} aoMudar={(v) => void bloquear(v)} />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <span className="block text-sm font-medium">Dar acesso total ao suporte</span>
            <span className={`block text-xs ${texto2}`}>
              Inclui o que o acesso padrão não mostra. {est.bloqueado ? 'Com o suporte bloqueado, não tem efeito — desbloqueie para mudar.' : 'Você retira quando quiser.'}
            </span>
          </div>
          <Chave ligada={!!est.acessoTotal} rotulo="Dar acesso total ao suporte" ocupada={ocupado || !!est.bloqueado} aoMudar={(v) => (v ? setConfirmandoTotal(true) : void acessoTotal(false))} />
        </div>
      </Card>
      {est.acessoTotal && !est.bloqueado && (
        <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm" role="status">
          <b>Acesso total ativo:</b> o suporte enxerga tudo da loja (inclusive R$). Desligue para voltar ao mínimo.
        </p>
      )}
      {agora.length > 0 && (
        <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm" role="status">
          <b>Suporte ativo agora:</b> {agora.map((x: any) => x.tecnicoNome || 'técnico').join(', ')}.
        </p>
      )}

      {erroSessoes ? (
        <Card className="space-y-3 p-5 text-sm">
          <p role="alert">{erroSessoes}</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void lerSessoes()}>Tentar de novo</Button>
        </Card>
      ) : sessoes === null ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
          <Filtros>
            <FiltroBusca id="suporte-busca" valor={busca} aoMudar={setBusca} placeholder="Nome do técnico ou motivo" />
          </Filtros>
          {lista.length === 0 ? (
            <Vazio>Nenhum acesso de suporte registrado.</Vazio>
          ) : linhas.length === 0 ? (
            <Vazio aoLimpar={() => { setBusca(''); setSit(-1); }} />
          ) : (
            <ListaDados
              legenda="Histórico de acessos de suporte"
              linhas={linhas}
              chave={(s) => s.id}
              nome={(s) => `${s.tecnicoNome || 'técnico'}, ${dt(s.iniciadaEm)}`}
              colunas={[
                { titulo: 'Técnico', celula: (s) => <span className="font-bold">{s.tecnicoNome || '—'}</span> },
                { titulo: 'Início', celula: (s) => <span className="whitespace-nowrap font-mono">{dt(s.iniciadaEm)}</span> },
                {
                  titulo: 'Fim',
                  celula: (s) =>
                    ativa(s) ? <Selo tom="aviso">ativo</Selo> : expirada(s) ? <span className="whitespace-nowrap font-mono">{dt(s.expiraEm)} <span className="font-sans">(prazo)</span></span> : (
                      <span className="whitespace-nowrap font-mono">{dt(s.encerradaEm)}{s.encerradaPor ? <span className="font-sans"> ({QUEM[s.encerradaPor] ?? s.encerradaPor})</span> : null}</span>
                    ),
                },
                { titulo: 'Motivo', celula: (s) => <span className="break-words">{s.motivo || '—'}</span> },
              ]}
            />
          )}
        </>
      )}

      {confirmandoTotal && (
        <Dialogo alerta titulo="Dar acesso total ao suporte?" aoFechar={() => setConfirmandoTotal(false)} voltarPara={ID_TITULO}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial onClick={() => setConfirmandoTotal(false)} disabled={ocupado}>Cancelar</Button>
              <Button type="button" variant="destructive" onClick={() => void acessoTotal(true)} disabled={ocupado}>{ocupado ? 'Gravando…' : 'Dar acesso total'}</Button>
            </>
          }>
          <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm">
            O técnico poderá ver/editar tudo da sua loja (incl. financeiro em R$, vendas e clientes) enquanto estiver conectado. Tudo continua auditado. Você
            pode retirar a qualquer momento.
          </p>
        </Dialogo>
      )}
    </section>
  );
}
