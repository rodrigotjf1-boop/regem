'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

/* eslint-disable @typescript-eslint/no-explicit-any */
const FREQ = [
  { value: 'diaria', label: 'Diária' },
  { value: 'turno', label: 'Por turno' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'sob_demanda', label: 'Sob demanda' },
];

export default function GuiasPage() {
  const [guias, setGuias] = useState<any[]>([]);
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);

  const [titulo, setTitulo] = useState('');
  const [codigo, setCodigo] = useState('');
  const [frequencia, setFrequencia] = useState('diaria');
  const [descricao, setDescricao] = useState('');
  const [passos, setPassos] = useState<string[]>(['']);

  const carregar = useCallback(async () => {
    try {
      setGuias(await api.get('/guias'));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (getToken()) carregar();
  }, [carregar]);

  async function salvar(estado: string) {
    if (titulo.trim().length < 2) {
      setErro('Informe o título do procedimento.');
      return;
    }
    setSaving(true);
    setErro('');
    try {
      await api.post('/guias', {
        titulo,
        codigo: codigo || undefined,
        frequencia,
        descricao: descricao || undefined,
        estado,
        passos: passos
          .filter((p) => p.trim())
          .map((p, i) => ({ descricao: p, ordem: i })),
      });
      setTitulo('');
      setCodigo('');
      setDescricao('');
      setPassos(['']);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function excluir(id: string) {
    await api.del(`/guias/${id}`);
    carregar();
  }

  return (
    <Shell eyebrow="Capacitação" title="POP & Guias">
      {erro && <p className="mb-4 text-destructive">{erro}</p>}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Editor */}
        <Card className="p-5">
          <h2 className="mb-4 font-display text-lg font-bold">
            Cadastro de guia operacional (POP)
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cod">Código</Label>
              <Input id="cod" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="POP-COZ-004" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="freq">Frequência</Label>
              <Select id="freq" value={frequencia} onChange={(e) => setFrequencia(e.target.value)}>
                {FREQ.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tit">Título do procedimento</Label>
              <Input id="tit" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Higienização de bancadas e utensílios" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="desc">Descrição / objetivo</Label>
              <textarea
                id="desc"
                rows={2}
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Garantir a higienização correta das bancadas ao final de cada turno…"
              />
            </div>
          </div>

          <div className="mt-5">
            <h3 className="mb-2 font-display text-sm font-bold">Passos do procedimento</h3>
            <div className="space-y-2">
              {passos.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary font-mono text-xs font-bold text-muted-foreground">
                    {idx + 1}
                  </span>
                  <Input
                    value={p}
                    onChange={(e) =>
                      setPassos((a) => a.map((x, n) => (n === idx ? e.target.value : x)))
                    }
                    placeholder="Descreva o passo…"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remover passo"
                    onClick={() => setPassos((a) => (a.length > 1 ? a.filter((_, n) => n !== idx) : a))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" className="mt-2" onClick={() => setPassos((a) => [...a, ''])}>
              <Plus className="h-4 w-4" /> Adicionar passo
            </Button>
          </div>

          <div className="mt-5 flex gap-2">
            <Button className="flex-1" disabled={saving} onClick={() => salvar('ativo')}>
              {saving ? 'Salvando…' : 'Publicar guia'}
            </Button>
            <Button variant="outline" disabled={saving} onClick={() => salvar('rascunho')}>
              Salvar rascunho
            </Button>
          </div>
        </Card>

        {/* Lista */}
        <div className="space-y-2">
          <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Guias cadastrados ({guias.length})
          </h2>
          {guias.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum guia ainda.</p>
          )}
          {guias.map((g) => {
            const ativo = g.estado === 'ativo';
            return (
              <Card key={g.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">
                      {g.codigo ? `${g.codigo} — ` : ''}
                      {g.titulo}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {g.passos?.length ?? 0} passo(s) · {g.frequencia}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span
                      className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                      style={{
                        background: ativo ? 'hsl(var(--ok)/.15)' : 'hsl(var(--warn)/.16)',
                        color: ativo ? 'hsl(var(--ok))' : 'hsl(var(--warn))',
                      }}
                    >
                      {ativo ? 'Ativo' : 'Rascunho'}
                    </span>
                    <Button variant="ghost" size="icon" aria-label="Excluir" onClick={() => excluir(g.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
