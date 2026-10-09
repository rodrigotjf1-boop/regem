'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialogo } from '@/components/ui/sobreposto';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Situacao = 'novo' | 'igual' | 'parecido' | 'repetido';
type Linha = {
  linha: number;
  nome: string;
  nomeFormatado: string;
  nomeComercial?: string;
  marcas?: string[];
  unidadeArquivo: string;
  unidade: string | null;
  categoria: string;
  estoqueMinimo: number | null;
  custo: number | null;
  quantidade: number | null;
  situacao: Situacao;
  existente: { id: string; nome: string } | null;
};
type Previa = {
  arquivo: string;
  formato: 'alochefia' | 'regem' | 'generico';
  colunas: Record<'nome' | 'comercial' | 'marcas' | 'unidade' | 'categoria' | 'minimo' | 'custo' | 'quantidade', string | null>;
  linhas: Linha[];
  unidades: { noArquivo: string; sugestao: string | null; produtos: number }[];
  categoriasNovas: string[];
  resumo: { total: number; novos: number; parecidos: number; iguais: number; repetidos: number; semNome: number };
};

const FORMATO = {
  alochefia: 'Alô Chefia · Relatório de Estoque',
  regem: 'exportação do Regem',
  generico: 'planilha comum',
} as const;
const SELO: Record<Situacao, { rotulo: string; cls: string }> = {
  novo: { rotulo: 'Novo', cls: 'bg-ok/15 text-foreground' },
  parecido: { rotulo: 'Parecido', cls: 'bg-warn/15 text-foreground' },
  igual: { rotulo: 'Já existe · não importa', cls: 'bg-secondary text-secondary-foreground' },
  repetido: { rotulo: 'Repetido no arquivo · não importa', cls: 'bg-secondary text-secondary-foreground' },
};
const texto2 = 'text-secondary-foreground';
const PASSOS = ['Arquivo', 'Unidades e opções', 'Conferência'];

// Importar o cadastro de produtos de uma planilha, em três passos: escolher o arquivo; conferir
// para qual unidade do Regem vai cada unidade do arquivo e o que trazer; conferir produto a
// produto. NADA é gravado antes do último botão — e o que já existe não entra de novo.
export function ImportarProdutos({
  unidades,
  aoFechar,
  aoImportar,
}: {
  unidades: string[];
  aoFechar: () => void;
  aoImportar: () => void;
}) {
  const [passo, setPasso] = useState(1);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState('');
  // unidade do arquivo → unidade do Regem ('' = ainda não escolhida)
  const [mapa, setMapa] = useState<Record<string, string>>({});
  const [padronizar, setPadronizar] = useState(true);
  const [trazerMinimo, setTrazerMinimo] = useState(true);
  const [trazerCusto, setTrazerCusto] = useState(true);
  const [trazerSaldo, setTrazerSaldo] = useState(false);
  const [marcados, setMarcados] = useState<Set<number>>(new Set());
  const [ver, setVer] = useState<'todos' | Situacao>('todos');
  const [enviando, setEnviando] = useState(false);
  // Ao trocar de passo o foco vai para o topo do diálogo. Sem isso ele ficaria no botão do
  // rodapé, que o React reaproveita: o Enter de "Conferir" cairia em "Importar" sem conferência.
  const topo = useRef<HTMLOListElement>(null);
  const passoAnterior = useRef(passo);
  useEffect(() => {
    // Só quando o passo MUDA (não na abertura, em que o foco é do campo do arquivo).
    if (passoAnterior.current === passo) return;
    passoAnterior.current = passo;
    topo.current?.focus();
  }, [passo]);

  async function lerArquivo(file: File | undefined) {
    if (!file || lendo) return;
    setErro('');
    setLendo(true);
    try {
      const p: Previa = await api.importarProdutosPrevia(file);
      setPrevia(p);
      setMapa(Object.fromEntries(p.unidades.map((u) => [u.noArquivo, u.sugestao ?? ''])));
      // Novos já vêm marcados; parecidos, não — a pessoa marca só os que forem outro produto.
      setMarcados(new Set(p.linhas.filter((l) => l.situacao === 'novo').map((l) => l.linha)));
      setVer('todos');
      setPasso(2);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui ler a planilha.');
    } finally {
      setLendo(false);
    }
  }

  const importaveis = useMemo(() => (previa?.linhas ?? []).filter((l) => l.situacao === 'novo' || l.situacao === 'parecido'), [previa]);
  const escolhidos = importaveis.filter((l) => marcados.has(l.linha));
  const semUnidade = previa ? previa.unidades.filter((u) => !mapa[u.noArquivo]) : [];
  const alternar = (linha: number) =>
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(linha)) n.delete(linha);
      else n.add(linha);
      return n;
    });
  const marcarParecidos = (marcar: boolean) =>
    setMarcados((s) => {
      const n = new Set(s);
      for (const l of importaveis) {
        if (l.situacao !== 'parecido') continue;
        if (marcar) n.add(l.linha);
        else n.delete(l.linha);
      }
      return n;
    });

  async function importar() {
    if (!previa || enviando || !escolhidos.length) return;
    setErro('');
    setEnviando(true);
    try {
      const r: any = await api.importarProdutos({
        arquivo: previa.arquivo,
        itens: escolhidos.map((l) => ({
          nome: padronizar ? l.nomeFormatado : l.nome,
          nomeComercial: l.nomeComercial || undefined,
          marcas: l.marcas?.length ? l.marcas : undefined,
          unidadeMedida: mapa[l.unidadeArquivo],
          categoria: l.categoria || undefined,
          estoqueMinimo: trazerMinimo ? (l.estoqueMinimo ?? undefined) : undefined,
          custo: trazerCusto ? (l.custo ?? undefined) : undefined,
          quantidade: trazerSaldo ? (l.quantidade ?? undefined) : undefined,
        })),
      });
      const fora = r?.jaExistiam?.length ?? 0;
      toast.success(
        `${r?.criados ?? 0} produto(s) importado(s).${fora ? ` ${fora} já existia(m) e ficou(aram) de fora.` : ''}${
          r?.categoriasCriadas?.length ? ` ${r.categoriasCriadas.length} categoria(s) criada(s).` : ''
        }`,
      );
      aoImportar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao importar');
      setEnviando(false);
    }
  }

  const r = previa?.resumo;
  const visiveis = (previa?.linhas ?? []).filter((l) => ver === 'todos' || l.situacao === ver);
  const FILTROS: { v: 'todos' | Situacao; rotulo: string; n: number }[] = r
    ? [
        { v: 'todos', rotulo: 'Todos', n: r.total },
        { v: 'novo', rotulo: 'Novos', n: r.novos },
        { v: 'parecido', rotulo: 'Parecidos', n: r.parecidos },
        { v: 'igual', rotulo: 'Já existem', n: r.iguais },
        ...(r.repetidos ? [{ v: 'repetido' as const, rotulo: 'Repetidos no arquivo', n: r.repetidos }] : []),
      ]
    : [];

  return (
    <Dialogo
      titulo="Importar produtos"
      largura="lg"
      aoFechar={aoFechar}
      fecharNoFundo={false}
      rodape={
        passo === 1 ? (
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
        ) : passo === 2 ? (
          <>
            <Button type="button" variant="outline" onClick={() => { setPasso(1); setErro(''); }}>← Voltar</Button>
            <Button key="conferir" type="button" disabled={semUnidade.length > 0} onClick={() => setPasso(3)}>Conferir →</Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" onClick={() => { setPasso(2); setErro(''); }} disabled={enviando}>← Voltar</Button>
            <Button key="importar" type="button" disabled={enviando || !escolhidos.length} onClick={importar}>
              {enviando ? 'Importando…' : `Importar ${escolhidos.length} produto(s)`}
            </Button>
          </>
        )
      }
    >
      <div className="space-y-4 text-sm">
        <ol ref={topo} tabIndex={-1} className="flex flex-wrap gap-2 outline-none" aria-label="Passos da importação">
          {PASSOS.map((p, i) => (
            <li key={p} aria-current={passo === i + 1 ? 'step' : undefined}
              className={`rounded-full border px-3 py-1 text-sm font-semibold ${passo === i + 1 ? 'border-foreground bg-foreground text-background' : `border-input ${texto2}`}`}>
              {i + 1} · {p}
            </li>
          ))}
        </ol>

        {passo === 1 && (
          <>
            <p>
              Escolha a planilha com os seus produtos. Aceita <b>Excel (.xlsx)</b> e <b>CSV</b>. O Regem reconhece o relatório de
              estoque do Alô Chefia e a exportação do próprio Regem; em outra planilha, basta a primeira linha ter os títulos
              (Produto, Nome comercial, Marcas, Unidade, Categoria, Estoque mínimo…).
            </p>
            <div className="space-y-1">
              <Label htmlFor="imp-arquivo">Arquivo</Label>
              <input id="imp-arquivo" data-foco-inicial type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={lendo} onChange={(e) => lerArquivo(e.target.files?.[0])}
                className="block min-h-11 w-full rounded-md border border-input bg-card px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-3 file:py-1 file:font-semibold" />
            </div>
            {lendo && <p className={texto2} role="status">Lendo a planilha…</p>}
            <p className="rounded-md border-l-4 border-info bg-info/10 px-3 py-2">
              Nada é gravado antes da conferência do passo 3. Produto que já existe no Regem não é importado de novo.
            </p>
          </>
        )}

        {passo === 2 && previa && r && (
          <>
            <p>
              <b>{previa.arquivo || 'Planilha'}</b> — reconhecida como <b>{FORMATO[previa.formato]}</b>: {r.total} produto(s)
              {r.semNome ? ` (${r.semNome} linha(s) sem nome ficaram de fora)` : ''}.
            </p>
            <div>
              <p className="mb-1.5 font-semibold">Unidades do arquivo → unidade do Regem</p>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full border-collapse">
                  <caption className="sr-only">Unidades encontradas no arquivo e a unidade do Regem de cada uma</caption>
                  <thead>
                    <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                      <th scope="col" className="px-3 py-2">No arquivo</th>
                      <th scope="col" className="px-3 py-2">Produtos</th>
                      <th scope="col" className="px-3 py-2">Vira</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previa.unidades.map((u) => (
                      <tr key={u.noArquivo} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-1.5 font-mono">{u.noArquivo || '(sem unidade)'}</td>
                        <td className="px-3 py-1.5 font-mono">{u.produtos}</td>
                        <td className="px-3 py-1.5">
                          <Select value={mapa[u.noArquivo] ?? ''} onChange={(e) => setMapa((m) => ({ ...m, [u.noArquivo]: e.target.value }))}
                            aria-label={`Unidade do Regem para ${u.noArquivo || 'produtos sem unidade'}`}
                            className={mapa[u.noArquivo] ? '' : 'border-destructive'}>
                            <option value="">— escolha —</option>
                            {unidades.map((x) => <option key={x} value={x}>{x}</option>)}
                          </Select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {semUnidade.length > 0 && (
                <p role="alert" className="mt-1.5 font-medium text-destructive">
                  Escolha a unidade de: {semUnidade.map((u) => u.noArquivo || '(sem unidade)').join(', ')}.
                </p>
              )}
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-1 font-semibold">O que trazer</legend>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={padronizar} onChange={(e) => setPadronizar(e.target.checked)} />
                <span>Padronizar os nomes (primeira letra maiúscula) quando vierem todos em maiúsculas ou minúsculas</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={trazerMinimo && !!previa.colunas.minimo} disabled={!previa.colunas.minimo} onChange={(e) => setTrazerMinimo(e.target.checked)} />
                <span>Estoque mínimo{previa.colunas.minimo ? ` (coluna "${previa.colunas.minimo}")` : ' — a planilha não tem essa coluna'}</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={trazerCusto && !!previa.colunas.custo} disabled={!previa.colunas.custo} onChange={(e) => setTrazerCusto(e.target.checked)} />
                <span>Custo{previa.colunas.custo ? ` (coluna "${previa.colunas.custo}")` : ' — a planilha não tem essa coluna'}</span>
              </label>
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary" checked={trazerSaldo && !!previa.colunas.quantidade} disabled={!previa.colunas.quantidade} onChange={(e) => setTrazerSaldo(e.target.checked)} />
                <span>
                  Quantidade em estoque como saldo inicial{previa.colunas.quantidade ? ` (coluna "${previa.colunas.quantidade}")` : ' — a planilha não tem essa coluna'}
                  <span className={`block text-xs ${texto2}`}>Entra como ajuste de estoque na loja em uso. Deixe desmarcado para começar do zero e fazer a contagem depois.</span>
                </span>
              </label>
            </fieldset>
            <p className={texto2}>
              {previa.categoriasNovas.length
                ? `Categorias que serão criadas (${previa.categoriasNovas.length}): ${previa.categoriasNovas.join(', ')}. `
                : 'Nenhuma categoria nova. '}
              Quando o produto tem mais de uma categoria na planilha, o Regem usa a primeira. Colunas que o Regem não usa (como ID) são ignoradas.
            </p>
            {(previa.colunas.comercial || previa.colunas.marcas) && (
              <p className={texto2}>
                A planilha também traz{' '}
                {[
                  previa.colunas.comercial ? `o nome comercial (coluna "${previa.colunas.comercial}")` : '',
                  previa.colunas.marcas ? `as marcas (coluna "${previa.colunas.marcas}", separadas por ponto e vírgula)` : '',
                ].filter(Boolean).join(' e ')}
                . Eles entram junto com o produto.
              </p>
            )}
          </>
        )}

        {passo === 3 && previa && r && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2.5 py-0.5 font-bold ${SELO.novo.cls}`}>{r.novos} novo(s)</span>
              <span className={`rounded-full px-2.5 py-0.5 font-bold ${SELO.parecido.cls}`}>{r.parecidos} parecido(s) — você decide</span>
              <span className={`rounded-full px-2.5 py-0.5 font-bold ${SELO.igual.cls}`}>{r.iguais + r.repetidos} já existe(m) — fica(m) de fora</span>
            </div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Mostrar">
              {FILTROS.map((f) => (
                <button key={f.v} type="button" aria-pressed={ver === f.v} onClick={() => setVer(f.v)}
                  className={`min-h-10 rounded-md border px-3 text-sm font-semibold ${ver === f.v ? 'border-foreground bg-foreground text-background' : `border-input bg-card ${texto2} hover:text-foreground`}`}>
                  {f.rotulo} <span className="font-mono">{f.n}</span>
                </button>
              ))}
              {r.parecidos > 0 && (
                <>
                  <Button type="button" variant="outline" size="sm" onClick={() => marcarParecidos(true)}>Marcar os parecidos</Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => marcarParecidos(false)}>Desmarcar os parecidos</Button>
                </>
              )}
            </div>
            <div className="max-h-[46vh] overflow-auto rounded-lg border border-border">
              <table className="w-full border-collapse sm:min-w-[640px]">
                <caption className="sr-only">Conferência dos produtos do arquivo</caption>
                <thead className="sticky top-0">
                  <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                    <th scope="col" className="px-3 py-2">Importar</th>
                    <th scope="col" className="px-3 py-2">Produto no arquivo</th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">Unidade</th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">Categoria</th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((l) => {
                    const pode = l.situacao === 'novo' || l.situacao === 'parecido';
                    const nome = padronizar ? l.nomeFormatado : l.nome;
                    const situacao = (
                      <>
                        <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${SELO[l.situacao].cls}`}>{SELO[l.situacao].rotulo}</span>
                        {l.existente && <span className={`block text-xs ${texto2}`}>no Regem: {l.existente.nome}</span>}
                      </>
                    );
                    return (
                      <tr key={l.linha} className="border-b border-border last:border-b-0">
                        <td className="px-3 py-1.5">
                          <input type="checkbox" className="h-5 w-5 accent-primary" aria-label={`Importar ${nome}`}
                            checked={pode && marcados.has(l.linha)} disabled={!pode} onChange={() => alternar(l.linha)} />
                        </td>
                        <td className="px-3 py-1.5">
                          <span className="font-semibold">{nome}</span>
                          {(l.nomeComercial || !!l.marcas?.length) && (
                            <span className={`block break-words text-xs ${texto2}`}>
                              {[l.nomeComercial ? `Na compra: ${l.nomeComercial}` : '', l.marcas?.length ? `${l.marcas.length === 1 ? 'Marca' : 'Marcas'}: ${l.marcas.join(', ')}` : ''].filter(Boolean).join(' · ')}
                            </span>
                          )}
                          {/* No celular, o que seriam as outras colunas vem aqui embaixo. */}
                          <span className={`block text-xs sm:hidden ${texto2}`}>{mapa[l.unidadeArquivo]}{l.categoria ? ` · ${l.categoria}` : ''}</span>
                          <span className="mt-1 block sm:hidden">{situacao}</span>
                        </td>
                        <td className="hidden px-3 py-1.5 sm:table-cell">{mapa[l.unidadeArquivo]}</td>
                        <td className={`hidden px-3 py-1.5 sm:table-cell ${texto2}`}>{l.categoria || '—'}</td>
                        <td className="hidden px-3 py-1.5 sm:table-cell">{situacao}</td>
                      </tr>
                    );
                  })}
                  {visiveis.length === 0 && (
                    <tr><td colSpan={5} className={`px-3 py-6 text-center ${texto2}`}>Nenhum produto nesta situação.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className={texto2} role="status" aria-live="polite">
              {escolhidos.length} de {importaveis.length} marcado(s) para importar. Os parecidos vêm desmarcados: marque só os que forem produtos diferentes dos que você já tem.
            </p>
          </>
        )}

        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium text-destructive">{erro}</p>}
      </div>
    </Dialogo>
  );
}
