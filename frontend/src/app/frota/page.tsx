'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';

/* eslint-disable @typescript-eslint/no-explicit-any */
const MODULOS = ['kds', 'ponto', 'app_colaborador', 'cashback', 'fidelidade', 'integracoes', 'bot'];
const dh = (d: any) => (d ? new Date(d).toLocaleString('pt-BR') : '—');

export default function FrotaPage() {
  const router = useRouter();
  const [cat, setCat] = useState<string | null>(null);
  const [frota, setFrota] = useState<any[]>([]);
  const [form, setForm] = useState<any>({ tenantId: '', ramo: 'food_service', plano: 'basico', modulos: [] as string[], trial: false, validadeDias: '' });
  const [tokenNovo, setTokenNovo] = useState<string | null>(null);
  const [restrito, setRestrito] = useState(false);

  const carregar = useCallback(async () => {
    try { setFrota((await api.frotaEdge()) as any[]); setRestrito(false); }
    catch (e) { if (e instanceof Error && /restrit/i.test(e.message)) setRestrito(true); }
  }, []);
  useEffect(() => {
    setCat(getCategoria());
    if (!getToken()) { router.replace('/entrar'); return; }
    carregar();
    const t = setInterval(carregar, 30000);
    return () => clearInterval(t);
  }, [carregar, router]);

  if (restrito || (cat && cat !== 'presidente')) {
    return <Shell eyebrow="Frota" title="Revenda & frota"><Card className="p-4"><p className="text-sm text-muted-foreground">Acesso restrito à distribuição (DMS/revenda).</p></Card></Shell>;
  }

  const toggleMod = (m: string) =>
    setForm((s: any) => ({ ...s, modulos: s.modulos.includes(m) ? s.modulos.filter((x: string) => x !== m) : [...s.modulos, m] }));

  async function emitir() {
    if (!form.tenantId.trim()) return toast.error('Informe o tenantId da loja.');
    try {
      const r: any = await api.emitirTokenAtivacao({
        tenantId: form.tenantId.trim(),
        ramo: form.ramo,
        plano: form.plano,
        modulos: form.modulos,
        trial: form.trial,
        validadeDias: form.validadeDias ? Number(form.validadeDias) : undefined,
      });
      setTokenNovo(r?.token ?? null);
      carregar();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
  }
  async function acao(id: string, a: 'suspender' | 'reativar' | 'revogar' | 'rebind') {
    if (a === 'revogar' && !confirm('Revogar a licença desta loja? A loja para de operar após o grace.')) return;
    try { await api.ativacaoAcao(id, a); toast.success('Feito.'); carregar(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Erro'); }
  }

  return (
    <Shell eyebrow="Revenda" title="Revenda & frota">
      <div className="space-y-4">
        {/* Emitir token de ativação */}
        <Card className="space-y-3 p-4">
          <h2 className="font-display text-base font-bold">Emitir ativação (nova loja)</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            <div><Label className="text-xs">Loja (tenantId)</Label><Input value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })} placeholder="uuid da empresa" /></div>
            <div>
              <Label className="text-xs">Ramo</Label>
              <select className="flex h-10 w-full rounded-md border border-input bg-card px-2 text-sm" value={form.ramo} onChange={(e) => setForm({ ...form, ramo: e.target.value })}>
                <option value="food_service">Food service (restaurantes)</option>
                <option value="varejo" disabled>Varejo (em breve)</option>
                <option value="industria" disabled>Indústria (em breve)</option>
                <option value="servicos" disabled>Serviços (em breve)</option>
              </select>
            </div>
            <div><Label className="text-xs">Plano</Label><Input value={form.plano} onChange={(e) => setForm({ ...form, plano: e.target.value })} placeholder="basico / pro / completo" /></div>
            <div className="flex items-end gap-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={form.trial} onChange={(e) => setForm({ ...form, trial: e.target.checked })} /> Trial</label>
              <div className="flex-1"><Label className="text-xs">Validade (dias)</Label><Input type="number" value={form.validadeDias} onChange={(e) => setForm({ ...form, validadeDias: e.target.value })} placeholder="vazio = sem prazo" /></div>
            </div>
          </div>
          <div>
            <Label className="text-xs">Módulos inclusos</Label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {MODULOS.map((m) => (
                <button key={m} type="button" onClick={() => toggleMod(m)} className={`rounded-full border px-2.5 py-1 text-xs ${form.modulos.includes(m) ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}>{m}</button>
              ))}
            </div>
          </div>
          <Button type="button" onClick={emitir}>Emitir token</Button>
          {tokenNovo && (
            <div className="rounded-lg border-2 border-dashed border-primary p-3">
              <p className="text-xs text-muted-foreground">Token de ativação (copie agora — só aparece uma vez):</p>
              <p className="mt-1 break-all font-mono text-sm font-bold">{tokenNovo}</p>
            </div>
          )}
        </Card>

        {/* Frota */}
        <Card className="space-y-3 p-4">
          <h2 className="font-display text-base font-bold">Frota ({frota.length})</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Frota de lojas</caption>
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Loja</th>
                  <th className="py-2 pr-3 font-medium">Ramo/Plano</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 pr-3 font-medium">Online</th>
                  <th className="py-2 pr-3 font-medium">Versão</th>
                  <th className="py-2 font-medium">Ações</th>
                </tr>
              </thead>
              <tbody>
                {frota.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Nenhuma loja ativada.</td></tr>}
                {frota.map((f) => (
                  <tr key={f.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-mono text-xs">{(f.tenantId ?? '').slice(0, 8)}…</td>
                    <td className="py-2 pr-3">{f.ramo} · {f.plano}{f.trial ? ' (trial)' : ''}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${f.status === 'ativado' ? 'bg-ok/15 text-ok' : f.status === 'suspenso' ? 'bg-warn/15 text-warn' : f.status === 'revogado' ? 'bg-destructive/15 text-destructive' : 'bg-secondary text-muted-foreground'}`}>{f.status}</span>
                    </td>
                    <td className="py-2 pr-3">{f.online ? '🟢' : '⚪'} <span className="text-xs text-muted-foreground">{dh(f.heartbeatEm)}</span></td>
                    <td className="py-2 pr-3 font-mono text-xs">{f.versao ?? '—'}</td>
                    <td className="py-2">
                      <div className="flex flex-wrap gap-1">
                        {f.status === 'ativado' && <button type="button" onClick={() => acao(f.id, 'suspender')} className="rounded border border-border px-2 py-0.5 text-xs">suspender</button>}
                        {f.status === 'suspenso' && <button type="button" onClick={() => acao(f.id, 'reativar')} className="rounded border border-border px-2 py-0.5 text-xs">reativar</button>}
                        <button type="button" onClick={() => acao(f.id, 'rebind')} className="rounded border border-border px-2 py-0.5 text-xs">rebind</button>
                        <button type="button" onClick={() => acao(f.id, 'revogar')} className="rounded border border-border px-2 py-0.5 text-xs text-destructive">revogar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </Shell>
  );
}
