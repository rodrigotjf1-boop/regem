'use client';

import { useId, useState } from 'react';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Chave } from '@/components/ui/chave';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, Selo, Situacoes, TituloLista, Vazio, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type ItemCatalogo = { chave: string; rotulo: string; grupo: string; tipo: string };
const ACOES = ['ver', 'criar', 'editar', 'excluir'] as const;
export const NIVEIS = [
  { v: 'gerente', rotulo: 'Gerência / ADM' },
  { v: 'supervisao', rotulo: 'Supervisão' },
  { v: 'execucao', rotulo: 'Execução' },
];
const nivelDe = (p: any): string => NIVEIS.find((n) => n.v === p.nivel)?.rotulo ?? String(p.nivel);
const entraDe = (p: any) => (p.loginWeb ? 'E-mail e senha' : 'Só PIN (ponto/app)');
const ID_TITULO = 'perfis-titulo';
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Quantas permissões o catálogo tem e quantas o perfil liga (o módulo com ações conta quatro). */
function contar(catalogo: ItemCatalogo[], perm: any): { ligadas: number; total: number } {
  let ligadas = 0;
  let total = 0;
  for (const it of catalogo) {
    if (it.tipo === 'crud') {
      total += ACOES.length;
      ligadas += ACOES.filter((a) => !!perm?.[it.chave]?.[a]).length;
    } else {
      total += 1;
      if (perm?.[it.chave]) ligadas += 1;
    }
  }
  return { ligadas, total };
}

// Acessos & perfis → Perfis (mockup `mockups/regem-configuracoes.html`): a lista dos perfis de
// acesso, com o nível, se entra pelo sistema, quantas permissões estão ligadas e quantas pessoas
// usam. As permissões abrem na gaveta larga, com busca e aviso de alteração não salva.
// O banco guarda UM perfil por nível em cada empresa: "Novo perfil" só aparece com nível livre.
export function PerfisParte({
  perfis, catalogo, pessoas, soDaLojaEmUso, recarregar,
}: {
  /** Sem o perfil presidente/C&O, que é fixo e não aparece aqui. */
  perfis: any[];
  catalogo: ItemCatalogo[];
  /** `null` = a lista de pessoas não carregou: a coluna "Pessoas" fica sem número. */
  pessoas: any[] | null;
  /** As pessoas vieram só da loja em uso (a contagem não é da empresa inteira). */
  soDaLojaEmUso: boolean;
  recarregar: () => Promise<void>;
}) {
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [filtroEntra, setFiltroEntra] = useState('');
  const [editando, setEditando] = useState<any | null>(null);
  const [excluindo, setExcluindo] = useState<any | null>(null);
  const [criando, setCriando] = useState(false);

  const usam = (p: any): number | null => (pessoas ? pessoas.filter((c) => c.perfilAcessoId === p.id).length : null);
  const SITUACOES: Situacao<any>[] = [
    ...NIVEIS.map((n) => ({ rotulo: n.rotulo, filtro: (p: any) => p.nivel === n.v })),
    ...(pessoas ? [{ rotulo: soDaLojaEmUso ? 'Sem ninguém nesta loja' : 'Sem ninguém', filtro: (p: any) => usam(p) === 0, tom: 'aviso' as const }] : []),
  ];
  const b = semAcento(busca);
  const base = perfis.filter((p) => (!b || semAcento(p.nome).includes(b)) && (!filtroEntra || entraDe(p) === filtroEntra));
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || filtroEntra || sit >= 0);
  const limpar = () => { setBusca(''); setFiltroEntra(''); setSit(-1); };
  const niveisLivres = NIVEIS.filter((n) => !perfis.some((p) => p.nivel === n.v));

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista id={ID_TITULO} titulo="Perfis de acesso" total={perfis.length} mostrando={linhas.length} um="perfil" varios="perfis"
        extra="o que cada perfil enxerga e faz · as mudanças valem no próximo login">
        {niveisLivres.length > 0 && <Button type="button" onClick={() => setCriando(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Novo perfil</Button>}
      </TituloLista>
      <p className={`max-w-3xl text-sm ${texto2}`}>
        Cada nível — Gerência / ADM, Supervisão e Execução — tem um perfil, e é nele que se liga e desliga o que as pessoas daquele nível enxergam e fazem.
        O perfil do presidente (C&O) tem acesso total e não aparece aqui.
        {soDaLojaEmUso && pessoas ? ' A coluna “Pessoas” conta só a loja em uso.' : ''}
      </p>
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="perfis-busca" valor={busca} aoMudar={setBusca} placeholder="Nome do perfil" />
        <FiltroSelect id="perfis-entra" rotulo="Entra pelo sistema" todos="Todos" opcoes={['E-mail e senha', 'Só PIN (ponto/app)']} valor={filtroEntra} aoMudar={setFiltroEntra} />
      </Filtros>
      {perfis.length === 0 ? (
        <Vazio>Nenhum perfil além do presidente. Crie um em “Novo perfil”.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Perfis de acesso"
          linhas={linhas}
          chave={(p) => p.id}
          nome={(p) => p.nome}
          colunas={[
            { titulo: 'Perfil', celula: (p) => <span className="font-bold">{p.nome}</span> },
            { titulo: 'Nível', celula: nivelDe },
            { titulo: 'Entra pelo sistema', celula: (p) => (p.loginWeb ? <Selo tom="ok">e-mail e senha</Selo> : <Selo>só PIN</Selo>) },
            { titulo: 'Permissões ligadas', celula: (p) => { const c = contar(catalogo, p.permissoes); return <span className="whitespace-nowrap font-mono">{c.ligadas} de {c.total}</span>; } },
            { titulo: 'Pessoas', celula: (p) => <span className="font-mono">{usam(p) ?? '—'}</span> },
          ]}
          acoes={() => [
            { rotulo: 'Permissões', icone: ShieldCheck, aoClicar: setEditando, tom: 'primaria' as const },
            { rotulo: 'Excluir', icone: Trash2, aoClicar: setExcluindo, tom: 'perigo' as const },
          ]}
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}

      {editando && (
        <GavetaPermissoes perfil={editando} catalogo={catalogo} usam={usam(editando)} soDaLojaEmUso={soDaLojaEmUso} aoFechar={() => setEditando(null)}
          aoSalvar={async () => { setEditando(null); await recarregar(); }} />
      )}
      {criando && <NovoPerfil niveis={niveisLivres} aoFechar={() => setCriando(false)} aoCriar={async () => { setCriando(false); await recarregar(); }} />}
      {excluindo && (
        <ExcluirPerfil perfil={excluindo} usam={usam(excluindo)} soDaLojaEmUso={soDaLojaEmUso} aoFechar={() => setExcluindo(null)}
          aoExcluir={async () => {
            setExcluindo(null);
            await recarregar();
            document.getElementById(ID_TITULO)?.focus(); // a linha (e o botão que abriu) saiu da lista
          }} />
      )}
    </section>
  );
}

function GavetaPermissoes({
  perfil, catalogo, usam, soDaLojaEmUso, aoFechar, aoSalvar,
}: { perfil: any; catalogo: ItemCatalogo[]; usam: number | null; soDaLojaEmUso: boolean; aoFechar: () => void; aoSalvar: () => void }) {
  const formId = useId();
  const [loginWeb, setLoginWeb] = useState(!!perfil.loginWeb);
  // Parte do que está gravado: chave que o catálogo não lista (antiga) continua no perfil.
  const [perm, setPerm] = useState<any>(() => JSON.parse(JSON.stringify(perfil.permissoes ?? {})));
  const [busca, setBusca] = useState('');
  const [sujo, setSujo] = useState(false);
  const [saindo, setSaindo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const tocar = () => { setSujo(true); setSaindo(false); };
  const ligar = (chave: string, v: boolean) => { setPerm((x: any) => ({ ...x, [chave]: v })); tocar(); };
  const ligarAcao = (chave: string, acao: string, v: boolean) => { setPerm((x: any) => ({ ...x, [chave]: { ...(x[chave] ?? {}), [acao]: v } })); tocar(); };
  const pedirFechar = () => (sujo && !saindo && !salvando ? setSaindo(true) : aoFechar());

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    setErro('');
    setSalvando(true);
    try {
      await api.patch(`/perfis/${perfil.id}`, { loginWeb, permissoes: perm });
      toast.success(`Perfil ${perfil.nome} salvo. Vale no próximo login.`);
      aoSalvar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar perfil');
      setSalvando(false);
    }
  }

  // Catálogo agrupado, na ordem em que os grupos aparecem; a busca olha o nome da permissão e o do grupo.
  const b = semAcento(busca);
  const grupos: { nome: string; itens: ItemCatalogo[]; todos: ItemCatalogo[] }[] = [];
  for (const it of catalogo) {
    let g = grupos.find((x) => x.nome === it.grupo);
    if (!g) grupos.push((g = { nome: it.grupo, itens: [], todos: [] }));
    g.todos.push(it);
    if (!b || semAcento(`${it.rotulo} ${it.grupo}`).includes(b)) g.itens.push(it);
  }
  const visiveis = grupos.filter((g) => g.itens.length > 0);
  const geral = contar(catalogo, perm);

  return (
    <Gaveta
      larga
      titulo={`Permissões — ${perfil.nome}`}
      aoFechar={pedirFechar}
      voltarPara={ID_TITULO}
      rodape={
        saindo ? (
          <>
            <span role="alert" className="mr-auto self-center text-sm font-medium">Há alterações ainda não salvas neste perfil.</span>
            <Button type="button" variant="outline" onClick={() => setSaindo(false)}>Continuar editando</Button>
            <Button type="button" variant="destructive" onClick={aoFechar}>Sair sem salvar</Button>
          </>
        ) : (
          <>
            <span role="status" className={`mr-auto self-center text-sm ${texto2}`}>{sujo ? 'alterações ainda não salvas' : 'nenhuma alteração'}</span>
            <Button type="button" variant="outline" onClick={pedirFechar} disabled={salvando}>Cancelar</Button>
            <Button type="submit" form={formId} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar perfil'}</Button>
          </>
        )
      }
    >
      <form id={formId} onSubmit={salvar} noValidate className="space-y-4">
        <p className={`text-sm ${texto2}`} role="status">
          Nível: <b className="text-foreground">{nivelDe(perfil)}</b> · <span data-contagem>{geral.ligadas} de {geral.total}</span> permissões ligadas
          {usam != null ? ` · ${plural(usam, 'pessoa usa', 'pessoas usam')} este perfil${soDaLojaEmUso ? ' na loja em uso' : ''}` : ''}.
        </p>
        <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <div className="min-w-0">
            <span className="block text-sm font-medium">Entrar pelo sistema (e-mail + senha)</span>
            <span className={`block text-xs ${texto2}`}>Desligado = só PIN (ponto/app).</span>
          </div>
          <Chave ligada={loginWeb} rotulo="Entrar pelo sistema (e-mail + senha)" aoMudar={(v) => { setLoginWeb(v); tocar(); }} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="permissoes-busca">Buscar permissão</Label>
          <Input id="permissoes-busca" data-foco-inicial type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Ex.: estoque, caixa, relatório" autoComplete="off" />
        </div>
        {visiveis.length === 0 && <p className={`rounded-md border border-dashed border-input px-3 py-4 text-center text-sm ${texto2}`}>Nenhuma permissão com esse nome.</p>}
        {visiveis.map((g) => {
          const c = contar(g.todos, perm);
          return (
            <section key={g.nome} className="rounded-md border border-border" aria-label={g.nome} data-grupo={g.nome}>
              <header className="flex items-center justify-between gap-2 border-b border-border bg-secondary px-3 py-2">
                <h3 className="font-display text-sm font-bold">{g.nome}</h3>
                <span className={`font-mono text-xs ${texto2}`}>{c.ligadas} de {c.total} ligadas</span>
              </header>
              <ul className="divide-y divide-border">
                {g.itens.map((it) =>
                  it.tipo === 'crud' ? (
                    <li key={it.chave} className="px-3 py-2" data-permissao={it.chave}>
                      <span className="block text-sm font-medium">{it.rotulo}</span>
                      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                        {ACOES.map((a) => (
                          <label key={a} className="inline-flex min-h-10 items-center gap-2 text-sm capitalize">
                            <input type="checkbox" className="h-5 w-5 accent-primary" checked={!!perm[it.chave]?.[a]} onChange={(e) => ligarAcao(it.chave, a, e.target.checked)} aria-label={`${it.rotulo}: ${a}`} />
                            {a}
                          </label>
                        ))}
                      </div>
                    </li>
                  ) : (
                    <li key={it.chave} className="flex items-center justify-between gap-3 px-3 py-1" data-permissao={it.chave}>
                      <span className="min-w-0 text-sm">{it.rotulo}</span>
                      <Chave ligada={!!perm[it.chave]} rotulo={it.rotulo} aoMudar={(v) => ligar(it.chave, v)} />
                    </li>
                  ),
                )}
              </ul>
            </section>
          );
        })}
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}

function NovoPerfil({ niveis, aoFechar, aoCriar }: { niveis: { v: string; rotulo: string }[]; aoFechar: () => void; aoCriar: () => void }) {
  const formId = useId();
  const [nome, setNome] = useState('');
  const [nivel, setNivel] = useState(niveis[0]?.v ?? 'execucao');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    if (!nome.trim()) {
      setErro('Informe o nome do perfil.');
      document.getElementById('perfil-novo-nome')?.focus();
      return;
    }
    setErro('');
    setSalvando(true);
    try {
      await api.post('/perfis', { nome: nome.trim(), nivel });
      toast.success(`Perfil ${nome.trim()} criado.`);
      aoCriar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao criar perfil');
      setSalvando(false);
    }
  }
  return (
    <Gaveta titulo="Novo perfil" aoFechar={aoFechar} voltarPara={ID_TITULO}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={salvando}>{salvando ? 'Salvando…' : 'Adicionar perfil'}</Button>
        </>
      }>
      <form id={formId} onSubmit={salvar} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="perfil-novo-nome">Nome do novo perfil</Label>
          <Input id="perfil-novo-nome" data-foco-inicial value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Supervisor" autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="perfil-novo-nivel">Nível (hierarquia)</Label>
          <Select id="perfil-novo-nivel" value={nivel} onChange={(e) => setNivel(e.target.value)}>
            {niveis.map((n) => <option key={n.v} value={n.v}>{n.rotulo}</option>)}
          </Select>
          <p className={`text-xs ${texto2}`}>Só aparecem os níveis que estão sem perfil: cada nível tem um perfil só. O perfil nasce com as permissões padrão do nível.</p>
        </div>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}

function ExcluirPerfil({ perfil, usam, soDaLojaEmUso, aoFechar, aoExcluir }: { perfil: any; usam: number | null; soDaLojaEmUso: boolean; aoFechar: () => void; aoExcluir: () => void }) {
  const [apagando, setApagando] = useState(false);
  const [erro, setErro] = useState('');
  const emUso = (usam ?? 0) > 0;
  async function confirmar() {
    if (apagando || emUso) return;
    setErro('');
    setApagando(true);
    try {
      await api.del(`/perfis/${perfil.id}`);
      toast.success('Perfil removido.');
      aoExcluir();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao remover perfil');
      setApagando(false);
    }
  }
  return (
    <Dialogo alerta titulo="Excluir perfil" aoFechar={aoFechar} voltarPara={ID_TITULO}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar} disabled={apagando}>{emUso ? 'Fechar' : 'Cancelar'}</Button>
          {!emUso && <Button type="button" variant="destructive" onClick={confirmar} disabled={apagando}>{apagando ? 'Excluindo…' : 'Excluir perfil'}</Button>}
        </>
      }>
      <div className="space-y-3 text-sm">
        <p>Excluir o perfil <b>{perfil.nome}</b> ({nivelDe(perfil)})?</p>
        {emUso ? (
          <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2">
            <b>{plural(usam ?? 0, 'pessoa usa', 'pessoas usam')} este perfil{soDaLojaEmUso ? ' na loja em uso' : ''}.</b> O servidor não remove perfil em uso: troque o perfil
            delas na parte “Pessoas” e volte aqui.
          </p>
        ) : (
          <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">
            O perfil é apagado e o nível {nivelDe(perfil)} fica sem perfil até você criar outro. Se algum colaborador ainda estiver nele — de qualquer loja —, o
            servidor recusa e nada muda. Não dá para desfazer.
          </p>
        )}
        {erro && <p role="alert" className="font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
