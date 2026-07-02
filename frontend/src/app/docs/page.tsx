'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { api, clearToken, getToken } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { BottomNav } from '@/components/app-shell/bottom-nav';
import { EntityForm, type FieldDef } from '@/components/cadastros/entity-form';
import { ChecklistCard } from '@/components/docs/checklist-card';
import { DocumentoCard } from '@/components/docs/documento-card';
import { RegemMark } from '@/components/brand/regem-mark';

/* eslint-disable @typescript-eslint/no-explicit-any */
const TIPOS_DOC = [
  { value: 'regimento', label: 'Regimento' },
  { value: 'treinamento', label: 'Treinamento' },
  { value: 'comunicado', label: 'Comunicado' },
  { value: 'outro', label: 'Outro' },
];

export default function DocsPage() {
  const router = useRouter();
  const [checklists, setChecklists] = useState<any[]>([]);
  const [documentos, setDocumentos] = useState<any[]>([]);
  const [unidades, setUnidades] = useState<any[]>([]);
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState('');
  const [ver, setVer] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [cl, doc, un] = await Promise.all([
        api.get('/checklists'),
        api.get('/documentos'),
        api.get('/unidades'),
      ]);
      setChecklists(cl);
      setDocumentos(doc);
      setUnidades(un);
      setVer((v) => v + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setPronto(true);
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/');
      return;
    }
    reload();
  }, [reload, router]);

  function sair() {
    clearToken();
    router.replace('/');
  }

  if (!pronto) {
    return (
      <div className="grid min-h-dvh place-items-center text-muted-foreground">
        Carregando…
      </div>
    );
  }

  const optU = unidades.map((u: any) => ({ value: u.id, label: u.nome }));

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-border bg-card/80 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <RegemMark className="h-8 w-8 text-foreground" />
            <p className="text-sm font-semibold">Documentos</p>
          </div>
          <Button variant="ghost" size="icon" onClick={sair} aria-label="Sair">
            <LogOut className="h-5 w-5" />
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-6 px-4 py-4 pb-24">
        {erro && (
          <p role="alert" className="text-destructive">
            {erro}
          </p>
        )}

        <section className="space-y-3">
          <h2 className="font-semibold">Checklists → POP</h2>
          <Card className="p-4">
            <EntityForm
              key={`cl-${ver}`}
              submitLabel="Criar checklist"
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
                  {
                    name: 'nome',
                    label: 'Nome',
                    type: 'text',
                    required: true,
                    placeholder: 'Ex.: Abertura da cozinha',
                  },
                ] as FieldDef[]
              }
              onSubmit={async (v) => {
                await api.post('/checklists', {
                  unidadeId: v.unidadeId,
                  nome: v.nome,
                });
                await reload();
              }}
            />
          </Card>
          {checklists.map((cl) => (
            <ChecklistCard key={cl.id} cl={cl} onChanged={reload} />
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="font-semibold">Documentos + ciência</h2>
          <Card className="p-4">
            <EntityForm
              key={`doc-${ver}`}
              submitLabel="Criar documento"
              fields={
                [
                  {
                    name: 'tipo',
                    label: 'Tipo',
                    type: 'select',
                    options: TIPOS_DOC,
                    defaultValue: 'comunicado',
                  },
                  {
                    name: 'titulo',
                    label: 'Título',
                    type: 'text',
                    required: true,
                    placeholder: 'Ex.: Regimento interno',
                  },
                ] as FieldDef[]
              }
              onSubmit={async (v) => {
                await api.post('/documentos', { tipo: v.tipo, titulo: v.titulo });
                await reload();
              }}
            />
          </Card>
          {documentos.map((d) => (
            <DocumentoCard key={d.id} doc={d} onChanged={reload} />
          ))}
        </section>
      </main>
      <BottomNav />
    </div>
  );
}
