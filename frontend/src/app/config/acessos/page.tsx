'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Toggle acessível (aria-pressed) reutilizado nas permissões.
function Toggle({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors ${
        on ? 'bg-primary' : 'bg-secondary'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-card shadow transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

function Linha({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="text-sm">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex flex-none items-center gap-2">{children}</div>
    </div>
  );
}

const ACOES = ['ver', 'criar', 'editar', 'excluir'] as const;

export default function AcessosPage() {
  const router = useRouter();
  const [perfis, setPerfis] = useState<any[]>([]);
  const [pessoas, setPessoas] = useState<any[]>([]);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    try {
      const [ps, cs] = await Promise.all([api.get('/perfis'), api.colaboradores()]);
      setPerfis(ps ?? []);
      setPessoas(cs ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    if (getCategoria() !== 'presidente') {
      router.replace('/painel');
      return;
    }
    carregar();
  }, [carregar, router]);

  // Edição local de um perfil.
  function setPerfil(id: string, patch: (p: any) => any) {
    setPerfis((arr) => arr.map((p) => (p.id === id ? patch({ ...p }) : p)));
  }
  function setPerm(id: string, path: string, valor: boolean) {
    setPerfil(id, (p) => {
      const perm = { ...(p.permissoes ?? {}) };
      if (path.includes('.')) {
        const [mod, acao] = path.split('.');
        perm[mod] = { ...(perm[mod] ?? {}), [acao]: valor };
      } else {
        perm[path] = valor;
      }
      p.permissoes = perm;
      return p;
    });
  }
  async function salvarPerfil(p: any) {
    try {
      await api.patch(`/perfis/${p.id}`, {
        loginWeb: p.loginWeb,
        permissoes: p.permissoes,
      });
      toast.success(`Perfil ${p.nome} salvo.`);
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar perfil');
    }
  }

  async function salvarAcesso(id: string, body: any) {
    try {
      await api.patch(`/colaboradores/${id}/acesso`, body);
      toast.success('Acesso atualizado.');
      setPessoas((arr) => arr.map((c) => (c.id === id ? { ...c, ...body } : c)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao atualizar acesso');
      carregar();
    }
  }

  const perfilNome = (id: string | null) =>
    perfis.find((p) => p.id === id)?.nome ?? '—';

  return (
    <Shell eyebrow="Configuração · segurança" title="Acessos & perfis">
      <div className="max-w-4xl space-y-6">
        {erro && <p className="text-destructive">{erro}</p>}

        {/* ── Perfis de acesso ── */}
        <section className="space-y-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Perfis de acesso</h2>
            <p className="text-sm text-muted-foreground">
              Ligue/desligue o que cada perfil enxerga e faz. As mudanças valem no
              próximo login do colaborador.
            </p>
          </div>

          {perfis.map((p) => {
            const pres = p.nivel === 'presidente';
            const perm = p.permissoes ?? {};
            return (
              <Card key={p.id} className="p-4">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <p className="font-display font-bold">{p.nome}</p>
                    <p className="text-xs text-muted-foreground">nível: {p.nivel}</p>
                  </div>
                  {pres ? (
                    <span className="rounded bg-ok/15 px-2 py-1 text-xs font-bold text-ok">
                      Acesso total (fixo)
                    </span>
                  ) : (
                    <Button type="button" size="sm" onClick={() => salvarPerfil(p)}>
                      Salvar
                    </Button>
                  )}
                </div>

                {!pres && (
                  <div className="divide-y divide-border/60">
                    <Linha label="Entrar pelo sistema (e-mail + senha)" hint="Desligado = só PIN (ponto/app)">
                      <Toggle label="login web" on={!!p.loginWeb} onChange={(v) => setPerfil(p.id, (x) => ((x.loginWeb = v), x))} />
                    </Linha>
                    <Linha label="Ver valores financeiros (R$)" hint="Faturamento, custos, valor de estoque, CMV">
                      <Toggle label="ver financeiro" on={!!perm.ver_financeiro} onChange={(v) => setPerm(p.id, 'ver_financeiro', v)} />
                    </Linha>
                    <Linha label="Módulo Financeiro" hint="Contas a pagar/receber, fluxo, DRE">
                      <Toggle label="financeiro" on={!!perm.financeiro} onChange={(v) => setPerm(p.id, 'financeiro', v)} />
                    </Linha>
                    <Linha label="Módulo Fiscal" hint="Notas fiscais (NFC-e)">
                      <Toggle label="fiscal" on={!!perm.fiscal} onChange={(v) => setPerm(p.id, 'fiscal', v)} />
                    </Linha>

                    <div className="py-2">
                      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Ponto</p>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                        {ACOES.map((a) => (
                          <label key={a} className="flex items-center justify-between gap-2 text-sm capitalize">
                            {a}
                            <Toggle label={`ponto ${a}`} on={!!perm.ponto?.[a]} onChange={(v) => setPerm(p.id, `ponto.${a}`, v)} />
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="py-2">
                      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">Estoque</p>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                        {ACOES.map((a) => (
                          <label key={a} className="flex items-center justify-between gap-2 text-sm capitalize">
                            {a}
                            <Toggle label={`estoque ${a}`} on={!!perm.estoque?.[a]} onChange={(v) => setPerm(p.id, `estoque.${a}`, v)} />
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </section>

        {/* ── Colaboradores & acesso ── */}
        <section className="space-y-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Colaboradores & acesso</h2>
            <p className="text-sm text-muted-foreground">
              Associe o perfil de cada colaborador, libere o app e bloqueie o acesso
              quando precisar.
            </p>
          </div>

          <Card className="p-0">
            <div className="divide-y divide-border">
              {pessoas.length === 0 && (
                <p className="px-4 py-6 text-sm text-muted-foreground">Nenhum colaborador.</p>
              )}
              {pessoas.map((c) => {
                const bloqueado = c.status === 'bloqueado';
                return (
                  <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {c.nome}
                        {bloqueado && (
                          <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold text-destructive">bloqueado</span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {c.email ?? 'sem e-mail'} · perfil atual: {perfilNome(c.perfilAcessoId)}
                      </p>
                    </div>

                    <label className="flex items-center gap-1.5 text-xs">
                      Perfil
                      <select
                        aria-label={`Perfil de ${c.nome}`}
                        className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                        value={c.perfilAcessoId ?? ''}
                        onChange={(e) => salvarAcesso(c.id, { perfilAcessoId: e.target.value })}
                      >
                        <option value="" disabled>—</option>
                        {perfis.map((p) => (
                          <option key={p.id} value={p.id}>{p.nome}</option>
                        ))}
                      </select>
                    </label>

                    <label className="flex items-center gap-1.5 text-xs" title="Libera o PIN do app do colaborador">
                      App
                      <Toggle label={`app de ${c.nome}`} on={!!c.appHabilitado} onChange={(v) => salvarAcesso(c.id, { appHabilitado: v })} />
                    </label>

                    <label className="flex items-center gap-1.5 text-xs">
                      Ativo
                      <Toggle
                        label={`acesso de ${c.nome}`}
                        on={!bloqueado}
                        onChange={(v) => salvarAcesso(c.id, { status: v ? 'ativo' : 'bloqueado' })}
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </Card>
        </section>
      </div>
    </Shell>
  );
}
