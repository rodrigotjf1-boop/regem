'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { api, getToken, getCategoria, getUnidadeAtual } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Chave } from '@/components/ui/chave';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PASSOS = ['Ramo', 'Setores', 'Funções', 'Escalas'];
const LIMITE = 35;
const ID_TITULO = 'ramo-titulo';
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
        on ? 'border-primary bg-primary/15 text-foreground' : `border-input bg-card ${texto2} hover:text-foreground`
      }`}
    >
      {on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
      {label}
    </button>
  );
}

// Configurações → Config. por ramo (mockup `mockups/regem-configuracoes.html`): assistente de início
// que cria setores, funções, vagas e insumos básicos conforme o ramo. Continua um assistente de 4
// passos; cada passo mostra quantos itens estão marcados, e a confirmação final é um diálogo.
export default function WizardPage() {
  const router = useRouter();
  // O papel vem do navegador (token): lido depois da montagem, para o primeiro desenho ser o mesmo
  // no servidor e no navegador.
  const [papel, setPapel] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [ramos, setRamos] = useState<any[]>([]);
  const [unidades, setUnidades] = useState<any[]>([]);
  const [unidadeId, setUnidadeId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [ramo, setRamo] = useState<string | null>(null);
  const [blueprint, setBlueprint] = useState<any>(null);
  const [setoresSel, setSetoresSel] = useState<string[]>([]);
  const [funcoesSel, setFuncoesSel] = useState<string[]>([]);
  const [escalasSel, setEscalasSel] = useState<string[]>([]);
  const [criarInsumos, setCriarInsumos] = useState(true);
  const [erro, setErro] = useState('');
  const [erroCarga, setErroCarga] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [resultado, setResultado] = useState<any>(null);
  const [progresso, setProgresso] = useState<any>(null);

  const carregar = useCallback(async () => {
    setErroCarga('');
    setCarregando(true);
    try {
      const [rs, unis, prog] = await Promise.all([api.onboardingRamosDetalhes(), api.get('/unidades'), api.get('/onboarding/progresso')]);
      const lista = (unis as any[]) ?? [];
      setRamos(rs as any[]);
      setUnidades(lista);
      // Aplica na loja em uso; sem loja escolhida, na primeira — e a tela diz qual é.
      const emUso = getUnidadeAtual();
      setUnidadeId((lista.find((u) => u.id === emUso) ?? lista[0])?.id ?? null);
      setProgresso(prog);
    } catch (e) {
      setErroCarga(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    const cat = getCategoria() ?? '';
    setPapel(cat);
    if (cat !== 'presidente') {
      setCarregando(false);
      return;
    }
    void carregar();
  }, [router, carregar]);

  const escolherRamo = useCallback(async (r: string) => {
    setErro('');
    setRamo(r);
    setBlueprint(null);
    try {
      const bp: any = await api.onboardingBlueprint(r);
      setBlueprint(bp);
      // Pré-seleciona todos os setores e funções sugeridos; escalas nenhuma.
      setSetoresSel(bp.setores.map((s: any) => s.nome));
      setFuncoesSel(bp.setores.flatMap((s: any) => s.funcoes.map((f: any) => f.nome)));
      setEscalasSel([]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar sugestões');
    }
  }, []);

  function toggle(arr: string[], set: (v: string[]) => void, v: string) {
    set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  }

  // Funções disponíveis no passo 3 = só as dos setores ainda selecionados.
  const funcoesDisponiveis: any[] =
    blueprint?.setores
      .filter((s: any) => setoresSel.includes(s.nome))
      .flatMap((s: any) => s.funcoes.map((f: any) => ({ ...f, setor: s.nome }))) ?? [];
  const funcoesValidas = funcoesSel.filter((f) => funcoesDisponiveis.some((fd) => fd.nome === f));
  const nInsumos = (blueprint?.itens?.length ?? 0) > 0 && criarInsumos ? blueprint.itens.length : 0;
  const unidade = unidades.find((u) => u.id === unidadeId);

  async function concluir() {
    if (!unidadeId || !ramo || busy) return;
    setBusy(true);
    setErro('');
    try {
      const res: any = await api.aplicarWizard({
        unidadeId,
        ramo,
        setores: setoresSel,
        funcoes: funcoesValidas,
        escalas: escalasSel,
        criarInsumos: (blueprint?.itens?.length ?? 0) > 0 ? criarInsumos : false,
      });
      setConfirmando(false);
      setResultado(res);
    } catch (e) {
      setConfirmando(false);
      setErro(e instanceof Error ? e.message : 'Erro ao aplicar');
    } finally {
      setBusy(false);
    }
  }

  const moldura = (filho: React.ReactNode) => (
    <Shell eyebrow="Configurações" title="Configuração por ramo">{filho}</Shell>
  );

  if (papel === null || carregando) return moldura(<SkeletonList rows={4} />);

  if (papel !== 'presidente') {
    return moldura(<Card className={`p-8 text-center ${texto2}`}>Apenas o presidente / C&O pode executar o wizard de configuração.</Card>);
  }

  if (erroCarga) {
    return moldura(
      <Card className="flex flex-wrap items-center justify-center gap-3 p-8 text-center text-sm">
        <span role="alert">{erroCarga}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => void carregar()}>Tentar de novo</Button>
      </Card>,
    );
  }

  // Gate de progresso: o wizard é ferramenta de início. Acima do limite, bloqueia.
  if (progresso && progresso.pct >= LIMITE) {
    return moldura(
      <Card className="mx-auto max-w-xl p-8 text-center">
        <div className="text-4xl" aria-hidden="true">🔒</div>
        <h2 className="mt-3 font-display text-2xl font-semibold">Seu cadastro já está avançado</h2>
        <p className={`mt-2 ${texto2}`}>
          O wizard é uma ferramenta de <b>início</b> de operação e fica disponível só enquanto o cadastro está abaixo de {LIMITE}%. O seu já
          está em <b className="text-foreground">{progresso.pct}%</b>. Para ajustes, use os Cadastros.
        </p>
        <div className="mx-auto mt-4 h-2 max-w-xs overflow-hidden rounded-full bg-secondary" role="img" aria-label={`Cadastro em ${progresso.pct}%`}>
          <div className="h-2 rounded-full bg-primary" style={{ width: `${progresso.pct}%` }} />
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={() => router.push('/cadastros')}>Ir para Cadastros</Button>
          <Button variant="outline" onClick={() => router.push('/painel')}>Ir para o app</Button>
        </div>
      </Card>,
    );
  }

  if (resultado) {
    const c = resultado.criados;
    const nada = !c.setores && !c.funcoes && !c.etiquetas && !c.itens;
    return moldura(
      <Card className="mx-auto max-w-xl p-8 text-center">
        <div className="text-4xl" aria-hidden="true">{nada ? '✅' : '🚀'}</div>
        <h2 className="mt-3 font-display text-2xl font-semibold" role="status">{nada ? 'Tudo já existia' : 'Estrutura criada!'}</h2>
        <p className={`mt-2 ${texto2}`}>
          {nada ? (
            <>Nada foi duplicado — os setores/funções selecionados já estavam cadastrados.</>
          ) : (
            <>
              {c.setores} setores · {c.funcoes} funções · {c.etiquetas} vagas
              {c.itens ? ` · ${c.itens} insumos` : ''} criados.
            </>
          )}
          {c.reaproveitados > 0 && <> {c.reaproveitados} já existia(m) e foi(ram) reaproveitado(s).</>}
          {resultado.escalas?.length ? ` Modelos de escala anotados: ${resultado.escalas.join(', ')}.` : ''}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={() => router.push('/cadastros')}>Ir para Cadastros</Button>
          <Button variant="outline" onClick={() => router.push('/painel')}>Ir para o app</Button>
        </div>
      </Card>,
    );
  }

  // O que cada passo já tem marcado ("6 de 8") — só existe depois de escolher o ramo.
  const conta = [
    ramo ? '1 de 1' : '0 de 1',
    blueprint ? `${setoresSel.length} de ${blueprint.setores.length}` : '—',
    blueprint ? `${funcoesValidas.length} de ${funcoesDisponiveis.length}` : '—',
    blueprint ? `${escalasSel.length} de ${blueprint.escalas.length}` : '—',
  ];

  return moldura(
    <>
      <section className="mx-auto max-w-2xl space-y-4" aria-labelledby={ID_TITULO}>
        <div>
          <h2 id={ID_TITULO} tabIndex={-1} className="font-display text-xl font-bold outline-none">Montar a estrutura pelo ramo</h2>
          <p className={`text-sm ${texto2}`} role="status" aria-live="polite">
            Passo {step} de 4{blueprint ? ` · ${plural(setoresSel.length, 'setor', 'setores')}, ${plural(funcoesValidas.length, 'função', 'funções')} e ${plural(escalasSel.length, 'escala', 'escalas')} marcados` : ''}
            {unidade ? ` · aplica na unidade ${unidade.nome}` : ''}
          </p>
        </div>

        {/* Passos, com o que cada um tem marcado */}
        <ol className="flex flex-wrap gap-2">
          {PASSOS.map((p, i) => {
            const n = i + 1;
            return (
              <li
                key={p}
                aria-current={n === step ? 'step' : undefined}
                className={`inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold ${
                  n === step ? 'border-foreground bg-foreground text-background' : `border-input bg-card ${texto2}`
                }`}
              >
                {n < step ? <Check className="h-4 w-4" aria-hidden="true" /> : <span className="font-mono text-xs">{n}</span>}
                {p}
                <span className={`rounded-full px-2 py-px font-mono text-xs ${n === step ? 'bg-background/20' : 'bg-secondary text-foreground'}`}>{conta[i]}</span>
              </li>
            );
          })}
        </ol>

        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
        {!unidadeId ? (
          <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2 text-sm">Nenhuma unidade encontrada — cadastre uma unidade antes de aplicar o wizard.</p>
        ) : (
          unidades.length > 1 && (
            <div className="max-w-sm space-y-1.5">
              <Label htmlFor="ramo-unidade">Aplicar na unidade</Label>
              <Select id="ramo-unidade" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)}>
                {unidades.map((u) => <option key={u.id} value={u.id}>{u.nome}</option>)}
              </Select>
            </div>
          )
        )}

        <Card className="p-5">
          {/* Passo 1 — Ramo */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Qual o ramo da empresa?</h3>
                <p className={`text-sm ${texto2}`}>O Regem sugere setores, funções e tarefas padrão — tudo editável depois.</p>
              </div>
              <p className={`text-xs ${texto2}`}>
                Por enquanto, só <strong>bares &amp; restaurantes</strong> está completo. Os outros ramos estão em desenvolvimento.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ramos.map((r) => {
                  const liberado = r.ramo === 'food_service';
                  return (
                    <button
                      key={r.ramo}
                      type="button"
                      disabled={!liberado}
                      aria-pressed={liberado ? ramo === r.ramo : undefined}
                      onClick={() => liberado && escolherRamo(r.ramo)}
                      title={liberado ? undefined : 'Em desenvolvimento — disponível em breve'}
                      className={`relative flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none ${
                        !liberado ? 'cursor-not-allowed border-border opacity-60' : ramo === r.ramo ? 'border-2 border-primary bg-primary/10' : 'border-input hover:bg-secondary'
                      }`}
                    >
                      <span className="text-3xl" aria-hidden="true">{r.emoji}</span>
                      <span className="text-xs font-semibold leading-tight">{r.label}</span>
                      {!liberado && <span className={`rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${texto2}`}>Em breve</span>}
                    </button>
                  );
                })}
              </div>
              {ramo && !blueprint && !erro && <p className={`text-sm ${texto2}`} role="status">Carregando as sugestões do ramo…</p>}
            </div>
          )}

          {/* Passo 2 — Setores */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Setores sugeridos</h3>
                <p className={`text-sm ${texto2}`}>Toque para incluir ou remover.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {blueprint?.setores.map((s: any) => (
                  <Chip key={s.nome} label={s.nome} on={setoresSel.includes(s.nome)} onClick={() => toggle(setoresSel, setSetoresSel, s.nome)} />
                ))}
              </div>
            </div>
          )}

          {/* Passo 3 — Funções */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Funções que mais se qualificam</h3>
                <p className={`text-sm ${texto2}`}>Cada função poderá receber POPs e escalas próprias.</p>
              </div>
              {funcoesDisponiveis.length === 0 ? (
                <p className={`text-sm ${texto2}`}>Selecione ao menos um setor no passo anterior.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {funcoesDisponiveis.map((f: any) => (
                    <Chip key={f.nome} label={f.nome} on={funcoesSel.includes(f.nome)} onClick={() => toggle(funcoesSel, setFuncoesSel, f.nome)} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Passo 4 — Escalas + resumo */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h3 className="font-display text-lg font-semibold">Modelos de escala</h3>
                <p className={`text-sm ${texto2}`}>Selecione os que sua operação utiliza.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {blueprint?.escalas.map((e: string) => (
                  <Chip key={e} label={e} on={escalasSel.includes(e)} onClick={() => toggle(escalasSel, setEscalasSel, e)} />
                ))}
              </div>
              {(blueprint?.itens?.length ?? 0) > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">Criar insumos básicos do ramo</span> <span className={texto2}>({blueprint.itens.length} itens)</span>
                    <span className={`mt-0.5 block text-xs ${texto2}`}>{blueprint.itens.map((i: any) => i.nome).join(' · ')} — já semeia o estoque (não duplica).</span>
                  </span>
                  <Chave ligada={criarInsumos} rotulo="Criar insumos básicos do ramo" aoMudar={setCriarInsumos} />
                </div>
              )}
              <div className="rounded-xl border border-border bg-secondary p-4 text-sm">
                <p className="font-semibold">Resumo</p>
                <p className={`mt-1 ${texto2}`}>
                  Ramo: <b className="text-foreground">{blueprint?.label}</b> · {setoresSel.length} setores · {funcoesValidas.length} funções
                  {nInsumos ? ` · ${nInsumos} insumos` : ''}. Ao concluir, o Regem cria o que estiver selecionado (sem duplicar o que já existe).
                </p>
              </div>
            </div>
          )}

          {/* Navegação */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
            <Button variant="outline" disabled={step === 1} onClick={() => setStep((s) => s - 1)}>← Voltar</Button>
            {step < 4 ? (
              <Button disabled={(step === 1 && (!ramo || !blueprint)) || (step === 2 && setoresSel.length === 0)} onClick={() => setStep((s) => s + 1)}>
                Avançar ▸
              </Button>
            ) : (
              <Button disabled={busy || !unidadeId || setoresSel.length === 0} onClick={() => setConfirmando(true)}>
                Concluir
              </Button>
            )}
          </div>
        </Card>
      </section>

      {confirmando && (
        <Dialogo alerta titulo="Aplicar a estrutura?" aoFechar={() => (busy ? undefined : setConfirmando(false))} voltarPara={ID_TITULO}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial onClick={() => setConfirmando(false)} disabled={busy}>Cancelar</Button>
              <Button type="button" onClick={() => void concluir()} disabled={busy}>{busy ? 'Aplicando…' : 'Aplicar'}</Button>
            </>
          }>
          <div className="space-y-3 text-sm">
            <p>Serão criados na unidade <b>{unidade?.nome ?? '—'}</b>:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              <li>{plural(setoresSel.length, 'setor', 'setores')}</li>
              <li>{plural(funcoesValidas.length, 'função, com a vaga dela', 'funções, com as vagas delas')}</li>
              {escalasSel.length > 0 && <li>{plural(escalasSel.length, 'modelo de escala anotado', 'modelos de escala anotados')}</li>}
              {nInsumos > 0 && <li>{plural(nInsumos, 'insumo básico', 'insumos básicos')}</li>}
            </ul>
            <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2">
              O wizard vai criar setores, funções, vagas{nInsumos ? ' e insumos' : ''} na sua operação. Ele não apaga o que já existe, mas mudanças na
              estrutura podem afetar dados já cadastrados. Confira o resumo.
            </p>
          </div>
        </Dialogo>
      )}
    </>,
  );
}
