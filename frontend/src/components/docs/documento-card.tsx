'use client';

import { useState } from 'react';
import { Check, Pencil, Trash2, Users } from 'lucide-react';
import { api, getCategoria } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ESTADO: Record<string, { label: string; cls: string }> = {
  rascunho: { label: 'Rascunho', cls: 'bg-secondary text-muted-foreground' },
  vigente: { label: 'Vigente', cls: 'bg-ok/10 text-ok' },
  arquivado: { label: 'Arquivado', cls: 'bg-secondary text-muted-foreground' },
};
const TIPOS = [
  { value: 'regimento', label: 'Regimento' },
  { value: 'treinamento', label: 'Treinamento' },
  { value: 'comunicado', label: 'Comunicado' },
  { value: 'outro', label: 'Outro' },
];

function textoDe(conteudo: any): string {
  if (!conteudo) return '';
  if (typeof conteudo === 'string') return conteudo;
  return conteudo.texto ?? '';
}

export function DocumentoCard({
  doc,
  onChanged,
}: {
  doc: any;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [editando, setEditando] = useState(false);
  const [ed, setEd] = useState({
    tipo: doc.tipo,
    titulo: doc.titulo,
    escopo: doc.escopo ?? '',
    texto: textoDe(doc.conteudo),
  });
  const [ciencias, setCiencias] = useState<any[] | null>(null);

  const cat = getCategoria();
  const gestor = cat === 'presidente' || cat === 'gerente';
  const st = ESTADO[doc.estado] ?? ESTADO.rascunho;
  const texto = textoDe(doc.conteudo);

  async function acao(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setErro('');
    setMsg('');
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  async function salvarEdicao() {
    await acao(async () => {
      await api.patch(`/documentos/${doc.id}`, {
        tipo: ed.tipo,
        titulo: ed.titulo,
        escopo: ed.escopo || undefined,
        conteudo: { texto: ed.texto },
      });
      setEditando(false);
      onChanged();
    });
  }

  async function verCiencias() {
    if (ciencias) {
      setCiencias(null);
      return;
    }
    try {
      setCiencias(await api.get(`/documentos/${doc.id}/ciencias`));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro');
    }
  }

  if (editando) {
    return (
      <Card className="space-y-3 p-4">
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
          <Select
            aria-label="Tipo"
            value={ed.tipo}
            onChange={(e) => setEd({ ...ed, tipo: e.target.value })}
          >
            {TIPOS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
          <Input
            value={ed.titulo}
            onChange={(e) => setEd({ ...ed, titulo: e.target.value })}
            placeholder="Título"
          />
        </div>
        <Input
          value={ed.escopo}
          onChange={(e) => setEd({ ...ed, escopo: e.target.value })}
          placeholder="Escopo (ex.: Todos os colaboradores) — opcional"
        />
        <textarea
          rows={8}
          value={ed.texto}
          onChange={(e) => setEd({ ...ed, texto: e.target.value })}
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          placeholder="Conteúdo do documento…"
        />
        {erro && (
          <p role="alert" className="text-sm text-destructive">
            {erro}
          </p>
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1"
            onClick={salvarEdicao}
            disabled={busy}
          >
            Salvar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditando(false)}
            disabled={busy}
          >
            Cancelar
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium">{doc.titulo}</p>
          <p className="text-xs capitalize text-muted-foreground">
            {doc.tipo}
            {doc.escopo ? ` · ${doc.escopo}` : ''} · v{doc.versao}
          </p>
        </div>
        <Badge className={st.cls}>{st.label}</Badge>
      </div>

      {texto ? (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
          {texto}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Sem conteúdo.{' '}
          {gestor && 'Use “Editar” para escrever o documento.'}
        </p>
      )}

      {/* Ciência */}
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Users className="h-4 w-4" />
        <span>
          {doc.cienciaCount ?? 0} deram ciência (v{doc.versao})
        </span>
        {doc.jaCiente && (
          <span className="inline-flex items-center gap-1 text-ok">
            <Check className="h-3.5 w-3.5" /> você já deu
          </span>
        )}
        {gestor && (doc.cienciaCount ?? 0) > 0 && (
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={verCiencias}
          >
            {ciencias ? 'ocultar' : 'ver quem'}
          </button>
        )}
      </div>
      {ciencias && (
        <ul className="rounded-md bg-secondary/50 p-2 text-xs text-muted-foreground">
          {ciencias.map((c) => (
            <li key={c.id} className="flex justify-between gap-2 py-0.5">
              <span>{c.nome ?? c.colaboradorId}</span>
              <span className="font-mono">
                {c.data ? new Date(c.data).toLocaleDateString('pt-BR') : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {erro && (
        <p role="alert" className="text-sm text-destructive">
          {erro}
        </p>
      )}
      {msg && <p className="text-sm text-ok">{msg}</p>}

      <div className="flex flex-wrap gap-2">
        {doc.estado === 'vigente' && !doc.jaCiente && (
          <Button
            type="button"
            onClick={() =>
              acao(
                () => api.post(`/documentos/${doc.id}/ciencia`, {}),
                'Ciência registrada ✓',
              ).then(onChanged)
            }
            disabled={busy}
          >
            Dar ciência
          </Button>
        )}
        {gestor && doc.estado !== 'vigente' && (
          <Button
            type="button"
            onClick={() =>
              acao(() => api.post(`/documentos/${doc.id}/publicar`, {})).then(
                onChanged,
              )
            }
            disabled={busy}
          >
            Publicar
          </Button>
        )}
        {gestor && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setEditando(true)}
            disabled={busy}
          >
            <Pencil className="h-4 w-4" /> Editar
          </Button>
        )}
        {gestor && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Excluir documento"
            onClick={() =>
              acao(() => api.del(`/documentos/${doc.id}`)).then(onChanged)
            }
            disabled={busy}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </Card>
  );
}
