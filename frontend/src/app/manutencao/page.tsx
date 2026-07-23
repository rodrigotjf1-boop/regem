'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImageUpload } from '@/components/ui/image-upload';
import { Plus, Wrench, X } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS: Record<string, { txt: string; cls: string }> = {
  aberto: { txt: 'Aberto', cls: 'bg-info/10 text-info' },
  em_andamento: { txt: 'Em andamento', cls: 'bg-warn/10 text-warn' },
  concluido_parcial: { txt: 'Concluído parcial', cls: 'bg-primary/10 text-primary' },
  concluido: { txt: 'Concluído', cls: 'bg-ok/10 text-ok' },
  cancelado: { txt: 'Cancelado', cls: 'bg-danger/10 text-danger' },
};
const PRIORIDADE: Record<string, string> = {
  baixa: '⚪ Baixa', normal: '🟡 Normal', alta: '🟠 Alta', critica: '🔴 Crítica',
};
const selectCls = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

export default function ManutencaoPage() {
  const [lista, setLista] = useState<any[]>([]);
  const [colabs, setColabs] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(true);
  const cat = typeof window !== 'undefined' ? getCategoria() : null;
  const ehCO = cat === 'presidente' || cat === 'gerente';

  const reload = useCallback(async () => {
    try {
      const [l, c] = await Promise.all([
        api.manutencaoLista(),
        ehCO ? api.colaboradores().catch(() => []) : Promise.resolve([]),
      ]);
      setLista(Array.isArray(l) ? l : []);
      setColabs(Array.isArray(c) ? c : []);
    } catch {
      /* poll silencioso */
    } finally {
      setLoading(false);
    }
  }, [ehCO]);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <Shell
      eyebrow="Tarefas"
      title="Pedidos de manutenção"
      actions={
        <Button size="sm" onClick={() => setShow((v) => !v)}>
          {show ? <><X className="h-4 w-4" /> Fechar</> : <><Plus className="h-4 w-4" /> Novo pedido</>}
        </Button>
      }
    >
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Registre equipamentos com defeito, lâmpadas queimadas ou mau funcionamento (até 3 fotos).
        O presidente/C&O acompanha, delega ao gerente e conclui.
      </p>

      {show && (
        <div className="mb-5 max-w-xl">
          <NovoPedidoForm
            onCancel={() => setShow(false)}
            onCreated={() => {
              setShow(false);
              reload();
            }}
          />
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : lista.length === 0 ? (
        <Card className="max-w-xl p-8 text-center text-muted-foreground">
          <Wrench className="mx-auto mb-2 h-6 w-6" />
          <p className="font-semibold text-foreground">Nenhum pedido de manutenção</p>
          <p className="mt-1 text-sm">Abra um pedido quando algo precisar de conserto.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {lista.map((p) => (
            <PedidoCard
              key={p.id}
              p={p}
              ehCO={ehCO}
              colabs={colabs}
              onChange={reload}
            />
          ))}
        </div>
      )}
    </Shell>
  );
}

function NovoPedidoForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [titulo, setTitulo] = useState('');
  const [equipamentoRef, setEquip] = useState('');
  const [descricao, setDescricao] = useState('');
  const [prioridade, setPrioridade] = useState('normal');
  const [fotos, setFotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  function setFoto(i: number, url: string) {
    setFotos((prev) => {
      const n = [...prev];
      n[i] = url;
      return n.filter(Boolean);
    });
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim()) return toast.error('Descreva o que está com defeito.');
    setBusy(true);
    try {
      await api.manutencaoCriar({ titulo, equipamentoRef, descricao, prioridade, fotos });
      toast.success('Pedido de manutenção aberto.');
      onCreated();
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao abrir o pedido.');
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={salvar} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="titulo">O que está com defeito?</Label>
          <Input id="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Lâmpada da cozinha queimada" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="equip">Equipamento / local (opcional)</Label>
          <Input id="equip" value={equipamentoRef} onChange={(e) => setEquip(e.target.value)} placeholder="Ex.: Geladeira 2, banheiro..." />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="desc">Detalhes (opcional)</Label>
          <textarea
            id="desc"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-input bg-card p-2 text-sm"
            placeholder="Como o problema aparece?"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="prio">Prioridade</Label>
          <select id="prio" value={prioridade} onChange={(e) => setPrioridade(e.target.value)} className={selectCls}>
            <option value="baixa">Baixa</option>
            <option value="normal">Normal</option>
            <option value="alta">Alta</option>
            <option value="critica">Crítica</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Fotos (até 3)</Label>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 w-24">
                <ImageUpload value={fotos[i]} onChange={(url) => setFoto(i, url)} />
              </div>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy}>{busy ? 'Enviando…' : 'Abrir pedido'}</Button>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>Cancelar</Button>
        </div>
      </form>
    </Card>
  );
}

function PedidoCard({ p, ehCO, colabs, onChange }: { p: any; ehCO: boolean; colabs: any[]; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const st = STATUS[p.status] ?? { txt: p.status, cls: 'bg-muted text-muted-foreground' };
  const fotos: string[] = Array.isArray(p.fotos) ? p.fotos : [];
  const venceu = p.prazo15d && new Date(p.prazo15d) < new Date() && p.status !== 'concluido' && p.status !== 'cancelado';

  async function acao(fn: () => Promise<any>, msg: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      onChange();
    } catch (e: any) {
      toast.error(e?.message || 'Falha na operação.');
      setBusy(false);
    }
  }

  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{p.titulo}</p>
          {p.equipamentoRef && <p className="truncate text-xs text-muted-foreground">📍 {p.equipamentoRef}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.txt}</span>
      </div>

      {p.descricao && <p className="mt-1 text-xs text-muted-foreground">{p.descricao}</p>}

      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
        <span>{PRIORIDADE[p.prioridade] ?? p.prioridade}</span>
        {p.responsavelNome && <span className="text-muted-foreground">👤 {p.responsavelNome}</span>}
        {venceu && <span className="rounded-full bg-danger/10 px-2 py-0.5 font-semibold text-danger">15+ dias</span>}
      </div>

      {fotos.length > 0 && (
        <div className="mt-2 flex gap-1.5">
          {fotos.map((f, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <a key={i} href={f} target="_blank" rel="noreferrer">
              <img src={f} alt={`foto ${i + 1}`} className="h-14 w-14 rounded object-cover" />
            </a>
          ))}
        </div>
      )}

      {ehCO && p.status !== 'concluido' && p.status !== 'cancelado' && (
        <div className="mt-3 space-y-2 border-t border-border pt-2">
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" disabled={busy}
              onClick={() => acao(() => api.manutencaoStatus(p.id, 'concluido_parcial'), 'Marcado como concluído parcial.')}>
              Parcial
            </Button>
            <Button size="sm" disabled={busy}
              onClick={() => acao(() => api.manutencaoStatus(p.id, 'concluido'), 'Concluído.')}>
              Concluir
            </Button>
            <Button size="sm" variant="ghost" disabled={busy}
              onClick={() => {
                const m = prompt('Motivo do cancelamento?');
                if (m) acao(() => api.manutencaoStatus(p.id, 'cancelado', m), 'Cancelado.');
              }}>
              Cancelar
            </Button>
          </div>
          <select
            className="h-9 w-full rounded-md border border-input bg-card px-2 text-xs"
            value={p.responsavelId ?? ''}
            disabled={busy}
            onChange={(e) => e.target.value && acao(() => api.manutencaoDelegar(p.id, e.target.value), 'Delegado ao gerente.')}
          >
            <option value="">Delegar ao gerente…</option>
            {colabs.map((c: any) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
          {venceu && (
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[11px] text-muted-foreground">15 dias:</span>
              <button className="text-[11px] font-semibold text-primary" disabled={busy}
                onClick={() => acao(() => api.manutencaoDecisao15d(p.id, 'manter'), 'Mantido pendente.')}>manter</button>
              <button className="text-[11px] font-semibold text-ok" disabled={busy}
                onClick={() => acao(() => api.manutencaoDecisao15d(p.id, 'concluir'), 'Concluído.')}>concluir</button>
              <button className="text-[11px] font-semibold text-danger" disabled={busy}
                onClick={() => acao(() => api.manutencaoDecisao15d(p.id, 'excluir'), 'Excluído.')}>excluir</button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
