'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api, getCategoria, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import {
  FiltroBusca, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ehMatriz = (u: any) => u.tipo === 'matriz';
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Matriz', filtro: ehMatriz },
  { rotulo: 'Filiais', filtro: (u) => !ehMatriz(u) },
  { rotulo: 'Sem endereço', filtro: (u) => !u.endereco, tom: 'aviso' },
];
const ID_TITULO = 'unidades-titulo';

// Configurações → Unidades (mockup `mockups/regem-configuracoes.html`): as lojas da rede, em lista com
// contagem, situações e busca. Criar e editar na gaveta; excluir num diálogo que diz a regra do servidor.
export default function UnidadesPage() {
  const router = useRouter();
  const [lista, setLista] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [editando, setEditando] = useState<any | null>(null); // a unidade em edição, ou {} para nova
  const [excluindo, setExcluindo] = useState<any | null>(null);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const r: any = await api.unidades();
      setLista(Array.isArray(r) ? r : []);
    } catch (e) {
      // Erro não é "nenhuma unidade": mostrar a lista vazia aqui enganava.
      setLista([]);
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as unidades.');
    }
  }, []);
  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    void carregar();
  }, [carregar, router]);

  if (lista === null)
    return (
      <Shell eyebrow="Configurações" title="Unidades">
        <SkeletonList rows={3} />
      </Shell>
    );

  // O servidor é quem autoriza (criar, editar e excluir são do presidente); aqui só não se oferece o
  // que ele recusaria.
  const podeGerir = getCategoria() === 'presidente';
  const b = semAcento(busca);
  const base = lista.filter((u) => !b || semAcento(`${u.nome} ${u.endereco ?? ''}`).includes(b));
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || sit >= 0);
  const limpar = () => { setBusca(''); setSit(-1); };

  return (
    <Shell eyebrow="Configurações" title="Unidades">
      <section className="space-y-3" aria-labelledby={ID_TITULO}>
        <TituloLista id={ID_TITULO} titulo="Unidades da rede" total={lista.length} mostrando={linhas.length} um="unidade" varios="unidades"
          extra="cada colaborador, setor, turno e venda pertence a uma unidade">
          {podeGerir && <Button type="button" onClick={() => setEditando({})}><Plus className="h-4 w-4" aria-hidden="true" /> Nova unidade</Button>}
        </TituloLista>

        {erro ? (
          <Card className="flex flex-wrap items-center justify-center gap-3 p-8 text-center text-sm">
            <span role="alert">{erro}</span>
            <Button type="button" variant="outline" size="sm" onClick={() => { setLista(null); void carregar(); }}>Tentar de novo</Button>
          </Card>
        ) : (
          <>
            <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
            <Filtros>
              <FiltroBusca id="unidades-busca" valor={busca} aoMudar={setBusca} placeholder="Nome ou endereço" />
            </Filtros>
            {lista.length === 0 ? (
              <Vazio>Nenhuma unidade ainda. Cadastre a primeira loja da rede.</Vazio>
            ) : linhas.length === 0 ? (
              <Vazio aoLimpar={limpar} />
            ) : (
              <ListaDados
                legenda="Unidades da rede"
                linhas={linhas}
                chave={(u) => u.id}
                nome={(u) => u.nome}
                colunas={[
                  { titulo: 'Unidade', celula: (u) => <NomeComApoio nome={u.nome}><Selo tom={ehMatriz(u) ? 'info' : 'neutro'}>{ehMatriz(u) ? 'Matriz' : 'Filial'}</Selo></NomeComApoio> },
                  { titulo: 'Endereço', celula: (u) => u.endereco || '—' },
                ]}
                acoes={() =>
                  podeGerir
                    ? [
                        { rotulo: 'Editar', icone: Pencil, aoClicar: setEditando },
                        { rotulo: 'Excluir', icone: Trash2, aoClicar: setExcluindo, tom: 'perigo' as const },
                      ]
                    : []
                }
              />
            )}
            {filtrando && linhas.length > 0 && (
              <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
            )}
          </>
        )}
      </section>

      {editando && (
        <UnidadeForm
          item={editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={async () => { setEditando(null); await carregar(); }}
        />
      )}
      {excluindo && (
        <ExcluirUnidade
          unidade={excluindo}
          aoFechar={() => setExcluindo(null)}
          aoExcluir={async () => {
            setExcluindo(null);
            await carregar();
            document.getElementById(ID_TITULO)?.focus(); // a linha (e o botão que abriu) saiu da lista
          }}
        />
      )}
    </Shell>
  );
}

function UnidadeForm({ item, aoFechar, aoSalvar }: { item: any; aoFechar: () => void; aoSalvar: () => void }) {
  const formId = useId();
  const [nome, setNome] = useState<string>(item.nome ?? '');
  const [tipo, setTipo] = useState<string>(item.tipo ?? 'filial');
  const [endereco, setEndereco] = useState<string>(item.endereco ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const nova = !item.id;

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (salvando) return;
    if (nome.trim().length < 2) {
      setErro('Informe o nome da unidade (mín. 2 letras).');
      document.getElementById('unidade-nome')?.focus();
      return;
    }
    setErro('');
    setSalvando(true);
    try {
      const body = { nome: nome.trim(), tipo, endereco: endereco.trim() || undefined };
      if (nova) await api.criarUnidade(body);
      else await api.atualizarUnidade(item.id, body);
      toast.success(nova ? 'Unidade criada.' : 'Unidade atualizada.');
      aoSalvar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao salvar');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo={nova ? 'Nova unidade' : 'Editar unidade'}
      aoFechar={aoFechar}
      voltarPara={ID_TITULO}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="submit" form={formId} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={salvar} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <Label htmlFor="unidade-nome">Nome da unidade</Label>
          <Input id="unidade-nome" data-foco-inicial value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Matriz, Filial Centro" autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="unidade-tipo">Tipo</Label>
          <Select id="unidade-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="matriz">Matriz</option>
            <option value="filial">Filial</option>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="unidade-endereco">Endereço (opcional)</Label>
          <Input id="unidade-endereco" value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número — bairro, cidade" autoComplete="off" />
        </div>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      </form>
    </Gaveta>
  );
}

function ExcluirUnidade({ unidade, aoFechar, aoExcluir }: { unidade: any; aoFechar: () => void; aoExcluir: () => void }) {
  const [apagando, setApagando] = useState(false);
  const [erro, setErro] = useState('');

  async function confirmar() {
    if (apagando) return;
    setErro('');
    setApagando(true);
    try {
      await api.removerUnidade(unidade.id);
      toast.success('Unidade removida.');
      aoExcluir();
    } catch (e) {
      // A recusa do servidor (unidade com setores, turnos ou janelas) fica à vista, no próprio diálogo.
      setErro(e instanceof Error ? e.message : 'Erro ao remover');
      setApagando(false);
    }
  }

  return (
    <Dialogo alerta titulo="Excluir unidade" aoFechar={aoFechar} voltarPara={ID_TITULO}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar} disabled={apagando}>Cancelar</Button>
          <Button type="button" variant="destructive" onClick={confirmar} disabled={apagando}>{apagando ? 'Excluindo…' : 'Excluir unidade'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p>Excluir <b>{unidade.nome}</b>?</p>
        <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">
          A unidade sai da lista. Só é possível se não houver setores, turnos ou janelas de pico nela. Não dá para desfazer por aqui.
        </p>
        {erro && <p role="alert" className={`font-medium ${texto2}`}><b className="text-foreground">Não foi possível excluir:</b> {erro}</p>}
      </div>
    </Dialogo>
  );
}
