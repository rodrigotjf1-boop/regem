'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Ajustes, alterados, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { Selo } from '@/components/ui/lista';
import { GavetaPremiosDeEscolha } from './gaveta-premios-de-escolha';
import type { PainelDoClube } from './tipos';

// Marketing › Clube › Álbum de selos (fase A2, mig 479; protótipo `mockups/regem-clube-banner.html`, "Marketing › Clube" ›
// Álbum): quantos selos completam o álbum, quanto tempo cada selo vale, os prêmios que o cliente escolhe ao completar e a
// arte (automática). Liga e desliga em Visão geral. Só o presidente muda (o servidor confere).
const SELOS = Array.from({ length: 10 }, (_, i) => i + 3); // 3 a 12

function valoresDe(p: PainelDoClube): Valores {
  return {
    albumSelos: String(p.config.albumSelos),
    albumValidadeMeses: String(p.config.albumValidadeMeses),
    albumPremios: p.config.albumPremios.join(','),
  };
}

export function AlbumDeSelos({
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
  const [gaveta, setGaveta] = useState(false);
  useEffect(() => setValores(salvos), [salvos]);

  const escolhidos = String(valores.albumPremios ?? '').split(',').filter(Boolean);
  // Só os prêmios que o cliente pode escolher (o produto grátis gravado antes do A2 não entra na escolha).
  const nomes = escolhidos.map((x) => painel.premios.find((p) => p.id === x && p.tipo !== 'produto')?.nome).filter(Boolean) as string[];

  const grupos: GrupoDeAjustes[] = [
    {
      titulo: 'Álbum de selos',
      nota: painel.config.albumAtivo
        ? 'Ligado: um selo por mês com pedido do cardápio online ou do WhatsApp, a partir do mínimo do clube. Só os pedidos depois de ligar contam.'
        : 'Desligado: liga em Visão geral. Só os pedidos depois de ligar contam.',
      itens: [
        podeMudar
          ? {
              id: 'albumSelos',
              rotulo: 'Selos para completar o álbum',
              tipo: 'selecao' as const,
              opcoes: SELOS.map((n) => ({ v: String(n), rotulo: `${n} selos` })),
              ajuda: 'De 3 a 12. Os selos não precisam ser seguidos.',
              palavras: 'selos completar álbum',
            }
          : { id: 'albumSelos', rotulo: 'Selos para completar o álbum', tipo: 'livre' as const, desenhar: () => <span className="font-mono text-sm">{painel.config.albumSelos}</span> },
        podeMudar
          ? {
              id: 'albumValidadeMeses',
              rotulo: 'Validade de cada selo',
              tipo: 'selecao' as const,
              opcoes: painel.opcoes.validadesDoSelo.map((m) => ({ v: String(m), rotulo: `${m} meses` })),
              ajuda: 'Depois disso o selo sai do álbum.',
              palavras: 'validade selo meses',
            }
          : { id: 'albumValidadeMeses', rotulo: 'Validade de cada selo', tipo: 'livre' as const, desenhar: () => <span className="text-sm">{painel.config.albumValidadeMeses} meses</span> },
        {
          id: 'albumPremios',
          rotulo: 'Prêmio de quem completa',
          tipo: 'livre',
          ajuda: nomes.length ? `O cliente escolhe um: ${nomes.join(', ')}.` : 'O cliente escolhe um da lista; vira cupom para o próximo pedido.',
          palavras: 'prêmio completa escolhe',
          desenhar: () =>
            podeMudar ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setGaveta(true)}>
                {nomes.length ? `${nomes.length} ${nomes.length === 1 ? 'prêmio' : 'prêmios'}` : 'Escolher os prêmios'}
              </Button>
            ) : (
              <Selo>{nomes.length ? `${nomes.length} prêmios` : 'nenhum'}</Selo>
            ),
        },
        {
          id: 'arte',
          rotulo: 'Arte do selo',
          tipo: 'livre',
          ajuda: 'A arte padrão de cada mês. A do evento do mês, quando a loja liga o evento, chega numa próxima entrega.',
          palavras: 'arte selo evento',
          desenhar: () => <Selo>automática</Selo>,
        },
      ],
    },
  ];

  async function salvar() {
    const mudou = alterados(grupos, valores, salvos).filter((k) => k !== 'arte');
    if (!mudou.length) return;
    const corpo: Record<string, unknown> = {};
    for (const k of mudou)
      corpo[k] = k === 'albumPremios' ? String(valores[k] ?? '').split(',').filter(Boolean) : Number(valores[k]);
    setErro('');
    setSalvando(true);
    try {
      aoMudar((await api.clubeSalvarConfig(corpo)) as PainelDoClube);
      toast.success('Álbum salvo.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível salvar o álbum.';
      setErro(msg);
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Ajustes
        id="clube-album"
        titulo="Álbum de selos"
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
      {gaveta && (
        <GavetaPremiosDeEscolha
          painel={painel}
          titulo="Prêmio de quem completa o álbum"
          ajuda="O cliente escolhe um da lista quando completa o álbum; vira cupom para o próximo pedido."
          rotuloDoGrupo="Prêmios do álbum"
          valor={escolhidos}
          aoFechar={() => setGaveta(false)}
          aoEscolher={(ids) => {
            setValores((x) => ({ ...x, albumPremios: ids.join(',') }));
            setGaveta(false);
          }}
          aoIrParaPremios={() => {
            setGaveta(false);
            aoIrParaPremios();
          }}
        />
      )}
    </>
  );
}
