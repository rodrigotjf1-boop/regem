'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ScrollText, Sparkles } from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
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
  const [sugCl, setSugCl] = useState<any[]>([]);
  const [sugDoc, setSugDoc] = useState<any[]>([]);
  const [uniStarter, setUniStarter] = useState('');
  const [pronto, setPronto] = useState(false);
  const [erro, setErro] = useState('');
  const [ver, setVer] = useState(0);

  const reload = useCallback(async () => {
    try {
      const [cl, doc, un, scl, sdoc] = await Promise.all([
        api.get('/checklists'),
        api.get('/documentos'),
        api.get('/unidades'),
        api.get('/checklists/sugestoes').catch(() => ({ sugestoes: [] })),
        api.get('/documentos/sugestoes').catch(() => ({ sugestoes: [] })),
      ]);
      setChecklists(cl);
      setDocumentos(doc);
      setUnidades(un);
      setSugCl(scl?.sugestoes ?? []);
      setSugDoc(sdoc?.sugestoes ?? []);
      setUniStarter((u) => u || un[0]?.id || '');
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

  // Cria um checklist a partir de um modelo do ramo (com os itens já preenchidos).
  async function usarModeloChecklist(s: any) {
    if (!uniStarter) {
      setErro('Cadastre/escolha uma unidade para o modelo.');
      return;
    }
    try {
      const cl = await api.post('/checklists', {
        unidadeId: uniStarter,
        nome: s.nome,
      });
      for (const [i, it] of (s.itens ?? []).entries()) {
        await api.post(`/checklists/${cl.id}/itens`, {
          descricao: it.descricao,
          procedimento: it.procedimento || undefined,
          ordem: i,
        });
      }
      await reload();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao criar modelo');
    }
  }

  async function usarModeloDocumento(s: any) {
    try {
      await api.post('/documentos', {
        tipo: s.tipo,
        titulo: s.titulo,
        escopo: s.escopo || undefined,
        conteudo: { texto: s.texto },
      });
      await reload();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao criar modelo');
    }
  }

  const optU = unidades.map((u: any) => ({ value: u.id, label: u.nome }));

  return (
    <Shell eyebrow="Qualidade" title="Documentos">
      <div className="max-w-3xl space-y-8">
        {erro && (
          <p role="alert" className="text-destructive">
            {erro}
          </p>
        )}

        {!pronto ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Card key={i} className="p-4">
                <div className="h-4 w-1/2 animate-pulse rounded bg-secondary" />
                <div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-secondary" />
              </Card>
            ))}
          </div>
        ) : (
          <>
            {/* Atalho para POP & Guias (agora dentro de Documentos) */}
            <Card className="flex items-center justify-between gap-3 p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-primary/10 text-primary">
                  <ScrollText className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-display font-semibold">POP &amp; Guias</p>
                  <p className="text-sm text-muted-foreground">
                    Procedimentos operacionais padrão e guias ilustrados, com
                    criação assistida por IA.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={() => router.push('/guias')}
                className="flex-none"
              >
                Abrir →
              </Button>
            </Card>

            {/* ── Checklists → POP ── */}
            <section className="space-y-3">
              <div>
                <h2 className="font-display font-semibold">Checklists → POP</h2>
                <p className="text-sm text-muted-foreground">
                  Monte a lista de verificações; ao publicar, ela gera o POP
                  vigente.
                </p>
              </div>

              {/* Modelos do ramo */}
              {sugCl.length > 0 && (
                <Card className="space-y-2 p-4">
                  <h3 className="flex items-center gap-1.5 text-sm font-bold">
                    <Sparkles className="h-4 w-4 text-primary" /> Modelos do seu
                    ramo
                  </h3>
                  {optU.length > 1 && (
                    <Select
                      aria-label="Unidade do modelo"
                      value={uniStarter}
                      onChange={(e) => setUniStarter(e.target.value)}
                    >
                      {optU.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {sugCl.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => usarModeloChecklist(s)}
                        className="rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-secondary"
                      >
                        + {s.nome}
                      </button>
                    ))}
                  </div>
                </Card>
              )}

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

              {checklists.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhum checklist ainda. Use um modelo do ramo ou crie um acima.
                </p>
              )}
              {checklists.map((cl) => (
                <ChecklistCard key={cl.id} cl={cl} onChanged={reload} />
              ))}
            </section>

            {/* ── Documentos + ciência ── */}
            <section className="space-y-3">
              <div>
                <h2 className="font-display font-semibold">
                  Documentos + ciência
                </h2>
                <p className="text-sm text-muted-foreground">
                  Regimentos, treinamentos e comunicados que a equipe lê e dá
                  ciência.
                </p>
              </div>

              {sugDoc.length > 0 && (
                <Card className="space-y-2 p-4">
                  <h3 className="flex items-center gap-1.5 text-sm font-bold">
                    <Sparkles className="h-4 w-4 text-primary" /> Modelos do seu
                    ramo
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {sugDoc.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => usarModeloDocumento(s)}
                        className="rounded-md border border-border px-3 py-1.5 text-sm transition hover:bg-secondary"
                      >
                        + {s.titulo}
                      </button>
                    ))}
                  </div>
                </Card>
              )}

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
                    await api.post('/documentos', {
                      tipo: v.tipo,
                      titulo: v.titulo,
                    });
                    await reload();
                  }}
                />
              </Card>

              {documentos.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Nenhum documento ainda. Use um modelo do ramo ou crie um acima.
                </p>
              )}
              {documentos.map((d) => (
                <DocumentoCard key={d.id} doc={d} onChanged={reload} />
              ))}
            </section>
          </>
        )}
      </div>
    </Shell>
  );
}
