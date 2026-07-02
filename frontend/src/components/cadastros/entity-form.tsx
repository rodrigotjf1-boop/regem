'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ImageUpload } from '@/components/ui/image-upload';

type Opt = { value: string; label: string };

export type FieldDef = {
  name: string;
  label: string;
  type: 'text' | 'select' | 'time' | 'date' | 'image';
  options?: Opt[];
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  /** Habilita "＋ Cadastrar nova…" no select; cria e já seleciona a opção. */
  onCreate?: (nome: string) => Promise<Opt>;
};

const NOVO = '__novo__';

export function EntityForm({
  fields,
  submitLabel,
  onSubmit,
}: {
  fields: FieldDef[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? ''])),
  );
  const [opts, setOpts] = useState<Record<string, Opt[]>>(() =>
    Object.fromEntries(
      fields.filter((f) => f.options).map((f) => [f.name, f.options ?? []]),
    ),
  );
  const [criando, setCriando] = useState<string | null>(null);
  const [novoNome, setNovoNome] = useState('');
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);

  function set(name: string, v: string) {
    setValues((s) => ({ ...s, [name]: v }));
  }

  async function criarOpcao(f: FieldDef) {
    if (!novoNome.trim() || !f.onCreate) return;
    setErro('');
    try {
      const nova = await f.onCreate(novoNome.trim());
      setOpts((o) => ({ ...o, [f.name]: [...(o[f.name] ?? []), nova] }));
      set(f.name, nova.value);
      setCriando(null);
      setNovoNome('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao criar');
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setSaving(true);
    try {
      await onSubmit(values);
      setValues((s) => {
        const n = { ...s };
        fields.forEach((f) => {
          if (f.type !== 'select') n[f.name] = '';
        });
        return n;
      });
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {fields.map((f) => (
        <div key={f.name} className="space-y-1.5">
          <Label htmlFor={f.name}>{f.label}</Label>

          {f.type === 'image' ? (
            <ImageUpload
              id={f.name}
              value={values[f.name] ?? ''}
              onChange={(url) => set(f.name, url)}
            />
          ) : f.type === 'select' ? (
            <>
              <Select
                id={f.name}
                value={values[f.name] ?? ''}
                required={f.required}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === NOVO) setCriando(f.name);
                  else set(f.name, v);
                }}
              >
                {(opts[f.name] ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                {f.onCreate && <option value={NOVO}>＋ Cadastrar nova…</option>}
              </Select>

              {criando === f.name && (
                <div className="flex gap-2">
                  <Input
                    value={novoNome}
                    onChange={(e) => setNovoNome(e.target.value)}
                    placeholder="Nome da nova opção"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        criarOpcao(f);
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={() => criarOpcao(f)}>
                    Criar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Cancelar"
                    onClick={() => {
                      setCriando(null);
                      setNovoNome('');
                    }}
                  >
                    ✕
                  </Button>
                </div>
              )}
            </>
          ) : (
            <Input
              id={f.name}
              type={f.type === 'text' ? 'text' : f.type}
              value={values[f.name] ?? ''}
              onChange={(e) => set(f.name, e.target.value)}
              placeholder={f.placeholder}
              required={f.required}
            />
          )}
        </div>
      ))}

      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      <Button type="submit" disabled={saving}>
        {saving ? 'Salvando…' : submitLabel}
      </Button>
    </form>
  );
}
