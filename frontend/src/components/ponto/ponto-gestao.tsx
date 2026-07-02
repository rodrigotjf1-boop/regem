'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ImageUpload } from '@/components/ui/image-upload';
import { TIPO_LABEL } from '@/components/ponto/ponto-card';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TIPOS_MARCACAO = [
  { value: 'entrada', label: 'Entrada' },
  { value: 'intervalo_inicio', label: 'Início de intervalo' },
  { value: 'intervalo_fim', label: 'Fim de intervalo' },
  { value: 'saida', label: 'Saída' },
];

function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function PontoGestao({
  colaboradorId,
  dias,
  onDone,
}: {
  colaboradorId: string;
  dias: any[];
  onDone: () => void;
}) {
  const [acao, setAcao] = useState<'incluir' | 'abono' | 'desconsiderar'>(
    'incluir',
  );
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState('');
  const [ok, setOk] = useState('');

  // incluir
  const [tipo, setTipo] = useState('entrada');
  const [marcadoEm, setMarcadoEm] = useState('');
  // abono/atestado
  const [subtipo, setSubtipo] = useState<'abono' | 'atestado'>('atestado');
  const [dataAbono, setDataAbono] = useState('');
  const [minutos, setMinutos] = useState('');
  const [atestadoRef, setAtestadoRef] = useState('');
  // desconsiderar
  const [diaSel, setDiaSel] = useState('');
  const [marcacaoId, setMarcacaoId] = useState('');
  // comum
  const [justificativa, setJustificativa] = useState('');

  const marcacoesDoDia =
    dias.find((d) => d.data === diaSel)?.marcacoes?.filter((m: any) => !m.desconsiderada) ??
    [];

  function limpar() {
    setMarcadoEm('');
    setMinutos('');
    setAtestadoRef('');
    setMarcacaoId('');
    setJustificativa('');
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setOk('');
    if (justificativa.trim().length < 3) {
      setErro('Justificativa obrigatória.');
      return;
    }
    setSaving(true);
    try {
      if (acao === 'incluir') {
        if (!marcadoEm) throw new Error('Informe a data e hora.');
        await api.incluirMarcacaoPonto({
          colaboradorId,
          tipo,
          marcadoEm: new Date(marcadoEm).toISOString(),
          justificativa,
        });
        setOk('Marcação incluída.');
      } else if (acao === 'abono') {
        if (!dataAbono) throw new Error('Informe o dia.');
        await api.criarAjustePonto({
          colaboradorId,
          data: dataAbono,
          tipo: subtipo,
          minutos: minutos ? Number(minutos) : undefined,
          justificativa,
          atestadoRef: atestadoRef || undefined,
        });
        setOk(subtipo === 'atestado' ? 'Atestado registrado.' : 'Abono registrado.');
      } else {
        if (!diaSel || !marcacaoId) throw new Error('Escolha o dia e a marcação.');
        await api.criarAjustePonto({
          colaboradorId,
          data: diaSel,
          tipo: 'desconsideracao',
          marcacaoId,
          justificativa,
        });
        setOk('Marcação desconsiderada.');
      }
      limpar();
      onDone();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={salvar} className="space-y-3 border-t border-border px-5 py-4">
      <div className="flex flex-wrap gap-1.5">
        {[
          { v: 'incluir', l: 'Incluir marcação' },
          { v: 'abono', l: 'Abono / Atestado' },
          { v: 'desconsiderar', l: 'Desconsiderar' },
        ].map((a) => (
          <button
            key={a.v}
            type="button"
            onClick={() => {
              setAcao(a.v as any);
              setErro('');
              setOk('');
            }}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              acao === a.v
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {a.l}
          </button>
        ))}
      </div>

      {acao === 'incluir' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onChange={(e) => setTipo(e.target.value)}>
              {TIPOS_MARCACAO.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Data e hora</Label>
            <Input
              type="datetime-local"
              value={marcadoEm}
              onChange={(e) => setMarcadoEm(e.target.value)}
            />
          </div>
        </div>
      )}

      {acao === 'abono' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select
              value={subtipo}
              onChange={(e) => setSubtipo(e.target.value as any)}
            >
              <option value="atestado">Atestado</option>
              <option value="abono">Abono</option>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Dia</Label>
            <Input
              type="date"
              value={dataAbono}
              onChange={(e) => setDataAbono(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">
              Minutos (vazio = abona a jornada do dia)
            </Label>
            <Input
              type="number"
              inputMode="numeric"
              value={minutos}
              onChange={(e) => setMinutos(e.target.value)}
              placeholder="ex.: 480 (8h)"
            />
          </div>
          {subtipo === 'atestado' && (
            <div className="space-y-1">
              <Label className="text-xs">Foto do atestado</Label>
              <ImageUpload value={atestadoRef} onChange={setAtestadoRef} />
            </div>
          )}
        </div>
      )}

      {acao === 'desconsiderar' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Dia</Label>
            <Select
              value={diaSel}
              onChange={(e) => {
                setDiaSel(e.target.value);
                setMarcacaoId('');
              }}
            >
              <option value="">— escolha —</option>
              {dias.map((d) => (
                <option key={d.data} value={d.data}>
                  {new Date(`${d.data}T00:00:00`).toLocaleDateString('pt-BR')}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Marcação</Label>
            <Select
              value={marcacaoId}
              onChange={(e) => setMarcacaoId(e.target.value)}
              disabled={!diaSel}
            >
              <option value="">— escolha —</option>
              {marcacoesDoDia.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {hhmm(m.hora)} · {TIPO_LABEL[m.tipo] ?? m.tipo}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}

      <div className="space-y-1">
        <Label className="text-xs">Justificativa</Label>
        <Input
          value={justificativa}
          onChange={(e) => setJustificativa(e.target.value)}
          placeholder="Motivo da correção (obrigatório, fica na auditoria)"
        />
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {ok && <p className="text-sm text-[hsl(var(--ok))]">{ok}</p>}

      <Button type="submit" size="sm" disabled={saving}>
        {saving ? 'Salvando…' : 'Registrar correção'}
      </Button>
    </form>
  );
}
