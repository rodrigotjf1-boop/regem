'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card } from '@/components/ui/card';

type Etiqueta = { id: string; sigla: string; contador: number };
type Turno = { id: string; nome: string };
type Colaborador = { id: string; nome: string };

export function NovaAlocacaoForm({
  data,
  onCreated,
  onCancel,
}: {
  data: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [etiquetas, setEtiquetas] = useState<Etiqueta[]>([]);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [colabs, setColabs] = useState<Colaborador[]>([]);
  const [etiquetaId, setEtiquetaId] = useState('');
  const [turnoId, setTurnoId] = useState('');
  const [colaboradorId, setColaboradorId] = useState('');
  const [tipo, setTipo] = useState('titular');
  const [dataSel, setDataSel] = useState(data);
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [e, t, c] = await Promise.all([
          api.etiquetas(),
          api.turnos(),
          api.colaboradores(),
        ]);
        setEtiquetas(e);
        setTurnos(t);
        setColabs(c);
        if (e[0]) setEtiquetaId(e[0].id);
        if (t[0]) setTurnoId(t[0].id);
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
      await api.criarAlocacao({
        data: dataSel,
        turnoId,
        etiquetaId,
        colaboradorId: colaboradorId || undefined,
        tipo,
      });
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
          <Label htmlFor="dt">Dia</Label>
          <Input
            id="dt"
            type="date"
            value={dataSel}
            onChange={(e) => setDataSel(e.target.value)}
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="et">Vaga (etiqueta)</Label>
          <Select
            id="et"
            value={etiquetaId}
            onChange={(e) => setEtiquetaId(e.target.value)}
            required
          >
            {etiquetas.length === 0 && (
              <option value="">— nenhuma etiqueta cadastrada —</option>
            )}
            {etiquetas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.sigla}
                {e.contador}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tn">Turno</Label>
          <Select
            id="tn"
            value={turnoId}
            onChange={(e) => setTurnoId(e.target.value)}
            required
          >
            {turnos.length === 0 && (
              <option value="">— nenhum turno cadastrado —</option>
            )}
            {turnos.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="co">Responsável</Label>
          <Select
            id="co"
            value={colaboradorId}
            onChange={(e) => setColaboradorId(e.target.value)}
          >
            <option value="">Vaga aberta</option>
            {colabs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tp">Tipo</Label>
          <Select
            id="tp"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
          >
            <option value="titular">Titular</option>
            <option value="diarista">Diarista</option>
            <option value="cobertura">Cobertura</option>
            <option value="avulso">Avulso</option>
          </Select>
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
            disabled={saving || !etiquetaId || !turnoId}
          >
            {saving ? 'Salvando…' : 'Alocar'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
        </div>
      </form>
    </Card>
  );
}
