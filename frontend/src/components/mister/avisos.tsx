'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Ajustes, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chave } from '@/components/ui/chave';
import { Selo, texto2 } from '@/components/ui/lista';
import { SkeletonList } from '@/components/ui/skeleton';
import { Gaveta } from '@/components/ui/sobreposto';

// MISTER › AVISOS E RELATÓRIOS — "para onde vai" cada aviso (versão 2 do protótipo `mockups/regem-mister.html`, aprovada
// em 14/11/2026). Cada aviso vai para quem resolve; o padrão é a tabela que o dono aprovou e cada empresa muda em "Mudar".
// Só o presidente (rotas `mister/avisos`). A tela segue o modelo das telas de ajuste do Regem: grupos contados, "buscar
// ajuste" e UMA barra de "Salvar alterações" — o "Mudar" abre a gaveta e "Aplicar" leva a escolha para a barra.

type Destino = 'presidente' | 'gerente' | 'tela' | 'kds' | 'atendimento' | 'dms';
type Regra = { ligado: boolean; destinos: Destino[]; escalaMin: number | null; escalaPara: Destino[]; parametro: number | null };
type AvisoNaTela = { tipo: string; grupo: string; titulo: string; descricao: string; jaFunciona: boolean; regra: Regra; padrao: boolean };
type DaTela = { avisos: AvisoNaTela[]; destinos: { id: Destino; nome: string }[] };

const ORDEM: Destino[] = ['presidente', 'gerente', 'tela', 'kds', 'atendimento', 'dms'];
const TEMPOS_DA_ESCALA = [5, 15, 30, 120];
const nomeDoTempo = (m: number) => (m >= 60 ? `${m / 60} ${m === 60 ? 'hora' : 'horas'}` : `${m} min`);

/** A regra como valor da tela: texto com as chaves sempre na mesma ordem (é o que decide "mudou ou não"). */
const paraValor = (r: Regra): string =>
  JSON.stringify({
    ligado: r.ligado,
    destinos: ORDEM.filter((d) => r.destinos.includes(d)),
    escalaMin: r.escalaMin,
    escalaPara: ORDEM.filter((d) => r.escalaPara.includes(d)),
    parametro: r.parametro,
  });
const deValor = (v: Valor | undefined): Regra => {
  try {
    const r = JSON.parse(String(v ?? ''));
    return { ligado: !!r.ligado, destinos: r.destinos ?? [], escalaMin: r.escalaMin ?? null, escalaPara: r.escalaPara ?? [], parametro: r.parametro ?? null };
  } catch {
    return { ligado: false, destinos: [], escalaMin: null, escalaPara: [], parametro: null };
  }
};

function GavetaDoDestino({
  aviso,
  regra,
  nomes,
  aoAplicar,
  aoFechar,
}: {
  aviso: AvisoNaTela;
  regra: Regra;
  nomes: Record<Destino, string>;
  aoAplicar: (r: Regra) => void;
  aoFechar: () => void;
}) {
  const [destinos, setDestinos] = useState<Destino[]>(regra.destinos);
  const [escalaMin, setEscalaMin] = useState<number | null>(regra.escalaMin);
  const [escalaPara, setEscalaPara] = useState<Destino[]>(regra.escalaPara);
  const virar = (l: Destino[], d: Destino) => (l.includes(d) ? l.filter((x) => x !== d) : [...l, d]);
  const semDestino = regra.ligado && destinos.length === 0;
  const semQuem = escalaMin !== null && escalaPara.length === 0;
  return (
    <Gaveta
      titulo={`Para onde vai: ${aviso.titulo}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={semDestino || semQuem}
            onClick={() => aoAplicar({ ...regra, destinos, escalaMin, escalaPara: escalaMin === null ? [] : escalaPara })}
          >
            Aplicar
          </Button>
        </>
      }
    >
      <p className={`text-sm ${texto2}`}>Escolha quem fica sabendo deste aviso. O que você escolher aqui vale para todas as lojas da empresa.</p>
      <fieldset className="mt-4 space-y-1 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-bold">Na hora</legend>
        {ORDEM.map((d) => (
          <label key={d} className="flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={destinos.includes(d)} onChange={() => setDestinos((l) => virar(l, d))} />
            {nomes[d]}
          </label>
        ))}
        {semDestino && (
          <p role="alert" className="text-sm font-medium text-destructive">
            Escolha pelo menos um destino, ou desligue o aviso.
          </p>
        )}
      </fieldset>
      <fieldset className="mt-3 space-y-2 rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-bold">Se ninguém resolver</legend>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          Depois de
          <select
            className="min-h-10 max-w-full rounded-md border border-input bg-background px-2"
            value={escalaMin ?? ''}
            onChange={(e) => setEscalaMin(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">não avisar mais ninguém</option>
            {TEMPOS_DA_ESCALA.map((m) => (
              <option key={m} value={m}>
                {nomeDoTempo(m)}
              </option>
            ))}
          </select>
        </label>
        {escalaMin !== null && (
          <div className="space-y-1">
            <p className={`text-sm ${texto2}`}>avisar também:</p>
            {(['gerente', 'presidente'] as Destino[]).map((d) => (
              <label key={d} className="flex min-h-10 items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={escalaPara.includes(d)} onChange={() => setEscalaPara((l) => virar(l, d))} />
                {nomes[d]}
              </label>
            ))}
            {semQuem && (
              <p role="alert" className="text-sm font-medium text-destructive">
                Escolha quem fica sabendo se ninguém resolver.
              </p>
            )}
          </div>
        )}
      </fieldset>
      <p className={`mt-3 text-xs ${texto2}`}>
        Pelo WhatsApp, o aviso chega a quem ligou o próprio número em Pessoas e não respondeu PARAR AVISOS. Sem gerente ligado na loja, o aviso do gerente vai ao
        presidente.
      </p>
    </Gaveta>
  );
}

export function AvisosDoMister() {
  const [dados, setDados] = useState<DaTela | null>(null);
  const [erroLeitura, setErroLeitura] = useState(false);
  const [salvos, setSalvos] = useState<Valores>({});
  const [valores, setValores] = useState<Valores>({});
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [mudando, setMudando] = useState<AvisoNaTela | null>(null);

  const aplicar = useCallback((d: DaTela) => {
    const v: Valores = {};
    for (const a of d.avisos) v[a.tipo] = paraValor(a.regra);
    setDados(d);
    setSalvos(v);
    setValores(v);
  }, []);

  const ler = useCallback(async () => {
    setErroLeitura(false);
    try {
      aplicar((await api.get('/mister/avisos')) as DaTela);
    } catch {
      setErroLeitura(true);
    }
  }, [aplicar]);

  useEffect(() => {
    void ler();
  }, [ler]);

  const nomes = useMemo(() => Object.fromEntries((dados?.destinos ?? []).map((d) => [d.id, d.nome])) as Record<Destino, string>, [dados]);

  const grupos: GrupoDeAjustes[] = useMemo(() => {
    if (!dados) return [];
    const porGrupo = new Map<string, AvisoNaTela[]>();
    for (const a of dados.avisos) porGrupo.set(a.grupo, [...(porGrupo.get(a.grupo) ?? []), a]);
    return [...porGrupo.entries()].map(([titulo, avisos]) => ({
      titulo,
      itens: avisos.map((a) => {
        const r = deValor(valores[a.tipo]);
        return {
          id: a.tipo,
          rotulo: a.titulo,
          tipo: 'livre' as const,
          palavras: `${a.descricao} ${r.destinos.map((d) => nomes[d]).join(' ')}`,
          ajuda: (
            <>
              <span className="block">{a.descricao}</span>
              {!a.jaFunciona && (
                <span className="mt-1 block">
                  <Selo tom="info">chega numa próxima entrega</Selo> <span className="text-xs">O que você escolher já fica guardado.</span>
                </span>
              )}
              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="text-xs">Vai para:</span>
                {r.destinos.length ? (
                  r.destinos.map((d) => <Selo key={d}>{nomes[d] ?? d}</Selo>)
                ) : (
                  <Selo tom="aviso">nenhum destino</Selo>
                )}
                {r.escalaMin !== null && r.escalaPara.length > 0 && (
                  <span className="text-xs">
                    · sem resolver em {nomeDoTempo(r.escalaMin)}: {r.escalaPara.map((d) => nomes[d] ?? d).join(', ')}
                  </span>
                )}
                <Button type="button" size="sm" variant="outline" className="min-h-9" onClick={() => setMudando(a)} aria-label={`Mudar para onde vai: ${a.titulo}`}>
                  Mudar
                </Button>
              </span>
            </>
          ),
          desenhar: (v: Valor, mudar: (x: Valor) => void) => {
            const atual = deValor(v);
            return (
              <span className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
                {a.tipo === 'pedido_parado' && (
                  <label className="flex items-center gap-1 text-sm">
                    <span className="sr-only">Tempo do pedido parado</span>
                    <select
                      className="min-h-10 rounded-md border border-input bg-background px-2"
                      value={atual.parametro ?? 20}
                      onChange={(e) => mudar(paraValor({ ...atual, parametro: Number(e.target.value) }))}
                    >
                      {[15, 20, 30].map((m) => (
                        <option key={m} value={m}>
                          {m} min
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <Chave ligada={atual.ligado} rotulo={`Aviso ${a.titulo}`} aoMudar={(l) => mudar(paraValor({ ...atual, ligado: l }))} />
              </span>
            );
          },
        };
      }),
    }));
  }, [dados, valores, nomes]);

  const salvar = async () => {
    if (!dados) return;
    setSalvando(true);
    setErro('');
    try {
      const regras = dados.avisos.filter((a) => valores[a.tipo] !== salvos[a.tipo]).map((a) => ({ tipo: a.tipo, ...deValor(valores[a.tipo]) }));
      aplicar((await api.patch('/mister/avisos', { regras })) as DaTela);
      toast.success('Avisos do Mister salvos.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para salvar.');
    } finally {
      setSalvando(false);
    }
  };

  if (erroLeitura)
    return (
      <Card className="p-8 text-center">
        <p className="font-display text-lg font-semibold">Não consegui ler os avisos agora</p>
        <button type="button" className="mt-2 inline-flex min-h-11 items-center font-semibold underline" onClick={() => void ler()}>
          Tentar de novo
        </button>
      </Card>
    );
  if (!dados) return <SkeletonList rows={4} />;

  return (
    <div className="space-y-4">
      <Ajustes
        id="mister-avisos"
        titulo="Avisos"
        grupos={grupos}
        valores={valores}
        salvos={salvos}
        aoMudar={(k: string, v: Valor) => setValores((x) => ({ ...x, [k]: v }))}
        aoSalvar={() => void salvar()}
        aoDescartar={() => {
          setValores(salvos);
          setErro('');
        }}
        salvando={salvando}
        erro={erro}
        antes={
          <p className={`text-sm ${texto2}`}>
            Cada aviso vai para quem resolve: o que a equipe resolve aparece na tela da loja e no KDS; o que pede o gestor vai pelo WhatsApp do Mister; o técnico vai
            ao suporte da DMS. Os destinos abaixo são o ponto de partida e mudam em &quot;Mudar&quot;.
          </p>
        }
      />
      <Card className="p-4">
        <p className="font-display font-semibold">Relatórios</p>
        <p className={`text-sm ${texto2}`}>O resumo do dia e o resumo da semana, no horário que você escolher, chegam numa próxima entrega.</p>
      </Card>
      {mudando && (
        <GavetaDoDestino
          aviso={mudando}
          regra={deValor(valores[mudando.tipo])}
          nomes={nomes}
          aoFechar={() => setMudando(null)}
          aoAplicar={(r) => {
            setValores((x) => ({ ...x, [mudando.tipo]: paraValor(r) }));
            setMudando(null);
          }}
        />
      )}
    </div>
  );
}
