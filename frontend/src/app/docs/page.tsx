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
import { Shell } from '@/components/app-shell/shell';

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
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  if (!pronto) {
    return (
      <div className="grid min-h-dvh place-items-center text-muted-foreground">
        Carregando…
      </div>
    );
  }

  const optU = unidades.map((u: any) => ({ value: u.id, label: u.nome }));

  return (
    <Shell eyebrow="Qualidade" title="Documentos">
      <div className="max-w-3xl space-y-6">
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
      </div>
    </Shell>
  );
}
