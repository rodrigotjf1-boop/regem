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
import { ContarContagem, HistoricoDaContagem } from './contagem-contar';
import { EscolhaProdutos, type Escolha } from './escolha-produtos';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio,
  dataBr, diasAte, distintos, semAcento, texto2, type Situacao,
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
        <ContarContagem lista={contando.lista} exec={contando.exec} aoFechar={() => setContando(null)}
          aoSalvar={() => { setContando(null); carregar(); aoMudarEstoque?.(); }} />
      )}
      {historico && <HistoricoDaContagem lista={historico} aoFechar={() => setHistorico(null)} />}
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
