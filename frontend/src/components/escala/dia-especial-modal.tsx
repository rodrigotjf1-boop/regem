'use client';

import { useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const TIPOS = [
  { value: 'feriado', label: 'Feriado', emoji: '🎉' },
  { value: 'evento', label: 'Evento', emoji: '📌' },
  { value: 'ferias', label: 'Férias', emoji: '🏖️' },
];

// Cadastro rápido de feriado / evento / férias (dia_especial). Feriados podem
// "fechar" a geração de escala; eventos servem de aviso; férias de um colaborador
// o DESMARCAM da escala no período (a vaga fica aberta p/ cobertura).
export function DiaEspecialModal({
  dataInicial,
  colabs = [],
  onClose,
  onSaved,
}: {
  dataInicial: string;
  colabs?: { id: string; nome: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [tipo, setTipo] = useState('feriado');
  const [nome, setNome] = useState('');
  const [colaboradorId, setColaboradorId] = useState('');
  const [data, setData] = useState(dataInicial);
  const [dataFim, setDataFim] = useState('');
  const [descricao, setDescricao] = useState('');
  const [salvando, setSalvando] = useState(false);
  const ehFerias = tipo === 'ferias';

  async function salvar() {
    if (ehFerias && !colaboradorId) return toast.error('Escolha o colaborador que vai de férias.');
    if (!ehFerias && nome.trim().length < 2)
      return toast.error('Dê um nome (ex.: Natal, Reunião geral).');
    if (!data) return toast.error('Escolha a data.');
    if (dataFim && dataFim < data) return toast.error('A data final deve ser depois da inicial.');
    const nomeColab = colabs.find((c) => c.id === colaboradorId)?.nome ?? 'Colaborador';
    setSalvando(true);
    try {
      const r: any = await api.criarDiaEspecial({
        tipo,
        nome: ehFerias ? `Férias — ${nomeColab}` : nome.trim(),
        colaboradorId: ehFerias ? colaboradorId : undefined,
        data,
        dataFim: dataFim || undefined,
        descricao: descricao.trim() || undefined,
      });
      if (ehFerias) {
        const n = r?.desmarcadas ?? 0;
        toast.success(`Férias registradas — ${n} dia(s) removido(s) da escala de ${nomeColab}.`);
      } else {
        toast.success(tipo === 'feriado' ? 'Feriado cadastrado.' : 'Evento cadastrado.');
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <Card className="w-full max-w-md space-y-4 p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <CalendarPlus className="h-5 w-5 text-primary" />
          <h2 className="font-display text-base font-bold">Feriado, evento ou férias</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          {ehFerias
            ? 'O colaborador sai da escala no período (a vaga fica aberta para cobertura).'
            : 'Feriados podem fechar a geração de escala; eventos servem de aviso (troca de escala, reforço de equipe).'}
        </p>
        <div className="flex gap-2">
          {TIPOS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTipo(t.value)}
              aria-pressed={tipo === t.value}
              className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium ${
                tipo === t.value
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border text-muted-foreground'
              }`}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
        {ehFerias ? (
          <div className="space-y-1.5">
            <Label className="text-xs">Colaborador</Label>
            <select
              value={colaboradorId}
              onChange={(e) => setColaboradorId(e.target.value)}
              className="flex h-10 w-full rounded-md border border-input bg-card px-2 text-sm"
              aria-label="Colaborador de férias"
            >
              <option value="">— escolher —</option>
              {colabs.map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label className="text-xs">Nome</Label>
            <Input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              placeholder={tipo === 'feriado' ? 'Ex.: Natal' : 'Ex.: Reunião geral / reforço'}
              autoFocus
            />
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label className="text-xs">{ehFerias ? 'Início das férias' : 'Data'}</Label>
            <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{ehFerias ? 'Fim das férias' : 'Até (opcional)'}</Label>
            <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Observação (opcional)</Label>
          <Input value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="detalhe do aviso" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" onClick={salvar} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Cadastrar'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
