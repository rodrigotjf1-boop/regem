'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, ChevronDown, Download, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { api, getCategoria, podePerm } from '@/lib/api';
import { baixarArquivo } from '@/lib/baixar-arquivo';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialogo } from '@/components/ui/sobreposto';
import { marcasConhecidas, marcasDe, nomeDeApoio, nomeDeCompra, textoDeBusca } from '@/lib/produto-compra';
import { ProdutoForm, equivalencia } from './produto-form';
import { ImportarProdutos } from './importar-produtos';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Opt = { id: string; nome: string };

const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (n: unknown) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Para onde o foco volta quando o botão que abriu um painel não existe mais (produto excluído).
const ID_BUSCA = 'produtos-busca';
const LARGA = '(min-width: 1280px)';
const texto2 = 'text-secondary-foreground'; // texto de apoio legível (o `muted` é claro demais para ler)

const unidadeDe = (i: any): string => i.unidadeLista ?? i.unidadeMedida;
const conversoesDe = (i: any) =>
  (i.conversoes ?? []).map((c: any) => ({
    unidadeDe: c.unidadeDeLista ?? c.unidadeDe,
    fator: c.fator,
    unidadePara: c.unidadeParaLista ?? c.unidadePara,
  }));

// Aba "Produtos" do Estoque: o cadastro inteiro numa lista com busca e filtros; criar e editar
// abrem numa gaveta ao lado (a lista continua à vista); movimentar e excluir, num diálogo;
// importar e exportar por planilha. Abaixo de 1280 px a tabela vira cartões.
export function ProdutosSecao({
  itens,
  categorias,
  fornecedores,
  verFin,
  reload,
}: {
  itens: any[];
  categorias: Opt[];
  fornecedores: Opt[];
  verFin: boolean;
  reload: () => Promise<void> | void;
}) {
  const [busca, setBusca] = useState('');
  const [categoria, setCategoria] = useState('');
  const [fornecedor, setFornecedor] = useState('');
  const [soAbaixo, setSoAbaixo] = useState(false);
  const [setores, setSetores] = useState<Opt[]>([]);
  const [unidades, setUnidades] = useState<string[]>([]);
  const [form, setForm] = useState<{ item?: any } | null>(null);
  const [movimentar, setMovimentar] = useState<any>(null);
  const [excluir, setExcluir] = useState<any>(null);
  const [importar, setImportar] = useState(false);
  const [menuExportar, setMenuExportar] = useState(false);
  const [exportando, setExportando] = useState(false);
  // Tela larga = tabela; estreita = cartões. A aba só é desenhada no navegador, depois da
  // carga, então dá para ler a largura já no primeiro desenho.
  const [larga, setLarga] = useState(() => typeof window !== 'undefined' && window.matchMedia(LARGA).matches);
  const botaoExportar = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    api.setores().then((s: any) => setSetores(Array.isArray(s) ? s : [])).catch(() => {});
    api.estoqueUnidades().then((r) => setUnidades(r?.unidades ?? [])).catch(() => {});
    const mq = window.matchMedia(LARGA);
    const ouvir = () => setLarga(mq.matches);
    mq.addEventListener('change', ouvir);
    return () => mq.removeEventListener('change', ouvir);
  }, []);
  // Menu de exportar: clicar fora fecha.
  useEffect(() => {
    if (!menuExportar) return;
    const fora = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.('[data-menu-exportar]')) setMenuExportar(false);
    };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [menuExportar]);

  // O servidor é quem autoriza; aqui só não se oferece o que ele recusaria.
  const gestor = ['presidente', 'gerente', 'suporte'].includes(getCategoria() ?? '');
  const podeCriar = podePerm('estoque', 'criar');
  const podeEditar = podePerm('estoque', 'editar');
  const podeExcluir = gestor && podeEditar;
  const podeImportar = gestor && podeCriar;

  const abaixo = (i: any) => i.abaixoMinimo ?? Number(i.saldo) < Number(i.estoqueMinimo);
  const lista = useMemo(() => {
    const b = semAcento(busca);
    return itens.filter(
      (i) =>
        (!b || semAcento(textoDeBusca(i)).includes(b)) && // nome do produto, nome comercial e marcas
        (!categoria || i.categoriaItemId === categoria) &&
        (!fornecedor || (i.fornecedorIds ?? []).includes(fornecedor)) &&
        (!soAbaixo || (i.abaixoMinimo ?? Number(i.saldo) < Number(i.estoqueMinimo))),
    );
  }, [itens, busca, categoria, fornecedor, soAbaixo]);
  const filtrando = !!(busca.trim() || categoria || fornecedor || soAbaixo);
  const sugestoesDeMarca = useMemo(() => marcasConhecidas(itens), [itens]);
  const nAbaixo = itens.filter(abaixo).length;
  const valor = lista.reduce((s, i) => s + Number(i.valorEstoque ?? 0), 0);
  const limpar = () => { setBusca(''); setCategoria(''); setFornecedor(''); setSoAbaixo(false); };

  async function exportar(formato: 'xlsx' | 'csv') {
    setMenuExportar(false);
    botaoExportar.current?.focus();
    if (exportando) return;
    setExportando(true);
    try {
      const res = await api.exportarProdutos(formato, filtrando ? lista.map((i) => i.id) : undefined);
      baixarArquivo(res);
      toast.success(`Planilha gerada com ${res.produtos} produto(s)${filtrando ? ' — os da lista filtrada' : ''}.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não consegui gerar a planilha.');
    } finally {
      setExportando(false);
    }
  }

  // Partes de uma linha, usadas pela tabela e pelo cartão. São FUNÇÕES chamadas no desenho, não
  // componentes: um componente criado aqui dentro seria outro a cada desenho, o React o
  // remontaria e o botão que acabou de receber o foco de volta o perderia.
  const nomes = (l: unknown) => (Array.isArray(l) && l.length ? l.join(', ') : '—');
  const celSaldo = (i: any) => {
    const eq = equivalencia(Number(i.saldo), unidadeDe(i), conversoesDe(i));
    return (
      <>
        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-sm font-bold ${abaixo(i) ? 'bg-destructive/10 text-destructive' : 'bg-ok/15 text-foreground'}`}>
          <span className="font-mono">{num(i.saldo)}</span> {unidadeDe(i)}
          {abaixo(i) && <span className="sr-only"> — abaixo do mínimo</span>}
        </span>
        {eq && <span className={`block font-mono text-xs ${texto2}`}>{eq}</span>}
      </>
    );
  };
  const celMinimo = (i: any) => {
    const eq = equivalencia(Number(i.estoqueMinimo), unidadeDe(i), conversoesDe(i));
    return (
      <>
        <span className="whitespace-nowrap"><span className="font-mono">{num(i.estoqueMinimo)}</span> {unidadeDe(i)}</span>
        {eq && <span className={`block font-mono text-xs ${texto2}`}>= {eq}</span>}
      </>
    );
  };
  const celCusto = (i: any) => (
    <>
      <span className="whitespace-nowrap font-mono">{Number(i.custoMedio) > 0 ? brl(Number(i.custoMedio)) : '—'}</span>
      {Number(i.valorEstoque) > 0 && <span className={`block whitespace-nowrap font-mono text-xs ${texto2}`}>{brl(Number(i.valorEstoque))} em estoque</span>}
    </>
  );
  const celNome = (i: any) => (
    <>
      <span className="flex items-center gap-1.5 font-bold">
        {i.categoriaCor && <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: i.categoriaCor }} aria-hidden="true" />}
        <span className="min-w-0 break-words">{i.nome}</span>
      </span>
      <span className={`block text-xs ${texto2}`}>{i.categoriaNome ?? 'Sem categoria'}</span>
      {/* Como o produto é comprado e de que marcas (mig 311) — só quando o cadastro tem. */}
      {nomeDeApoio(i) && <span className={`block break-words text-xs ${texto2}`}>Na compra: {nomeDeCompra(i)}</span>}
      {marcasDe(i).length > 0 && (
        <span className={`block break-words text-xs ${texto2}`}>{marcasDe(i).length === 1 ? 'Marca' : 'Marcas'}: {marcasDe(i).join(', ')}</span>
      )}
    </>
  );
  // `rotulo`: no cartão o botão mostra o texto; na tabela, só a partir da tela bem larga.
  const acoes = (i: any, rotulo: string) => {
    const botao = 'inline-flex min-h-10 min-w-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border px-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
    const neutro = `${botao} border-transparent ${texto2} hover:border-input hover:bg-secondary hover:text-foreground`;
    return (
      <div className="flex gap-1">
        {podeEditar && (
          <button type="button" className={neutro} title="Movimentar" aria-label={`Movimentar ${i.nome}`} onClick={() => setMovimentar(i)}>
            <ArrowUpDown className="h-4 w-4" aria-hidden="true" /><span className={rotulo}>Movimentar</span>
          </button>
        )}
        {podeEditar && (
          <button type="button" className={neutro} title="Editar" aria-label={`Editar ${i.nome}`} onClick={() => setForm({ item: i })}>
            <Pencil className="h-4 w-4" aria-hidden="true" /><span className={rotulo}>Editar</span>
          </button>
        )}
        {podeExcluir && (
          <button type="button" className={`${botao} border-transparent ${texto2} hover:border-destructive hover:bg-destructive/10 hover:text-destructive`}
            title="Excluir" aria-label={`Excluir ${i.nome}`} onClick={() => setExcluir(i)}>
            <Trash2 className="h-4 w-4" aria-hidden="true" /><span className={rotulo}>Excluir</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-3" aria-labelledby="produtos-titulo">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="produtos-titulo" tabIndex={-1} className="font-display text-xl font-bold outline-none">Produtos</h2>
          <p className={`text-sm ${texto2}`} role="status" aria-live="polite">
            {filtrando ? `${lista.length} de ${itens.length} produtos` : `${itens.length} produtos`}
            {verFin ? ` · valor em estoque ${brl(valor)}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {podeImportar && (
            <Button type="button" variant="outline" onClick={() => setImportar(true)}>
              <Upload className="h-4 w-4" aria-hidden="true" /> Importar
            </Button>
          )}
          {itens.length > 0 && (
            <div className="relative" data-menu-exportar>
              <Button ref={botaoExportar} type="button" variant="outline" aria-haspopup="true" aria-expanded={menuExportar} aria-controls="produtos-exportar"
                disabled={exportando} onClick={() => setMenuExportar((v) => !v)}
                onKeyDown={(e) => { if (e.key === 'Escape') setMenuExportar(false); }}>
                <Download className="h-4 w-4" aria-hidden="true" /> {exportando ? 'Gerando…' : 'Exportar'} <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </Button>
              <ul id="produtos-exportar" hidden={!menuExportar}
                className="absolute right-0 top-12 z-30 min-w-52 rounded-xl border border-input bg-card p-1.5 shadow-lg"
                onKeyDown={(e) => { if (e.key === 'Escape') { setMenuExportar(false); botaoExportar.current?.focus(); } }}>
                <li><button type="button" className="block min-h-10 w-full rounded-md px-3 text-left text-sm font-semibold hover:bg-secondary" onClick={() => exportar('xlsx')}>Excel (.xlsx)</button></li>
                <li><button type="button" className="block min-h-10 w-full rounded-md px-3 text-left text-sm font-semibold hover:bg-secondary" onClick={() => exportar('csv')}>CSV (planilha simples)</button></li>
              </ul>
            </div>
          )}
          {podeCriar && (
            <Button type="button" onClick={() => setForm({})}>
              <Plus className="h-4 w-4" aria-hidden="true" /> Novo produto
            </Button>
          )}
        </div>
      </div>

      {itens.length > 0 && (
        <Card className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div className="space-y-1 sm:col-span-2 lg:col-span-1">
            <Label htmlFor={ID_BUSCA}>Buscar por nome ou marca</Label>
            <Input id={ID_BUSCA} type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: coca, queijo, embalagem" autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="produtos-categoria">Categoria</Label>
            <Select id="produtos-categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
              <option value="">Todas as categorias</option>
              {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="produtos-fornecedor">Fornecedor</Label>
            <Select id="produtos-fornecedor" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}>
              <option value="">Todos os fornecedores</option>
              {fornecedores.map((f) => <option key={f.id} value={f.id}>{f.nome}</option>)}
            </Select>
          </div>
          <button type="button" aria-pressed={soAbaixo} onClick={() => setSoAbaixo((v) => !v)}
            className={`inline-flex min-h-11 items-center justify-center gap-2 self-end whitespace-nowrap rounded-md border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              soAbaixo ? 'border-destructive bg-destructive/10 text-destructive' : 'border-input bg-card text-foreground hover:bg-secondary'
            }`}>
            Abaixo do mínimo <span className="font-mono">{nAbaixo}</span>
          </button>
        </Card>
      )}

      {itens.length === 0 ? (
        <Card className={`p-8 text-center text-sm ${texto2}`}>
          Nenhum produto cadastrado. Cadastre o primeiro{podeImportar ? ' ou importe uma planilha' : ''} — ingredientes de ficha técnica, bebidas, embalagens e limpeza.
        </Card>
      ) : lista.length === 0 ? (
        <Card className={`flex flex-wrap items-center justify-center gap-3 p-8 text-center text-sm ${texto2}`}>
          Nenhum produto com esses filtros.
          <Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button>
        </Card>
      ) : larga ? (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Produtos do estoque, com saldo, estoque mínimo e ações</caption>
            <thead>
              <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                <th scope="col" className="px-3 py-2.5 font-bold">Produto</th>
                <th scope="col" className="px-3 py-2.5 font-bold">Fornecedores</th>
                <th scope="col" className="px-3 py-2.5 font-bold">Setores</th>
                <th scope="col" className="px-3 py-2.5 font-bold">Saldo</th>
                <th scope="col" className="px-3 py-2.5 font-bold">Mínimo</th>
                {verFin && <th scope="col" className="px-3 py-2.5 font-bold">Custo médio</th>}
                <th scope="col" className="px-3 py-2.5"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((i) => (
                <tr key={i.id} className="border-b border-border last:border-b-0 hover:bg-secondary/60">
                  <td className="max-w-72 px-3 py-2.5">{celNome(i)}</td>
                  <td className={`max-w-56 px-3 py-2.5 ${texto2}`}>{nomes(i.fornecedorNomes)}</td>
                  <td className={`max-w-44 px-3 py-2.5 ${texto2}`}>{nomes(i.setorNomes)}</td>
                  <td className="px-3 py-2.5">{celSaldo(i)}</td>
                  <td className="px-3 py-2.5">{celMinimo(i)}</td>
                  {verFin && <td className="px-3 py-2.5">{celCusto(i)}</td>}
                  <td className="px-2 py-1.5"><div className="flex justify-end">{acoes(i, 'hidden 2xl:inline')}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {lista.map((i) => (
            <li key={i.id}>
              <Card className="space-y-2 p-3">
                <div>{celNome(i)}</div>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                  <dt className={`text-xs font-bold ${texto2}`}>Fornecedores</dt><dd className="text-right">{nomes(i.fornecedorNomes)}</dd>
                  <dt className={`text-xs font-bold ${texto2}`}>Setores</dt><dd className="text-right">{nomes(i.setorNomes)}</dd>
                  <dt className={`text-xs font-bold ${texto2}`}>Saldo</dt><dd className="text-right">{celSaldo(i)}</dd>
                  <dt className={`text-xs font-bold ${texto2}`}>Mínimo</dt><dd className="text-right">{celMinimo(i)}</dd>
                  {verFin && (<><dt className={`text-xs font-bold ${texto2}`}>Custo médio</dt><dd className="text-right">{celCusto(i)}</dd></>)}
                </dl>
                {(podeEditar || podeExcluir) && (
                  <div className="[&>div]:justify-between [&_button]:flex-1 [&_button]:border-input">{acoes(i, 'inline')}</div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {form && (
        <ProdutoForm
          key={form.item?.id ?? 'novo'}
          item={form.item}
          categorias={categorias}
          fornecedores={fornecedores}
          setores={setores}
          unidades={unidades}
          marcasConhecidas={sugestoesDeMarca}
          voltarPara={ID_BUSCA}
          onCancel={() => setForm(null)}
          onReload={reload}
          onSaved={() => { setForm(null); reload(); }}
        />
      )}
      {movimentar && (
        <MovimentarDialogo item={movimentar} aoFechar={() => setMovimentar(null)} aoSalvar={() => { setMovimentar(null); reload(); }} />
      )}
      {excluir && (
        <ExcluirDialogo
          item={excluir}
          aoFechar={() => setExcluir(null)}
          aoExcluir={async () => {
            setExcluir(null);
            await reload();
            // A linha (e o botão que abriu o diálogo) saiu da tela: o foco vai para a busca —
            // ou para o título, se este era o último produto.
            (document.getElementById(ID_BUSCA) ?? document.getElementById('produtos-titulo'))?.focus();
          }}
        />
      )}
      {importar && (
        <ImportarProdutos unidades={unidades} aoFechar={() => setImportar(false)} aoImportar={() => { setImportar(false); reload(); }} />
      )}
    </section>
  );
}

// ── Movimentar: entrada, saída ou ajuste (pelo saldo contado) ──────────────────────────────
const TIPOS = [
  { v: 'entrada', rotulo: 'Entrada' },
  { v: 'saida', rotulo: 'Saída' },
  { v: 'ajuste', rotulo: 'Ajuste' },
] as const;

function MovimentarDialogo({ item, aoFechar, aoSalvar }: { item: any; aoFechar: () => void; aoSalvar: () => void }) {
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]['v']>('entrada');
  const [qtd, setQtd] = useState('');
  const [motivo, setMotivo] = useState('');
  const [data, setData] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }));
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const un = unidadeDe(item);
  const saldo = Number(item.saldo) || 0;
  const q = Number(qtd);
  const valido = qtd !== '' && Number.isFinite(q) && (tipo === 'ajuste' ? q >= 0 : q > 0);
  const depois = tipo === 'entrada' ? saldo + q : tipo === 'saida' ? saldo - q : q;
  // Em "todas as lojas" o saldo mostrado é a soma: o lançamento precisa de UMA loja.
  const semLoja = !!item.minimoPorLoja;
  const eq = equivalencia(saldo, un, conversoesDe(item));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!valido || salvando || semLoja) return;
    setErro('');
    setSalvando(true);
    try {
      const r: any = await api.post('/estoque/movimentos', {
        itemId: item.id,
        tipo,
        ...(tipo === 'ajuste' ? { saldoContado: q } : { quantidade: q }),
        motivo: motivo.trim() || undefined,
        data: data || undefined,
      });
      toast.success(r?.semMudanca ? 'O saldo já era esse. Nada foi lançado.' : 'Movimento registrado.');
      aoSalvar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao registrar o movimento');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialogo
      titulo={`Movimentar ${item.nome}`}
      aoFechar={aoFechar}
      fecharNoFundo={false}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="submit" form="form-movimento" disabled={!valido || salvando || semLoja}>
            {salvando ? 'Registrando…' : 'Registrar movimento'}
          </Button>
        </>
      }
    >
      <form id="form-movimento" onSubmit={salvar} className="space-y-3">
        <p className={`text-sm ${texto2}`}>
          Saldo atual: <b className="font-mono text-foreground">{num(saldo)}</b> {un}{eq ? ` (${eq})` : ''}
        </p>
        {semLoja && (
          <p role="alert" className="rounded-md border-l-4 border-info bg-info/10 px-3 py-2 text-sm">
            Você está vendo todas as lojas. Escolha a loja no topo da tela para lançar estoque — cada loja tem o próprio estoque.
          </p>
        )}
        <div>
          <span className="mb-1 block text-sm font-medium">Tipo</span>
          <div className="grid grid-cols-3 overflow-hidden rounded-md border border-input" role="group" aria-label="Tipo de movimento">
            {TIPOS.map((t) => (
              <button key={t.v} type="button" aria-pressed={tipo === t.v} onClick={() => setTipo(t.v)}
                className={`min-h-11 border-r border-input text-sm font-semibold last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                  tipo === t.v ? 'bg-foreground text-background' : 'bg-card text-foreground hover:bg-secondary'
                }`}>
                {t.rotulo}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="mov-qtd">{tipo === 'ajuste' ? `Saldo contado, em ${un}` : `Quantidade, em ${un}`}</Label>
            <Input id="mov-qtd" data-foco-inicial type="number" min={0} step="any" inputMode="decimal" value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder="0" required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="mov-data">Data</Label>
            <Input id="mov-data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="mov-motivo">Motivo (opcional)</Label>
          <Input id="mov-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ex.: compra no atacado, conferência do estoque" maxLength={200} />
        </div>
        {valido && !semLoja && (
          <p className="rounded-md bg-info/10 px-3 py-2 text-sm font-semibold" aria-live="polite">
            Saldo depois: <span className="font-mono">{num(depois)}</span> {un}
            {tipo === 'ajuste' ? ` (diferença de ${depois - saldo > 0 ? '+' : ''}${num(depois - saldo)})` : ''}
            {tipo === 'saida' && depois < 0 ? ' — fica negativo' : ''}
          </p>
        )}
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{erro}</p>}
      </form>
    </Dialogo>
  );
}

// ── Excluir: o servidor examina antes; se não pode, o diálogo diz por quê e o que fazer ────
function ExcluirDialogo({ item, aoFechar, aoExcluir }: { item: any; aoFechar: () => void; aoExcluir: () => void }) {
  const [exame, setExame] = useState<{ pode: boolean; motivos: string[]; comoResolver: string[] } | null>(null);
  const [erro, setErro] = useState('');
  const [excluindo, setExcluindo] = useState(false);
  const seguro = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let vivo = true;
    api.exclusaoDoItem(item.id)
      .then((r) => { if (vivo) setExame(r); })
      .catch((e) => { if (vivo) setErro(e instanceof Error ? e.message : 'Não consegui conferir o produto.'); });
    return () => { vivo = false; };
  }, [item.id]);
  // O botão seguro só existe depois da resposta: o foco vai para ele quando aparece.
  useEffect(() => { seguro.current?.focus(); }, [exame, erro]);

  async function confirmar() {
    if (excluindo) return;
    setErro('');
    setExcluindo(true);
    try {
      await api.excluirItem(item.id);
      toast.success('Produto excluído.');
      aoExcluir();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao excluir');
      setExcluindo(false);
    }
  }

  const pode = !!exame?.pode;
  return (
    <Dialogo
      alerta
      largura="md"
      titulo={exame && !pode ? 'Este produto não pode ser excluído agora' : 'Excluir produto'}
      aoFechar={aoFechar}
      voltarPara={ID_BUSCA}
      rodape={
        !exame && !erro ? undefined : pode ? (
          <>
            <Button ref={seguro} type="button" variant="outline" onClick={aoFechar} disabled={excluindo}>Cancelar</Button>
            <Button type="button" variant="destructive" onClick={confirmar} disabled={excluindo}>
              {excluindo ? 'Excluindo…' : 'Excluir produto'}
            </Button>
          </>
        ) : (
          <Button ref={seguro} type="button" onClick={aoFechar}>Entendi</Button>
        )
      }
    >
      <div className="space-y-3 text-sm">
        {!exame && !erro && <p className={texto2}>Conferindo se o produto pode ser excluído…</p>}
        {exame && pode && (
          <>
            <p>Excluir <b>{item.nome}</b>?</p>
            <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">
              Ele sai das listas, das contagens e das sugestões de compra. O histórico (movimentos, perdas, compras e etiquetas) continua guardado. Não dá para desfazer por aqui.
            </p>
          </>
        )}
        {exame && !pode && (
          <>
            <p><b>{item.nome}</b> {exame.motivos.join('; ')}.</p>
            <p className="rounded-md border-l-4 border-info bg-info/10 px-3 py-2">
              {exame.comoResolver.join(' ')} Depois disso a exclusão é liberada.
            </p>
          </>
        )}
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium text-destructive">{erro}</p>}
      </div>
    </Dialogo>
  );
}
