'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Card } from '@/components/ui/card';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Opt = { id: string; nome: string };

export function NovaTarefaForm({
  data,
  onCreated,
  onCancel,
}: {
  data: string;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [unidades, setUnidades] = useState<Opt[]>([]);
  const [setores, setSetores] = useState<Opt[]>([]);
  const [funcoes, setFuncoes] = useState<Opt[]>([]);
  const [responsaveis, setResponsaveis] = useState<Opt[]>([]);
  const [titulo, setTitulo] = useState('');
  const [unidadeId, setUnidadeId] = useState('');
  const [setorId, setSetorId] = useState('');
  const [funcaoId, setFuncaoId] = useState('');
  const [colaboradorId, setColaboradorId] = useState(''); // '' = em aberto
  const [horario, setHorario] = useState('');
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [u, s, f] = await Promise.all([
          api.unidades(),
          api.get('/setores'),
          api.get('/funcoes'),
        ]);
        setUnidades(u as Opt[]);
        setSetores(s as Opt[]);
        setFuncoes(f as Opt[]);
        if ((u as Opt[])[0]) setUnidadeId((u as Opt[])[0].id);
      } catch (err) {
        setErro(err instanceof Error ? err.message : 'Erro ao carregar opções');
      }
    })();
  }, []);

  // Ao escolher a função (+setor), busca os escalados do dia para o responsável.
  useEffect(() => {
    if (!funcaoId) {
      setResponsaveis([]);
      setColaboradorId('');
      return;
    }
    api
      .tarefaResponsaveis(data, funcaoId, setorId || undefined)
      .then((r: any) => setResponsaveis(Array.isArray(r) ? r : []))
      .catch(() => setResponsaveis([]));
  }, [funcaoId, setorId, data]);

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    setErro('');
    if (!funcaoId) {
      setErro('Selecione a função da tarefa.');
      return;
    }
    setSaving(true);
    try {
      const def: any = await api.criarTarefaDef({
        unidadeId,
        titulo,
        setorId: setorId || undefined,
        funcaoId,
        horario: horario || undefined,
        origem: 'avulsa',
      });
      await api.instanciarTarefa({
        tarefaDefId: def.id,
        data,
        colaboradorResolvidoId: colaboradorId || undefined,
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
          <Select id="un" value={unidadeId} onChange={(e) => setUnidadeId(e.target.value)} required>
            {unidades.length === 0 && <option value="">— nenhuma unidade —</option>}
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>{u.nome}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="st">Setor (opcional)</Label>
          <Select id="st" value={setorId} onChange={(e) => setSetorId(e.target.value)}>
            <option value="">Sem setor específico</option>
            {setores.map((s) => (
              <option key={s.id} value={s.id}>{s.nome}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fn">Função</Label>
          <Select id="fn" value={funcaoId} onChange={(e) => setFuncaoId(e.target.value)} required>
            <option value="">Selecione a função…</option>
            {funcoes.map((f) => (
              <option key={f.id} value={f.id}>{f.nome}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rp">Responsável (opcional)</Label>
          <Select
            id="rp"
            value={colaboradorId}
            onChange={(e) => setColaboradorId(e.target.value)}
            disabled={!funcaoId}
          >
            <option value="">Em aberto (qualquer um da função)</option>
            {responsaveis.map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </Select>
          <p className="text-xs text-muted-foreground">
            {funcaoId
              ? responsaveis.length
                ? 'Escalados desta função hoje — ou deixe em aberto.'
                : 'Ninguém escalado nesta função hoje; fica em aberto.'
              : 'Escolha a função para listar os escalados.'}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hr">Horário (opcional)</Label>
          <Input id="hr" type="time" value={horario} onChange={(e) => setHorario(e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Posiciona a tarefa na linha do tempo do dia (Dashboard).
          </p>
        </div>
        {erro && (
          <p role="alert" className="text-sm text-destructive">{erro}</p>
        )}
        <div className="flex gap-2 pt-1">
          <Button type="submit" className="flex-1" disabled={saving || !titulo || !unidadeId || !funcaoId}>
            {saving ? 'Salvando…' : 'Criar tarefa'}
          </Button>
          <Button type="button" variant="outline" onClick={onCancel}>Cancelar</Button>
        </div>
      </form>
    </Card>
  );
}
