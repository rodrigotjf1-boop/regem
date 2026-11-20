'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Ajustes, alterados, type Ajuste, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { Selo } from '@/components/ui/lista';
import { GavetaPremiosDeEscolha } from './gaveta-premios-de-escolha';
import type { PainelDoClube } from './tipos';

// Marketing › Clube › Meta do mês (fase A3; a 479 trouxe `meta_desde`; protótipo `mockups/regem-clube-banner.html`,
// "Marketing › Clube" › Meta): até 3 níveis (pedidos no mês e os prêmios que o cliente escolhe ao bater cada um) e a
// validade do prêmio. Liga e desliga em Visão geral. Só o presidente muda (o servidor confere a ordem dos níveis).
const NIVEIS = [1, 2, 3] as const;
const lista = (v: Valor | undefined) => String(v ?? '').split(',').filter(Boolean);
const temNivel = (v: Valores, n: number) => String(v[`nivel${n}Pedidos`] ?? '') !== '';

function valoresDe(p: PainelDoClube): Valores {
  const v: Valores = { metaValidadeDias: String(p.config.metaValidadeDias) };
  for (const n of NIVEIS) {
    const nivel = p.config.metaNiveis[n - 1];
    v[`nivel${n}Pedidos`] = nivel ? String(nivel.pedidos) : '';
    v[`nivel${n}Premios`] = nivel ? nivel.premios.join(',') : '';
  }
  return v;
}

export function MetaDoMes({
  painel,
  podeMudar,
  aoMudar,
  aoIrParaPremios,
}: {
  painel: PainelDoClube;
  podeMudar: boolean;
  aoMudar: (p: PainelDoClube) => void;
  aoIrParaPremios: () => void;
}) {
  const salvos = useMemo(() => valoresDe(painel), [painel]);
  const [valores, setValores] = useState<Valores>(salvos);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [gaveta, setGaveta] = useState<number | null>(null);
  useEffect(() => setValores(salvos), [salvos]);

  // Só os prêmios que o cliente pode escolher (o produto grátis gravado antes não entra na escolha).
  const nomes = (n: number) =>
    lista(valores[`nivel${n}Premios`]).map((x) => painel.premios.find((p) => p.id === x && p.tipo !== 'produto')?.nome).filter(Boolean) as string[];
  const presentes = NIVEIS.filter((n) => temNivel(valores, n));
  const ultimo = presentes[presentes.length - 1];

  const itensDoNivel = (n: number): Ajuste[] => {
    if (!temNivel(valores, n)) {
      if (!podeMudar) return [];
      return [
        {
          id: `nivel${n}Pedidos`,
          rotulo: `Nível ${n}`,
          tipo: 'livre',
          ajuda: 'Opcional: mais pedidos no mês para um prêmio maior.',
          palavras: `nível ${n} pôr`,
          desenhar: (_v, mudar) => (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!temNivel(valores, n - 1)}
              onClick={() => mudar(String(Math.min(30, Number(valores[`nivel${n - 1}Pedidos`] || 0) + 3)))}
            >
              ＋ Pôr o nível {n}
            </Button>
          ),
        },
      ];
    }
    const pedidos: Ajuste = podeMudar
      ? {
          id: `nivel${n}Pedidos`,
          rotulo: `Nível ${n} · pedidos no mês`,
          tipo: 'numero',
          sufixo: 'pedidos',
          ajuda: n === 1 ? 'Pedidos no mês para escolher um prêmio da lista 1.' : 'Pedidos no mês para um prêmio maior (mais que o nível anterior).',
          palavras: `nível ${n} pedidos`,
        }
      : { id: `nivel${n}Pedidos`, rotulo: `Nível ${n}`, tipo: 'livre', desenhar: () => <span className="text-sm">{valores[`nivel${n}Pedidos`]} pedidos no mês</span> };
    const premios: Ajuste = {
      id: `nivel${n}Premios`,
      rotulo: `Nível ${n} · prêmios`,
      tipo: 'livre',
      ajuda: nomes(n).length ? `O cliente escolhe um: ${nomes(n).join(', ')}.` : 'O cliente escolhe um da lista; vira cupom para o próximo pedido.',
      palavras: `nível ${n} prêmios`,
      desenhar: () =>
        podeMudar ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setGaveta(n)}>
              {nomes(n).length ? `${nomes(n).length} ${nomes(n).length === 1 ? 'prêmio' : 'prêmios'}` : 'Escolher os prêmios'}
            </Button>
            {n > 1 && n === ultimo && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setValores((x) => ({ ...x, [`nivel${n}Pedidos`]: '', [`nivel${n}Premios`]: '' }))}
              >
                Tirar o nível {n}
              </Button>
            )}
          </div>
        ) : (
          <Selo>{nomes(n).length ? `${nomes(n).length} prêmios` : 'nenhum'}</Selo>
        ),
    };
    return [pedidos, premios];
  };

  const grupos: GrupoDeAjustes[] = [
    {
      titulo: 'Meta do mês',
      nota: painel.config.metaAtivo
        ? 'Ligada: contam os pedidos do mês do cardápio online ou do WhatsApp, a partir do mínimo do clube, depois de ligar. Cada nível batido dá um prêmio no mês.'
        : 'Desligada: liga em Visão geral. Só os pedidos depois de ligar contam.',
      itens: [
        ...NIVEIS.flatMap(itensDoNivel),
        podeMudar
          ? {
              id: 'metaValidadeDias',
              rotulo: 'Validade do prêmio',
              tipo: 'selecao' as const,
              opcoes: painel.opcoes.validadesDaMeta.map((d) => ({ v: String(d), rotulo: `${d} dias` })),
              ajuda: 'Conta a partir do dia em que o cliente escolhe.',
              palavras: 'validade prêmio meta',
            }
          : { id: 'metaValidadeDias', rotulo: 'Validade do prêmio', tipo: 'livre' as const, desenhar: () => <span className="text-sm">{painel.config.metaValidadeDias} dias</span> },
      ],
    },
  ];

  async function salvar() {
    const mudou = alterados(grupos, valores, salvos);
    // O nível tirado some da lista de itens: a diferença dele se confere à parte.
    const tirou = NIVEIS.some((n) => temNivel(salvos, n) !== temNivel(valores, n));
    if (!mudou.length && !tirou) return;
    const corpo: Record<string, unknown> = {};
    if (tirou || mudou.some((k) => k.startsWith('nivel')))
      corpo.metaNiveis = NIVEIS.filter((n) => temNivel(valores, n)).map((n) => ({
        pedidos: Number(valores[`nivel${n}Pedidos`]),
        premios: lista(valores[`nivel${n}Premios`]),
      }));
    if (mudou.includes('metaValidadeDias')) corpo.metaValidadeDias = Number(valores.metaValidadeDias);
    setErro('');
    setSalvando(true);
    try {
      aoMudar((await api.clubeSalvarConfig(corpo)) as PainelDoClube);
      toast.success('Meta salva.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível salvar a meta.';
      setErro(msg);
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Ajustes
        id="clube-meta"
        titulo="Meta do mês"
        grupos={grupos}
        valores={valores}
        salvos={salvos}
        aoMudar={(k: string, v: Valor) => setValores((x) => ({ ...x, [k]: v }))}
        aoSalvar={salvar}
        aoDescartar={() => setValores(salvos)}
        salvando={salvando}
        erro={erro}
        antes={!podeMudar ? <p className="text-sm text-secondary-foreground">Só o presidente muda o Clube; aqui você vê como está.</p> : undefined}
      />
      {gaveta !== null && (
        <GavetaPremiosDeEscolha
          painel={painel}
          titulo={`Prêmios do nível ${gaveta} da meta`}
          ajuda={`Quem faz ${valores[`nivel${gaveta}Pedidos`]} pedidos no mês escolhe um destes; vira cupom para o próximo pedido.`}
          rotuloDoGrupo={`Prêmios do nível ${gaveta}`}
          valor={lista(valores[`nivel${gaveta}Premios`])}
          aoFechar={() => setGaveta(null)}
          aoEscolher={(ids) => {
            setValores((x) => ({ ...x, [`nivel${gaveta}Premios`]: ids.join(',') }));
            setGaveta(null);
          }}
          aoIrParaPremios={() => {
            setGaveta(null);
            aoIrParaPremios();
          }}
        />
      )}
    </>
  );
}
