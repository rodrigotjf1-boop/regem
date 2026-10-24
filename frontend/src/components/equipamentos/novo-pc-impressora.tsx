'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Gaveta } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { cn } from '@/lib/utils';
import { podeReativar } from './equipamento';
import type { CodigoGerado } from './equipamento-dialogos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// NOVO PC COM IMPRESSORA (central de impressão, fase 2, decisão 3A; mockup
// `mockups/regem-impressao-onde-sai.html`, peça 2). Antes eram quatro idas e vindas — criar a
// estação, digitar o código no instalador, criar a impressora e preencher "Ligada em" e "Nome no
// Windows" — e o dono achou "complicado entender a parte de gerar códigos" (17/10/2026). Aqui é um
// fluxo só: o código fica na tela até o PC conectar, e as impressoras que o Windows dele tem
// aparecem para marcar. Usa as rotas de sempre (estação, código, impressora, regra, teste).

type Uso = 'delivery' | 'retirada' | 'balcao' | 'producao';
const USOS: { v: Uso; rotulo: string }[] = [
  { v: 'delivery', rotulo: 'Via do delivery e comanda do entregador' },
  { v: 'retirada', rotulo: 'Via da retirada (o cliente busca no balcão)' },
  { v: 'balcao', rotulo: 'Via do cliente (balcão e mesa)' },
  { v: 'producao', rotulo: 'Produção (escolho no direcionamento)' },
];
/** Impressoras do Windows que não são de cupom ("Microsoft Print to PDF", fax…): vêm desmarcadas. */
const naoECupom = (nome: string) => /pdf|xps|onenote|fax|microsoft|send to/i.test(nome);
const ESPERA_MS = 3000;

export function NovoPcComImpressora({
  unidades,
  unidadeAtual,
  todos = [],
  voltarPara,
  aoFechar,
  aoConcluir,
}: {
  unidades: any[];
  unidadeAtual: string | null;
  /** A lista de Equipamentos: as estações que já existem (parear de novo o PC que já tinha uma). */
  todos?: any[];
  voltarPara: string;
  aoFechar: () => void;
  aoConcluir: () => void;
}) {
  const [passo, setPasso] = useState<1 | 2 | 3 | 4>(1);
  const [nome, setNome] = useState('PC do delivery');
  const [unidadeId, setUnidadeId] = useState<string>(unidadeAtual ?? unidades[0]?.id ?? '');
  // Parear sem reinstalar (pedido do dono de 22/10/2026): o PC que já tinha uma estação pareia de novo NELA (mesmo id,
  // as impressoras continuam ligadas) — antes este fluxo sempre criava OUTRA, e a antiga ficava "muda" com as impressoras.
  const [escolha, setEscolha] = useState<'nova' | string>('nova');
  const existentes = todos.filter(
    (e) => e.tipo === 'estacao_impressao' && (!unidadeId || !e.unidadeId || e.unidadeId === unidadeId) && (e.ativo !== false || podeReativar(e)),
  );
  const impressorasDe = (id: string) => todos.filter((p) => p.tipo === 'impressora' && p.estacaoId === id && p.ativo !== false);
  const [estacao, setEstacao] = useState<any>(null);
  // O pareamento de ANTES do código: o passo 2 só avança quando ele muda (a estação que já existe já está "pareada").
  const [pareadoAntes, setPareadoAntes] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<CodigoGerado | null>(null);
  const [sinal, setSinal] = useState<{ pareado: boolean; maquina: string | null; impressoras: string[] }>({ pareado: false, maquina: null, impressoras: [] });
  const [marcadas, setMarcadas] = useState<Record<string, Uso | null>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState('');
  const [pronto, setPronto] = useState<string[]>([]);

  async function mostrarCodigo() {
    const ja = escolha === 'nova' ? null : existentes.find((e) => e.id === escolha);
    if ((!ja && !nome.trim()) || ocupado) return;
    setErro('');
    setOcupado(true);
    try {
      if (ja) {
        // A estação que já existe: código para ELA (ou reativa a revogada há até 30 dias, que volta com código).
        const c: any = ja.ativo === false ? await api.reativarEquipamento(ja.id) : await api.gerarCodigoTerminal(ja.id);
        setEstacao(ja);
        setPareadoAntes(ja.pareadoEm ?? null);
        setCodigo({ codigo: String(c.codigo), expiraEm: c.expiraEm, onde: c.onde ?? null });
      } else {
        const nova: any = await api.criarEquipamento({ tipo: 'estacao_impressao', nome: nome.trim(), unidadeId: unidadeId || null });
        setEstacao(nova);
        setPareadoAntes(nova.pareadoEm ?? null);
        const c: any = await api.gerarCodigoTerminal(nova.id);
        setCodigo({ codigo: String(c.codigo), expiraEm: c.expiraEm, onde: c.onde ?? null });
      }
      setPasso(2);
    } catch (e) {
      setErro(e instanceof Error ? e.message : ja ? 'Não foi possível gerar o código.' : 'Não foi possível criar a estação.');
    } finally {
      setOcupado(false);
    }
  }

  async function outroCodigo() {
    if (!estacao || ocupado) return;
    setErro('');
    setOcupado(true);
    try {
      const c: any = await api.gerarCodigoTerminal(estacao.id);
      setCodigo({ codigo: String(c.codigo), expiraEm: c.expiraEm, onde: c.onde ?? null });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível gerar outro código.');
    } finally {
      setOcupado(false);
    }
  }

  // Passo 2: confere a cada 3 s se o PC conectou e se já mandou as impressoras do Windows (a batida).
  useEffect(() => {
    if (passo !== 2 || !estacao) return;
    let parar = false;
    const ver = async () => {
      try {
        const lista: any[] = ((await api.equipamentos()) as any[]) ?? [];
        const e = lista.find((x) => x.id === estacao.id);
        // `parar` = a gaveta fechou ou o passo mudou (o efeito limpou): a resposta atrasada não vale.
        if (!e || parar) return;
        const impressoras: string[] = Array.isArray(e.estacao?.impressoras) ? e.estacao.impressoras.map(String) : [];
        // Pareou AGORA = a data do pareamento mudou desde o código (a estação que já existia já estava pareada; a
        // comparação é com o valor do próprio servidor — nada do relógio deste PC).
        const pareouAgora = !!e.pareadoEm && e.pareadoEm !== pareadoAntes;
        setSinal({ pareado: pareouAgora, maquina: e.estacao?.maquina ?? e.maquinaPareada ?? null, impressoras: pareouAgora ? impressoras : [] });
        if (pareouAgora && impressoras.length) {
          const primeira = impressoras.find((n) => !naoECupom(n));
          setMarcadas(Object.fromEntries(impressoras.map((n) => [n, n === primeira ? 'delivery' : null])));
          setPasso(3);
        }
      } catch {
        /* falha de uma volta: tenta na próxima */
      }
    };
    void ver();
    const t = setInterval(() => void ver(), ESPERA_MS);
    return () => { parar = true; clearInterval(t); };
  }, [passo, estacao, pareadoAntes]);

  async function concluir() {
    const escolhidas = Object.entries(marcadas).filter((x): x is [string, Uso] => !!x[1]);
    if (!estacao || ocupado) return;
    setErro('');
    setOcupado(true);
    const feitas: string[] = [];
    try {
      // 1) A impressora ligada a esta estação, com o nome exato do Windows (reusa a que já existe).
      const existentes: any[] = ((await api.impressoras()) as any[]) ?? [];
      const criadas: { id: string; dispositivo: string; uso: Uso }[] = [];
      for (const [dispositivo, uso] of escolhidas) {
        const ja = existentes.find((p) => p.estacaoId === estacao.id && p.dispositivo === dispositivo);
        const salva: any = await api.salvarImpressora({
          ...(ja ? { id: ja.id } : { nome: dispositivo }),
          conexao: 'local',
          dispositivo,
          estacaoId: estacao.id,
          unidadeId: unidadeId || null,
          fazCupom: uso !== 'producao',
          fazProducao: uso === 'producao',
        });
        criadas.push({ id: salva.id, dispositivo, uso });
        feitas.push(`${dispositivo}: ligada ao ${estacao.nome}`);
      }
      // 2) A regra do documento (Onde cada documento sai): soma às impressoras que já estão lá.
      const cfg: any = await api.deliveryConfig();
      const regras = cfg?.impressaoRegras ?? {};
      const soma = (lista: any[] | undefined, id: string) => [...(lista ?? []).filter((a: any) => a.id !== id), { id, vias: 1 }];
      const enviar: Record<string, unknown> = {};
      for (const c of criadas) {
        if (c.uso === 'delivery') enviar.delivery = { impressoras: soma((enviar.delivery as any)?.impressoras ?? regras.delivery?.impressoras, c.id) };
        // Retirada: passa a ter a lista própria (deixa de ser "nas mesmas do delivery").
        if (c.uso === 'retirada') {
          const antes = (enviar.retirada as any)?.impressoras ?? (regras.retirada?.mesmasDoDelivery === false ? regras.retirada?.impressoras : []);
          enviar.retirada = { mesmasDoDelivery: false, impressoras: soma(antes, c.id) };
        }
        if (c.uso === 'balcao') {
          const base: any = enviar.balcao ?? regras.balcao ?? { pdv: true, pdvVias: 1, impressoras: [] };
          enviar.balcao = { ...base, impressoras: soma(base.impressoras, c.id) };
        }
      }
      if (Object.keys(enviar).length) {
        await api.setDeliveryConfig({ impressaoRegras: enviar });
        feitas.push('regra de onde cada documento sai: atualizada');
      }
      // 3) A página de teste em cada uma (sai no PC, pela estação).
      for (const c of criadas) {
        await api.impressoraTeste(c.id).catch(() => undefined);
        feitas.push(`${c.dispositivo}: página de teste enviada`);
      }
      setPronto(feitas);
      setPasso(4);
      toast.success(escolhidas.length ? 'PC com impressora pronto.' : 'PC pareado.');
      aoConcluir();
    } catch (e) {
      setErro(`${e instanceof Error ? e.message : 'Erro ao concluir.'}${feitas.length ? ` Já feito: ${feitas.join('; ')}.` : ''}`);
    } finally {
      setOcupado(false);
    }
  }

  const passos = [
    { n: 1, rotulo: 'Nome do PC' },
    { n: 2, rotulo: 'No PC' },
    { n: 3, rotulo: 'Impressoras dele' },
  ];
  const ateHora = codigo?.expiraEm ? new Date(codigo.expiraEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '';
  const codigoBonito = codigo ? `${codigo.codigo.slice(0, 3)} ${codigo.codigo.slice(3)}` : '';

  return (
    <Gaveta
      titulo="Novo PC com impressora"
      aoFechar={aoFechar}
      voltarPara={voltarPara}
      rodape={
        passo === 1 ? (
          <>
            <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
            <Button type="button" onClick={() => void mostrarCodigo()} disabled={ocupado || (escolha === 'nova' && !nome.trim())}>
              {ocupado ? (escolha === 'nova' ? 'Criando…' : 'Gerando…') : 'Mostrar o código'}
            </Button>
          </>
        ) : passo === 3 ? (
          <>
            <Button type="button" variant="outline" onClick={aoFechar}>Fechar</Button>
            <Button type="button" onClick={() => void concluir()} disabled={ocupado}>{ocupado ? 'Concluindo…' : 'Concluir'}</Button>
          </>
        ) : (
          <Button type="button" variant="outline" onClick={aoFechar}>{passo === 4 ? 'Fechar' : 'Fechar e terminar depois'}</Button>
        )
      }
    >
      <div className="space-y-4">
        <ol className="flex flex-wrap gap-x-4 gap-y-2" aria-label="Passos">
          {passos.map((p) => (
            <li key={p.n} aria-current={passo === p.n ? 'step' : undefined} className={cn('flex items-center gap-2 text-sm font-semibold', passo === p.n ? 'text-foreground' : texto2)}>
              <span className={cn('grid h-6 w-6 place-items-center rounded-full border text-xs', passo > p.n ? 'border-ok bg-ok/15' : passo === p.n ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                {passo > p.n ? '✓' : p.n}
              </span>
              {p.rotulo}
            </li>
          ))}
        </ol>

        {passo === 1 && (
          <div className="space-y-4">
            {existentes.length > 0 && (
              <fieldset className="space-y-2">
                <legend className="mb-1 text-sm font-semibold">Este PC já tinha uma estação?</legend>
                <p className={`text-xs ${texto2}`}>
                  Se sim, ele pareia de novo nela, sem reinstalar: as impressoras ligadas continuam as mesmas.
                </p>
                {existentes.map((e) => {
                  const imps = impressorasDe(e.id).length;
                  const maquina = e.estacao?.maquina ?? e.maquinaPareada ?? null;
                  return (
                    <label key={e.id} className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm', escolha === e.id ? 'border-primary bg-primary/5' : 'border-border')}>
                      <input type="radio" name="pc-estacao" className="mt-1 flex-none" checked={escolha === e.id} onChange={() => setEscolha(e.id)} />
                      <span className="min-w-0">
                        <b className="break-words">Sim, era “{e.nome}”</b>
                        <span className={`block text-xs ${texto2}`}>
                          {imps === 1 ? '1 impressora ligada' : `${imps} impressoras ligadas`}
                          {maquina ? ` · último PC: ${maquina}` : ''}
                          {e.ativo === false ? ' · revogada: volta com as impressoras' : ''}
                        </span>
                      </span>
                    </label>
                  );
                })}
                <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm', escolha === 'nova' ? 'border-primary bg-primary/5' : 'border-border')}>
                  <input type="radio" name="pc-estacao" className="mt-1 flex-none" checked={escolha === 'nova'} onChange={() => setEscolha('nova')} />
                  <span className="min-w-0">
                    <b>Não, é um PC novo</b>
                    <span className={`block text-xs ${texto2}`}>Cria uma estação nova com o nome abaixo.</span>
                  </span>
                </label>
              </fieldset>
            )}
            {escolha === 'nova' && (
              <div className="space-y-1.5">
                <Label htmlFor="pc-nome">Como chamar este PC</Label>
                <Input id="pc-nome" data-foco-inicial value={nome} onChange={(e) => setNome(e.target.value)} maxLength={60} autoComplete="off" aria-describedby="pc-nome-ajuda" />
                <p id="pc-nome-ajuda" className={`text-xs ${texto2}`}>É o nome que aparece no ícone da bandeja do PC e na lista de equipamentos.</p>
              </div>
            )}
            {unidades.length > 1 && (
              <div className="space-y-1.5">
                <Label htmlFor="pc-unidade">Loja</Label>
                <Select id="pc-unidade" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
                  {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
                </Select>
              </div>
            )}
          </div>
        )}

        {passo === 2 && codigo && (
          <div className="space-y-4">
            {/* Onde digitar, pelo servidor (`common/onde-digitar.ts`): primeiro o ícone "Regem neste PC" (o PC que já tem o
                Regem pareia sem reinstalar); o instalador fica para o PC novo (`obs`). */}
            <p className="font-semibold">No {estacao?.nome}:</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {(codigo.onde?.passos ?? ['Digite o código abaixo.']).map((p) => <li key={p}>{p}</li>)}
            </ol>
            {codigo.onde?.obs && <p className={`text-sm ${texto2}`}>{codigo.onde.obs}</p>}
            <p aria-label={`Código de pareamento: ${codigo.codigo.split('').join(' ')}`} className="rounded-lg border border-dashed border-border py-3 text-center font-mono text-4xl font-bold tracking-[0.18em]">
              {codigoBonito}
            </p>
            <p role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm">
              <span className={cn('h-2.5 w-2.5 flex-none rounded-full', sinal.pareado ? 'bg-ok' : 'bg-warn motion-safe:animate-pulse')} aria-hidden="true" />
              {sinal.pareado
                ? `PC conectado${sinal.maquina ? ` (${sinal.maquina})` : ''}: esperando a lista de impressoras do Windows…`
                : `Esperando o PC conectar · o código vale até ${ateHora}.`}
            </p>
            {!sinal.pareado && (
              <Button type="button" variant="outline" size="sm" onClick={() => void outroCodigo()} disabled={ocupado}>
                {ocupado ? 'Gerando…' : 'Gerar outro código'}
              </Button>
            )}
            <p className={`text-xs ${texto2}`}>Pode fechar e terminar depois: o PC aparece em Equipamentos, e a impressora se liga nele pela gaveta dela (“Ligada em”).</p>
          </div>
        )}

        {passo === 3 && (
          <div className="space-y-3">
            <p className="text-sm"><span className="font-semibold text-ok">PC conectado</span>{sinal.maquina ? ` · ${sinal.maquina}` : ''}. O Windows dele tem estas impressoras:</p>
            <ul className="grid gap-2" aria-label="Impressoras do Windows deste PC">
              {sinal.impressoras.map((n, i) => {
                const uso = marcadas[n] ?? null;
                return (
                  <li key={n} className={cn('rounded-lg border px-3 py-2', uso ? 'border-primary bg-primary/10' : 'border-border')}>
                    <label htmlFor={`pc-imp-${i}`} className="flex items-start gap-2">
                      <input id={`pc-imp-${i}`} type="checkbox" className="mt-1 h-4 w-4 flex-none accent-primary" checked={!!uso}
                        onChange={(e) => setMarcadas((m) => ({ ...m, [n]: e.target.checked ? 'delivery' : null }))} />
                      <span className="min-w-0">
                        <span className="block break-words font-semibold">{n}</span>
                        <span className={`block text-xs ${texto2}`}>{naoECupom(n) ? 'Do Windows · não parece impressora de cupom' : 'Instalada neste PC'}</span>
                      </span>
                    </label>
                    {uso && (
                      <div className="mt-2 space-y-1 pl-6">
                        <Label htmlFor={`pc-uso-${i}`} className="text-xs">Para quê</Label>
                        <Select id={`pc-uso-${i}`} value={uso} onChange={(e) => setMarcadas((m) => ({ ...m, [n]: e.target.value as Uso }))}>
                          {USOS.map((u) => <option key={u.v} value={u.v}>{u.rotulo}</option>)}
                        </Select>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className={`text-xs ${texto2}`}>A impressora é criada já ligada a este PC, com o nome exato do Windows, e entra em “Onde cada documento sai”. Sai uma página de teste em cada uma.</p>
          </div>
        )}

        {passo === 4 && (
          <div role="status" className="space-y-2 rounded-lg bg-ok/15 px-4 py-3 text-sm">
            <p className="font-semibold">Pronto.</p>
            {pronto.length ? (
              <ul className="list-disc space-y-0.5 pl-5">{pronto.map((x) => <li key={x}>{x}</li>)}</ul>
            ) : (
              <p>Nenhuma impressora marcada: o PC fica pareado, e dá para escolher depois.</p>
            )}
          </div>
        )}

        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{erro}</p>}
      </div>
    </Gaveta>
  );
}
