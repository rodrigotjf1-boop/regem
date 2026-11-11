'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Pencil, Plus } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { texto2 } from '@/components/ui/lista';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo } from '@/components/ui/sobreposto';
import { KdsProdutosGaveta } from '@/components/kds/kds-produtos-gaveta';
import { BlocoEdicao } from '@/components/rota-cozinha/bloco-edicao';
import { NoKds, NoTv } from '@/components/rota-cozinha/no-kds';
import { Nota } from '@/components/rota-cozinha/nota';
import { Simulador } from '@/components/rota-cozinha/simulador';
import { TEMAS_KDS } from '@/lib/kds-tema';
import { cn } from '@/lib/utils';
import {
  NOME_DA_ETAPA_MAX, despachoNoFim, escolherVai, iniciarEdicao, incluir, mover, naRota, nomeDaEtapa, paraSalvar, proximoDeVerdade,
  renomear, resumoDaEdicao, tirar, valeMover, type Edicao, type Etapa, type KdsDaRota, type Movimento, type Rota,
} from '@/lib/rota-cozinha';

/* eslint-disable @typescript-eslint/no-explicit-any */
const LARGURA_DA_COLUNA = 230; // abaixo disso por coluna, a rota empilha (de cima para baixo)
const semInert = {};
const inerte = { inert: '' } as any; // React 18: atributo cru (o leitor de tela e o Tab pulam a parte esmaecida)

// Configurações › Rota da cozinha (onda 2 da auditoria do KDS, mig 410; protótipo aprovado `mockups/regem-kds-cozinha.html`,
// aba 2). A corrente inteira num lugar só: as etapas (colunas, na ordem desta cozinha), o "vai para" e a impressão de cada
// KDS e a TV no fim. "Editar a ordem" move os KDS entre as etapas (botões ou arrastar); salvar mostra antes o que muda.
export default function RotaCozinhaPage() {
  const router = useRouter();
  const [rota, setRota] = useState<Rota | null>(null);
  const [erro, setErro] = useState('');
  const [ed, setEd] = useState<Edicao | null>(null);
  const [juntoDe, setJuntoDe] = useState<string | null>(null);
  const [incluindo, setIncluindo] = useState(false);
  const [renomeia, setRenomeia] = useState<number | null>(null);
  const [nomeTemp, setNomeTemp] = useState('');
  const [pegado, setPegado] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState(false);
  const [erroSalvar, setErroSalvar] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [configurando, setConfigurando] = useState<KdsDaRota | null>(null);
  const [largura, setLargura] = useState(0);
  const leitura = useRef(0);
  const botaoEditar = useRef<HTMLButtonElement | null>(null);
  const botaoSalvar = useRef<HTMLButtonElement | null>(null);
  const observador = useRef<ResizeObserver | null>(null);

  const carregar = useCallback(async () => {
    const minha = ++leitura.current; // só a leitura mais nova vale (V64)
    setErro('');
    try {
      const r = await api.kdsRota();
      if (minha === leitura.current) setRota(r);
    } catch (e) {
      if (minha === leitura.current) {
        setRota(null);
        setErro(e instanceof Error && e.message ? e.message : 'Não consegui carregar a rota da cozinha.');
      }
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    void carregar();
    // Trocou a loja no topo: a rota é outra (a edição em curso é descartada).
    const trocou = () => {
      setEd(null);
      setRota(null);
      void carregar();
    };
    window.addEventListener('regem:unidade', trocou);
    return () => window.removeEventListener('regem:unidade', trocou);
  }, [carregar, router]);

  // A largura da rota decide: colunas lado a lado (com a seta) ou uma embaixo da outra (V45 — nada rola para o lado).
  const fluxoRef = useCallback((el: HTMLDivElement | null) => {
    observador.current?.disconnect();
    if (!el) return;
    const ro = new ResizeObserver(() => setLargura(el.clientWidth));
    ro.observe(el);
    observador.current = ro;
    setLargura(el.clientWidth);
  }, []);
  useEffect(() => () => observador.current?.disconnect(), []);

  if (!rota)
    return (
      <Shell eyebrow="Configurações" title="Rota da cozinha">
        {erro ? (
          <Card className="flex flex-wrap items-center justify-center gap-3 p-8 text-center text-sm">
            <span role="alert">{erro}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void carregar()}>
              Tentar de novo
            </Button>
          </Card>
        ) : (
          <SkeletonList rows={4} />
        )}
      </Shell>
    );

  const kds = rota.kds;
  const porId = new Map(kds.map((k) => [k.id, k]));
  const etapas: Etapa[] = ed ? ed.etapas : rota.etapas;
  const editando = !!ed;
  const cols = etapas.length + 1;
  const horizontal = largura > 0 && largura / cols >= LARGURA_DA_COLUNA;
  const naRotaSalva = kds.filter((k) => naRota(rota.etapas, k.id));
  const desligados = kds.filter((k) => !k.ativo).length;
  const foraLigados = kds.filter((k) => k.ativo && !naRota(rota.etapas, k.id));
  const esmaece = editando ? inerte : semInert;

  // ── edição ──
  const comecar = () => {
    setEd(iniciarEdicao(rota));
    setJuntoDe(null);
    setIncluindo(false);
    setRenomeia(null);
    requestAnimationFrame(() => botaoSalvar.current?.focus());
  };
  const cancelar = () => {
    setEd(null);
    setDialogo(false);
    toast.info('Edição cancelada: nada mudou.');
    requestAnimationFrame(() => botaoEditar.current?.focus());
  };
  const aplicar = (novo: Edicao, aviso?: string) => {
    setEd(novo);
    setJuntoDe(null);
    if (aviso) toast.info(aviso);
  };
  const moverKds = (id: string, mov: Movimento) => {
    if (!ed) return;
    const novo = mover(ed, id, mov, kds);
    const i = novo.etapas.findIndex((e) => e.kds.includes(id));
    aplicar(novo, novo === ed ? undefined : `${porId.get(id)?.nome ?? 'KDS'} → etapa ${i + 1}`);
  };
  const soltarEm = (id: string, mov: Movimento) => {
    setPegado(null);
    setSobre(null);
    if (!ed) return;
    if (!valeMover(ed, id, mov, kds)) return toast.error('O despacho só pode ficar na última etapa.');
    moverKds(id, mov);
  };
  const confirmarNome = (i: number) => {
    if (ed) setEd(renomear(ed, i, nomeTemp));
    setRenomeia(null);
  };
  const resumo = ed ? resumoDaEdicao(rota, ed) : { linhas: [], motivos: [] };
  const pedirSalvar = () => {
    if (!ed) return;
    if (!resumo.motivos.length && !resumo.linhas.length) return toast.info('Nada mudou na ordem da rota.');
    setErroSalvar('');
    setDialogo(true);
  };
  const salvar = async () => {
    if (!ed) return;
    setSalvando(true);
    setErroSalvar('');
    try {
      const r = await api.salvarKdsRota(paraSalvar(ed));
      setRota(r);
      setEd(null);
      setDialogo(false);
      toast.success('Ordem da rota salva.');
      requestAnimationFrame(() => botaoEditar.current?.focus());
    } catch (e) {
      setErroSalvar(e instanceof Error && e.message ? e.message : 'Não consegui salvar a ordem.');
    } finally {
      setSalvando(false);
    }
  };

  // ── notas (o modo, o produto em dois KDS, o desligado, o de fora) ──
  const notas: React.ReactNode[] = [];
  if (!rota.editavel && rota.motivo) notas.push(<Nota key="servidor" tom="aviso">{rota.motivo}</Nota>);
  if (kds.length)
    notas.push(
      rota.estacoes ? (
        <Nota key="modo">
          <b>Estações ligadas nesta loja.</b> Cada KDS recebe os produtos que marcou; o que nenhum KDS marcar sai em papel, na impressora
          escolhida para ele{rota.padrao ? ` ou na padrão (${rota.padrao.nome})` : ' — e esta loja não tem impressora padrão de produção'}.
        </Nota>
      ) : (
        <Nota key="modo">
          <b>Modo comum.</b> Nenhum KDS marcou produto: todo pedido aparece inteiro no começo da rota e segue o &quot;vai para&quot;. Marcar
          produtos num KDS liga as estações.
        </Nota>
      ),
    );
  for (const d of rota.duplicados) {
    const [a, b] = d.kds.map((id) => porId.get(id)).filter((x): x is KdsDaRota => !!x);
    if (!a || !b) continue;
    // Se um manda para o outro, o de depois recebe o produto duas vezes.
    const chega = (de: string, para: string) => {
      const vistos = new Set<string>();
      for (let x = proximoDeVerdade(kds, de); x && !vistos.has(x); x = proximoDeVerdade(kds, x)) {
        if (x === para) return true;
        vistos.add(x);
      }
      return false;
    };
    const fim = chega(a.id, b.id) ? b : chega(b.id, a.id) ? a : null;
    const ini = fim === b ? a : b;
    notas.push(
      <Nota
        key={`dup-${d.produto}`}
        tom="aviso"
        acao={
          !editando && (
            <Button type="button" variant="outline" size="sm" className="h-auto min-h-11 whitespace-normal text-left [overflow-wrap:anywhere]" onClick={() => setConfigurando(fim ?? b)}>
              Resolver: {(fim ?? b).nome}
            </Button>
          )
        }
      >
        <b>Produto em dois KDS sai nos dois:</b> {d.produto} está marcado em {d.kds.map((id) => porId.get(id)?.nome).filter(Boolean).join(' e ')}.
        {fim ? ` Como ${ini.nome} manda para ${fim.nome}, ${fim.nome} recebe ${d.produto} duas vezes.` : ''}
      </Nota>,
    );
  }
  for (const k of kds.filter((x) => !x.ativo && naRota(rota.etapas, x.id))) {
    const depois = proximoDeVerdade(kds, k.id);
    notas.push(
      <Nota key={`off-${k.id}`} tom="neutro">
        <b>KDS {k.nome} desligado:</b> é pulado — {depois ? `quem manda para ele passa direto para ${porId.get(depois)?.nome}` : 'quem manda para ele termina ali'} até ele
        voltar.
      </Nota>,
    );
  }
  if (foraLigados.length)
    notas.push(
      <Nota key="fora" tom="neutro">
        <b>Fora da rota:</b> {foraLigados.map((k) => k.nome).join(', ')} — recebe{foraLigados.length === 1 ? '' : 'm'} os produtos marcados e segue
        {foraLigados.length === 1 ? '' : 'm'} o próprio &quot;vai para&quot;.
      </Nota>,
    );

  // ── impressoras da rota ──
  const porImpressora = new Map<string, KdsDaRota[]>();
  for (const k of kds.filter((x) => x.imprimeAoAvancar && x.ativo))
    porImpressora.set(k.impressora ?? 'Impressora escolhida', [...(porImpressora.get(k.impressora ?? 'Impressora escolhida') ?? []), k]);
  const QUANDO: Record<string, string> = { recebido: 'ao receber', preparo: 'ao iniciar', pronto: 'ao ficar pronto', entregue: 'ao despachar' };

  const dica = (texto: string) => <span className="block text-xs font-bold text-destructive">{texto}</span>;
  const colunaProibida = (i: number) => !!pegado && !valeMover(ed!, pegado, { tipo: 'junto', etapa: i }, kds);
  const zonaProibida = (pos: number) => !!pegado && !valeMover(ed!, pegado, { tipo: 'nova', pos }, kds);
  const zona = (pos: number, texto: string) =>
    pegado ? (
      <div
        onDragOver={(e) => {
          if (zonaProibida(pos)) return;
          e.preventDefault();
          setSobre(`n${pos}`);
        }}
        onDragLeave={() => setSobre((s) => (s === `n${pos}` ? null : s))}
        onDrop={(e) => {
          e.preventDefault();
          soltarEm(pegado, { tipo: 'nova', pos });
        }}
        className={cn(
          'grid min-h-14 place-items-center rounded-lg border-2 border-dashed p-2 text-center text-sm font-bold',
          zonaProibida(pos) ? 'border-destructive text-destructive' : sobre === `n${pos}` ? 'border-foreground bg-secondary' : `border-border ${texto2}`,
        )}
      >
        <span>
          ＋ {texto}
          {zonaProibida(pos) && dica('O despacho só pode ficar na última etapa')}
        </span>
      </div>
    ) : null;

  return (
    <Shell eyebrow="Configurações" title="Rota da cozinha">
      <div className="grid min-w-0 gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <p className={`min-w-0 max-w-3xl text-sm ${texto2}`}>
            {kds.length} KDS{desligados ? ` (${desligados} desligado${desligados === 1 ? '' : 's'})` : ''}, {naRotaSalva.length} na rota,{' '}
            {rota.tvs.length} TV{rota.tvs.length === 1 ? '' : 's'} de senhas · {rota.etapas.length} etapa{rota.etapas.length === 1 ? '' : 's'} · por onde cada
            pedido passa, na ordem desta cozinha.
          </p>
          {!editando && (
            <Button ref={botaoEditar} type="button" variant="outline" onClick={comecar} disabled={!rota.editavel || !kds.length}>
              <Pencil className="h-4 w-4" aria-hidden="true" /> Editar a ordem
            </Button>
          )}
        </div>

        {editando && ed && (
          <div role="region" aria-label="Editando a ordem da rota" className="sticky top-0 z-10 flex min-w-0 flex-wrap items-center gap-2 rounded-xl border-2 border-foreground bg-card p-3 shadow-lg">
            <div className="min-w-0 flex-[1_1_260px]">
              <b className="block font-display">Editando a ordem da rota</b>
              <span className={`block text-sm ${texto2}`}>
                Arraste cada KDS para outra etapa, ou use &quot;Antes&quot;, &quot;Depois&quot; e &quot;Junto com…&quot;. Dois KDS na mesma etapa preparam em
                paralelo. Nada muda na cozinha até salvar.
              </span>
            </div>
            <Button type="button" variant="outline" aria-expanded={incluindo} onClick={() => setIncluindo((x) => !x)}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Incluir KDS na rota
            </Button>
            <Button type="button" variant="outline" onClick={cancelar}>
              Cancelar
            </Button>
            <Button ref={botaoSalvar} type="button" onClick={pedirSalvar}>
              Salvar a ordem
            </Button>
            {incluindo && (
              <div role="group" aria-label="KDS ligados fora da rota" className="flex min-w-0 basis-full flex-wrap items-center gap-1.5">
                {ed.fora.length ? (
                  <>
                    <span className={`text-sm font-bold ${texto2}`}>Ligados fora da rota:</span>
                    {ed.fora.map((id) => (
                      <Button
                        key={id}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-auto min-h-11 whitespace-normal text-left [overflow-wrap:anywhere]"
                        onClick={() => {
                          aplicar(incluir(ed, id, kds), `${porId.get(id)?.nome} entrou na etapa 1 — mova para onde ele fica.`);
                          setIncluindo(false);
                        }}
                      >
                        ＋ {porId.get(id)?.nome}
                      </Button>
                    ))}
                  </>
                ) : (
                  <span className={`text-sm ${texto2}`}>Todos os KDS ligados já estão na rota.</span>
                )}
              </div>
            )}
          </div>
        )}

        {notas.length > 0 && (
          <div className={cn('grid gap-2', editando && 'opacity-60')} {...esmaece}>
            {notas}
          </div>
        )}

        {!kds.length ? (
          <Card className={`p-8 text-center text-sm ${texto2}`}>
            Nenhum KDS de preparo ou de despacho nesta loja. Cadastre o primeiro em Configurações › Equipamentos.
          </Card>
        ) : (
          <div
            ref={fluxoRef}
            role="group"
            aria-label="A rota da cozinha"
            className="grid min-w-0 gap-3"
            style={{ gridTemplateColumns: horizontal ? `repeat(${cols}, minmax(0, 1fr))` : 'minmax(0, 1fr)' }}
          >
            {etapas.map((e, i) => (
              <div
                key={`etapa-${i}`}
                className={cn(
                  'grid min-w-0 content-start gap-2.5',
                  editando && 'rounded-xl p-1.5',
                  pegado && (colunaProibida(i) ? 'outline-dashed outline-2 -outline-offset-2 outline-destructive' : sobre === `e${i}` ? 'bg-secondary outline-dashed outline-2 -outline-offset-2 outline-foreground' : 'outline-dashed outline-2 -outline-offset-2 outline-border'),
                )}
                onDragOver={(ev) => {
                  if (!pegado || colunaProibida(i)) return;
                  ev.preventDefault();
                  setSobre(`e${i}`);
                }}
                onDragLeave={() => setSobre((s) => (s === `e${i}` ? null : s))}
                onDrop={(ev) => {
                  ev.preventDefault();
                  if (pegado) soltarEm(pegado, { tipo: 'junto', etapa: i });
                }}
              >
                <h3 className={`flex min-h-11 items-center gap-2 font-display text-xs font-extrabold uppercase tracking-[0.12em] ${texto2}`}>
                  {i > 0 && horizontal && <ArrowRight className="h-4 w-4 flex-none text-primary" aria-hidden="true" />}
                  {editando && renomeia === i ? (
                    <>
                      <input
                        autoFocus
                        value={nomeTemp}
                        maxLength={NOME_DA_ETAPA_MAX}
                        placeholder={`Etapa ${i + 1}`}
                        aria-label={`Nome da etapa ${i + 1} (vazio fica Etapa ${i + 1})`}
                        onChange={(ev) => setNomeTemp(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') {
                            ev.preventDefault();
                            confirmarNome(i);
                          }
                        }}
                        className="h-11 min-w-0 flex-[1_1_120px] rounded-md border border-input bg-card px-3 font-sans text-sm font-bold normal-case tracking-normal text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <Button type="button" variant="outline" size="sm" className="w-11 flex-none px-0" aria-label="Guardar o nome" onClick={() => confirmarNome(i)}>
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {i + 1} · {nomeDaEtapa(e, i)}
                      </span>
                      {editando && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-11 flex-none px-0"
                          aria-label={`Renomear a etapa ${i + 1}`}
                          onClick={() => {
                            setNomeTemp(e.nome);
                            setRenomeia(i);
                          }}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      )}
                    </>
                  )}
                </h3>
                {pegado && colunaProibida(i) && dica('O despacho só pode ficar na última etapa')}
                {i === 0 && editando && zona(0, 'Nova etapa antes')}
                {e.kds.map((id) => {
                  const k = porId.get(id);
                  if (!k) return null;
                  return editando && ed ? (
                    <BlocoEdicao
                      key={id}
                      k={k}
                      i={i}
                      ed={ed}
                      kds={kds}
                      horizontal={horizontal}
                      juntoAberto={juntoDe === id}
                      pegado={pegado === id}
                      aoMover={(mov) => moverKds(id, mov)}
                      aoTirar={() => aplicar(tirar(ed, id, kds), `${k.nome} saiu da rota: termina nele (os produtos continuam nele).`)}
                      aoJunto={() => setJuntoDe((j) => (j === id ? null : id))}
                      aoVai={(alvo) => aplicar(escolherVai(ed, id, alvo, kds))}
                      aoPegar={() => setPegado(id)}
                      aoSoltar={() => {
                        setPegado(null);
                        setSobre(null);
                      }}
                    />
                  ) : (
                    <NoKds key={id} k={k} kds={kds} etapas={rota.etapas} estacoes={rota.estacoes} aoEditar={rota.editavel ? setConfigurando : undefined} />
                  );
                })}
                {i === etapas.length - 1 && editando && zona(etapas.length, 'Nova etapa depois')}
              </div>
            ))}
            <div className="grid min-w-0 content-start gap-2.5">
              <h3 className={`flex min-h-11 items-center gap-2 font-display text-xs font-extrabold uppercase tracking-[0.12em] ${texto2}`}>
                {horizontal && <ArrowRight className="h-4 w-4 flex-none text-primary" aria-hidden="true" />}
                {editando ? 'Cliente · não é etapa' : 'Cliente'}
              </h3>
              <NoTv tvs={rota.tvs} editando={editando} />
            </div>
          </div>
        )}

        {!editando && foraLigados.length > 0 && (
          <section aria-labelledby="rota-fora" className="grid min-w-0 gap-2.5 rounded-xl border bg-card p-3">
            <h3 id="rota-fora" className="font-display text-base font-extrabold">
              Fora da rota · seguem o próprio &quot;vai para&quot;
            </h3>
            <div className="grid min-w-0 gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr))]">
              {foraLigados.map((k) => (
                <NoKds key={k.id} k={k} kds={kds} etapas={rota.etapas} estacoes={rota.estacoes} aoEditar={rota.editavel ? setConfigurando : undefined} />
              ))}
            </div>
          </section>
        )}

        <section aria-labelledby="rota-imps" className={cn('grid min-w-0 gap-2.5 rounded-xl border bg-card p-3', editando && 'opacity-60')} {...esmaece}>
          <h3 id="rota-imps" className="font-display text-base font-extrabold">
            Impressoras da rota
          </h3>
          <div className="grid min-w-0 gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
            {rota.padrao && (
              <div className="grid min-w-0 gap-1 rounded-lg border bg-secondary px-3 py-2.5">
                <b className="font-display [overflow-wrap:anywhere]">{rota.padrao.nome} · padrão</b>
                <span className={`text-sm ${texto2}`}>
                  {rota.estacoes
                    ? 'Recebe, na hora da venda, o que nenhum KDS marca e nenhuma outra impressora atende.'
                    : 'A impressora padrão de produção da loja (a via da cozinha do que não tem outro destino).'}
                </span>
              </div>
            )}
            {[...porImpressora.entries()].map(([imp, lista]) => (
              <div key={imp} className="grid min-w-0 gap-1 rounded-lg border bg-secondary px-3 py-2.5">
                <b className="font-display [overflow-wrap:anywhere]">{imp}</b>
                <span className={`text-sm ${texto2}`}>
                  Imprime ao avançar: {lista.map((k) => `${k.nome} (${QUANDO[k.imprimeNoStatus ?? 'pronto'] ?? 'ao avançar'})`).join(', ')}.
                </span>
              </div>
            ))}
            {!rota.padrao && !porImpressora.size && (
              <p className={`text-sm ${texto2}`}>Nenhum KDS imprime ao avançar e a loja não tem impressora padrão de produção: o pedido só avança de um KDS para o outro.</p>
            )}
          </div>
        </section>

        <div className={cn(editando && 'opacity-60')} {...esmaece}>
          <Simulador rota={rota} />
        </div>
      </div>

      {dialogo && ed && (
        <Dialogo
          titulo={resumo.motivos.length ? 'Não dá para salvar esta ordem' : 'Salvar a nova ordem da rota?'}
          aoFechar={() => setDialogo(false)}
          rodape={
            resumo.motivos.length ? (
              <Button type="button" onClick={() => setDialogo(false)}>
                Voltar e corrigir
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={() => setDialogo(false)} disabled={salvando}>
                  Voltar
                </Button>
                <Button type="button" onClick={() => void salvar()} disabled={salvando || !despachoNoFim(ed, kds)}>
                  {salvando ? 'Salvando…' : 'Salvar a ordem'}
                </Button>
              </>
            )
          }
        >
          {resumo.motivos.length ? (
            <div className="grid gap-3">
              <Nota tom="critico">
                {resumo.motivos.map((m) => (
                  <span key={m} className="block">
                    {m}
                  </span>
                ))}
              </Nota>
              <p className={`text-sm ${texto2}`}>Nada foi salvo. Corrija e tente de novo — ou &quot;Cancelar&quot; na barra desfaz tudo.</p>
            </div>
          ) : (
            <div className="grid gap-3 text-sm">
              <p>O que muda em cada KDS:</p>
              <ul className="ml-5 grid list-disc gap-1 [overflow-wrap:anywhere]">
                {resumo.linhas.map((l) => (
                  <li key={`${l.quem}-${l.texto}`}>
                    <b>{l.quem}:</b> {l.texto}
                  </li>
                ))}
              </ul>
              <p className={texto2}>
                Os produtos de cada KDS não mudam. Vale na hora: o próximo &quot;Pronto&quot; de cada cartão — também dos que já estão na tela — segue a
                ordem nova.
              </p>
              {erroSalvar && (
                <p role="alert" className="font-bold text-destructive">
                  {erroSalvar}
                </p>
              )}
            </div>
          )}
        </Dialogo>
      )}

      {configurando && (
        <KdsProdutosGaveta
          kds={configurando}
          telas={kds}
          T={TEMAS_KDS.claro}
          onFechar={() => {
            setConfigurando(null);
            void carregar();
          }}
          onFluxoSalvo={() => void carregar()}
        />
      )}
    </Shell>
  );
}
