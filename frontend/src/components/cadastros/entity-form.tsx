'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

export type FieldDef = {
  name: string;
  label: string;
  type: 'text' | 'select';
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
};

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
  const [erro, setErro] = useState('');
  const [saving, setSaving] = useState(false);

  function set(name: string, v: string) {
    setValues((s) => ({ ...s, [name]: v }));
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
          if (f.type === 'text') n[f.name] = '';
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
          {f.type === 'text' ? (
            <Input
              id={f.name}
              value={values[f.name] ?? ''}
              onChange={(e) => set(f.name, e.target.value)}
              placeholder={f.placeholder}
              required={f.required}
            />
          ) : (
            <Select
              id={f.name}
              value={values[f.name] ?? ''}
              onChange={(e) => set(f.name, e.target.value)}
              required={f.required}
            >
              {(f.options ?? []).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
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
