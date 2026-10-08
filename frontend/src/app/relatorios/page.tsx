'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getCategoria, getToken, getUnidadeAtual, podePerm, podeVerFinanceiro } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Partes } from '@/components/ui/partes';
import { SkeletonList } from '@/components/ui/skeleton';
import { texto2 } from '@/components/ui/lista';
import { BarraPeriodo, usePeriodo } from '@/components/relatorios/periodo';
import { useLeitura, type Acompanhar } from '@/components/relatorios/leitura';
import type { PropsDaAba } from '@/components/relatorios/formatos';
import { AbaVendas } from '@/components/relatorios/abas/aba-vendas';
import { AbaCanal } from '@/components/relatorios/abas/aba-canal';
import { AbaConferencia } from '@/components/relatorios/abas/aba-conferencia';
import { AbaTurnos } from '@/components/relatorios/abas/aba-turnos';
import { AbaOperacoes } from '@/components/relatorios/abas/aba-operacoes';
import { AbaEstoque } from '@/components/relatorios/abas/aba-estoque';
import { AbaProducao } from '@/components/relatorios/abas/aba-producao';
import { AbaResgates, CASHBACK, FIDELIDADE } from '@/components/relatorios/abas/aba-resgates';
import { AbaFinanceiro } from '@/components/relatorios/abas/aba-financeiro';

/* eslint-disable @typescript-eslint/no-explicit-any */

// RELATÓRIOS DE VENDAS — as 11 abas no modelo novo (mockup `mockups/regem-relatorios.html`,
// aprovado em 07/10/2026). Só a tela mudou: as rotas e as contas do servidor são as mesmas.
//  · um período para a tela inteira (atalhos, datas e faixa de horário), com o texto de quando a
//    quando são os números, de qual loja e a que horas chegaram;
//  · cada parte lê e falha sozinha (`useLeitura`): a que não veio diz que não veio;
//  · as abas que são lista mostram a quantidade — turnos e resgates já na abertura da tela;
//    estoque e produção, depois de abertas.
// As rotas de venda somam a EMPRESA INTEIRA (não olham a loja em uso); só a aba Estoque obedece
// a loja — a tela escreve isso.

const ABAS = [
  { key: 'vendas', label: 'Vendas' },
  { key: 'balcao', label: 'Balcão / Salão' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'conferencia', label: 'Conferência de valores' },
  { key: 'turnos', label: 'Turnos / Caixa' },
  { key: 'caixa', label: 'Operações de caixa' },
  { key: 'estoque', label: 'Estoque' },
  { key: 'producao', label: 'Produção' },
  { key: 'fidelidade', label: 'Fidelidades' },
  { key: 'cashback', label: 'Cashbacks' },
  { key: 'financeiro', label: 'Financeiro' },
] as const;
type Aba = (typeof ABAS)[number]['key'];

type Perfil = { gestor: boolean; gerencia: boolean; verFin: boolean; fidelidade: boolean; cashback: boolean; lojaEmUso: boolean };

export default function RelatoriosDeVendasPage() {
  const router = useRouter();
  const periodo = usePeriodo('30');
  // Quem é o usuário só se sabe no navegador: até lá a tela não desenha nada que dependa disso.
  const [perfil, setPerfil] = useState<Perfil | null>(null);
  const [aba, setAba] = useState<Aba>('vendas');
  const [versao, setVersao] = useState(0);
  const [pendentes, setPendentes] = useState(0);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [contas, setContas] = useState<{ chave: string; estoque: number | null; producao: number | null }>({ chave: '', estoque: null, producao: null });

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    const categoria = getCategoria() ?? '';
    const gerencia = ['presidente', 'gerente'].includes(categoria);
    setPerfil({
      gestor: gerencia || categoria === 'supervisao',
      gerencia,
      verFin: podeVerFinanceiro(),
      fidelidade: gerencia && (categoria === 'presidente' || podePerm('fidelidade')),
      cashback: gerencia && (categoria === 'presidente' || podePerm('cashback')),
      lojaEmUso: !!getUnidadeAtual(),
    });
    // Quem volta do Mapa de calor (ou chega por um link) cai na aba pedida: `/relatorios?aba=delivery`.
    const pedida = new URLSearchParams(window.location.search).get('aba');
    if (pedida && ABAS.some((a) => a.key === pedida)) setAba(pedida as Aba);
  }, [router]);

  const acompanhar = useMemo<Acompanhar>(
    () => ({
      comecou: () => setPendentes((n) => n + 1),
      terminou: (deuCerto) => {
        setPendentes((n) => Math.max(0, n - 1));
        if (deuCerto) setAtualizadoEm(new Date());
      },
    }),
    [],
  );

  const gestor = !!perfil?.gestor;
  const verFin = !!perfil?.verFin;
  const chave = gestor && periodo.pronto ? `${periodo.inicioTs}|${periodo.fimTs}` : '';
  const { inicioTs, fimTs, de, ate } = periodo;

  // As três listas que mostram a quantidade na aba são lidas com a tela.
  const turnos = useLeitura<any>(() => api.relatorioTurnos(inicioTs, fimTs), chave, gestor, versao, acompanhar);
  const fidelidade = useLeitura<any[]>(() => api.fidelidadeRelatorioPeriodo(de, ate) as Promise<any[]>, chave, !!perfil?.fidelidade, versao, acompanhar);
  const cashback = useLeitura<any[]>(() => api.cashbackRelatorio(de, ate) as Promise<any[]>, chave, !!perfil?.cashback, versao, acompanhar);

  const contarEstoque = useCallback((n: number) => setContas((c) => ({ chave, estoque: n, producao: c.chave === chave ? c.producao : null })), [chave]);
  const contarProducao = useCallback((n: number) => setContas((c) => ({ chave, producao: n, estoque: c.chave === chave ? c.estoque : null })), [chave]);

  function escolherAba(k: Aba) {
    setAba(k);
    window.history.replaceState(null, '', k === 'vendas' ? '/relatorios' : `/relatorios?aba=${k}`);
  }
  const fimDoMes = (ym: string) => {
    const [a, m] = ym.split('-').map(Number);
    return `${ym}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, '0')}`;
  };
  function escolherMes(ym: string) {
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    periodo.escolher('outro');
    periodo.mudar({ de: `${ym}-01`, ate: fimDoMes(ym) });
  }
  // O seletor de mês só mostra um mês quando o período É aquele mês inteiro. Mostrando o mês da
  // data inicial (como era), escolher esse mesmo mês não fazia nada.
  const mesInteiro = de && de === `${de.slice(0, 7)}-01` && ate === fimDoMes(de.slice(0, 7)) ? de.slice(0, 7) : '';

  if (!perfil)
    return (
      <Shell eyebrow="Relatórios" title="Relatórios de vendas">
        <SkeletonList rows={4} />
      </Shell>
    );
  if (!perfil.gestor)
    return (
      <Shell eyebrow="Relatórios" title="Relatórios de vendas">
        <p className={`text-sm ${texto2}`}>Acesso restrito à gestão.</p>
      </Shell>
    );

  const contaDaAba: Partial<Record<Aba, number | null>> = {
    turnos: turnos.dados ? (turnos.dados.turnos ?? []).length : null,
    estoque: contas.chave === chave ? contas.estoque : null,
    producao: contas.chave === chave ? contas.producao : null,
    fidelidade: Array.isArray(fidelidade.dados) ? fidelidade.dados.length : null,
    cashback: Array.isArray(cashback.dados) ? cashback.dados.length : null,
  };
  const partes = ABAS.filter((a) => verFin || a.key !== 'financeiro').map((a) => ({ key: a.key, label: a.label, conta: contaDaAba[a.key] ?? null }));
  const ativa: Aba = partes.some((p) => p.key === aba) ? aba : 'vendas';
  const props: PropsDaAba = { inicio: inicioTs, fim: fimTs, chave, versao, verFin, acompanhar };
  const escopo = ativa === 'estoque' ? (perfil.lojaEmUso ? 'loja em uso' : 'todas as lojas') : 'todas as lojas da empresa';

  return (
    <Shell eyebrow="Relatórios" title="Relatórios de vendas">
      <div className="space-y-4">
        <p className={`text-sm ${texto2}`}>Vendas, caixa, estoque e produção no período escolhido.</p>
        <BarraPeriodo periodo={periodo} escopo={escopo} comHorario atualizadoEm={atualizadoEm} carregando={pendentes > 0} aoAtualizar={() => setVersao((v) => v + 1)} />
        <Partes partes={partes} ativa={ativa} aoEscolher={escolherAba} rotulo="Abas de Relatórios de vendas" />

        {!periodo.pronto ? null : ativa === 'vendas' ? (
          <AbaVendas {...props} />
        ) : ativa === 'balcao' ? (
          <AbaCanal key="balcao" canal="balcao" {...props} />
        ) : ativa === 'delivery' ? (
          <AbaCanal key="delivery" canal="delivery" podeMapa={perfil.gerencia} {...props} />
        ) : ativa === 'conferencia' ? (
          <AbaConferencia {...props} />
        ) : ativa === 'turnos' ? (
          <AbaTurnos leitura={turnos} verFin={verFin} />
        ) : ativa === 'caixa' ? (
          <AbaOperacoes {...props} />
        ) : ativa === 'estoque' ? (
          <AbaEstoque {...props} aoContar={contarEstoque} />
        ) : ativa === 'producao' ? (
          <AbaProducao {...props} aoContar={contarProducao} />
        ) : ativa === 'fidelidade' ? (
          <AbaResgates key="fidelidade" tipo={FIDELIDADE} pode={perfil.fidelidade} leitura={fidelidade} />
        ) : ativa === 'cashback' ? (
          <AbaResgates key="cashback" tipo={CASHBACK} pode={perfil.cashback} leitura={cashback} />
        ) : (
          <AbaFinanceiro {...props} mes={mesInteiro} aoEscolherMes={escolherMes} />
        )}
      </div>
    </Shell>
  );
}
