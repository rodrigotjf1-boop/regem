'use client';

import { Card } from '@/components/ui/card';
import { EntityForm, type FieldDef } from '@/components/cadastros/entity-form';
import { META } from '@/components/cadastros/constants';
import { type Opt, type Secao } from '@/components/cadastros/build-secoes';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

export function CadastrosHub({
  secoes,
  busca,
  setBusca,
  onSelect,
  ver,
  optU,
  reload,
  onNavigate,
}: {
  secoes: Secao[];
  busca: string;
  setBusca: (v: string) => void;
  onSelect: (key: string) => void;
  ver: number;
  optU: Opt[];
  reload: () => Promise<void>;
  onNavigate: (path: string) => void;
}) {
  const feitas = secoes.filter((s) => s.itens.length > 0).length;
  const pct = Math.round((feitas / secoes.length) * 100);
  const q = busca.trim().toLowerCase();
  const visiveis = secoes.filter(
    (s) => !q || s.titulo.toLowerCase().includes(q) || s.key.includes(q),
  );
  const tint = (key: string) =>
    key === 'pico' || key === 'fornecedor'
      ? 'bg-warn/10'
      : key === 'colaborador' || key === 'turno'
        ? 'bg-ok/10'
        : 'bg-info/10';

  return (
    <>
      {/* Busca */}
      <div className="relative max-w-sm">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          type="search"
          placeholder="Buscar cadastro… (ex.: funções)"
          aria-label="Buscar cadastro"
          className="h-11 w-full rounded-lg border border-input bg-card pl-3 pr-3 text-sm"
        />
      </div>

      {/* Barra de completude */}
      <Card className="p-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <b className="font-display text-sm font-bold">
            Configuração da unidade
          </b>
          <span className="font-mono text-sm font-bold text-primary">
            {pct}%
          </span>
          <span className="text-xs text-muted-foreground">
            {feitas} de {secoes.length} cadastros com dados
          </span>
        </div>
        <div className="my-3 h-2 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
      </Card>

      {/* Template por ramo */}
      <Card className="border-primary/40 bg-primary/5 p-5">
        <h2 className="font-display text-sm font-bold">Template por ramo</h2>
        <p className="mb-3 mt-1 max-w-xl text-sm text-muted-foreground">
          Cria setores, funções, etiquetas, tipos de ocorrência e itens de
          estoque de uma vez — sem cadastrar tudo à mão. Nada existente é
          apagado.
        </p>
        {optU.length > 0 ? (
          <EntityForm
            key={`tpl-${ver}`}
            submitLabel="Aplicar Food Service"
            fields={
              [
                {
                  name: 'unidadeId',
                  label: 'Unidade',
                  type: 'select',
                  required: true,
                  options: optU,
                  defaultValue: optU[0]?.value,
                },
              ] as FieldDef[]
            }
            onSubmit={async (v) => {
              await api.post('/onboarding/template', {
                unidadeId: v.unidadeId,
                ramo: 'food_service',
              });
              await reload();
            }}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Crie uma unidade primeiro (em Unidades).
          </p>
        )}
      </Card>

      {/* Grid por dependência */}
      <p className="px-1 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
        Ordem sugerida — cada etapa habilita a próxima
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visiveis.map((sec) => {
          const m = META[sec.key];
          const zero = sec.itens.length === 0;
          return (
            <button
              key={sec.key}
              type="button"
              onClick={() => onSelect(sec.key)}
              className={`relative flex flex-col gap-3 rounded-2xl border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 ${
                zero ? 'border-dashed border-input' : 'border-border'
              }`}
            >
              {zero && m?.nudge && (
                <span className="absolute -top-2 left-4 rounded-full bg-primary px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-primary-foreground">
                  Comece por aqui
                </span>
              )}
              <div className="flex items-start gap-3">
                <div
                  className={`grid h-10 w-10 flex-none place-items-center rounded-xl text-lg ${tint(
                    sec.key,
                  )}`}
                >
                  {m?.icon ?? '📋'}
                </div>
                <div>
                  <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
                    Passo {m?.step ?? '—'}
                  </div>
                  <h3 className="font-display text-[15px] font-bold">
                    {sec.titulo}
                  </h3>
                </div>
                <span className="ml-auto grid h-8 w-8 flex-none place-items-center rounded-lg border border-border bg-secondary text-base text-muted-foreground">
                  ＋
                </span>
              </div>
              <div
                className={`font-mono text-2xl font-bold ${
                  zero ? 'text-muted-foreground' : ''
                }`}
              >
                {sec.itens.length}{' '}
                <small className="font-sans text-xs font-medium text-muted-foreground">
                  cadastrado(s)
                </small>
              </div>
              {zero && m?.nudge ? (
                <div className="rounded-lg bg-info/10 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  💡 {m.nudge}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  {zero ? 'Ainda sem cadastros' : 'Toque para ver e adicionar'}
                </div>
              )}
            </button>
          );
        })}
        {visiveis.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-input bg-secondary/50 p-10 text-center text-sm text-muted-foreground">
            🔍 Nenhum cadastro encontrado para “{busca}”.
          </div>
        )}
      </div>

      {/* Produtos & Equipamentos (fora da cadeia de dependência) */}
      <button
        type="button"
        onClick={() => onNavigate('/produtos')}
        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40"
      >
        <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-ok/10 text-lg">
          🍔
        </div>
        <div>
          <h3 className="font-display text-[15px] font-bold">
            Produtos & Catálogo
          </h3>
          <span className="text-sm text-muted-foreground">
            O que se vende no PDV — categorias, fichas, variações, combos
          </span>
        </div>
      </button>

      <button
        type="button"
        onClick={() => onNavigate('/equipamentos')}
        className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40"
      >
        <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-info/10 text-lg">
          🖥️
        </div>
        <div>
          <h3 className="font-display text-[15px] font-bold">
            Equipamentos & Apps
          </h3>
          <span className="text-sm text-muted-foreground">
            Cadastrar KDS e Terminais de Ponto (device token)
          </span>
        </div>
      </button>
    </>
  );
}
