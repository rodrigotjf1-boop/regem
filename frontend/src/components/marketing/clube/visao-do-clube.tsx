'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Ajustes, alterados, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { brl, Selo } from '@/components/ui/lista';
import { Dialogo } from '@/components/ui/sobreposto';
import type { Ferramenta, PainelDoClube } from './tipos';

// Marketing › Clube › Visão geral (protótipo `mockups/regem-clube-banner.html`): cada ferramenta liga e desliga sozinha
// (todas nascem desligadas; só o presidente liga) e as regras que valem para as três. No modelo de ajustes (grupos
// contados, busca, a barra de "N alterações ainda não salvas"). A ferramenta que ainda não existe nesta versão não mostra
// a chave — diz que chega numa próxima entrega (o servidor também recusa ligá-la).
const FERRAMENTAS: { f: Ferramenta; chave: 'surpresaAtivo' | 'albumAtivo' | 'metaAtivo'; nome: string; ajuda: string }[] = [
  { f: 'surpresa', chave: 'surpresaAtivo', nome: 'Prêmio surpresa', ajuda: 'Raspadinha ou roleta: o cliente revela um prêmio que já ganhou (na entrega, por uma reclamação, pela classificação do marketing ou numa campanha).' },
  { f: 'album', chave: 'albumAtivo', nome: 'Álbum de selos', ajuda: 'Um selo por mês com pedido; juntou os selos, o cliente escolhe um prêmio.' },
  { f: 'meta', chave: 'metaAtivo', nome: 'Meta do mês', ajuda: 'Tantos pedidos no mês dão direito a escolher um prêmio; mais pedidos, prêmio maior.' },
];

function valoresDe(p: PainelDoClube): Valores {
  return {
    surpresaAtivo: p.config.surpresaAtivo,
    albumAtivo: p.config.albumAtivo,
    metaAtivo: p.config.metaAtivo,
    minimo: String(p.config.minimo),
  };
}

export function VisaoDoClube({ painel, podeMudar, aoMudar }: { painel: PainelDoClube; podeMudar: boolean; aoMudar: (p: PainelDoClube) => void }) {
  const salvos = useMemo(() => valoresDe(painel), [painel]);
  const [valores, setValores] = useState<Valores>(salvos);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [verRegras, setVerRegras] = useState(false);
  useEffect(() => setValores(salvos), [salvos]);

  const grupos: GrupoDeAjustes[] = [
    {
      titulo: 'Ferramentas',
      nota: 'Desligar para de dar direitos novos na hora; o que o cliente já ganhou vale até a validade. Nenhuma usa sorteio: todo mundo que cumpre a regra recebe.',
      itens: FERRAMENTAS.map(({ f, chave, nome, ajuda }) =>
        podeMudar && painel.prontas[f]
          ? { id: chave, rotulo: nome, tipo: 'chave' as const, ajuda, palavras: `${nome} ligar desligar` }
          : {
              id: chave,
              rotulo: nome,
              tipo: 'livre' as const,
              ajuda,
              palavras: nome,
              desenhar: () =>
                painel.prontas[f] ? (
                  <Selo tom={painel.config[chave] ? 'ok' : 'neutro'}>{painel.config[chave] ? 'Ligado' : 'Desligado'}</Selo>
                ) : (
                  <Selo>Chega numa próxima entrega</Selo>
                ),
            },
      ),
    },
    {
      titulo: 'Regras que valem para as três',
      nota: 'Convivem com o Plano de fidelidade e o cashback.',
      itens: [
        {
          id: 'pedidos',
          rotulo: 'Que pedidos contam',
          tipo: 'livre',
          ajuda: 'Só os do cardápio online e do atendente no WhatsApp: o iFood e a 99 não aceitam o cupom do Regem.',
          palavras: 'pedidos contam canais cardápio whatsapp ifood 99',
          desenhar: () => <Selo>Cardápio e WhatsApp</Selo>,
        },
        podeMudar
          ? {
              id: 'minimo',
              rotulo: 'Pedido mínimo para contar',
              tipo: 'numero' as const,
              sufixo: 'R$',
              ajuda: `Pedidos abaixo disso não dão selo, não contam na meta e não dão raspadinha. De R$ 0 a R$ ${painel.opcoes.minimoMax}.`,
              palavras: 'pedido mínimo valor contar',
            }
          : {
              id: 'minimo',
              rotulo: 'Pedido mínimo para contar',
              tipo: 'livre' as const,
              ajuda: 'Pedidos abaixo disso não dão selo, não contam na meta e não dão raspadinha.',
              palavras: 'pedido mínimo valor contar',
              desenhar: () => <span className="font-mono text-sm">{brl(painel.config.minimo)}</span>,
            },
        {
          id: 'umPorPedido',
          rotulo: 'Um benefício por pedido',
          tipo: 'livre',
          ajuda: 'O cupom do prêmio não junta com outro cupom. O cashback continua.',
          palavras: 'benefício cupom junta cashback',
          desenhar: () => <Selo>Sempre</Selo>,
        },
        {
          id: 'regras',
          rotulo: 'Regras do clube',
          tipo: 'livre',
          ajuda: 'A página com as regras de cada ferramenta ligada, montada sozinha. O link aparece em cada tela do jogo.',
          palavras: 'regras clube página sorteio',
          desenhar: () => (
            <Button type="button" variant="outline" size="sm" onClick={() => setVerRegras(true)}>
              Ver as regras
            </Button>
          ),
        },
      ],
    },
  ];

  async function salvar() {
    const mudou = alterados(grupos, valores, salvos);
    if (!mudou.length) return;
    const corpo: Record<string, unknown> = {};
    for (const k of mudou) corpo[k] = k === 'minimo' ? (String(valores[k] ?? '').trim() === '' ? NaN : Number(String(valores[k]).replace(',', '.'))) : valores[k] === true;
    setErro('');
    setSalvando(true);
    try {
      aoMudar((await api.clubeSalvarConfig(corpo)) as PainelDoClube);
      toast.success('Clube salvo.');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível salvar o clube.';
      setErro(msg);
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <>
      <Ajustes
        id="clube-visao"
        titulo="Visão geral"
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
      {verRegras && (
        <Dialogo titulo="Regras do clube" aoFechar={() => setVerRegras(false)} rodape={<Button type="button" onClick={() => setVerRegras(false)}>Entendi</Button>}>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {painel.regras.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Dialogo>
      )}
    </>
  );
}
