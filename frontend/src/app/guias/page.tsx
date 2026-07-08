'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Copy,
  FileText,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { api, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';

/* eslint-disable @typescript-eslint/no-explicit-any */
const FREQ = [
  { value: 'diaria', label: 'Diária' },
  { value: 'turno', label: 'Por turno' },
  { value: 'semanal', label: 'Semanal' },
  { value: 'sob_demanda', label: 'Sob demanda' },
];
const FREQ_LABEL: Record<string, string> = Object.fromEntries(
  FREQ.map((f) => [f.value, f.label]),
);

const vazio = () => ({
  titulo: '',
  codigo: '',
  frequencia: 'diaria',
  descricao: '',
  alcance: '',
  responsavelExecuta: '',
  responsavelSupervisiona: '',
  materiais: '',
  revisaoMeses: 12,
  logoRef: '',
  passos: [''] as string[],
});

export default function GuiasPage() {
  const [guias, setGuias] = useState<any[]>([]);
  const [sugestoes, setSugestoes] = useState<any[]>([]);
  const [checklists, setChecklists] = useState<any[]>([]);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [editId, setEditId] = useState<string | null>(null);
  const [f, setF] = useState(vazio());
  const set = (patch: Partial<ReturnType<typeof vazio>>) =>
    setF((prev) => ({ ...prev, ...patch }));

  const carregar = useCallback(async () => {
    try {
      const [g, s, c] = await Promise.all([
        api.get('/guias'),
        api.get('/guias/sugestoes').catch(() => ({ sugestoes: [] })),
        api.get('/checklists').catch(() => []),
      ]);
      setGuias(g);
      setSugestoes(s?.sugestoes ?? []);
      setChecklists(Array.isArray(c) ? c : []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (getToken()) carregar();
    else setLoading(false);
  }, [carregar]);

  function flash(texto: string) {
    setMsg(texto);
    setErro('');
    setTimeout(() => setMsg(''), 4000);
  }

  function limpar() {
    setEditId(null);
    setF(vazio());
  }

  function editar(g: any) {
    setEditId(g.id);
    setErro('');
    setMsg('');
    setF({
      titulo: g.titulo ?? '',
      codigo: g.codigo ?? '',
      frequencia: g.frequencia ?? 'diaria',
      descricao: g.descricao ?? '',
      alcance: g.alcance ?? '',
      responsavelExecuta: g.responsavelExecuta ?? '',
      responsavelSupervisiona: g.responsavelSupervisiona ?? '',
      materiais: g.materiais ?? '',
      revisaoMeses: g.revisaoMeses ?? 12,
      logoRef: g.logoRef ?? '',
      passos: g.passos?.length ? g.passos.map((p: any) => p.descricao) : [''],
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Preenche o formulário a partir de um modelo do ramo.
  function usarModelo(s: any) {
    setEditId(null);
    setErro('');
    setF({
      ...vazio(),
      titulo: s.titulo ?? '',
      frequencia: s.frequencia ?? 'diaria',
      descricao: s.descricao ?? '',
      alcance: s.alcance ?? '',
      responsavelExecuta: s.responsavelExecuta ?? '',
      responsavelSupervisiona: s.responsavelSupervisiona ?? '',
      materiais: s.materiais ?? '',
      passos: s.passos?.length ? [...s.passos] : [''],
    });
    flash('Modelo carregado — ajuste e publique.');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Gera um rascunho de POP a partir dos itens de um checklist existente.
  async function gerarDeChecklist(id: string) {
    if (!id) return;
    try {
      const cl = await api.get(`/checklists/${id}`);
      const itens: any[] = cl.itens ?? [];
      setEditId(null);
      setF({
        ...vazio(),
        titulo: cl.nome ? `POP — ${cl.nome}` : 'POP gerado do checklist',
        descricao: `Padronizar a execução das verificações do checklist "${cl.nome}".`,
        passos: itens.length
          ? itens.map((i) => i.procedimento || i.descricao)
          : [''],
      });
      flash(`Rascunho gerado de "${cl.nome}" — revise e publique.`);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao ler checklist');
    }
  }

  async function enviarLogo(file: File) {
    try {
      const { url } = await api.upload(file);
      set({ logoRef: url });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao enviar logo');
    }
  }

  // Monta um prompt pronto p/ colar em qualquer IA gratuita (sem custo p/ nós).
  function copiarPrompt() {
    const passos = f.passos.filter((p) => p.trim());
    const linhas = [
      'Você é um especialista em processos operacionais. Escreva um Procedimento Operacional Padrão (POP) completo, didático e pronto para impressão, em português do Brasil, seguindo a estrutura da Anvisa RDC 216 quando aplicável.',
      '',
      'Estrutura obrigatória: Cabeçalho (com espaço para o logotipo da empresa), Título, Código, Objetivo, Alcance, Responsáveis (quem executa / quem supervisiona), Materiais e EPIs, Procedimento (passo a passo numerado), Frequência, Registros e Revisão.',
      '',
      'Dados fornecidos:',
      `- Título: ${f.titulo || '(defina um título claro)'}`,
      f.codigo && `- Código: ${f.codigo}`,
      `- Objetivo: ${f.descricao || '(descreva o objetivo)'}`,
      f.alcance && `- Alcance: ${f.alcance}`,
      f.responsavelExecuta && `- Executa: ${f.responsavelExecuta}`,
      f.responsavelSupervisiona &&
        `- Supervisiona: ${f.responsavelSupervisiona}`,
      f.materiais && `- Materiais/EPIs: ${f.materiais}`,
      `- Frequência: ${FREQ_LABEL[f.frequencia] ?? f.frequencia}`,
      `- Revisão a cada ${f.revisaoMeses} meses`,
      f.logoRef && `- Logotipo da empresa (anexe esta imagem): ${f.logoRef}`,
      '',
      passos.length ? 'Passos base (refine, detalhe e ordene):' : '',
      ...passos.map((p, i) => `${i + 1}. ${p}`),
      '',
      'Deixe o texto claro para treinar um colaborador iniciante. Não invente normas específicas; se algo não foi informado, use boas práticas gerais do setor.',
    ].filter(Boolean);
    const texto = linhas.join('\n');
    navigator.clipboard
      .writeText(texto)
      .then(() => flash('Prompt copiado! Cole em uma IA gratuita e traga o POP.'))
      .catch(() => setErro('Não foi possível copiar. Copie manualmente.'));
  }

  async function salvar(estado: string) {
    if (f.titulo.trim().length < 2) {
      setErro('Informe o título do procedimento.');
      return;
    }
    setSaving(true);
    setErro('');
    const payload = {
      titulo: f.titulo,
      codigo: f.codigo || undefined,
      frequencia: f.frequencia,
      descricao: f.descricao || undefined,
      alcance: f.alcance || undefined,
      responsavelExecuta: f.responsavelExecuta || undefined,
      responsavelSupervisiona: f.responsavelSupervisiona || undefined,
      materiais: f.materiais || undefined,
      revisaoMeses: Number(f.revisaoMeses) || 12,
      logoRef: f.logoRef || undefined,
      estado,
      passos: f.passos
        .filter((p) => p.trim())
        .map((p, i) => ({ descricao: p, ordem: i })),
    };
    try {
      if (editId) {
        await api.patch(`/guias/${editId}`, payload);
        flash('Guia atualizado.');
      } else {
        await api.post('/guias', payload);
        flash(estado === 'ativo' ? 'Guia publicado.' : 'Rascunho salvo.');
      }
      limpar();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }

  async function excluir(id: string) {
    await api.del(`/guias/${id}`);
    if (editId === id) limpar();
    carregar();
  }

  return (
    <Shell eyebrow="Capacitação" title="POP & Guias">
      {erro && <p className="mb-4 text-destructive">{erro}</p>}
      {msg && (
        <p className="mb-4 rounded-md bg-ok/10 px-3 py-2 text-sm font-medium text-ok">
          {msg}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* Editor */}
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="font-display text-lg font-bold">
              {editId ? 'Editar guia (POP)' : 'Novo guia operacional (POP)'}
            </h2>
            {editId && (
              <Button variant="ghost" size="sm" onClick={limpar}>
                <X className="h-4 w-4" /> Cancelar edição
              </Button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cod">Código</Label>
              <Input
                id="cod"
                value={f.codigo}
                onChange={(e) => set({ codigo: e.target.value })}
                placeholder="POP-COZ-004"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="freq">Frequência</Label>
              <Select
                id="freq"
                value={f.frequencia}
                onChange={(e) => set({ frequencia: e.target.value })}
              >
                {FREQ.map((x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="tit">Título do procedimento</Label>
              <Input
                id="tit"
                value={f.titulo}
                onChange={(e) => set({ titulo: e.target.value })}
                placeholder="Ex.: Higienização de bancadas e utensílios"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="desc">Objetivo</Label>
              <textarea
                id="desc"
                rows={2}
                value={f.descricao}
                onChange={(e) => set({ descricao: e.target.value })}
                className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Garantir a higienização correta das bancadas ao final de cada turno…"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="alc">Alcance</Label>
              <Input
                id="alc"
                value={f.alcance}
                onChange={(e) => set({ alcance: e.target.value })}
                placeholder="Cozinha e áreas de manipulação"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rexe">Responsável — executa</Label>
              <Input
                id="rexe"
                value={f.responsavelExecuta}
                onChange={(e) => set({ responsavelExecuta: e.target.value })}
                placeholder="Auxiliar de cozinha"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rsup">Responsável — supervisiona</Label>
              <Input
                id="rsup"
                value={f.responsavelSupervisiona}
                onChange={(e) =>
                  set({ responsavelSupervisiona: e.target.value })
                }
                placeholder="Chefe de cozinha"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="mat">Materiais e EPIs</Label>
              <Input
                id="mat"
                value={f.materiais}
                onChange={(e) => set({ materiais: e.target.value })}
                placeholder="Detergente neutro, sanitizante, luvas…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rev">Revisar a cada (meses)</Label>
              <Input
                id="rev"
                type="number"
                min={1}
                value={f.revisaoMeses}
                onChange={(e) => set({ revisaoMeses: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="logo">Logo no cabeçalho</Label>
              <div className="flex items-center gap-2">
                {f.logoRef && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={f.logoRef}
                    alt="Logo"
                    className="h-9 w-9 rounded-md border border-border object-cover"
                  />
                )}
                <Input
                  id="logo"
                  type="file"
                  accept="image/*"
                  onChange={(e) =>
                    e.target.files?.[0] && enviarLogo(e.target.files[0])
                  }
                />
              </div>
            </div>
          </div>

          <div className="mt-5">
            <h3 className="mb-2 font-display text-sm font-bold">
              Passos do procedimento
            </h3>
            <div className="space-y-2">
              {f.passos.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-secondary font-mono text-xs font-bold text-muted-foreground">
                    {idx + 1}
                  </span>
                  <Input
                    value={p}
                    onChange={(e) =>
                      set({
                        passos: f.passos.map((x, n) =>
                          n === idx ? e.target.value : x,
                        ),
                      })
                    }
                    placeholder="Descreva o passo…"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remover passo"
                    onClick={() =>
                      set({
                        passos:
                          f.passos.length > 1
                            ? f.passos.filter((_, n) => n !== idx)
                            : f.passos,
                      })
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              onClick={() => set({ passos: [...f.passos, ''] })}
            >
              <Plus className="h-4 w-4" /> Adicionar passo
            </Button>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {editId ? (
              <Button
                className="flex-1"
                disabled={saving}
                onClick={() => salvar('ativo')}
              >
                {saving ? 'Salvando…' : 'Salvar alterações'}
              </Button>
            ) : (
              <>
                <Button
                  className="flex-1"
                  disabled={saving}
                  onClick={() => salvar('ativo')}
                >
                  {saving ? 'Salvando…' : 'Publicar guia'}
                </Button>
                <Button
                  variant="outline"
                  disabled={saving}
                  onClick={() => salvar('rascunho')}
                >
                  Salvar rascunho
                </Button>
              </>
            )}
            <Button variant="outline" type="button" onClick={copiarPrompt}>
              <Copy className="h-4 w-4" /> Copiar prompt de IA
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            &ldquo;Copiar prompt de IA&rdquo; monta um texto pronto com os dados
            acima — cole em qualquer IA gratuita (ChatGPT, Gemini…) e traga o POP
            detalhado de volta. Sem custo para a plataforma.
          </p>
        </Card>

        {/* Coluna lateral */}
        <div className="space-y-4">
          {/* Modelos do ramo */}
          <Card className="p-4">
            <h2 className="mb-1 flex items-center gap-1.5 font-display text-sm font-bold">
              <Sparkles className="h-4 w-4 text-primary" /> Modelos do seu ramo
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Comece de um modelo pronto e edite. Nada é publicado sem você.
            </p>
            <div className="space-y-1.5">
              {sugestoes.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Sem modelos para este ramo.
                </p>
              )}
              {sugestoes.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => usarModelo(s)}
                  className="flex w-full items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm transition hover:bg-secondary"
                >
                  <span className="min-w-0 truncate">{s.titulo}</span>
                  <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </Card>

          {/* Gerar de checklist */}
          <Card className="p-4">
            <h2 className="mb-1 flex items-center gap-1.5 font-display text-sm font-bold">
              <FileText className="h-4 w-4 text-primary" /> Gerar de um checklist
            </h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Transforma os itens de um checklist em passos de um POP rascunho.
            </p>
            {checklists.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Nenhum checklist cadastrado.
              </p>
            ) : (
              <Select
                aria-label="Escolher checklist"
                defaultValue=""
                onChange={(e) => {
                  gerarDeChecklist(e.target.value);
                  e.target.value = '';
                }}
              >
                <option value="" disabled>
                  Escolher checklist…
                </option>
                {checklists.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </Select>
            )}
          </Card>

          {/* Lista */}
          <div className="space-y-2">
            <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
              Guias cadastrados ({guias.length})
            </h2>
            {loading && (
              <>
                {[0, 1, 2].map((i) => (
                  <Card key={i} className="p-4">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-secondary" />
                    <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-secondary" />
                  </Card>
                ))}
              </>
            )}
            {!loading && guias.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum guia ainda. Use um modelo do ramo ou gere de um checklist.
              </p>
            )}
            {!loading &&
              guias.map((g) => {
                const ativo = g.estado === 'ativo';
                return (
                  <Card key={g.id} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">
                          {g.codigo ? `${g.codigo} — ` : ''}
                          {g.titulo}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {g.passos?.length ?? 0} passo(s) ·{' '}
                          {FREQ_LABEL[g.frequencia] ?? g.frequencia}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <span
                          className="rounded-md px-2 py-0.5 text-[11px] font-bold"
                          style={{
                            background: ativo
                              ? 'hsl(var(--ok)/.15)'
                              : 'hsl(var(--warn)/.16)',
                            color: ativo
                              ? 'hsl(var(--ok))'
                              : 'hsl(var(--warn))',
                          }}
                        >
                          {ativo ? 'Ativo' : 'Rascunho'}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Editar"
                          onClick={() => editar(g)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Excluir"
                          onClick={() => excluir(g.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
          </div>
        </div>
      </div>
    </Shell>
  );
}
