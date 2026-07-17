'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ImageUpload } from '@/components/ui/image-upload';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ESTADO_LABEL: Record<string, string> = {
  feita: 'Concluída',
  parcial: 'Parcialmente concluída',
  nao_feita: 'Não concluída',
  pendente: 'Pendente',
  em_execucao: 'Em execução',
};

type Modo = 'view' | 'feita' | 'parcial' | 'nao_feita' | 'editar' | 'excluir';

// Dispositivo móvel (Android/iOS): a comprovação é tirada NA HORA pela câmera
// (sem galeria), evitando enviar fotos antigas de conclusões passadas.
const ehMobile =
  typeof navigator !== 'undefined' &&
  /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);

// Modal (toast) de controle da tarefa: infos + status (com foto conforme política),
// editar e excluir (com motivo). Fotos de conclusão/parcial: até 3, expurgo 30d.
export function TarefaModal({
  tarefa,
  politica,
  data,
  onClose,
  onChanged,
}: {
  tarefa: any;
  politica: { conclusao: boolean; parcial: boolean };
  data: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [modo, setModo] = useState<Modo>('view');
  const [busy, setBusy] = useState(false);
  const [fotos, setFotos] = useState<string[]>(
    Array.isArray(tarefa.fotos) ? tarefa.fotos.slice(0, 3) : [],
  );
  const [motivo, setMotivo] = useState('');

  // Edição
  const [titulo, setTitulo] = useState(tarefa.titulo ?? '');
  const [horario, setHorario] = useState((tarefa.horario ?? '').slice(0, 5));
  const [setorId, setSetorId] = useState(tarefa.setorId ?? '');
  const [funcaoId, setFuncaoId] = useState(tarefa.funcaoId ?? '');
  const [colaboradorId, setColaboradorId] = useState(tarefa.colaboradorId ?? '');
  const [setores, setSetores] = useState<any[]>([]);
  const [funcoes, setFuncoes] = useState<any[]>([]);
  const [responsaveis, setResponsaveis] = useState<any[]>([]);

  useEffect(() => {
    if (modo !== 'editar') return;
    Promise.all([api.get('/setores'), api.get('/funcoes')])
      .then(([s, f]) => {
        setSetores(s as any[]);
        setFuncoes(f as any[]);
      })
      .catch(() => {});
  }, [modo]);

  useEffect(() => {
    if (modo !== 'editar' || !funcaoId) return;
    api
      .tarefaResponsaveis(data, funcaoId, setorId || undefined)
      .then((r: any) => setResponsaveis(Array.isArray(r) ? r : []))
      .catch(() => setResponsaveis([]));
  }, [modo, funcaoId, setorId, data]);

  const fotosLimpas = fotos.filter(Boolean);
  const exigeFotoFeita = politica.conclusao;
  const exigeFotoParcial = politica.parcial;

  async function mudarStatus(estado: 'feita' | 'parcial' | 'nao_feita') {
    if (estado === 'nao_feita' && !motivo.trim())
      return toast.error('Informe o motivo da não conclusão.');
    if (estado === 'feita' && exigeFotoFeita && fotosLimpas.length === 0)
      return toast.error('Foto de comprovação é obrigatória na conclusão.');
    if (estado === 'parcial' && exigeFotoParcial && fotosLimpas.length === 0)
      return toast.error('Foto de comprovação é obrigatória na conclusão parcial.');
    setBusy(true);
    try {
      await api.concluirTarefa(
        tarefa.id,
        estado,
        estado === 'nao_feita' ? motivo.trim() : undefined,
        estado === 'nao_feita' ? undefined : fotosLimpas,
      );
      toast.success('Status atualizado.');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao atualizar');
    } finally {
      setBusy(false);
    }
  }

  async function salvarEdicao() {
    if (!funcaoId) return toast.error('Selecione a função.');
    setBusy(true);
    try {
      await api.editarTarefa(tarefa.id, {
        titulo: titulo.trim(),
        horario: horario || null,
        setorId: setorId || null,
        funcaoId,
        colaboradorResolvidoId: colaboradorId || null,
      });
      toast.success('Tarefa atualizada.');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setBusy(false);
    }
  }

  async function excluir() {
    if (!motivo.trim()) return toast.error('Informe o motivo da exclusão.');
    setBusy(true);
    try {
      await api.excluirTarefa(tarefa.id, motivo.trim());
      toast.success('Tarefa excluída.');
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao excluir');
    } finally {
      setBusy(false);
    }
  }

  function FotoSlots({ exige }: { exige: boolean }) {
    return (
      <div className="space-y-1.5">
        <Label className="text-xs">
          Fotos de comprovação {exige ? '(obrigatória)' : '(opcional)'} — até 3
        </Label>
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2].map((i) => (
            <ImageUpload
              key={i}
              value={fotos[i] ?? ''}
              onChange={(url) =>
                setFotos((f) => {
                  const cp = [...f];
                  cp[i] = url;
                  return cp;
                })
              }
              id={`tarefa-foto-${tarefa.id}-${i}`}
              alt="Comprovação"
              capture={ehMobile}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <Card className="max-h-[88dvh] w-full max-w-md space-y-4 overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
        <div>
          <h2 className="font-display text-base font-bold">{tarefa.titulo}</h2>
          <p className="text-xs text-muted-foreground">
            {[tarefa.setorNome, tarefa.funcaoNome, tarefa.colaboradorNome ?? 'em aberto']
              .filter(Boolean)
              .join(' · ')}
            {tarefa.horario ? ` · ${String(tarefa.horario).slice(0, 5)}` : ''}
          </p>
          <span className="mt-1 inline-block rounded-md bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {ESTADO_LABEL[tarefa.estado] ?? tarefa.estado}
          </span>
        </div>

        {/* Fotos já registradas */}
        {modo === 'view' && Array.isArray(tarefa.fotos) && tarefa.fotos.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tarefa.fotos.map((u: string, i: number) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={u} alt="Comprovação" className="h-16 w-16 rounded-md object-cover" />
            ))}
          </div>
        )}
        {modo === 'view' && tarefa.motivo && (
          <p className="rounded-md bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Motivo: {tarefa.motivo}
          </p>
        )}

        {/* VIEW: ações */}
        {modo === 'view' && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" size="sm" onClick={() => setModo('feita')}>Concluída</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setModo('parcial')}>Parcial</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setModo('nao_feita')}>Não concluída</Button>
            </div>
            <div className="flex gap-2 border-t border-border pt-3">
              <Button type="button" size="sm" variant="ghost" className="flex-1" onClick={() => setModo('editar')}>Editar</Button>
              <Button type="button" size="sm" variant="ghost" className="flex-1 text-destructive" onClick={() => setModo('excluir')}>Excluir</Button>
            </div>
          </div>
        )}

        {/* CONCLUÍDA / PARCIAL: foto conforme política */}
        {(modo === 'feita' || modo === 'parcial') && (
          <div className="space-y-3">
            <FotoSlots exige={modo === 'feita' ? exigeFotoFeita : exigeFotoParcial} />
            <div className="flex gap-2">
              <Button type="button" className="flex-1" disabled={busy} onClick={() => mudarStatus(modo)}>
                {busy ? 'Salvando…' : modo === 'feita' ? 'Marcar concluída' : 'Marcar parcial'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setModo('view')}>Voltar</Button>
            </div>
          </div>
        )}

        {/* NÃO CONCLUÍDA: só motivo */}
        {modo === 'nao_feita' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="mv" className="text-xs">Motivo da não conclusão</Label>
              <textarea id="mv" value={motivo} onChange={(e) => setMotivo(e.target.value)}
                className="min-h-[72px] w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                placeholder="Ex.: faltou material / sem tempo no turno" />
            </div>
            <div className="flex gap-2">
              <Button type="button" className="flex-1" disabled={busy} onClick={() => mudarStatus('nao_feita')}>
                {busy ? 'Salvando…' : 'Marcar não concluída'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setModo('view')}>Voltar</Button>
            </div>
          </div>
        )}

        {/* EDITAR */}
        {modo === 'editar' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="et" className="text-xs">Título</Label>
              <Input id="et" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="es" className="text-xs">Setor (opcional)</Label>
              <Select id="es" value={setorId} onChange={(e) => setSetorId(e.target.value)}>
                <option value="">Sem setor específico</option>
                {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ef" className="text-xs">Função</Label>
              <Select id="ef" value={funcaoId} onChange={(e) => setFuncaoId(e.target.value)} required>
                <option value="">Selecione…</option>
                {funcoes.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="er" className="text-xs">Responsável</Label>
              <Select id="er" value={colaboradorId} onChange={(e) => setColaboradorId(e.target.value)} disabled={!funcaoId}>
                <option value="">Em aberto</option>
                {responsaveis.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="eh" className="text-xs">Horário</Label>
              <Input id="eh" type="time" value={horario} onChange={(e) => setHorario(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="button" className="flex-1" disabled={busy} onClick={salvarEdicao}>
                {busy ? 'Salvando…' : 'Salvar'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setModo('view')}>Voltar</Button>
            </div>
          </div>
        )}

        {/* EXCLUIR */}
        {modo === 'excluir' && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="xm" className="text-xs">Motivo da exclusão</Label>
              <textarea id="xm" value={motivo} onChange={(e) => setMotivo(e.target.value)}
                className="min-h-[72px] w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none"
                placeholder="Por que esta tarefa está sendo excluída?" />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="destructive" className="flex-1" disabled={busy} onClick={excluir}>
                {busy ? 'Excluindo…' : 'Excluir tarefa'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setModo('view')}>Voltar</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
