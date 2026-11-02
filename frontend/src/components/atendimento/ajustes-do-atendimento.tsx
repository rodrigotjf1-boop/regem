'use client';

import { useEffect, useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Ajustes, alterados, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { NO_SERVIDOR_DA_LOJA, SoPelaNuvem } from '@/components/ui/so-pela-nuvem';
import { texto2 } from '@/components/ui/lista';
import { MOTIVO_REEMBOLSO_99 } from '@/components/atendimento/pedido-99';

// AJUSTES DO ATENDIMENTO — Delivery › Configurações › Operação › Atendimento (Onda 1, PR 3; protótipo
// `mockups/regem-central-atendimento.html`, vista "ajustes"). Por enquanto, o grupo da 99 (o que o Regem faz com o pedido
// de cancelamento e de reembolso do cliente). Os grupos da fila e do iFood entram com o que eles ligam (PRs seguintes) —
// nenhum ajuste aparece antes de valer. Os ajustes ficam na integração da 99, que mora só na NUVEM: no servidor da loja a
// tela só explica. Só gerente e presidente mudam (o servidor confere).

const HORAS_PADRAO = [1, 2, 4, 8, 12, 20];

type Resposta = {
  conectado99: boolean;
  ajuste99: { decidirCancelamento: boolean; reembolsoRecusarEmHoras: number; reembolsoMotivo: string; reembolsoExplicacao: string } | null;
  horasPermitidas?: number[];
};

const paraValores = (r: Resposta): Valores =>
  r.ajuste99
    ? {
        decidirCancelamento: r.ajuste99.decidirCancelamento,
        reembolsoRecusarEmHoras: String(r.ajuste99.reembolsoRecusarEmHoras),
        reembolsoMotivo: r.ajuste99.reembolsoMotivo,
        reembolsoExplicacao: r.ajuste99.reembolsoExplicacao,
      }
    : {};

export function AjustesDoAtendimento() {
  const [podeMudar, setPodeMudar] = useState<boolean | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'pronto' | 'erro'>('carregando');
  const [resp, setResp] = useState<Resposta | null>(null);
  const [valores, setValores] = useState<Valores>({});
  const [salvos, setSalvos] = useState<Valores>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const ler = () => {
    setEstado('carregando');
    api
      .atendimentoAjustes()
      .then((r: Resposta) => {
        setResp(r);
        setValores(paraValores(r));
        setSalvos(paraValores(r));
        setEstado('pronto');
      })
      .catch(() => setEstado('erro'));
  };

  // A categoria só existe no navegador: lida depois de montar (o primeiro desenho é o mesmo do servidor — V35).
  useEffect(() => {
    const pode = ['presidente', 'gerente'].includes(getCategoria() ?? '');
    setPodeMudar(pode);
    if (pode && !NO_SERVIDOR_DA_LOJA) ler();
  }, []);

  const horas = resp?.horasPermitidas?.length ? resp.horasPermitidas : HORAS_PADRAO;
  const motivoSalvo = String(salvos.reembolsoMotivo ?? '');
  const opcoesMotivo = Object.entries(MOTIVO_REEMBOLSO_99).map(([v, rotulo]) => ({ v, rotulo }));
  if (motivoSalvo && !opcoesMotivo.some((o) => o.v.toLowerCase() === motivoSalvo.toLowerCase())) opcoesMotivo.push({ v: motivoSalvo, rotulo: motivoSalvo });

  const grupos: GrupoDeAjustes[] = [
    {
      titulo: '99Food · pedidos do cliente',
      nota: 'Quem responde aos pedidos da 99 na tela Atendimento: gerente e presidente, com a senha.',
      itens: [
        {
          id: 'decidirCancelamento',
          rotulo: 'Cancelamento pedido pelo cliente: decidir na fila',
          tipo: 'chave',
          ajuda: valores.decidirCancelamento
            ? 'Ligado (padrão): o pedido vira caso na fila; se ninguém responder em 5 min, a 99 recusa sozinha (regra da 99).'
            : 'Desligado: o Regem aceita o cancelamento na hora e o caso aparece em "Resolvidos hoje".',
          palavras: '99 cancelamento fila',
        },
        {
          id: 'reembolsoRecusarEmHoras',
          rotulo: 'Reembolso pedido pelo cliente: o Regem recusa se ninguém responder em',
          tipo: 'selecao',
          opcoes: horas.map((h) => ({ v: String(h), rotulo: `${h} h` })),
          ajuda: 'O pedido vira caso na fila, com as fotos do cliente. Sem o Regem, a 99 reembolsa sozinha em 24 h.',
          palavras: '99 reembolso tempo horas',
        },
        {
          id: 'reembolsoMotivo',
          rotulo: 'Motivo da recusa automática do reembolso',
          tipo: 'selecao',
          opcoes: opcoesMotivo,
          ajuda: 'Da lista da 99. Se o motivo não vier na lista do pedido, vai "Outro".',
          palavras: '99 reembolso motivo',
        },
        {
          id: 'reembolsoExplicacao',
          rotulo: 'Explicação que a 99 recebe',
          tipo: 'texto',
          opcional: true,
          maximo: 200,
          ajuda: 'Vai junto com o motivo da recusa automática.',
          palavras: '99 reembolso explicação texto',
        },
      ],
    },
  ];

  async function salvar() {
    const chaves = alterados(grupos, valores, salvos);
    if (!chaves.length || salvando) return;
    setSalvando(true);
    setErro('');
    const ajuste99: Record<string, unknown> = {};
    for (const k of chaves) ajuste99[k] = k === 'reembolsoRecusarEmHoras' ? Number(valores[k]) : valores[k];
    try {
      const r: Resposta = await api.salvarAtendimentoAjustes({ ajuste99 });
      setResp(r);
      setValores(paraValores(r));
      setSalvos(paraValores(r));
      toast.success('Ajustes do atendimento salvos.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'tente de novo');
    } finally {
      setSalvando(false);
    }
  }

  const cabecalho = (texto: React.ReactNode) => (
    <section className="space-y-3" aria-labelledby="atend-ajustes-titulo">
      <h2 id="atend-ajustes-titulo" className="font-display text-xl font-bold">
        Atendimento
      </h2>
      {texto}
    </section>
  );

  if (NO_SERVIDOR_DA_LOJA) return cabecalho(<SoPelaNuvem />);
  if (podeMudar === null) return cabecalho(<p className={`text-sm ${texto2}`}>Carregando…</p>);
  if (!podeMudar) return cabecalho(<p className={`text-sm ${texto2}`}>Só gerente e presidente veem e mudam os ajustes do atendimento.</p>);
  if (estado === 'carregando') return cabecalho(<p className={`text-sm ${texto2}`} role="status">Carregando os ajustes…</p>);
  if (estado === 'erro')
    return cabecalho(
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm" role="alert">
        <span>Não foi possível ler os ajustes do atendimento.</span>
        <Button type="button" size="sm" variant="outline" onClick={ler}>
          Tentar de novo
        </Button>
      </div>,
    );
  if (!resp?.conectado99)
    return cabecalho(
      <p className={`rounded-lg border border-border px-4 py-3 text-sm ${texto2}`}>
        A 99 não está conectada nesta empresa. Os ajustes dos pedidos do cliente da 99 aparecem aqui depois de conectar em Delivery ›
        Configurações › Integrações.
      </p>,
    );

  return (
    <Ajustes
      id="atend-ajustes"
      titulo="Atendimento"
      grupos={grupos}
      valores={valores}
      salvos={salvos}
      aoMudar={(k: string, v: Valor) => setValores((s) => ({ ...s, [k]: v }))}
      aoSalvar={() => void salvar()}
      aoDescartar={() => {
        setValores(salvos);
        setErro('');
      }}
      salvando={salvando}
      erro={erro}
    />
  );
}
