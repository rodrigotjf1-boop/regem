'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Sparkles } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EntityForm, type FieldDef } from '@/components/cadastros/entity-form';
import { RegemMark } from '@/components/brand/regem-mark';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Status = {
  unidades: any[];
  setores: any[];
  funcoes: any[];
  colaboradores: any[];
  turnos: any[];
  etiquetas: any[];
};

const TOTAL = 5;

export default function InicioPage() {
  const router = useRouter();
  const [s, setS] = useState<Status | null>(null);
  const [step, setStep] = useState(0);
  const [erro, setErro] = useState('');
  const [ver, setVer] = useState(0);
  const [busy, setBusy] = useState(false);

  const carregar = useCallback(async () => {
    const [unidades, setores, funcoes, colaboradores, turnos, etiquetas] =
      await Promise.all([
        api.get('/unidades'),
        api.get('/setores'),
        api.get('/funcoes'),
        api.get('/colaboradores'),
        api.get('/turnos'),
        api.get('/etiquetas'),
      ]);
    setS({ unidades, setores, funcoes, colaboradores, turnos, etiquetas });
    setVer((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    carregar().catch((e) =>
      setErro(e instanceof Error ? e.message : 'Erro ao carregar'),
    );
  }, [carregar, router]);

  if (!s) {
    return (
      <div className="grid min-h-dvh place-items-center text-muted-foreground">
        Carregando…
      </div>
    );
  }

  const optF = s.funcoes.map((f: any) => ({ value: f.id, label: f.nome }));
  const withNone = (arr: any[]) => [{ value: '', label: '— sem função —' }, ...arr];
  const unidadeId = s.unidades[0]?.id;

  async function aplicarTemplate() {
    setBusy(true);
    setErro('');
    try {
      await api.post('/onboarding/template', { unidadeId, ramo: 'food_service' });
      await carregar();
      setStep(3);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao aplicar pacote');
    } finally {
      setBusy(false);
    }
  }

  const feito = (
    <span className="inline-flex items-center gap-1 text-sm font-medium text-primary">
      <Check className="h-4 w-4" /> já configurado
    </span>
  );

  function Passo({
    titulo,
    fala,
    children,
  }: {
    titulo: string;
    fala: string;
    children: React.ReactNode;
  }) {
    return (
      <Card className="p-6">
        {step > 0 && (
          <p className="mb-1 font-mono text-[.68rem] uppercase tracking-[.16em] text-muted-foreground">
            Passo {step} de {TOTAL}
          </p>
        )}
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          {titulo}
        </h2>
        <p className="mt-2 text-muted-foreground">{fala}</p>
        <div className="mt-5">{children}</div>
      </Card>
    );
  }

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <RegemMark className="h-8 w-8 text-foreground" />
            <span className="font-display text-lg font-semibold">Regem</span>
          </div>
          <button
            onClick={() => router.push('/meu-dia')}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Ir para o app
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-8">
        {erro && (
          <p role="alert" className="mb-4 text-destructive">
            {erro}
          </p>
        )}

        {/* 0 — Boas-vindas */}
        {step === 0 && (
          <Card className="p-6">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <h1 className="font-display text-3xl font-bold tracking-tight">
              Bem-vindo ao Regem 👋
            </h1>
            <p className="mt-3 text-muted-foreground">
              Vou te guiar em {TOTAL} passos rápidos para deixar sua operação
              pronta. Você pode pular o que não for essencial e voltar depois —
              nada fica quebrado.
            </p>
            <Button className="mt-6 w-full" size="lg" onClick={() => setStep(1)}>
              Começar <ArrowRight className="h-4 w-4" />
            </Button>
          </Card>
        )}

        {/* 1 — Unidade */}
        {step === 1 && (
          <Passo
            titulo="Onde fica sua operação?"
            fala="Comece cadastrando sua primeira unidade (loja/restaurante). É a base de tudo."
          >
            {s.unidades.length > 0 ? (
              <div className="space-y-4">
                <p>
                  {feito} — <b>{s.unidades[0].nome}</b>
                </p>
                <Button className="w-full" onClick={() => setStep(2)}>
                  Continuar <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <EntityForm
                key={`uni-${ver}`}
                submitLabel="Criar unidade e continuar"
                fields={
                  [
                    { name: 'nome', label: 'Nome da unidade', type: 'text', required: true, placeholder: 'Ex.: Matriz' },
                  ] as FieldDef[]
                }
                onSubmit={async (v) => {
                  await api.post('/unidades', { nome: v.nome });
                  await carregar();
                  setStep(2);
                }}
              />
            )}
          </Passo>
        )}

        {/* 2 — Estrutura (template) */}
        {step === 2 && (
          <Passo
            titulo="Vamos montar a estrutura?"
            fala="Aplique o pacote do seu ramo e o Regem cria setores, funções, vagas (etiquetas), tipos de ocorrência e itens de estoque de uma vez. Dá pra ajustar tudo depois."
          >
            {s.setores.length > 0 ? (
              <div className="space-y-4">
                <p>
                  {feito} — {s.setores.length} setores, {s.etiquetas.length} vagas
                </p>
                <Button className="w-full" onClick={() => setStep(3)}>
                  Continuar <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Button className="w-full" size="lg" disabled={busy} onClick={aplicarTemplate}>
                  <Sparkles className="h-4 w-4" />
                  {busy ? 'Aplicando…' : 'Aplicar pacote Food Service'}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => setStep(3)}
                >
                  Pular — configuro manualmente depois
                </Button>
              </div>
            )}
          </Passo>
        )}

        {/* 3 — Equipe */}
        {step === 3 && (
          <Passo
            titulo="Quem faz parte da equipe?"
            fala="Adicione seus colaboradores. Eles serão alocados na escala e nas tarefas. (Você pode adicionar vários.)"
          >
            <div className="space-y-4">
              {s.colaboradores.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {s.colaboradores.length} colaborador(es) cadastrado(s).
                </p>
              )}
              <EntityForm
                key={`col-${ver}`}
                submitLabel="Adicionar colaborador"
                fields={
                  [
                    { name: 'nome', label: 'Nome', type: 'text', required: true, placeholder: 'Ex.: Maria' },
                    { name: 'funcaoId', label: 'Função', type: 'select', options: withNone(optF) },
                    { name: 'pin', label: 'PIN de acesso (opcional)', type: 'text', placeholder: 'ex.: 1234' },
                  ] as FieldDef[]
                }
                onSubmit={async (v) => {
                  await api.post('/colaboradores', {
                    nome: v.nome,
                    funcaoId: v.funcaoId || undefined,
                    pin: v.pin || undefined,
                  });
                  await carregar();
                }}
              />
              <Button className="w-full" onClick={() => setStep(4)}>
                {s.colaboradores.length > 0 ? 'Continuar' : 'Pular por agora'}{' '}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </Passo>
        )}

        {/* 4 — Turnos */}
        {step === 4 && (
          <Passo
            titulo="Quais são os turnos?"
            fala="Defina os horários de trabalho (ex.: Almoço 11:00–15:00). Precisamos deles para montar a escala."
          >
            <div className="space-y-4">
              {s.turnos.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {s.turnos.length} turno(s) cadastrado(s).
                </p>
              )}
              <EntityForm
                key={`tur-${ver}`}
                submitLabel="Adicionar turno"
                fields={
                  [
                    { name: 'nome', label: 'Nome', type: 'text', required: true, placeholder: 'Ex.: Almoço' },
                    { name: 'horaInicio', label: 'Início (HH:MM)', type: 'text', required: true, placeholder: '11:00' },
                    { name: 'horaFim', label: 'Fim (HH:MM)', type: 'text', required: true, placeholder: '15:00' },
                  ] as FieldDef[]
                }
                onSubmit={async (v) => {
                  await api.post('/turnos', {
                    unidadeId,
                    nome: v.nome,
                    horaInicio: v.horaInicio,
                    horaFim: v.horaFim,
                  });
                  await carregar();
                }}
              />
              <Button className="w-full" onClick={() => setStep(5)}>
                {s.turnos.length > 0 ? 'Continuar' : 'Pular por agora'}{' '}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </Passo>
        )}

        {/* 5 — Pronto */}
        {step === 5 && (
          <Passo
            titulo="Tudo pronto! 🎉"
            fala="Sua operação está configurada. Você pode ajustar qualquer coisa em Cadastros a qualquer momento."
          >
            <div className="space-y-4">
              <ul className="space-y-1.5 text-sm">
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" /> {s.unidades.length}{' '}
                  unidade(s)
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" /> {s.setores.length}{' '}
                  setores · {s.etiquetas.length} vagas
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" />{' '}
                  {s.colaboradores.length} colaborador(es)
                </li>
                <li className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" /> {s.turnos.length}{' '}
                  turno(s)
                </li>
              </ul>
              <Button className="w-full" size="lg" onClick={() => router.push('/meu-dia')}>
                Ir para o app <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </Passo>
        )}
      </main>
    </div>
  );
}
