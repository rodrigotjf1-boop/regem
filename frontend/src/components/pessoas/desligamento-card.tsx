'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserMinus } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const selectCls = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

const TIPOS = [
  { v: 'sem_justa_causa', l: 'Dispensa sem justa causa' },
  { v: 'justa_causa', l: 'Justa causa' },
  { v: 'pedido_demissao', l: 'Pedido de demissão' },
  { v: 'acordo', l: 'Acordo (comum)' },
  { v: 'experiencia', l: 'Fim de contrato de experiência' },
];

function hoje() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

export function DesligamentoCard() {
  const [aberto, setAberto] = useState(false);
  const [colabs, setColabs] = useState<any[]>([]);
  const [contadores, setContadores] = useState<any[]>([]);

  const reload = useCallback(async () => {
    const [c, ct] = await Promise.all([
      api.colaboradores().catch(() => []),
      api.contadores().catch(() => []),
    ]);
    setColabs((Array.isArray(c) ? c : []).filter((x: any) => x.status !== 'bloqueado' && !x.desligadoEm));
    setContadores(Array.isArray(ct) ? ct : []);
  }, []);

  useEffect(() => {
    if (aberto) reload();
  }, [aberto, reload]);

  return (
    <Card className="p-4">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={aberto}
      >
        <span className="flex items-center gap-2 font-display text-sm font-bold">
          <UserMinus className="h-4 w-4" /> Desligamento de colaborador
        </span>
        <span className="text-xs text-muted-foreground">{aberto ? 'fechar' : 'abrir'}</span>
      </button>

      {aberto && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <DesligarForm colabs={colabs} contadores={contadores} onDone={reload} />
          <ContadoresManager contadores={contadores} onChange={reload} />
        </div>
      )}
    </Card>
  );
}

function DesligarForm({ colabs, contadores, onDone }: { colabs: any[]; contadores: any[]; onDone: () => void }) {
  const [colaboradorId, setColaboradorId] = useState('');
  const [tipo, setTipo] = useState('sem_justa_causa');
  const [avisoInicio, setAvisoInicio] = useState(hoje());
  const [avisoOpcao, setAvisoOpcao] = useState<'2h' | '7dias'>('7dias');
  const [avisoDias, setAvisoDias] = useState('30');
  const [desligamentoData, setDesligamentoData] = useState(hoje());
  const [motivo, setMotivo] = useState('');
  const [enviarPonto, setEnviarPonto] = useState(false);
  const [contadorId, setContadorId] = useState('');
  const [busy, setBusy] = useState(false);

  const semJusta = tipo === 'sem_justa_causa';

  async function submeter(e: React.FormEvent) {
    e.preventDefault();
    if (!colaboradorId) return toast.error('Escolha o colaborador.');
    if (enviarPonto && !contadorId) return toast.error('Escolha o contador para enviar o ponto.');
    setBusy(true);
    try {
      const r: any = await api.desligarColaborador(colaboradorId, {
        tipo,
        motivo,
        avisoInicio: semJusta ? avisoInicio : undefined,
        avisoOpcao: semJusta ? avisoOpcao : undefined,
        avisoDias: semJusta ? Number(avisoDias) || 30 : undefined,
        desligamentoData: semJusta ? undefined : desligamentoData,
        enviarPonto,
        contadorId: enviarPonto ? contadorId : undefined,
      });
      toast.success(r?.avisoContador || 'Desligamento registrado.');
      setColaboradorId('');
      setMotivo('');
      setEnviarPonto(false);
      onDone();
    } catch (err: any) {
      toast.error(err?.message || 'Falha no desligamento.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submeter} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor="dcolab">Colaborador</Label>
        <select id="dcolab" value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)} className={selectCls} required>
          <option value="">— escolha —</option>
          {colabs.map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="dtipo">Tipo de desligamento</Label>
        <select id="dtipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={selectCls}>
          {TIPOS.map((t) => (
            <option key={t.v} value={t.v}>{t.l}</option>
          ))}
        </select>
      </div>

      {semJusta ? (
        <div className="rounded-lg border border-border bg-secondary/40 p-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Aviso prévio trabalhado (Art. 488 CLT). A escala é ajustada sozinha no período.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="dini" className="text-[11px]">Início do aviso</Label>
              <Input id="dini" type="date" value={avisoInicio} onChange={(e) => setAvisoInicio(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ddias" className="text-[11px]">Dias (30 + prop., teto 90)</Label>
              <Input id="ddias" type="number" min={30} max={90} value={avisoDias} onChange={(e) => setAvisoDias(e.target.value)} className="h-9" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={avisoOpcao === '2h'} onClick={() => setAvisoOpcao('2h')}
              className={`rounded-lg border p-2 text-xs font-semibold ${avisoOpcao === '2h' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>
              −2h por dia
            </button>
            <button type="button" aria-pressed={avisoOpcao === '7dias'} onClick={() => setAvisoOpcao('7dias')}
              className={`rounded-lg border p-2 text-xs font-semibold ${avisoOpcao === '7dias' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>
              7 dias corridos no fim
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label htmlFor="ddata">Data do desligamento</Label>
          <Input id="ddata" type="date" value={desligamentoData} onChange={(e) => setDesligamentoData(e.target.value)} className="h-11" />
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="dmotivo">Motivo (opcional)</Label>
        <Input id="dmotivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Registro interno" />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enviarPonto} onChange={(e) => setEnviarPonto(e.target.checked)} className="h-4 w-4 rounded border-input" />
        Enviar o relatório de ponto ao contador (WhatsApp)
      </label>
      {enviarPonto && (
        <select value={contadorId} onChange={(e) => setContadorId(e.target.value)} className={selectCls}>
          <option value="">— escolha o contador —</option>
          {contadores.filter((c) => c.ativo).map((c) => (
            <option key={c.id} value={c.id}>{c.nome} · {c.whatsapp}</option>
          ))}
        </select>
      )}

      <Button type="submit" variant="destructive" disabled={busy}>
        {busy ? 'Processando…' : 'Registrar desligamento'}
      </Button>
    </form>
  );
}

function ContadoresManager({ contadores, onChange }: { contadores: any[]; onChange: () => void }) {
  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!nome.trim() || !whatsapp.trim()) return toast.error('Nome e WhatsApp são obrigatórios.');
    setBusy(true);
    try {
      await api.salvarContador({ nome, whatsapp });
      toast.success('Contador cadastrado.');
      setNome('');
      setWhatsapp('');
      onChange();
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function remover(id: string) {
    if (!confirm('Remover este contador?')) return;
    try {
      await api.removerContador(id);
      onChange();
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao remover.');
    }
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <p className="mb-2 font-display text-sm font-bold">Contador (destino do ponto)</p>
      <div className="mb-3 space-y-1.5">
        {contadores.length === 0 && (
          <p className="text-xs text-muted-foreground">Nenhum contador cadastrado.</p>
        )}
        {contadores.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1.5 text-sm">
            <span className={`min-w-0 truncate ${c.ativo ? '' : 'text-muted-foreground line-through'}`}>
              {c.nome} · {c.whatsapp}
            </span>
            {c.ativo && (
              <button type="button" onClick={() => remover(c.id)} className="text-xs text-destructive">remover</button>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={add} className="space-y-2">
        <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do contador / escritório" />
        <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="WhatsApp (com DDD)" />
        <Button type="submit" variant="outline" size="sm" disabled={busy}>Adicionar contador</Button>
      </form>
    </div>
  );
}
