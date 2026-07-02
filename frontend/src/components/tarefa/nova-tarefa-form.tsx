'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card } from '@/components/ui/card';

type Unidade = { id: string; nome: string };
type Etiqueta = { id: string; sigla: string; contador: number };

export function NovaTarefaForm({
  data,
  onCreated,
  onCancel,
}: {
  data: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [unidades, setUnidades] = useState<Unidade[]>([]);
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [titulo, setTitulo] = useState('');
  const [unidadeId, setUnidadeId] = useState('');
  const [etiquetaId, setEtiquetaId] = useState('');
  const [horario, setHorario] = useState('');
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [u, e] = await Promise.all([api.unidades(), api.etiquetas()]);
        setUnidades(u);
        setEtiquetas(e);
        if (u[0]) setUnidadeId(u[0].id);
        if (e[0]) setEtiquetaId(e[0].id);
      } catch (err) {
        setErro(err instanceof Error ? err.message : 'Erro ao carregar opções');
      }
    })();
  }, []);

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro('');
    setSaving(true);
    try {
      const def = await api.criarTarefaDef({
        unidadeId,
        titulo,
        etiquetaId: etiquetaId || undefined,
        horario: horario || undefined,
        origem: 'avulsa',
      });
      await api.instanciarTarefa({ tarefaDefId: def.id, data });
      onCreated();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-4">
      <form onSubmit={salvar} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="tt">Título da tarefa</Label>
          <Input
            id="tt"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Ex.: Conferir validades"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="un">Unidade</Label>
          <Select
            id="un"
            value={unidadeId}
            onChange={(e) => setUnidadeId(e.target.value)}
            required
          >
            {unidades.length === 0 && (
              <option value="">— nenhuma unidade —</option>
            )}
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.nome}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vg">Vaga (opcional)</Label>
          <Select
            id="vg"
            value={etiquetaId}
            onChange={(e) => setEtiquetaId(e.target.value)}
          >
            <option value="">Sem vaga específica</option>
            {etiquetas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.sigla}
                {e.contador}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hr">Horário (opcional)</Label>
          <Input
            id="hr"
            type="time"
            value={horario}
            onChange={(e) => setHorario(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Posiciona a tarefa na linha do tempo do dia (Dashboard).
          </p>
        </div>
        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <Button
            type="submit"
            className="flex-1"
            disabled={saving || !titulo || !unidadeId}
          >
            {saving ? 'Salvando…' : 'Criar tarefa'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
