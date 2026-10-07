'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { ClipboardCheck, History, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, getCategoria, podePerm } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import { EscolhaProdutos, type Escolha } from './escolha-produtos';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio,
  dataBr, diasAte, distintos, num, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const RECOR: Record<string, string> = { diaria: 'Diária', semanal: 'Semanal', mensal: 'Mensal', avulsa: 'Avulsa' };
const recorDe = (l: any) => RECOR[l.recorrencia] ?? l.recorrencia;
function quando(l: any): string {
  const hora = l.hora ? ` · ${String(l.hora).slice(0, 5)}` : '';
  if (l.recorrencia === 'diaria') return `todo dia${hora}`;
  if (l.recorrencia === 'semanal') return `${l.diaSemana != null ? DIAS[l.diaSemana].toLowerCase() : 'dia não marcado'}${hora}`;
  if (l.recorrencia === 'mensal') return `${l.diaMes != null ? `dia ${l.diaMes}` : 'dia não marcado'}${hora}`;
  return 'sem dia marcado';
}
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Para hoje', filtro: (l) => !!l.pendenteHoje, tom: 'aviso' },
  { rotulo: 'Em dia', filtro: (l) => !l.pendenteHoje && !!l.ultimaContagem },
  { rotulo: 'Nunca contada', filtro: (l) => !l.ultimaContagem, tom: 'critico' },
];
const ID_TITULO = 'contagem-titulo';

// Aba Contagem: as listas de contagem (recorrência, responsável, aviso por horário), com as que
// são para hoje e as nunca contadas à vista. Criar e editar abrem na gaveta; contar, o histórico
// e a exclusão, em diálogo.
export function ContagemSecao({ itens, aoMudarEstoque }: { itens: any[]; aoMudarEstoque?: () => void }) {
  const [listas, setListas] = useState<any[] | null>(null);
  const [colabs, setColabs] = useState<any[]>([]);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [recorrencia, setRecorrencia] = useState('');
  const [responsavel, setResponsavel] = useState('');
  const [form, setForm] = useState<{ lista?: any } | null>(null);
  const [contando, setContando] = useState<any>(null);
  const [historico, setHistorico] = useState<any>(null);
  const [excluir, setExcluir] = useState<any>(null);
  const [excluindo, setExcluindo] = useState(false);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      // A lista de pessoas é só para o campo "responsável": se o perfil não puder vê-la, a aba segue.
      const [ls, cs] = await Promise.all([api.contagemListas(), api.colaboradores().catch(() => [])]);
      setListas(Array.isArray(ls) ? (ls as any[]) : []);
      setColabs(Array.isArray(cs) ? (cs as any[]) : []);
    } catch (e) {
      setListas([]);
      setErro(e instanceof Error ? e.message : 'Erro ao carregar as contagens');
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function contar(l: any) {
    try {
      setContando({ lista: l, exec: await api.iniciarContagem(l.id) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao iniciar a contagem');
    }
  }
  async function confirmarExclusao() {
    if (!excluir || excluindo) return;
    setExcluindo(true);
    try {
      await api.removerContagemLista(excluir.id);
      toast.success('Lista excluída.');
      setExcluir(null);
      await carregar();
      document.getElementById(ID_TITULO)?.focus(); // a linha (e o botão que abriu) saiu da tela
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao excluir');
    } finally {
      setExcluindo(false);
    }
  }

  if (listas === null) return <SkeletonList rows={4} />;

  // O servidor é quem autoriza; aqui só não se oferece o que ele recusaria.
  const gestao = ['presidente', 'gerente', 'supervisao', 'suporte'].includes(getCategoria() ?? '');
  const podeCriar = gestao && podePerm('estoque', 'criar');
  const podeEditar = gestao && podePerm('estoque', 'editar');
  const podeExcluir = gestao && podePerm('estoque', 'excluir');
  const podeContar = podePerm('estoque', 'editar');

  const nomeResp = (l: any) => l.delegadoNome ?? 'Sem responsável';
  const b = semAcento(busca);
  const base = listas.filter(
    (l) => (!b || semAcento(l.nome).includes(b)) && (!recorrencia || recorDe(l) === recorrencia) && (!responsavel || nomeResp(l) === responsavel),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || recorrencia || responsavel || sit >= 0);
  const limpar = () => { setBusca(''); setRecorrencia(''); setResponsavel(''); setSit(-1); };
  const produtosNasListas = linhas.reduce((s, l) => s + Number(l.itens || 0), 0);

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista id={ID_TITULO} titulo="Contagem" total={listas.length} mostrando={linhas.length} um="lista" varios="listas"
        extra={`${produtosNasListas} produto(s) nas listas`}>
        {podeCriar && <Button type="button" onClick={() => setForm({})}><Plus className="h-4 w-4" aria-hidden="true" /> Nova lista</Button>}
      </TituloLista>
      {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="contagem-busca" valor={busca} aoMudar={setBusca} placeholder="Nome da lista" />
        <FiltroSelect id="contagem-recorrencia" rotulo="Recorrência" todos="Todas as recorrências" opcoes={distintos(listas, recorDe)} valor={recorrencia} aoMudar={setRecorrencia} />
        <FiltroSelect id="contagem-responsavel" rotulo="Responsável" todos="Todos os responsáveis" opcoes={distintos(listas, nomeResp)} valor={responsavel} aoMudar={setResponsavel} />
      </Filtros>

      {listas.length === 0 ? (
        <Vazio>Nenhuma lista de contagem. Crie uma com os produtos que você confere junto — a câmara fria, as bebidas, o inventário do mês.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Listas de contagem"
          linhas={linhas}
          chave={(l) => l.id}
          nome={(l) => l.nome}
          colunas={[
            { titulo: 'Lista', celula: (l) => <NomeComApoio nome={l.nome} apoio={`${recorDe(l)} · ${quando(l)}`}>{l.pendenteHoje && <Selo tom="aviso">hoje</Selo>}</NomeComApoio> },
            { titulo: 'Produtos', celula: (l) => <span className="font-mono">{l.itens}</span> },
            { titulo: 'Responsável', celula: (l) => l.delegadoNome ?? '—' },
            {
              titulo: 'Última contagem',
              celula: (l) =>
                l.ultimaContagem ? (
                  <><span className="font-mono">{dataBr(l.ultimaContagem)}</span><span className={`block text-xs ${texto2}`}>{diasAte(l.ultimaContagem) === 0 ? 'hoje' : `há ${-diasAte(l.ultimaContagem)} dia(s)`}</span></>
                ) : (
                  <Selo tom="critico">nunca contada</Selo>
                ),
            },
          ]}
          acoes={() => [
            ...(podeContar ? [{ rotulo: 'Contar', icone: ClipboardCheck, aoClicar: contar, tom: 'primaria' as const }] : []),
            { rotulo: 'Histórico', icone: History, aoClicar: setHistorico },
            ...(podeEditar ? [{ rotulo: 'Editar', icone: Pencil, aoClicar: (l: any) => setForm({ lista: l }) }] : []),
            ...(podeExcluir ? [{ rotulo: 'Excluir', icone: Trash2, aoClicar: setExcluir, tom: 'perigo' as const }] : []),
          ]}
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}

      {form && (
        <ListaForm key={form.lista?.id ?? 'nova'} lista={form.lista} itens={itens} colabs={colabs}
          aoFechar={() => setForm(null)} aoSalvar={() => { setForm(null); carregar(); }} />
      )}
      {contando && (
        <ContarDialogo lista={contando.lista} exec={contando.exec} aoFechar={() => setContando(null)}
          aoSalvar={() => { setContando(null); carregar(); aoMudarEstoque?.(); }} />
      )}
      {historico && <HistoricoDialogo lista={historico} aoFechar={() => setHistorico(null)} />}
      {excluir && (
        <Dialogo alerta titulo="Excluir lista de contagem" aoFechar={() => setExcluir(null)} voltarPara={ID_TITULO}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial onClick={() => setExcluir(null)} disabled={excluindo}>Cancelar</Button>
              <Button type="button" variant="destructive" onClick={confirmarExclusao} disabled={excluindo}>{excluindo ? 'Excluindo…' : 'Excluir lista'}</Button>
            </>
          }>
          <div className="space-y-3 text-sm">
            <p>Excluir <b>{excluir.nome}</b>?</p>
            <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">
              A lista sai da tela e os avisos dela param. As contagens já feitas e os ajustes de estoque que elas lançaram continuam valendo. Não dá para desfazer por aqui.
            </p>
          </div>
        </Dialogo>
      )}
    </section>
  );
}

// ── criar / editar a lista (gaveta) ─────────────────────────────────────────────────────────
function ListaForm({ lista, itens, colabs, aoFechar, aoSalvar }: { lista?: any; itens: any[]; colabs: any[]; aoFechar: () => void; aoSalvar: () => void }) {
  const formId = useId();
  const [nome, setNome] = useState<string>(lista?.nome ?? '');
  const [recorrencia, setRecorrencia] = useState<string>(lista?.recorrencia ?? 'semanal');
  const [diaSemana, setDiaSemana] = useState(String(lista?.diaSemana ?? 1));
  const [diaMes, setDiaMes] = useState(String(lista?.diaMes ?? 1));
  const [hora, setHora] = useState(lista ? String(lista.hora ?? '').slice(0, 5) : '08:00');
  const [delegadoId, setDelegadoId] = useState<string>(lista?.delegadoId ?? '');
  const [enviarKds, setEnviarKds] = useState<boolean>(lista?.enviarKds ?? true);
  const [enviarDashboard, setEnviarDashboard] = useState<boolean>(lista?.enviarDashboard ?? true);
  const [escolha, setEscolha] = useState<Escolha>(() =>
    Object.fromEntries(((lista?.itemIds ?? []) as string[]).map((id) => [id, { quantidade: '', custoUnitario: '' }])),
  );
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const itemIds = Object.keys(escolha).filter((id) => itens.some((i) => i.id === id));
  const falta = nome.trim().length < 2 || itemIds.length === 0;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (falta || salvando) return;
    setErro('');
    setSalvando(true);
    const body = {
      nome: nome.trim(),
      itemIds,
      recorrencia,
      diaSemana: recorrencia === 'semanal' ? Number(diaSemana) : undefined,
      diaMes: recorrencia === 'mensal' ? Number(diaMes) : undefined,
      hora: hora || undefined,
      delegadoId: delegadoId || undefined,
      enviarKds,
      enviarDashboard,
    };
    try {
      if (lista?.id) await api.atualizarContagemLista(lista.id, body);
      else await api.criarContagemLista(body);
      toast.success(lista?.id ? 'Lista atualizada.' : 'Lista de contagem criada.');
      aoSalvar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo={lista?.id ? 'Editar lista de contagem' : 'Nova lista de contagem'}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={falta || salvando}>{salvando ? 'Salvando…' : lista?.id ? 'Salvar alterações' : 'Criar lista'}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="cont-nome">Nome da contagem</Label>
          <Input id="cont-nome" data-foco-inicial value={nome} onChange={(e) => setNome(e.target.value)} required minLength={2} placeholder="Ex.: Contagem geral de segunda" autoComplete="off" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="cont-rec">Recorrência</Label>
            <Select id="cont-rec" value={recorrencia} onChange={(e) => setRecorrencia(e.target.value)}>
              {Object.entries(RECOR).map(([v, r]) => <option key={v} value={v}>{r}</option>)}
            </Select>
          </div>
          {recorrencia === 'semanal' && (
            <div className="space-y-1.5">
              <Label htmlFor="cont-dia">Dia da semana</Label>
              <Select id="cont-dia" value={diaSemana} onChange={(e) => setDiaSemana(e.target.value)}>
                {DIAS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </Select>
            </div>
          )}
          {recorrencia === 'mensal' && (
            <div className="space-y-1.5">
              <Label htmlFor="cont-mes">Dia do mês</Label>
              <Input id="cont-mes" type="number" min={1} max={31} inputMode="numeric" value={diaMes} onChange={(e) => setDiaMes(e.target.value)} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="cont-hora">Horário do aviso</Label>
            <Input id="cont-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cont-resp">Responsável (opcional)</Label>
            <Select id="cont-resp" value={delegadoId} onChange={(e) => setDelegadoId(e.target.value)}>
              <option value="">— ninguém —</option>
              {colabs.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={enviarKds} onChange={(e) => setEnviarKds(e.target.checked)} /> Avisar no KDS
          </label>
          <label className="flex min-h-10 items-center gap-2">
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={enviarDashboard} onChange={(e) => setEnviarDashboard(e.target.checked)} /> Avisar no painel do gerente
          </label>
        </div>
        <EscolhaProdutos itens={itens} valor={escolha} aoMudar={setEscolha} rotulo="Produtos a contar" />
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}

// ── contar (diálogo largo): contado × sistema, com progresso ────────────────────────────────
function ContarDialogo({ lista, exec, aoFechar, aoSalvar }: { lista: any; exec: any; aoFechar: () => void; aoSalvar: () => void }) {
  const itens: any[] = exec.itens ?? [];
  const [contado, setContado] = useState<Record<string, string>>({});
  // Hora em que CADA item foi informado. É o que permite o servidor usar o saldo do instante
  // certo: o inventário roda durante o expediente e o operador conta item a item, andando
  // entre câmara e freezer, enquanto a venda consome.
  const [contadoEm, setContadoEm] = useState<Record<string, string>>({});
  const [ajuste, setAjuste] = useState(true);
  const [busca, setBusca] = useState('');
  const [soFaltam, setSoFaltam] = useState(false);
  const [soDiferenca, setSoDiferenca] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const informado = (i: any) => contado[i.itemId] !== undefined && contado[i.itemId] !== '';
  // O ajuste é calculado contra o saldo do INSTANTE da contagem, não o da abertura. Aqui a
  // melhor aproximação é abertura + o que já se moveu — senão a tela mostraria um número e o
  // servidor lançaria outro.
  const diferenca = (i: any): number | null =>
    informado(i) ? Number(contado[i.itemId]) - (Number(i.saldoSistema) + (Number(i.movimentoDesdeAbertura) || 0)) : null;
  const temDiferenca = (i: any) => { const d = diferenca(i); return d !== null && Math.abs(d) > 1e-9; };
  const contados = itens.filter(informado).length;
  const b = semAcento(busca);
  const visiveis = itens.filter((i) => (!b || semAcento(i.nome).includes(b)) && (!soFaltam || !informado(i)) && (!soDiferenca || temDiferenca(i)));

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    try {
      const r: any = await api.salvarContagem(exec.id, {
        itens: itens.filter(informado).map((i) => ({ itemId: i.itemId, contado: Number(contado[i.itemId]), contadoEm: contadoEm[i.itemId] })),
        aplicarAjuste: ajuste,
      });
      const moveram = Number(r?.itensComMovimento) || 0;
      if (ajuste && moveram > 0) {
        // O ajuste foi lançado contra o saldo da ABERTURA. Se o item se moveu no meio da
        // contagem, esse ajuste pode estar errado — e este é o único momento em que alguém
        // ainda lembra o que contou.
        toast.info(`Contagem salva, mas ${moveram} item(ns) tiveram venda ou produção durante a contagem. O ajuste desses pode estar errado — confira o saldo.`);
      } else {
        toast.success(ajuste ? 'Contagem salva e estoque ajustado.' : 'Contagem salva.');
      }
      aoSalvar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
      setSalvando(false);
    }
  }
  const ficha = (ligada: boolean) =>
    `inline-flex min-h-10 items-center rounded-full border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      ligada ? 'border-primary bg-primary/15 text-foreground' : `border-input bg-card ${texto2}`
    }`;

  return (
    <Dialogo largura="lg" titulo={`Contar: ${lista.nome}`} aoFechar={aoFechar} fecharNoFundo={false}
      rodape={
        <>
          <label className="mr-auto flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={ajuste} onChange={(e) => setAjuste(e.target.checked)} />
            Ajustar o estoque pela contagem (lança a diferença)
          </label>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando || contados === 0}>{salvando ? 'Salvando…' : 'Salvar contagem'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        {Number(exec.itensComMovimento) > 0 && (
          <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2">
            {Number(exec.itensComMovimento)} item(ns) tiveram venda ou produção desde que esta contagem abriu. O saldo do sistema abaixo é o da abertura — confira esses itens.
          </p>
        )}
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-1">
            <Label htmlFor="contar-busca">Buscar produto</Label>
            <Input id="contar-busca" data-foco-inicial type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite parte do nome" autoComplete="off" />
          </div>
          <p className="rounded-md bg-info/10 px-3 py-2.5 font-semibold" role="status" aria-live="polite">
            {contados} de {itens.length} contados · {itens.filter(temDiferenca).length} com diferença
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={soFaltam} className={ficha(soFaltam)} onClick={() => setSoFaltam((v) => !v)}>Só os que faltam contar</button>
          <button type="button" aria-pressed={soDiferenca} className={ficha(soDiferenca)} onClick={() => setSoDiferenca((v) => !v)}>Só com diferença</button>
        </div>
        <div className="max-h-[46vh] overflow-auto rounded-lg border border-border">
          <table className="w-full border-collapse">
            <caption className="sr-only">Produtos desta contagem</caption>
            <thead className="sticky top-0">
              <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                <th scope="col" className="px-3 py-2">Produto</th>
                <th scope="col" className="hidden px-3 py-2 sm:table-cell">No sistema</th>
                <th scope="col" className="px-3 py-2">Contado</th>
                <th scope="col" className="px-3 py-2">Diferença</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((i) => {
                const d = diferenca(i);
                return (
                  <tr key={i.itemId} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-1.5">
                      <span className="font-semibold">{i.nome}</span>
                      <span className={`block text-xs sm:hidden ${texto2}`}>sistema: {num(i.saldoSistema)} {i.unidadeMedida}</span>
                      {/* O saldo mostrado é o da ABERTURA da contagem. Se o item saiu ou entrou
                          depois, quem está contando precisa saber — é ele quem sabe se contou
                          antes ou depois do movimento. */}
                      {Number(i.movimentosDesdeAbertura) > 0 && (
                        <span className="block text-xs font-semibold">
                          ⚠ {Number(i.movimentoDesdeAbertura) > 0 ? '+' : ''}{num(i.movimentoDesdeAbertura)} desde que a contagem abriu
                        </span>
                      )}
                    </td>
                    <td className="hidden whitespace-nowrap px-3 py-1.5 font-mono sm:table-cell">{num(i.saldoSistema)} {i.unidadeMedida}</td>
                    <td className="px-3 py-1.5">
                      <Input type="number" min={0} step="any" inputMode="decimal" className="w-28" value={contado[i.itemId] ?? ''} placeholder="contado"
                        aria-label={`Contado de ${i.nome}, em ${i.unidadeMedida}`}
                        onChange={(e) => {
                          setContado((s) => ({ ...s, [i.itemId]: e.target.value }));
                          // Recarimba a cada digitação: se o operador voltar e recontar o item
                          // depois do aviso de movimento, a base acompanha.
                          setContadoEm((s) => ({ ...s, [i.itemId]: new Date().toISOString() }));
                        }} />
                    </td>
                    <td className="px-3 py-1.5">
                      {d === null ? '—' : Math.abs(d) <= 1e-9 ? <Selo tom="ok">confere</Selo> : <Selo tom={d < 0 ? 'critico' : 'aviso'}>{d > 0 ? '+' : ''}{num(d)}</Selo>}
                    </td>
                  </tr>
                );
              })}
              {visiveis.length === 0 && <tr><td colSpan={4} className={`px-3 py-6 text-center ${texto2}`}>Nenhum produto com esses filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Dialogo>
  );
}

// ── histórico das contagens feitas ──────────────────────────────────────────────────────────
function HistoricoDialogo({ lista, aoFechar }: { lista: any; aoFechar: () => void }) {
  const [linhas, setLinhas] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let vivo = true;
    api.contagemHistorico(lista.id)
      .then((r: any) => { if (vivo) setLinhas(Array.isArray(r) ? r : []); })
      .catch((e: unknown) => { if (vivo) { setLinhas([]); setErro(e instanceof Error ? e.message : 'Não consegui abrir o histórico.'); } });
    return () => { vivo = false; };
  }, [lista.id]);
  return (
    <Dialogo largura="lg" titulo={`Histórico: ${lista.nome}`} aoFechar={aoFechar}
      rodape={<Button type="button" data-foco-inicial onClick={aoFechar}>Fechar</Button>}>
      <div className="space-y-3 text-sm">
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erro}</p>}
        {linhas === null && <p className={texto2}>Abrindo o histórico…</p>}
        {linhas && linhas.length === 0 && !erro && <p className={`py-6 text-center ${texto2}`}>Esta lista ainda não foi contada.</p>}
        {linhas && linhas.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[520px] border-collapse">
              <caption className="sr-only">Contagens feitas desta lista</caption>
              <thead>
                <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                  <th scope="col" className="px-3 py-2">Data</th>
                  <th scope="col" className="px-3 py-2">Quem abriu</th>
                  <th scope="col" className="px-3 py-2">Contados</th>
                  <th scope="col" className="px-3 py-2">Diferença</th>
                  <th scope="col" className="px-3 py-2">Situação</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((h) => (
                  <tr key={h.id} className="border-b border-border last:border-b-0">
                    <td className="px-3 py-2 font-mono">{dataBr(h.data)}</td>
                    <td className="px-3 py-2">{h.quemNome ?? <span className={texto2}>não identificado</span>}</td>
                    <td className="px-3 py-2 font-mono">{h.contados} de {h.itens}</td>
                    <td className="px-3 py-2">{Number(h.comDiferenca) > 0 ? <Selo tom="aviso">{h.comDiferenca} produto(s)</Selo> : Number(h.contados) > 0 ? <Selo tom="ok">tudo conferiu</Selo> : '—'}</td>
                    <td className="px-3 py-2">{h.status === 'concluida' ? <Selo tom="ok">concluída</Selo> : <Selo tom="aviso">aberta</Selo>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={texto2}>A diferença é contra o saldo que o sistema tinha quando a contagem abriu. Mostra as 30 contagens mais recentes.</p>
      </div>
    </Dialogo>
  );
}
