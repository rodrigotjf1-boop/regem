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

// F9 — Acesso de suporte da distribuição: o presidente vê as sessões e pode
// bloquear/liberar (bloquear encerra as ativas na hora).
function SuporteCard() {
  const [est, setEst] = useState<any>(null);
  const [sessoes, setSessoes] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const carregar = useCallback(async () => {
    try {
      const [e, s]: any = await Promise.all([api.suporteEstado(), api.suporteSessoes().catch(() => [])]);
      setEst(e); setSessoes(Array.isArray(s) ? s : []);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  async function alternar(bloquear: boolean) {
    setBusy(true);
    try { const e: any = await api.suporteBloquear(bloquear); setEst(e); await carregar(); toast.success(bloquear ? 'Acesso de suporte bloqueado.' : 'Acesso de suporte liberado.'); }
    catch (err) { toast.error(err instanceof Error ? err.message : 'Erro'); }
    finally { setBusy(false); }
  }
  const dt = (v: any) => (v ? new Date(v).toLocaleString('pt-BR') : '—');
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold">Acesso de suporte</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Técnicos da distribuição podem acessar <strong>apenas as configurações</strong> (impressão, KDS,
            direcionamento, cupom) — nunca financeiro, dados de clientes ou vendas. Toda ação fica na sua
            auditoria. Você pode bloquear a qualquer momento.
          </p>
        </div>
        <label className="flex flex-none items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-primary" disabled={busy}
            checked={!!est?.bloqueado} onChange={(e) => alternar(e.target.checked)} />
          Bloquear acesso de suporte
        </label>
      </div>
      {est?.sessoesAtivas?.length > 0 && (
        <p className="mt-2 rounded bg-amber-500/15 px-2 py-1 text-xs text-amber-700">
          🛠️ Suporte ativo agora: {est.sessoesAtivas.map((x: any) => x.tecnicoNome || 'técnico').join(', ')}.
        </p>
      )}
      {sessoes.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-xs">
            <caption className="sr-only">Histórico de acessos de suporte</caption>
            <thead><tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1 pr-2 font-medium">Técnico</th><th className="py-1 pr-2 font-medium">Início</th>
              <th className="py-1 pr-2 font-medium">Fim</th><th className="py-1 font-medium">Motivo</th>
            </tr></thead>
            <tbody>
              {sessoes.slice(0, 10).map((s) => (
                <tr key={s.id} className="border-b border-border/60">
                  <td className="py-1 pr-2">{s.tecnicoNome || '—'}</td>
                  <td className="py-1 pr-2">{dt(s.iniciadaEm)}</td>
                  <td className="py-1 pr-2">{s.encerradaEm ? `${dt(s.encerradaEm)} (${s.encerradaPor})` : 'ativo'}</td>
                  <td className="py-1">{s.motivo || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function AcessosPage() {
  const router = useRouter();
  const [perfis, setPerfis] = useState<any[]>([]);
  const [pessoas, setPessoas] = useState<any[]>([]);
  const [catalogo, setCatalogo] = useState<any[]>([]);
  const [novoNome, setNovoNome] = useState('');
  const [novoNivel, setNovoNivel] = useState('execucao');
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    try {
      const [ps, cs, cat] = await Promise.all([
        api.get('/perfis'),
        api.colaboradores(),
        api.get('/perfis/catalogo').catch(() => []),
      ]);
      setPerfis(ps ?? []);
      setPessoas(cs ?? []);
      setCatalogo((cat as any[]) ?? []);
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

  async function criarPerfil() {
    const nome = novoNome.trim();
    if (!nome) return;
    try {
      await api.post('/perfis', { nome, nivel: novoNivel });
      setNovoNome('');
      toast.success(`Perfil ${nome} criado.`);
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar perfil');
    }
  }
  async function removerPerfil(p: any) {
    if (!confirm(`Remover o perfil "${p.nome}"?`)) return;
    try {
      await api.del(`/perfis/${p.id}`);
      toast.success('Perfil removido.');
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao remover perfil');
    }
  }

  // Catálogo agrupado (mantém a ordem de inserção dos grupos).
  const grupos = catalogo.reduce((acc: Record<string, any[]>, it: any) => {
    (acc[it.grupo] = acc[it.grupo] ?? []).push(it);
    return acc;
  }, {});

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
      <div className="space-y-6">
        {erro && <p className="text-destructive">{erro}</p>}

        {/* ── Acesso de suporte (F9) ── */}
        <SuporteCard />

        {/* ── Perfis de acesso ── */}
        <section className="space-y-3">
          <div>
            <h2 className="font-display text-lg font-semibold">Perfis de acesso</h2>
            <p className="text-sm text-muted-foreground">
              Ligue/desligue o que cada perfil enxerga e faz. As mudanças valem no
              próximo login do colaborador.
            </p>
          </div>

          {/* Novo perfil (o presidente pode acrescentar além dos 4 base) */}
          <Card className="flex flex-wrap items-end gap-3 border-dashed p-4">
            <div className="min-w-0 flex-1 space-y-1">
              <label className="text-xs text-muted-foreground">Nome do novo perfil</label>
              <input
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                placeholder="Ex.: Caixa, Cozinheiro, Atendente"
                className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Nível (hierarquia)</label>
              <select
                aria-label="Nível do novo perfil"
                value={novoNivel}
                onChange={(e) => setNovoNivel(e.target.value)}
                className="h-10 rounded-md border border-input bg-card px-2 text-sm"
              >
                <option value="gerente">Gerência / ADM</option>
                <option value="supervisao">Supervisão</option>
                <option value="execucao">Execução</option>
              </select>
            </div>
            <Button type="button" onClick={criarPerfil} disabled={!novoNome.trim()}>
              Adicionar perfil
            </Button>
          </Card>

          {perfis.map((p) => {
            const pres = p.nivel === 'presidente';
            const perm = p.permissoes ?? {};
            return (
              <Card key={p.id} className="p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="font-display font-bold">{p.nome}</p>
                    <p className="text-xs text-muted-foreground">nível: {p.nivel}</p>
                  </div>
                  {pres ? (
                    <span className="rounded bg-ok/15 px-2 py-1 text-xs font-bold text-ok">
                      Acesso total (fixo)
                    </span>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => removerPerfil(p)}>
                        Remover
                      </Button>
                      <Button type="button" size="sm" onClick={() => salvarPerfil(p)}>
                        Salvar
                      </Button>
                    </div>
                  )}
                </div>

                {!pres && (
                  <div className="space-y-3">
                    <Linha label="Entrar pelo sistema (e-mail + senha)" hint="Desligado = só PIN (ponto/app)">
                      <Toggle label="login web" on={!!p.loginWeb} onChange={(v) => setPerfil(p.id, (x) => ((x.loginWeb = v), x))} />
                    </Linha>

                    {Object.entries(grupos).map(([grupo, itens]) => (
                      <div key={grupo}>
                        <p className="mb-1 mt-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{grupo}</p>
                        <div className="divide-y divide-border/60">
                          {(itens as any[]).map((it) =>
                            it.tipo === 'crud' ? (
                              <div key={it.chave} className="py-2">
                                <p className="mb-1 text-sm">{it.rotulo}</p>
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                                  {ACOES.map((a) => (
                                    <label key={a} className="flex items-center justify-between gap-2 text-sm capitalize">
                                      {a}
                                      <Toggle label={`${it.chave} ${a}`} on={!!perm[it.chave]?.[a]} onChange={(v) => setPerm(p.id, `${it.chave}.${a}`, v)} />
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <Linha key={it.chave} label={it.rotulo}>
                                <Toggle label={it.rotulo} on={!!perm[it.chave]} onChange={(v) => setPerm(p.id, it.chave, v)} />
                              </Linha>
                            ),
                          )}
                        </div>
                      </div>
                    ))}
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
              Associe o perfil de cada colaborador, libere o app, autorize o acesso
              online (nuvem) e bloqueie o acesso quando precisar. Por padrão, só o
              presidente entra pela nuvem — os demais operam no servidor local da loja.
            </p>
          </div>

          <Card className="p-0">
            <div className="divide-y divide-border">
              {pessoas.length === 0 && (
                <p className="px-4 py-6 text-sm text-muted-foreground">Nenhum colaborador.</p>
              )}
              {pessoas.map((c) => {
                const bloqueado = c.status === 'bloqueado';
                // Presidente/C&O é dono: acessa a nuvem sempre (toggle travado ligado).
                const ehPres =
                  perfis.find((p) => p.id === c.perfilAcessoId)?.nivel === 'presidente';
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

                    <label
                      className="flex items-center gap-1.5 text-xs"
                      title="Deixa entrar pelo app ONLINE (nuvem). Desligado = só no servidor local da loja. Presidente/C&O acessa sempre."
                    >
                      Nuvem
                      <Toggle
                        label={`acesso online de ${c.nome}`}
                        on={ehPres || !!c.podeNuvem}
                        disabled={ehPres}
                        onChange={(v) => salvarAcesso(c.id, { podeNuvem: v })}
                      />
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
