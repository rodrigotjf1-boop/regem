'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ImageUpload } from '@/components/ui/image-upload';
import { toast } from '@/lib/toast';
import { CAMPOS_BR, type CampoBr } from '@/lib/br';

type Opt = { value: string; label: string };

export type FieldDef = {
  name: string;
  label: string;
  // cnpj/cpf/telefone/cep/email: mascaram enquanto digita e validam ao sair do
  // campo — o servidor revalida (o front só avisa antes).
  type:
    | 'text'
    | 'password'
    | 'select'
    | 'time'
    | 'date'
    | 'image'
    | 'color'
    | 'multiselect'
    | CampoBr;
  options?: Opt[];
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  /** Habilita "＋ Cadastrar nova…" no select; cria e já seleciona a opção. */
  onCreate?: (nome: string) => Promise<Opt>;
  /** Mostra o campo só quando a condição (sobre os valores atuais) é verdadeira. */
  showIf?: (values: Record<string, string>) => boolean;
  /** Deriva o valor inicial (edição) a partir da linha, quando não é `row[name]`. */
  fromRow?: (row: Record<string, unknown>) => string;
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
  const [erroCampo, setErroCampo] = useState<Record<string, string>>({});

  const regraBr = (f: FieldDef) => CAMPOS_BR[f.type as CampoBr];

  function set(name: string, v: string) {
    setValues((s) => ({ ...s, [name]: v }));
    if (erroCampo[name]) setErroCampo((e) => ({ ...e, [name]: '' })); // some ao corrigir
  }

  // Valida CNPJ/CPF/telefone/CEP/e-mail. Campo vazio e não obrigatório passa.
  function conferir(f: FieldDef, valor: string): string {
    const r = regraBr(f);
    if (!r) return '';
    const v = String(valor ?? '').trim();
    if (!v) return f.required ? 'Campo obrigatório.' : '';
    return r.valido(v) ? '' : r.erro;
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
    // Barra o envio com documento/contato inválido — sem gastar uma ida ao servidor.
    const problemas: Record<string, string> = {};
    for (const f of fields.filter((x) => !x.showIf || x.showIf(values))) {
      const msg = conferir(f, values[f.name] ?? '');
      if (msg) problemas[f.name] = msg;
    }
    if (Object.keys(problemas).length) {
      setErroCampo(problemas);
      toast.error('Confira os campos destacados.');
      return;
    }
    setErro('');
    setSaving(true);
    try {
      await onSubmit(values);
      setValues((s) => {
        const n = { ...s };
        fields.forEach((f) => {
          // Limpa só campos de "digitar"; mantém select/cor/multiselect no default.
          if (['text', 'password', 'time', 'date', 'image'].includes(f.type)) n[f.name] = '';
        });
        return n;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erro ao salvar';
      setErro(msg);
      toast.error(msg); // toda ação tem feedback, mesmo se o texto ficar fora da tela
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {fields.filter((f) => !f.showIf || f.showIf(values)).map((f) => (
        <div key={f.name} className="space-y-1.5">
          <Label htmlFor={f.name}>{f.label}</Label>

          {f.type === 'image' ? (
            <ImageUpload
              id={f.name}
              value={values[f.name] ?? ''}
              onChange={(url) => set(f.name, url)}
            />
          ) : f.type === 'color' ? (
            <div className="flex items-center gap-2">
              <input
                type="color"
                id={f.name}
                aria-label={f.label}
                value={values[f.name] || '#94a3b8'}
                onChange={(e) => set(f.name, e.target.value)}
                className="h-9 w-14 cursor-pointer rounded-md border border-input bg-card p-1"
              />
              <span className="font-mono text-xs text-muted-foreground">
                {values[f.name] || '#94a3b8'}
              </span>
            </div>
          ) : f.type === 'multiselect' ? (
            <div className="flex flex-wrap gap-1.5">
              {(opts[f.name] ?? []).map((o) => {
                const sel = (values[f.name] ?? '').split(',').filter(Boolean);
                const on = sel.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={on ? 'true' : 'false'}
                    onClick={() =>
                      set(
                        f.name,
                        (on ? sel.filter((v) => v !== o.value) : [...sel, o.value]).join(','),
                      )
                    }
                    className={`rounded-md border px-2.5 py-1 text-sm transition-colors ${
                      on
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border text-muted-foreground hover:border-primary/50'
                    }`}
                  >
                    {o.label}
                  </button>
                );
              })}
              {(opts[f.name] ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">
                  Nenhuma opção cadastrada ainda.
                </span>
              )}
            </div>
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
              type={regraBr(f) ? 'text' : f.type === 'text' ? 'text' : f.type}
              inputMode={regraBr(f)?.modo as any}
              value={values[f.name] ?? ''}
              onChange={(e) => {
                const r = regraBr(f);
                set(f.name, r ? r.mascara(e.target.value) : e.target.value);
              }}
              onBlur={(e) => {
                const msg = conferir(f, e.target.value);
                if (msg) setErroCampo((x) => ({ ...x, [f.name]: msg }));
              }}
              aria-invalid={erroCampo[f.name] ? 'true' : undefined}
              className={erroCampo[f.name] ? 'border-destructive' : undefined}
              placeholder={f.placeholder}
              required={f.required}
            />
          )}
          {erroCampo[f.name] && (
            <p role="alert" className="text-xs text-destructive">
              {erroCampo[f.name]}
            </p>
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
