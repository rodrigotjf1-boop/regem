'use client';

import { useId, useState } from 'react';
import { Ban, Check, UserCog } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Chave } from '@/components/ui/chave';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, distintos, semAcento, texto2, type Acao, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ID_TITULO = 'pessoas-titulo';
const PRESIDENTE = 'Presidente · C&O (fixo)';
const bloqueada = (c: any) => c.status === 'bloqueado';

// Acessos & perfis → Pessoas (mockup `mockups/regem-configuracoes.html`): o perfil de cada
// colaborador, o app, o acesso pela internet e o bloqueio. O acesso muda na gaveta (grava só o que
// mudou); bloquear pede confirmação. O presidente/C&O é fixo: o servidor não deixa mexer nele por aqui.
export function PessoasParte({
  pessoas, perfis, soDaLojaEmUso, recarregar,
}: {
  pessoas: any[];
  /** Todos os perfis da empresa, inclusive o do presidente (para reconhecer quem é C&O). */
  perfis: any[];
  soDaLojaEmUso: boolean;
  recarregar: () => Promise<void>;
}) {
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [filtroPerfil, setFiltroPerfil] = useState('');
  const [editando, setEditando] = useState<any | null>(null);
  const [bloqueando, setBloqueando] = useState<any | null>(null);
  const [gravando, setGravando] = useState<string | null>(null);

  const perfilDoId = (id: string | null) => perfis.find((p) => p.id === id);
  const ehPresidente = (c: any) => perfilDoId(c.perfilAcessoId)?.nivel === 'presidente';
  const perfilDe = (c: any) => (ehPresidente(c) ? PRESIDENTE : perfilDoId(c.perfilAcessoId)?.nome ?? 'Sem perfil');
  // O presidente/C&O entra pela internet sempre.
  const naInternet = (c: any) => ehPresidente(c) || !!c.podeNuvem;
  const SITUACOES: Situacao<any>[] = [
    { rotulo: 'Ativas', filtro: (c) => !bloqueada(c) },
    { rotulo: 'Bloqueadas', filtro: bloqueada, tom: 'critico' },
    { rotulo: 'Sem e-mail', filtro: (c) => !c.email, tom: 'aviso' },
    { rotulo: 'Com acesso pela internet', filtro: naInternet },
  ];
  const b = semAcento(busca);
  const base = pessoas.filter((c) => (!b || semAcento(`${c.nome} ${c.email ?? ''}`).includes(b)) && (!filtroPerfil || perfilDe(c) === filtroPerfil));
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || filtroPerfil || sit >= 0);
  const limpar = () => { setBusca(''); setFiltroPerfil(''); setSit(-1); };

  async function desbloquear(c: any) {
    if (gravando) return;
    setGravando(c.id);
    try {
      await api.patch(`/colaboradores/${c.id}/acesso`, { status: 'ativo' });
      toast.success(`${c.nome} desbloqueado.`);
      await recarregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao atualizar acesso');
    } finally {
      setGravando(null);
    }
  }
  const acoesDe = (c: any): Acao<any>[] =>
    ehPresidente(c)
      ? []
      : [
          { rotulo: 'Acesso', icone: UserCog, aoClicar: setEditando, tom: 'primaria' as const },
          bloqueada(c)
            ? { rotulo: 'Desbloquear', icone: Check, aoClicar: (x: any) => void desbloquear(x), ocupada: (x: any) => gravando === x.id }
            : { rotulo: 'Bloquear', icone: Ban, aoClicar: setBloqueando, tom: 'perigo' as const },
        ];

  return (
    <section className="space-y-3" aria-labelledby={ID_TITULO}>
      <TituloLista id={ID_TITULO} titulo="Colaboradores & acesso" total={pessoas.length} mostrando={linhas.length} um="pessoa" varios="pessoas"
        extra={`${soDaLojaEmUso ? 'da loja em uso · ' : ''}as mudanças valem no próximo login do colaborador`} />
      <p className={`max-w-3xl text-sm ${texto2}`}>
        Associe o perfil de cada colaborador, libere o app, autorize o acesso online (nuvem) e bloqueie o acesso quando precisar. Por padrão, só o presidente
        entra pela nuvem — os demais operam no servidor local da loja.
      </p>
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="pessoas-busca" valor={busca} aoMudar={setBusca} placeholder="Nome ou e-mail" />
        <FiltroSelect id="pessoas-perfil" rotulo="Perfil" todos="Todos os perfis" opcoes={distintos(pessoas, perfilDe)} valor={filtroPerfil} aoMudar={setFiltroPerfil} />
      </Filtros>
      {pessoas.length === 0 ? (
        <Vazio>Nenhum colaborador{soDaLojaEmUso ? ' na loja em uso' : ''}.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Colaboradores e o acesso de cada um"
          linhas={linhas}
          chave={(c) => c.id}
          nome={(c) => c.nome}
          colunas={[
            { titulo: 'Colaborador', celula: (c) => <NomeComApoio nome={c.nome} apoio={c.email ?? 'sem e-mail'} /> },
            { titulo: 'Perfil', celula: perfilDe },
            { titulo: 'App', celula: (c) => (c.appHabilitado ? <Selo tom="ok">ligado</Selo> : <Selo>desligado</Selo>) },
            { titulo: 'Internet', celula: (c) => (naInternet(c) ? <Selo tom="ok">liberado</Selo> : <Selo>só na loja</Selo>) },
            { titulo: 'Situação', celula: (c) => (bloqueada(c) ? <Selo tom="critico">bloqueado</Selo> : <Selo tom="ok">ativo</Selo>) },
          ]}
          acoes={acoesDe}
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}

      {editando && (
        <AcessoDaPessoa pessoa={editando} perfis={perfis.filter((p) => p.nivel !== 'presidente')} aoFechar={() => setEditando(null)} aoSalvar={async () => { setEditando(null); await recarregar(); }} />
      )}
      {bloqueando && <BloquearPessoa pessoa={bloqueando} aoFechar={() => setBloqueando(null)} aoBloquear={async () => { setBloqueando(null); await recarregar(); }} />}
    </section>
  );
}

function AcessoDaPessoa({ pessoa, perfis, aoFechar, aoSalvar }: { pessoa: any; perfis: any[]; aoFechar: () => void; aoSalvar: () => void }) {
  const formId = useId();
  const inicial = { perfilAcessoId: (pessoa.perfilAcessoId ?? '') as string, appHabilitado: !!pessoa.appHabilitado, podeNuvem: !!pessoa.podeNuvem };
  const [f, setF] = useState(inicial);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    // Só o que mudou: o servidor mantém o resto.
    const corpo: Record<string, unknown> = {};
    if (f.perfilAcessoId !== inicial.perfilAcessoId && f.perfilAcessoId) corpo.perfilAcessoId = f.perfilAcessoId;
    if (f.appHabilitado !== inicial.appHabilitado) corpo.appHabilitado = f.appHabilitado;
    if (f.podeNuvem !== inicial.podeNuvem) corpo.podeNuvem = f.podeNuvem;
    if (!Object.keys(corpo).length) return aoFechar();
    setErro('');
    setSalvando(true);
    try {
      await api.patch(`/colaboradores/${pessoa.id}/acesso`, corpo);
      toast.success('Acesso atualizado.');
      aoSalvar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao atualizar acesso');
      setSalvando(false);
    }
  }
  return (
    <Gaveta titulo={`Acesso de ${pessoa.nome}`} aoFechar={aoFechar} voltarPara={ID_TITULO}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </>
      }>
      <form id={formId} onSubmit={salvar} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="acesso-perfil">Perfil</Label>
          <Select id="acesso-perfil" data-foco-inicial value={f.perfilAcessoId} onChange={(e) => setF((x) => ({ ...x, perfilAcessoId: e.target.value }))}>
            {!f.perfilAcessoId && <option value="" disabled>— sem perfil —</option>}
            {/* C&O fora das opções: ninguém vira presidente por aqui (o servidor também recusa). */}
            {perfis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </Select>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="block text-sm font-medium">App do colaborador</span>
            <span className={`block text-xs ${texto2}`}>Libera o PIN do app do colaborador.</span>
          </div>
          <Chave ligada={f.appHabilitado} rotulo="App do colaborador" aoMudar={(v) => setF((x) => ({ ...x, appHabilitado: v }))} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="block text-sm font-medium">Acesso pela internet (nuvem)</span>
            <span className={`block text-xs ${texto2}`}>Deixa entrar pelo app online. Desligado, a pessoa só entra no servidor local da loja.</span>
          </div>
          <Chave ligada={f.podeNuvem} rotulo="Acesso pela internet (nuvem)" aoMudar={(v) => setF((x) => ({ ...x, podeNuvem: v }))} />
        </div>
        <p className={`text-xs ${texto2}`}>As mudanças valem no próximo login do colaborador. Para tirar o acesso na hora, use “Bloquear” na lista.</p>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}

function BloquearPessoa({ pessoa, aoFechar, aoBloquear }: { pessoa: any; aoFechar: () => void; aoBloquear: () => void }) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');
  async function confirmar() {
    if (gravando) return;
    setErro('');
    setGravando(true);
    try {
      await api.patch(`/colaboradores/${pessoa.id}/acesso`, { status: 'bloqueado' });
      toast.success(`${pessoa.nome} bloqueado.`);
      aoBloquear();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao bloquear');
      setGravando(false);
    }
  }
  return (
    <Dialogo alerta titulo={`Bloquear ${pessoa.nome}?`} aoFechar={aoFechar} voltarPara={ID_TITULO}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar} disabled={gravando}>Cancelar</Button>
          <Button type="button" variant="destructive" onClick={confirmar} disabled={gravando}>{gravando ? 'Bloqueando…' : 'Bloquear'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">
          A pessoa deixa de entrar no sistema e, se estiver logada, perde o acesso em instantes. Você desbloqueia por aqui quando quiser.
        </p>
        {erro && <p role="alert" className="font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
