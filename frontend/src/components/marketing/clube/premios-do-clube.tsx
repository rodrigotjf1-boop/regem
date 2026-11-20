'use client';

import { useMemo, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { FiltroBusca, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, semAcento, type Situacao } from '@/components/ui/lista';
import { GavetaDoPremio } from './gaveta-do-premio';
import { NOME_DO_TIPO, type PainelDoClube, type PremioDoClube } from './tipos';

// Marketing › Clube › Prêmios (protótipo `mockups/regem-clube-banner.html`): a lista no modelo do Estoque — o título com a
// contagem, as situações que filtram (em uso × sem uso), a busca, as ações na linha, criar e editar em gaveta e excluir em
// diálogo. Só o presidente cria, edita e exclui (o servidor confere; a tela só esconde os botões).
const SITUACOES: Situacao<PremioDoClube>[] = [
  { rotulo: 'Em uso', filtro: (p) => p.emUso.length > 0 },
  { rotulo: 'Sem uso', filtro: (p) => p.emUso.length === 0 },
];

export function PremiosDoClube({ painel, podeMudar, aoMudar }: { painel: PainelDoClube; podeMudar: boolean; aoMudar: (p: PainelDoClube) => void }) {
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState(-1);
  const [editando, setEditando] = useState<PremioDoClube | 'novo' | null>(null);
  const [excluindo, setExcluindo] = useState<PremioDoClube | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const todos = painel.premios;
  const daBusca = useMemo(() => {
    const b = semAcento(busca.trim());
    return b ? todos.filter((p) => semAcento(`${p.nome} ${p.descricao}`).includes(b)) : todos;
  }, [todos, busca]);
  const mostrando = situacao < 0 ? daBusca : daBusca.filter(SITUACOES[situacao].filtro);
  const cheio = todos.length >= painel.opcoes.premiosMax;

  async function excluir() {
    if (!excluindo) return;
    setOcupado(true);
    try {
      aoMudar((await api.clubeExcluirPremio(excluindo.id)) as PainelDoClube);
      toast.success('Prêmio excluído.');
      setExcluindo(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível excluir o prêmio.');
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-4">
      <TituloLista id="titulo-premios-do-clube" titulo="Prêmios" total={todos.length} mostrando={mostrando.length} um="prêmio" varios="prêmios">
        {podeMudar && (
          <Button type="button" onClick={() => setEditando('novo')} disabled={cheio} title={cheio ? `No máximo ${painel.opcoes.premiosMax} prêmios` : undefined}>
            ＋ Novo prêmio
          </Button>
        )}
      </TituloLista>
      {todos.length > 0 && (
        <>
          <Situacoes base={daBusca} opcoes={SITUACOES} valor={situacao} aoMudar={setSituacao} todas={{ rotulo: 'Todos', filtro: () => true }} />
          <Filtros emLinha>
            <FiltroBusca id="busca-premios-do-clube" valor={busca} aoMudar={setBusca} placeholder="Buscar prêmio" />
          </Filtros>
        </>
      )}
      {!todos.length ? (
        <Vazio>
          {podeMudar
            ? 'Nenhum prêmio ainda. Crie os prêmios que a loja consegue dar a todos: um desconto, o frete grátis ou um produto grátis.'
            : 'Nenhum prêmio ainda. Quem cria os prêmios é o presidente.'}
        </Vazio>
      ) : !mostrando.length ? (
        <Vazio aoLimpar={() => { setBusca(''); setSituacao(-1); }} />
      ) : (
        <ListaDados
          legenda="Prêmios do clube"
          linhas={mostrando}
          chave={(p) => p.id}
          nome={(p) => p.nome}
          colunas={[
            { titulo: 'Prêmio', celula: (p) => <NomeComApoio nome={p.nome} apoio={p.descricao} /> },
            { titulo: 'Tipo', celula: (p) => NOME_DO_TIPO[p.tipo] },
            {
              titulo: 'Uso',
              celula: (p) => (p.emUso.length ? <Selo tom="ok">{p.emUso.join(' · ')}</Selo> : <Selo>Sem uso</Selo>),
            },
          ]}
          acoes={
            podeMudar
              ? () => [
                  { rotulo: 'Editar', icone: Pencil, aoClicar: (p) => setEditando(p) },
                  { rotulo: 'Excluir', icone: Trash2, tom: 'perigo', aoClicar: (p) => setExcluindo(p) },
                ]
              : undefined
          }
        />
      )}

      {editando && (
        <GavetaDoPremio
          premio={editando === 'novo' ? null : editando}
          validades={painel.opcoes.validadesDoPremio}
          nomeMax={painel.opcoes.nomeMax}
          aoFechar={() => setEditando(null)}
          aoSalvar={(p) => {
            aoMudar(p);
            setEditando(null);
          }}
        />
      )}
      {excluindo && (
        <Dialogo
          titulo={`Excluir "${excluindo.nome}"?`}
          alerta
          aoFechar={() => setExcluindo(null)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setExcluindo(null)}>Cancelar</Button>
              <Button type="button" variant="destructive" onClick={excluir} disabled={ocupado}>{ocupado ? 'Excluindo…' : 'Excluir'}</Button>
            </>
          }
        >
          <p className="text-sm">
            {excluindo.emUso.length
              ? `Este prêmio está em uso em: ${excluindo.emUso.join(', ')}. Troque o prêmio lá antes de excluir.`
              : 'Sai da lista agora. Quem já ganhou este prêmio continua podendo usar até a validade.'}
          </p>
        </Dialogo>
      )}
    </div>
  );
}
