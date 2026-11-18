'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { Button, buttonVariants } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { ListaDados, NomeComApoio, hojeIso, texto2 } from '@/components/ui/lista';
import { Colunas, type Ponto } from '@/components/relatorios/graficos';
import { NumerosDoGasto } from './numeros-do-gasto';
import { GastoPorTipo } from './gasto-por-tipo';
import { AlertasDoGasto } from './alertas-do-gasto';
import { type GastoOficial, type Grupo, type ResumoDoGasto, type TipoDePeriodo, PAPEL, TIPO, diaCurto, dinheiro, horaDaLeitura, inteiro, nomeDoMes } from './tipos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// WHATSAPP › USO E GASTO (G1 do protótipo `mockups/regem-whatsapp-gasto.html`, aprovado pelo dono em 18/11/2026; mig 445).
// O que a Meta cobra das mensagens da empresa pela API oficial, do que a nuvem guardou (ela lê a Meta a cada 30 minutos):
// o período e o número, os números grandes, por tipo, por dia, de onde veio e os meses anteriores. Só o presidente — a
// página decide se a tela aparece; o servidor é quem barra de verdade.

const PERIODOS: { v: TipoDePeriodo; rotulo: string }[] = [
  { v: 'mes', rotulo: 'Este mês' },
  { v: 'passado', rotulo: 'Mês passado' },
  { v: 'tres', rotulo: 'Últimos 3 meses' },
  { v: 'outro', rotulo: 'Outro período' },
];

export function GastoDoWhatsapp() {
  const idDe = useId();
  const idAte = useId();
  const idNumero = useId();
  const [periodo, setPeriodo] = useState<TipoDePeriodo>('mes');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [numero, setNumero] = useState('');
  const [dados, setDados] = useState<ResumoDoGasto | null>(null);
  const [lendo, setLendo] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [relendo, setRelendo] = useState(false);
  // O Mister ligado? (G2: os alertas de gasto vão por ele.) null = não deu para saber — o cartão não afirma nada.
  const [misterLigado, setMisterLigado] = useState<boolean | null>(null);
  useEffect(() => {
    api
      .get('/modulos/meus')
      .then((m) => setMisterLigado((m as Record<string, boolean>)?.mister === true))
      .catch(() => setMisterLigado(null));
  }, []);
  // Só a resposta do pedido mais novo vale (V64): trocar o período rápido não deixa a resposta velha por cima.
  const pedido = useRef(0);
  const invertido = periodo === 'outro' && !!de && !!ate && de > ate;

  const consulta = useCallback((): Record<string, string> | null => {
    const q: Record<string, string> = { periodo };
    if (periodo === 'outro') {
      if (!de || !ate || de > ate) return null;
      q.de = de;
      q.ate = ate;
    }
    if (numero) q.numero = numero;
    return q;
  }, [periodo, de, ate, numero]);

  const ler = useCallback(async () => {
    const q = consulta();
    if (!q) return;
    const meu = ++pedido.current;
    setLendo(true);
    setErro(null);
    try {
      const r = (await api.whatsappGasto(q)) as ResumoDoGasto;
      if (meu === pedido.current) setDados(r);
    } catch (e: any) {
      if (meu === pedido.current) setErro(e?.message || 'Não consegui ler o gasto agora.');
    } finally {
      if (meu === pedido.current) setLendo(false);
    }
  }, [consulta]);

  useEffect(() => {
    void ler();
  }, [ler]);

  async function lerAgora() {
    const q = consulta();
    if (!q || relendo) return;
    setRelendo(true);
    try {
      const r = (await api.whatsappGastoLer(q)) as ResumoDoGasto;
      pedido.current++;
      setDados(r);
      setErro(null);
      setLendo(false);
      toast.success('Gasto lido de novo na Meta.');
    } catch (e: any) {
      toast.error(e?.message || 'Não consegui ler o gasto na Meta agora.');
    } finally {
      setRelendo(false);
    }
  }

  function escolherPeriodo(v: TipoDePeriodo) {
    setPeriodo(v);
    if (v === 'outro' && !de) {
      const h = hojeIso();
      setDe(`${h.slice(0, 8)}01`);
      setAte(h);
    }
  }

  if (dados && !dados.oficial) {
    return (
      <EmptyState
        icon="📱"
        title="Esta loja usa a conexão por QR Code."
        description="Pela conexão por QR Code a Meta não cobra por mensagem, então não há gasto para acompanhar. O controle de gasto vale para quem usa a API oficial."
        action={
          <Link href="/delivery/configuracoes?aba=robo" className={buttonVariants({ variant: 'outline' })}>
            Ver como o WhatsApp está ligado
          </Link>
        }
      />
    );
  }

  const numeros = dados?.oficial ? dados.numeros : [];
  return (
    <div className="space-y-4">
      <p className={cn('max-w-3xl text-sm', texto2)}>
        O que a Meta cobra das mensagens da loja pela API oficial. A Meta cobra a empresa direto, no cartão cadastrado no Gerenciador de Negócios dela; o
        Regem lê o gasto a cada 30 minutos e mostra aqui.
      </p>

      <div className="flex flex-wrap items-end gap-3" role="group" aria-label="Período e número">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <Button key={p.v} type="button" variant={periodo === p.v ? 'default' : 'outline'} aria-pressed={periodo === p.v} onClick={() => escolherPeriodo(p.v)}>
              {p.rotulo}
            </Button>
          ))}
        </div>
        {periodo === 'outro' && (
          <>
            <div className="grid w-full max-w-[11rem] gap-1.5">
              <Label htmlFor={idDe}>De</Label>
              <Input id={idDe} type="date" value={de} max={ate || undefined} onChange={(e) => setDe(e.target.value)} />
            </div>
            <div className="grid w-full max-w-[11rem] gap-1.5">
              <Label htmlFor={idAte}>Até</Label>
              <Input id={idAte} type="date" value={ate} min={de || undefined} onChange={(e) => setAte(e.target.value)} />
            </div>
          </>
        )}
        {numeros.length > 1 && (
          <div className="grid w-full max-w-[15rem] gap-1.5">
            <Label htmlFor={idNumero}>Número</Label>
            <Select id={idNumero} value={numero} onChange={(e) => setNumero(e.target.value)}>
              <option value="">Os {numeros.length === 2 ? 'dois' : numeros.length} números</option>
              {numeros.map((n) => (
                <option key={n.numero} value={n.numero}>
                  {PAPEL[n.papel] ?? n.papel} · final {n.final}
                </option>
              ))}
            </Select>
          </div>
        )}
      </div>
      {invertido && (
        <p role="alert" className="text-sm text-destructive">
          A data inicial vem depois da final.
        </p>
      )}

      {lendo && !invertido && <SkeletonList rows={4} />}
      {!lendo && erro && (
        <EmptyState
          icon="⚠️"
          title="Não consegui ler o gasto agora."
          description={erro}
          action={
            <Button type="button" variant="outline" onClick={() => void ler()}>
              Tentar de novo
            </Button>
          }
        />
      )}
      {!lendo && !erro && dados?.oficial && <Conteudo g={dados} relendo={relendo} lerAgora={lerAgora} misterLigado={misterLigado} />}
    </div>
  );
}

function Conteudo({ g, relendo, lerAgora, misterLigado }: { g: GastoOficial; relendo: boolean; lerAgora: () => void; misterLigado: boolean | null }) {
  const moeda = g.leitura.moeda;
  if (!g.leitura.algumaLida) {
    return (
      <EmptyState
        icon="⏳"
        title={g.leitura.erro ? 'A primeira leitura do gasto não deu certo.' : 'A primeira leitura do gasto chega em até 30 minutos.'}
        description={
          g.leitura.erro
            ? `${g.leitura.erro.motivo} O Regem tenta de novo sozinho a cada 30 minutos.`
            : 'O Regem pergunta à Meta o gasto da conta a cada 30 minutos. Os meses anteriores (até 12) entram na mesma leitura.'
        }
        action={
          <Button type="button" variant="outline" disabled={relendo} onClick={lerAgora}>
            {relendo ? 'Lendo na Meta…' : 'Ler agora'}
          </Button>
        }
      />
    );
  }
  const semGasto = g.total.mensagens === 0;
  return (
    <div className="space-y-4">
      {g.leitura.erro ? (
        <div role="status" className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          <p>
            <strong>A Meta não respondeu na última leitura ({horaDaLeitura(g.leitura.tentouEm)})</strong>
            {g.leitura.erro.conta ? ` — a conta do número ${PAPEL[g.leitura.erro.conta.papel]?.toLowerCase() ?? ''} final ${g.leitura.erro.conta.final}` : ''}.{' '}
            {g.leitura.lidoEm ? `Os números abaixo são da leitura de ${horaDaLeitura(g.leitura.lidoEm)}. ` : ''}O Regem tenta de novo sozinho em até 30 minutos.
          </p>
          <p className={cn('mt-1 break-words text-xs', texto2)}>{g.leitura.erro.motivo}</p>
          <Button type="button" variant="outline" className="mt-2" disabled={relendo} onClick={lerAgora}>
            {relendo ? 'Lendo na Meta…' : 'Tentar de novo'}
          </Button>
        </div>
      ) : (
        <p className={cn('text-sm', texto2)} data-fonte-do-custo={g.leitura.fonteDoCusto ?? ''}>
          {g.leitura.fonteDoCusto === 'tabela' ? (
            <>
              <strong className="text-foreground">Valores estimados:</strong> esta conta é cobrada por meio de um parceiro, e a Meta não mostra o custo dela. A
              quantidade de mensagens é a que a Meta informa; o valor é estimado pelo preço publicado da Meta (marketing ~R$ 0,32, utilidade e atendimento ~R$ 0,035
              por mensagem cobrada). A fatura é a do parceiro. Última leitura {horaDaLeitura(g.leitura.lidoEm)} · lê de novo a cada {g.leitura.minutos} minutos.
            </>
          ) : (
            <>
              Valores aproximados que a Meta informa · última leitura {horaDaLeitura(g.leitura.lidoEm)} · lê de novo a cada {g.leitura.minutos} minutos. A fatura
              oficial é a da Meta.
            </>
          )}
        </p>
      )}

      <NumerosDoGasto g={g} />

      {semGasto ? (
        <EmptyState icon="📭" title="Nenhuma mensagem entregue neste período." description="Quando a loja mandar mensagens pela API oficial, o gasto aparece aqui." />
      ) : (
        <>
          <GastoPorTipo g={g} />
          <GastoNoTempo g={g} />
          <section className="space-y-2" aria-labelledby="gasto-de-onde">
            <h2 id="gasto-de-onde" className="font-display text-lg font-bold">
              De onde veio
            </h2>
            {g.deOndeVeio.length ? (
              <ListaDados
                legenda="O gasto do período por campanha, aviso do pedido e atendimento"
                linhas={g.deOndeVeio}
                chave={(r) => `${r.grupo}|${r.nome}`}
                nome={(r) => r.nome}
                colunas={[
                  { titulo: 'O que mandou', celula: (r) => <NomeComApoio nome={r.nome} apoio={r.apoio} /> },
                  { titulo: 'Tipo', celula: (r) => TIPO[r.grupo as Grupo]?.nome ?? r.grupo },
                  { titulo: 'Mensagens', celula: (r) => <span className="font-mono">{inteiro(r.mensagens)}</span>, classe: 'text-right' },
                  { titulo: 'Gasto', celula: (r) => <span className="font-mono">{dinheiro(r.custo, moeda)}</span>, classe: 'text-right' },
                ]}
              />
            ) : (
              <p className={cn('text-sm', texto2)}>O gasto por modelo chega numa das próximas leituras (a Meta o informa de 3 em 3 horas).</p>
            )}
          </section>
        </>
      )}

      {g.alertas && <AlertasDoGasto a={g.alertas} misterLigado={misterLigado} moeda={moeda} />}

      <section className="space-y-2" aria-labelledby="gasto-meses">
        <h2 id="gasto-meses" className="font-display text-lg font-bold">
          Meses anteriores
        </h2>
        {g.meses.length ? (
          <ListaDados
            legenda="O gasto dos meses anteriores"
            linhas={g.meses}
            chave={(m) => m.mes}
            nome={(m) => nomeDoMes(m.mes)}
            colunas={[
              { titulo: 'Mês', celula: (m) => <strong>{nomeDoMes(m.mes)}</strong> },
              { titulo: 'Mensagens cobradas', celula: (m) => <span className="font-mono">{inteiro(m.cobradas)}</span>, classe: 'text-right' },
              { titulo: 'Gasto', celula: (m) => <span className="font-mono">{dinheiro(m.custo, moeda)}</span>, classe: 'text-right' },
            ]}
          />
        ) : (
          <p className={cn('text-sm', texto2)}>Nenhum mês anterior com gasto.</p>
        )}
        <p className={cn('text-xs', texto2)}>A Meta guarda até 12 meses.</p>
      </section>
    </div>
  );
}

/** Por dia (até dois meses) ou por mês (período maior), com o número escrito e "Ver em tabela". */
function GastoNoTempo({ g }: { g: GastoOficial }) {
  const porMes = g.dias.length > 62;
  let pontos: Ponto[];
  if (porMes) {
    const m = new Map<string, number>();
    for (const d of g.dias) m.set(d.dia.slice(0, 7), (m.get(d.dia.slice(0, 7)) ?? 0) + d.custo);
    pontos = [...m.entries()].map(([mes, custo]) => ({ rotulo: nomeDoMes(mes).replace(/ de \d{4}$/, '').slice(0, 3), valor: custo, texto: dinheiro(custo, g.leitura.moeda) }));
  } else {
    pontos = g.dias.map((d) => ({ rotulo: diaCurto(d.dia), valor: d.custo, texto: dinheiro(d.custo, g.leitura.moeda) }));
  }
  // O dia que se destaca: gastou 3 vezes a mediana dos dias com gasto, ou mais, e a maior parte foi marketing (a campanha).
  const comGasto = g.dias.filter((d) => d.custo > 0).map((d) => d.custo).sort((a, b) => a - b);
  const mediana = comGasto.length ? comGasto[Math.floor(comGasto.length / 2)] : 0;
  const campanha = !porMes ? g.dias.filter((d) => d.custo > 0 && d.custo >= 3 * mediana && d.marketing >= d.custo / 2).map((d) => diaCurto(d.dia)) : [];
  return (
    <section className="space-y-2" aria-labelledby="gasto-tempo">
      <h2 id="gasto-tempo" className="font-display text-lg font-bold">
        {porMes ? 'Gasto por mês' : 'Gasto por dia'}
      </h2>
      {campanha.length > 0 && (
        <p className={cn('text-sm', texto2)}>
          {campanha.length === 1 ? `O dia ${campanha[0]} teve` : `Os dias ${campanha.join(', ')} tiveram`} mais gasto de marketing (campanha ou automática).
        </p>
      )}
      <Colunas legenda={porMes ? 'Gasto por mês' : 'Gasto por dia'} pontos={pontos} cabecalho={[porMes ? 'Mês' : 'Dia', 'Gasto']} />
    </section>
  );
}
