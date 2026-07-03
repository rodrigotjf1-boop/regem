'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */

const PASSOS = ['Ramo', 'Setores', 'Funções', 'Escalas'];

function Chip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-sm transition ${
        on
          ? 'border-primary bg-primary/10 font-medium text-primary'
          : 'border-border text-muted-foreground hover:bg-muted'
      }`}
    >
      {on ? '✓ ' : ''}
      {label}
    </button>
  );
}

export default function WizardPage() {
  const router = useRouter();
  const [ramos, setRamos] = useState<any[]>([]);
  const [unidadeId, setUnidadeId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [ramo, setRamo] = useState<string | null>(null);
  const [blueprint, setBlueprint] = useState<any>(null);
  const [setoresSel, setSetoresSel] = useState<string[]>([]);
  const [funcoesSel, setFuncoesSel] = useState<string[]>([]);
  const [escalasSel, setEscalasSel] = useState<string[]>([]);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<any>(null);

  const gestor = ['presidente', 'gerente'].includes(getCategoria() ?? '');

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    (async () => {
      try {
        const [rs, unis] = await Promise.all([
          api.onboardingRamosDetalhes(),
          api.get('/unidades'),
        ]);
        setRamos(rs);
        setUnidadeId((unis as any[])[0]?.id ?? null);
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Erro ao carregar');
      }
    })();
  }, [router]);

  const escolherRamo = useCallback(async (r: string) => {
    setErro('');
    setRamo(r);
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

  async function concluir() {
    if (!unidadeId || !ramo) return;
    setBusy(true);
    setErro('');
    try {
      const funcoesValidas = funcoesSel.filter((f) =>
        funcoesDisponiveis.some((fd) => fd.nome === f),
      );
      const res: any = await api.aplicarWizard({
        unidadeId,
        ramo,
        setores: setoresSel,
        funcoes: funcoesValidas,
        escalas: escalasSel,
      });
      setResultado(res);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao aplicar');
    } finally {
      setBusy(false);
    }
  }

  if (!gestor) {
    return (
      <Shell eyebrow="Onboarding" title="Configuração por ramo">
        <Card className="p-8 text-center text-muted-foreground">
          Apenas presidente e gerente podem executar o wizard.
        </Card>
      </Shell>
    );
  }

  if (resultado) {
    return (
      <Shell eyebrow="Onboarding" title="Configuração por ramo">
        <Card className="mx-auto max-w-xl p-8 text-center">
          <div className="text-4xl">🚀</div>
          <h2 className="mt-3 font-display text-2xl font-semibold">Estrutura criada!</h2>
          <p className="mt-2 text-muted-foreground">
            {resultado.criados.setores} setores · {resultado.criados.funcoes} funções ·{' '}
            {resultado.criados.etiquetas} vagas criadas.
            {resultado.escalas?.length
              ? ` Modelos de escala anotados: ${resultado.escalas.join(', ')}.`
              : ''}
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <Button onClick={() => router.push('/cadastros')}>Ir para Cadastros</Button>
            <Button variant="outline" onClick={() => router.push('/painel')}>
              Ir para o app
            </Button>
          </div>
        </Card>
      </Shell>
    );
  }

  return (
    <Shell eyebrow="Onboarding" title="Configuração por ramo">
      <div className="mx-auto max-w-2xl space-y-6">
        {/* Passos */}
        <div className="flex items-center gap-2">
          {PASSOS.map((p, i) => {
            const n = i + 1;
            return (
              <div key={p} className="flex flex-1 items-center gap-2">
                <div
                  className={`grid h-7 w-7 flex-none place-items-center rounded-full text-xs font-bold ${
                    n === step
                      ? 'bg-primary text-primary-foreground'
                      : n < step
                        ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {n < step ? '✓' : n}
                </div>
                <span className={`text-xs ${n === step ? 'font-semibold' : 'text-muted-foreground'}`}>
                  {p}
                </span>
                {i < PASSOS.length - 1 && <div className="h-px flex-1 bg-border" />}
              </div>
            );
          })}
        </div>

        {erro && <p className="text-destructive">{erro}</p>}
        {!unidadeId && (
          <p className="text-sm text-warn">
            Nenhuma unidade encontrada — cadastre uma unidade antes de aplicar o wizard.
          </p>
        )}

        <Card className="p-6">
          {/* Passo 1 — Ramo */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-xl font-semibold">Qual o ramo da empresa?</h2>
                <p className="text-sm text-muted-foreground">
                  O Regem sugere setores, funções e tarefas padrão — tudo editável depois.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ramos.map((r) => (
                  <button
                    key={r.ramo}
                    type="button"
                    onClick={() => escolherRamo(r.ramo)}
                    className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition ${
                      ramo === r.ramo
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted'
                    }`}
                  >
                    <span className="text-3xl">{r.emoji}</span>
                    <span className="text-xs font-medium leading-tight">{r.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Passo 2 — Setores */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-xl font-semibold">Setores sugeridos</h2>
                <p className="text-sm text-muted-foreground">Toque para incluir ou remover.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {blueprint?.setores.map((s: any) => (
                  <Chip
                    key={s.nome}
                    label={s.nome}
                    on={setoresSel.includes(s.nome)}
                    onClick={() => toggle(setoresSel, setSetoresSel, s.nome)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Passo 3 — Funções */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-xl font-semibold">
                  Funções que mais se qualificam
                </h2>
                <p className="text-sm text-muted-foreground">
                  Cada função poderá receber POPs e escalas próprias.
                </p>
              </div>
              {funcoesDisponiveis.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Selecione ao menos um setor no passo anterior.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {funcoesDisponiveis.map((f: any) => (
                    <Chip
                      key={f.nome}
                      label={f.nome}
                      on={funcoesSel.includes(f.nome)}
                      onClick={() => toggle(funcoesSel, setFuncoesSel, f.nome)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Passo 4 — Escalas + resumo */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h2 className="font-display text-xl font-semibold">Modelos de escala</h2>
                <p className="text-sm text-muted-foreground">
                  Selecione os que sua operação utiliza.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {blueprint?.escalas.map((e: string) => (
                  <Chip
                    key={e}
                    label={e}
                    on={escalasSel.includes(e)}
                    onClick={() => toggle(escalasSel, setEscalasSel, e)}
                  />
                ))}
              </div>
              <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm">
                <p className="font-semibold">🚀 Resumo</p>
                <p className="mt-1 text-muted-foreground">
                  Ramo: <b className="text-foreground">{blueprint?.label}</b> ·{' '}
                  {setoresSel.length} setores ·{' '}
                  {funcoesSel.filter((f) => funcoesDisponiveis.some((fd) => fd.nome === f)).length}{' '}
                  funções. Ao concluir, o Regem cria os setores, funções e vagas.
                </p>
              </div>
            </div>
          )}

          {/* Navegação */}
          <div className="mt-6 flex items-center justify-between">
            <Button
              variant="ghost"
              disabled={step === 1}
              onClick={() => setStep((s) => s - 1)}
            >
              ← Voltar
            </Button>
            {step < 4 ? (
              <Button
                disabled={
                  (step === 1 && !ramo) ||
                  (step === 2 && setoresSel.length === 0)
                }
                onClick={() => setStep((s) => s + 1)}
              >
                Avançar ▸
              </Button>
            ) : (
              <Button
                disabled={busy || !unidadeId || setoresSel.length === 0}
                onClick={concluir}
              >
                {busy ? 'Aplicando…' : '✓ Concluir'}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
