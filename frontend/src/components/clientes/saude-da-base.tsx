'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

// SAÚDE DA BASE (F4 do docs/plano-perfil-cliente.md; protótipo `mockups/regem-perfil-cliente.html`, aba 5): os números da
// loja, SOMADOS e sem pessoa — o resumo em frases, os itens da estreia que fazem voltar e os que levam a sumir, o que os
// clientes querem encontrar, as reclamações por motivo, as buscas sem resultado e os mais abertos no cardápio Regem, e
// quanto do perfil tem dado. Só clientes diretos (o servidor exclui iFood e 99). Cada bloco que o servidor não leu chega
// `null` e mostra o próprio aviso; o resto aparece.

const pct = (a: number, b: number) => (b > 0 ? Math.round((100 * a) / b) : 0);
const n = (v: number) => Number(v || 0).toLocaleString('pt-BR');

function Barra({ nome, valor, max, texto }: { nome: string; valor: number; max: number; texto: string }) {
  const largura = max > 0 ? Math.max(2, Math.round((100 * valor) / max)) : 0;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_minmax(3rem,6rem)_auto] items-center gap-2 py-0.5 text-sm">
      <span className="min-w-0 break-words">{nome}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${largura}%` }} />
      </span>
      <span className="text-right font-mono text-xs text-secondary-foreground">{texto}</span>
    </li>
  );
}

function Bloco({
  titulo,
  sub,
  dado,
  vazio,
  aoTentar,
  children,
  rodape,
}: {
  titulo: string;
  sub: string;
  dado: unknown;
  vazio: boolean;
  aoTentar: () => void;
  children: React.ReactNode;
  rodape?: React.ReactNode;
}) {
  return (
    <Card className="space-y-2 p-4">
      <div>
        <h2 className="font-display text-base font-semibold">{titulo}</h2>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </div>
      {dado === null ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-secondary-foreground">Não consegui ler este bloco agora.</span>
          <Button size="sm" variant="outline" onClick={aoTentar}>
            Tentar de novo
          </Button>
        </div>
      ) : vazio ? null : (
        <ul aria-label={titulo}>{children}</ul>
      )}
      {dado !== null && rodape}
    </Card>
  );
}

export function SaudeDaBase() {
  const [s, setS] = useState<any | null>(null);
  const [estado, setEstado] = useState<'carregando' | 'ok' | 'erro' | 'sem-acesso'>('carregando');
  const ler = useCallback(() => {
    setEstado('carregando');
    api
      .perfilClienteSaude()
      .then((r: any) => {
        setS(r);
        setEstado('ok');
      })
      .catch((e: any) => setEstado(e?.status === 403 ? 'sem-acesso' : 'erro'));
  }, []);
  useEffect(() => ler(), [ler]);

  if (estado === 'carregando' && !s) return <Card className="p-6 text-sm text-muted-foreground">Carregando a saúde da base…</Card>;
  if (estado === 'sem-acesso')
    return <Card className="p-6 text-sm">A Saúde da base é do presidente, com o módulo “Perfil do cliente” ligado.</Card>;
  if (estado === 'erro' && !s)
    return (
      <Card className="flex flex-wrap items-center gap-3 p-6 text-sm">
        <span>Não consegui ler a saúde da base.</span>
        <Button size="sm" variant="outline" onClick={ler}>
          Tentar de novo
        </Button>
      </Card>
    );

  const f = s?.frase;
  const it = s?.itens;
  const dado = s?.dado;
  const gostaria: any[] = s?.gostaria ?? [];
  const recl = s?.reclamacoes;
  const buscas: any[] = s?.buscas ?? [];
  const abertos: any[] = s?.abertos ?? [];
  const mediaVolta = it ? pct(it.voltaram, it.estreias) : 0;
  const respostas = gostaria.reduce((a, g) => a + Number(g.n || 0), 0);

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary-foreground">
        Clientes diretos (sem iFood e 99), somados e sem pessoa. O mês é o de hoje; os cliques do cardápio, os últimos 30 dias.
      </p>

      <Card className="space-y-2 p-4">
        <h2 className="font-display text-base font-semibold">Em uma frase</h2>
        {f === null ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-secondary-foreground">Não consegui ler o resumo agora.</span>
            <Button size="sm" variant="outline" onClick={ler}>
              Tentar de novo
            </Button>
          </div>
        ) : (
          <>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              <li>
                {f.semanaisSumidos > 0 ? (
                  <>
                    <b>
                      {n(f.semanaisSumidos)} {f.semanaisSumidos === 1 ? 'cliente que pedia' : 'clientes que pediam'} toda semana não{' '}
                      {f.semanaisSumidos === 1 ? 'pede' : 'pedem'} há {f.sumiuDias} dias ou mais.
                    </b>{' '}
                    {f.semanaisComReclamacao > 0
                      ? `${n(f.semanaisComReclamacao)} ${f.semanaisComReclamacao === 1 ? 'tem' : 'têm'} reclamação nos últimos 90 dias.`
                      : 'Nenhum deles tem reclamação nos últimos 90 dias.'}
                  </>
                ) : (
                  `Nenhum cliente que pedia toda semana está há ${f.sumiuDias} dias sem pedir.`
                )}
              </li>
              <li>
                {f.novos > 0 ? (
                  <>
                    Chegaram <b>{n(f.novos)} {f.novos === 1 ? 'cliente novo' : 'clientes novos'}</b> neste mês;{' '}
                    <b>{pct(f.novos2o, f.novos)}%</b> já {f.novos === 1 ? 'fez' : 'fizeram'} o 2º pedido
                    {f.novosAnt > 0 ? ` (no mesmo ponto do mês passado: ${pct(f.novos2oAnt, f.novosAnt)}%).` : '.'}
                  </>
                ) : (
                  'Nenhum cliente novo neste mês até agora.'
                )}
              </li>
              <li>
                {f.voltaram > 0 ? (
                  <>
                    <b>
                      {n(f.voltaram)} {f.voltaram === 1 ? 'cliente voltou' : 'clientes voltaram'}
                    </b>{' '}
                    neste mês depois de 60 dias ou mais sem pedir.
                  </>
                ) : (
                  'Nenhum cliente voltou neste mês depois de 60 dias ou mais sem pedir.'
                )}
              </li>
            </ul>
            <Link
              href="/clientes?seg=perfil_atrasado"
              className="inline-flex h-9 items-center rounded-md border border-input bg-card px-3 text-sm font-semibold hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Ver os atrasados no próprio ritmo
            </Link>
          </>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Bloco
          titulo="Itens que fazem voltar"
          sub="Quem estreou com o item e fez o 2º pedido em até 30 dias"
          dado={it}
          vazio={!it?.voltam?.length}
          aoTentar={ler}
          rodape={
            <p className="text-xs text-muted-foreground">
              {it?.voltam?.length
                ? `Média da loja: ${mediaVolta}%. Só itens com ${it.minimo} estreias ou mais, de 30 a 210 dias atrás.`
                : `Ainda não há itens com ${it?.minimo ?? 30} estreias ou mais (estreias de 30 a 210 dias atrás).`}
            </p>
          }
        >
          {(it?.voltam ?? []).map((x: any) => (
            <Barra key={`v-${x.nome}`} nome={x.nome} valor={pct(x.voltaram, x.estreias)} max={100} texto={`${pct(x.voltaram, x.estreias)}%`} />
          ))}
        </Bloco>

        <Bloco
          titulo="Itens que levam a sumir"
          sub="Mesmo cálculo, os mais baixos"
          dado={it}
          vazio={!it?.somem?.length}
          aoTentar={ler}
          rodape={
            !it?.somem?.length ? (
              <p className="text-xs text-muted-foreground">Aparece quando houver mais de 3 itens com {it?.minimo ?? 30} estreias ou mais.</p>
            ) : undefined
          }
        >
          {(it?.somem ?? []).map((x: any) => (
            <Barra key={`s-${x.nome}`} nome={x.nome} valor={pct(x.voltaram, x.estreias)} max={100} texto={`${pct(x.voltaram, x.estreias)}%`} />
          ))}
        </Bloco>

        <Bloco
          titulo="O que os clientes querem encontrar"
          sub={`Respostas a “o que você gostaria de encontrar aqui?” · ${n(respostas)} ${respostas === 1 ? 'resposta' : 'respostas'} · soma, sem pessoa`}
          dado={s?.gostaria}
          vazio={!gostaria.length}
          aoTentar={ler}
          rodape={!gostaria.length ? <p className="text-xs text-muted-foreground">Ninguém respondeu ainda. A pergunta aparece no Perfil do cardápio.</p> : undefined}
        >
          {gostaria.map((g: any) => (
            <Barra key={`g-${g.opcao}`} nome={g.opcao} valor={g.n} max={gostaria[0]?.n ?? 1} texto={n(g.n)} />
          ))}
        </Bloco>

        <Bloco
          titulo="Reclamações por motivo"
          sub="Do perfil de cada cliente · avaliações e casos do Atendimento"
          dado={recl}
          vazio={!recl?.porMotivo?.length}
          aoTentar={ler}
          rodape={
            <p className="text-xs text-muted-foreground">
              {!recl?.porMotivo?.length
                ? 'Nenhuma reclamação no perfil dos clientes.'
                : recl.repetidos > 0
                  ? `${n(recl.repetidos)} ${recl.repetidos === 1 ? 'cliente reclamou' : 'clientes reclamaram'} 2 vezes ou mais do mesmo motivo.`
                  : 'Nenhum cliente reclamou 2 vezes do mesmo motivo.'}
            </p>
          }
        >
          {(recl?.porMotivo ?? []).map((r: any) => (
            <Barra key={`r-${r.nome}`} nome={r.nome} valor={r.vezes} max={recl.porMotivo[0]?.vezes ?? 1} texto={n(r.vezes)} />
          ))}
        </Bloco>

        <Bloco
          titulo="Buscas sem resultado"
          sub="No cardápio Regem, últimos 30 dias · visitas que buscaram"
          dado={s?.buscas}
          vazio={!buscas.length}
          aoTentar={ler}
          rodape={!buscas.length ? <p className="text-xs text-muted-foreground">Nenhuma busca sem resultado nos últimos 30 dias.</p> : undefined}
        >
          {buscas.map((b: any) => (
            <Barra key={`b-${b.termo}`} nome={b.termo} valor={b.pessoas} max={buscas[0]?.pessoas ?? 1} texto={n(b.pessoas)} />
          ))}
        </Bloco>

        <Bloco
          titulo="Mais abertos no cardápio"
          sub="Últimos 30 dias · visitas que abriram e quantas puseram no carrinho"
          dado={s?.abertos}
          vazio={!abertos.length}
          aoTentar={ler}
          rodape={
            <p className="text-xs text-muted-foreground">
              {abertos.length
                ? 'Muito aberto e pouco no carrinho: vale olhar a foto, a descrição e o preço.'
                : 'Ainda sem cliques no cardápio Regem nos últimos 30 dias.'}
            </p>
          }
        >
          {abertos.map((a: any) => (
            <Barra
              key={`a-${a.produto_id}`}
              nome={a.nome}
              valor={a.abriram}
              max={abertos[0]?.abriram ?? 1}
              texto={`${n(a.abriram)} · ${pct(a.carrinho, a.abriram)}% no carrinho`}
            />
          ))}
        </Bloco>

        <Bloco
          titulo="Perfil com dado suficiente"
          sub={dado ? `Clientes ativos (pediram nos últimos 90 dias): ${n(dado.ativos)} · em cada camada` : 'Clientes ativos, em cada camada'}
          dado={dado}
          vazio={!dado?.ativos}
          aoTentar={ler}
          rodape={
            <p className="text-xs text-muted-foreground">
              {!dado?.ativos
                ? 'Ainda sem clientes ativos com perfil. A rotina calcula toda manhã.'
                : `“O que olha” cresce quando mais clientes pedem pelo cardápio Regem e ligam as recomendações. ${n(dado.visitasComCliques30d)} ${dado.visitasComCliques30d === 1 ? 'visita' : 'visitas'} com cliques nos últimos 30 dias.`}
            </p>
          }
        >
          {dado?.ativos
            ? [
                ['O que pede', dado.pede],
                ['Quando pede', dado.quando],
                ['O que move', dado.move],
                ['O que olha', dado.olha],
              ].map(([nome, v]) => (
                <Barra key={`d-${nome}`} nome={String(nome)} valor={pct(Number(v), dado.ativos)} max={100} texto={`${pct(Number(v), dado.ativos)}%`} />
              ))
            : null}
        </Bloco>
      </div>
    </div>
  );
}
