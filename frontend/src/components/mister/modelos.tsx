'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import { SkeletonList } from '@/components/ui/skeleton';
import { Filtros, FiltroBusca, ListaDados, Selo, Situacoes, TituloLista, Vazio, semAcento, texto2 } from '@/components/ui/lista';

// MISTER › MODELOS DE COMPRA (versão 9, fase O2, mig 503; protótipo `mockups/regem-mister-v9.html`, "Na loja"; só o presidente). O que
// cada fornecedor manda e a que insumo vai — nasce do que a pessoa confirmou nas notas e nos cupons do Mister — e os apelidos da
// empresa (o nome que ela usa para um insumo na lista de compras). "Mudar" troca o insumo, a conversão ou deixa fora do estoque;
// "Esquecer" apaga: o próximo cupom pergunta de novo. O servidor confere tudo (o insumo é da empresa, a conversão é um número).

type Modelo = { fornecedor: string; nome: string; produtos: number; comDuvida: number; vezes: number; usadoEm: string | null; parado: boolean };
type Resposta = { ligado: boolean; modelos: Modelo[]; apelidos: number; limite: number };
type Linha = {
  chave: string;
  descricao: string | null;
  itemId: string | null;
  itemNome: string | null;
  unidadeDoEstoque: string | null;
  insumoSumiu: boolean;
  fator: number | null;
  unidadeNota: string | null;
  ultimaQuantidade: number | null;
  ultimoPrecoCentavos: number | null;
  usadoEm: string | null;
};
type Detalhe = { fornecedor: string; nome: string; linhas: Linha[] };
type Apelido = { chave: string; texto: string; itemId: string; itemNome: string | null; insumoSumiu: boolean; vezes: number; atualizadoEm: string };
type Insumo = { id: string; nome: string; unidadeMedida?: string | null };

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—');
const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const erroDe = (e: unknown, padrao: string) => (e instanceof Error ? e.message : padrao);

/** Os insumos do estoque para o "Mudar" (lidos uma vez, quando a primeira gaveta precisa). */
function useInsumos() {
  const [insumos, setInsumos] = useState<Insumo[] | null>(null);
  const [erro, setErro] = useState(false);
  const ler = useCallback(async () => {
    if (insumos) return;
    setErro(false);
    try {
      const l = (await api.estoqueItens()) as Insumo[];
      setInsumos([...l].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR')));
    } catch {
      setErro(true);
    }
  }, [insumos]);
  return { insumos, erro, ler };
}

export function ModelosDeCompra() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState(false);
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState(-1);
  const [aberto, setAberto] = useState<Modelo | null>(null);
  const [apelidosAbertos, setApelidosAbertos] = useState(false);
  const insumos = useInsumos();

  const carregar = useCallback(async () => {
    setErro(false);
    try {
      setDados((await api.get('/mister/modelos')) as Resposta);
    } catch {
      setErro(true);
    }
  }, []);
  useEffect(() => void carregar(), [carregar]);

  const base = useMemo(() => {
    const t = semAcento(busca.trim());
    return (dados?.modelos ?? []).filter((m) => !t || semAcento(`${m.nome} ${m.fornecedor}`).includes(t));
  }, [dados, busca]);
  const situacoes = [
    { rotulo: 'Com dúvida', filtro: (m: Modelo) => m.comDuvida > 0, tom: 'aviso' as const },
    { rotulo: `Parados há 60 dias`, filtro: (m: Modelo) => m.parado },
  ];
  const linhas = situacao < 0 ? base : base.filter(situacoes[situacao].filtro);
  const limpar = () => {
    setBusca('');
    setSituacao(-1);
  };

  if (erro)
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        Não consegui carregar os modelos agora.{' '}
        <Button variant="outline" className="ml-2" onClick={() => void carregar()}>
          Tentar de novo
        </Button>
      </div>
    );

  return (
    <section className="space-y-4" aria-labelledby="modelos-mister">
      <TituloLista
        id="modelos-mister"
        titulo="Modelos de compra"
        total={dados?.modelos.length ?? 0}
        mostrando={linhas.length}
        um="modelo"
        varios="modelos"
        extra="o que cada fornecedor manda e a que insumo vai · nasce do que você confirmou"
      />
      {!dados ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          {!dados.ligado && (
            <p role="status" className="rounded-md border-l-4 border-primary bg-primary/10 px-3 py-2 text-sm">
              &quot;Aprender o modelo de cada fornecedor&quot; está desligado: a nota continua ligando o que você já confirmou, mas o resumo não diz o que mudou e a
              lista de compras não usa os apelidos. Ligue em Mister › Avisos e relatórios › Conversa.
            </p>
          )}
          <Situacoes base={base} opcoes={situacoes} valor={situacao} aoMudar={setSituacao} />
          <Filtros emLinha>
            <FiltroBusca id="modelos-busca" valor={busca} aoMudar={setBusca} placeholder="Buscar fornecedor" />
          </Filtros>
          {dados.modelos.length >= dados.limite && (
            <p className="text-sm text-muted-foreground" role="status">
              Mostrando os {dados.limite} modelos usados por último.
            </p>
          )}
          {dados.modelos.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">
              <span className="mb-1 block text-2xl" aria-hidden>
                🧾
              </span>
              Nenhum modelo ainda. Mande para o Mister a foto da nota ou do cupom de um fornecedor e confirme os itens: o modelo nasce do que você confirmou.
            </p>
          ) : linhas.length === 0 ? (
            <Vazio aoLimpar={limpar}>Nenhum modelo com esses filtros.</Vazio>
          ) : (
            <ListaDados
              legenda="Modelos de compra por fornecedor, com os produtos conhecidos, a última nota e as dúvidas"
              linhas={linhas}
              chave={(m) => m.fornecedor}
              nome={(m) => m.nome}
              colunas={[
                {
                  titulo: 'Fornecedor',
                  celula: (m) => (
                    <span className="block">
                      <span className="font-semibold">{m.nome}</span>
                      <span className={`block text-xs ${texto2}`}>
                        {plural(m.produtos, 'produto conhecido', 'produtos conhecidos')} · última nota {dia(m.usadoEm)} · {plural(m.vezes, 'vez', 'vezes')}
                      </span>
                    </span>
                  ),
                },
                {
                  titulo: 'Situação',
                  celula: (m) =>
                    m.comDuvida > 0 ? (
                      <Selo tom="aviso">{plural(m.comDuvida, 'com dúvida', 'com dúvida')}</Selo>
                    ) : m.parado ? (
                      <Selo tom="neutro">parado</Selo>
                    ) : (
                      <Selo tom="ok">em dia</Selo>
                    ),
                },
              ]}
              acoes={() => [{ rotulo: 'Ver', icone: Eye, aoClicar: (m: Modelo) => setAberto(m) }]}
            />
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
            <span className="min-w-0">
              <span className="block font-semibold">Apelidos da empresa</span>
              <span className={`block text-sm ${texto2}`}>
                {dados.apelidos ? `${plural(dados.apelidos, 'nome que vale', 'nomes que valem')} para qualquer fornecedor na lista de compras` : 'Nenhum ainda: nascem quando você confirma na lista um nome diferente do cadastro.'}
              </span>
            </span>
            <Button type="button" variant="outline" onClick={() => setApelidosAbertos(true)}>
              Ver
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            &quot;Mudar&quot; troca o insumo ou a conversão; &quot;Esquecer&quot; apaga a linha, e o próximo cupom do fornecedor pergunta de novo.
          </p>
        </>
      )}
      {aberto && (
        <GavetaDoModelo
          modelo={aberto}
          insumos={insumos}
          aoFechar={() => setAberto(null)}
          aoMudar={() => void carregar()}
          aoEsquecerTudo={() => {
            setAberto(null);
            void carregar();
          }}
        />
      )}
      {apelidosAbertos && <GavetaDosApelidos insumos={insumos} aoFechar={() => setApelidosAbertos(false)} aoMudar={() => void carregar()} />}
    </section>
  );
}

function EscolhaDoInsumo({
  id,
  insumos,
  valor,
  aoMudar,
  comFora,
}: {
  id: string;
  insumos: ReturnType<typeof useInsumos>;
  valor: string;
  aoMudar: (v: string) => void;
  comFora: boolean;
}) {
  // A leitura é estável enquanto a lista não chega (sem laço de pedidos a cada desenho).
  const { ler } = insumos;
  useEffect(() => void ler(), [ler]);
  if (insumos.erro)
    return (
      <p role="alert" className="text-sm">
        Não consegui ler os insumos.{' '}
        <button type="button" className="font-semibold underline" onClick={() => void insumos.ler()}>
          Tentar de novo
        </button>
      </p>
    );
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        Insumo do estoque
      </label>
      <select id={id} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm" value={valor} onChange={(e) => aoMudar(e.target.value)} disabled={!insumos.insumos}>
        {!insumos.insumos ? (
          <option value="">Carregando…</option>
        ) : (
          // Nada escolhido ainda (o insumo de antes saiu do estoque): o seletor diz isso, não a primeira opção.
          <option value="" disabled>
            Escolha o insumo
          </option>
        )}
        {comFora && <option value="fora">Fora do estoque (só na conta)</option>}
        {(insumos.insumos ?? []).map((i) => (
          <option key={i.id} value={i.id}>
            {i.nome}
            {i.unidadeMedida ? ` (${i.unidadeMedida})` : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

function GavetaDoModelo({
  modelo,
  insumos,
  aoFechar,
  aoMudar,
  aoEsquecerTudo,
}: {
  modelo: Modelo;
  insumos: ReturnType<typeof useInsumos>;
  aoFechar: () => void;
  aoMudar: () => void;
  aoEsquecerTudo: () => void;
}) {
  const [det, setDet] = useState<Detalhe | null>(null);
  const [erro, setErro] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [esquecer, setEsquecer] = useState<Linha | 'tudo' | null>(null);

  const ler = useCallback(async () => {
    setErro(false);
    try {
      setDet((await api.get(`/mister/modelos/${encodeURIComponent(modelo.fornecedor)}`)) as Detalhe);
    } catch {
      setErro(true);
    }
  }, [modelo.fornecedor]);
  useEffect(() => void ler(), [ler]);

  return (
    <Gaveta
      titulo={`Modelo de ${modelo.nome}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" className="text-destructive" onClick={() => setEsquecer('tudo')} disabled={!det}>
            Esquecer o modelo
          </Button>
          <Button type="button" onClick={aoFechar}>
            Fechar
          </Button>
        </>
      }
    >
      <p className={`text-sm ${texto2}`}>
        {plural(modelo.produtos, 'produto', 'produtos')} · última nota {dia(modelo.usadoEm)} · {plural(modelo.vezes, 'vez', 'vezes')}
      </p>
      {erro ? (
        <p role="alert" className="mt-3 text-sm">
          Não consegui abrir o modelo.{' '}
          <button type="button" className="font-semibold underline" onClick={() => void ler()}>
            Tentar de novo
          </button>
        </p>
      ) : !det ? (
        <SkeletonList rows={3} />
      ) : (
        <ul className="mt-3 text-sm" aria-label={`Produtos do modelo de ${det.nome}`}>
          {det.linhas.map((l) => (
            <li key={l.chave} className="border-b border-border py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 break-words font-medium">{l.descricao ?? l.chave.replace(/^(cod|desc):/, '')}</span>
                <span className="flex min-w-0 flex-wrap items-center gap-2 break-words text-right">
                  <span aria-hidden>→</span>
                  {l.insumoSumiu ? (
                    <Selo tom="aviso">o insumo saiu do estoque</Selo>
                  ) : l.itemId ? (
                    <span className="font-semibold">{l.itemNome}</span>
                  ) : (
                    <span className={texto2}>fora do estoque, só na conta</span>
                  )}
                </span>
              </div>
              <p className={`mt-1 text-xs ${texto2}`}>
                {l.fator != null && l.itemId && !l.insumoSumiu ? `1 ${l.unidadeNota ?? 'unidade'} = ${num(l.fator)} ${l.unidadeDoEstoque ?? ''} · ` : ''}
                {l.ultimaQuantidade != null
                  ? `última vez ${num(l.ultimaQuantidade)}${l.unidadeNota ? ` ${l.unidadeNota}` : ''}${l.ultimoPrecoCentavos != null ? ` a ${reais(l.ultimoPrecoCentavos)}` : ''}`
                  : 'ainda sem nota lançada com este produto'}
              </p>
              {editando === l.chave ? (
                <EditorDaLinha
                  fornecedor={det.fornecedor}
                  linha={l}
                  insumos={insumos}
                  aoCancelar={() => setEditando(null)}
                  aoSalvar={() => {
                    setEditando(null);
                    void ler();
                    aoMudar();
                  }}
                />
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setEditando(l.chave)} aria-label={`Mudar ${l.descricao ?? l.chave}`}>
                    Mudar
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEsquecer(l)} aria-label={`Esquecer ${l.descricao ?? l.chave}`}>
                    Esquecer
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {esquecer && det && (
        <DialogoEsquecer
          titulo={esquecer === 'tudo' ? `Esquecer o modelo de ${det.nome}?` : 'Esquecer este produto?'}
          texto={
            esquecer === 'tudo'
              ? `Os ${plural(det.linhas.length, 'produto', 'produtos')} saem do modelo. O próximo cupom de ${det.nome} pergunta de novo cada item. O estoque e as notas lançadas não mudam.`
              : `"${esquecer.descricao ?? esquecer.chave}" sai do modelo. O próximo cupom de ${det.nome} pergunta de novo a que insumo ele vai.`
          }
          aoFechar={() => setEsquecer(null)}
          aoConfirmar={async () => {
            await api.post(`/mister/modelos/${encodeURIComponent(det.fornecedor)}/esquecer`, esquecer === 'tudo' ? { tudo: true } : { chave: esquecer.chave });
            toast.success(esquecer === 'tudo' ? 'Modelo esquecido.' : 'Produto esquecido.');
            setEsquecer(null);
            if (esquecer === 'tudo') aoEsquecerTudo();
            else {
              void ler();
              aoMudar();
            }
          }}
        />
      )}
    </Gaveta>
  );
}

function EditorDaLinha({ fornecedor, linha, insumos, aoCancelar, aoSalvar }: { fornecedor: string; linha: Linha; insumos: ReturnType<typeof useInsumos>; aoCancelar: () => void; aoSalvar: () => void }) {
  const [item, setItem] = useState<string>(linha.itemId && !linha.insumoSumiu ? linha.itemId : linha.itemId ? '' : 'fora');
  const [fator, setFator] = useState(linha.fator != null ? String(linha.fator).replace('.', ',') : '');
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');
  const idBase = `modelo-${linha.chave.replace(/[^a-z0-9]/gi, '-')}`;
  const unidadeDoInsumo = insumos.insumos?.find((i) => i.id === item)?.unidadeMedida ?? null;
  async function salvar() {
    setErro('');
    if (!item) {
      setErro('Escolha o insumo ou "Fora do estoque".');
      return;
    }
    const f = fator.trim() ? Number(fator.replace(/\./g, '').replace(',', '.')) : null;
    if (item !== 'fora' && f !== null && !(f > 0)) {
      setErro('A conversão é um número maior que zero.');
      return;
    }
    setGravando(true);
    try {
      await api.patch(`/mister/modelos/${encodeURIComponent(fornecedor)}`, { chave: linha.chave, itemId: item === 'fora' ? null : item, fator: item === 'fora' ? null : f });
      toast.success('Produto do modelo mudado.');
      aoSalvar();
    } catch (e) {
      setErro(erroDe(e, 'Não deu para mudar.'));
      setGravando(false);
    }
  }
  return (
    <div className="mt-3 space-y-3 rounded-md border border-border p-3">
      <EscolhaDoInsumo id={`${idBase}-insumo`} insumos={insumos} valor={item} aoMudar={setItem} comFora />
      {item !== 'fora' && (
        <div className="space-y-1">
          <label htmlFor={`${idBase}-fator`} className="text-sm font-medium">
            Conversão: 1 {linha.unidadeNota ?? 'unidade da nota'} = quanto {unidadeDoInsumo ? `em ${unidadeDoInsumo}` : 'do estoque'}?
          </label>
          <input
            id={`${idBase}-fator`}
            inputMode="decimal"
            className="h-11 w-full max-w-40 rounded-md border border-input bg-background px-3 font-mono text-sm"
            value={fator}
            onChange={(e) => setFator(e.target.value)}
            placeholder="pela unidade"
          />
          <p className={`text-xs ${texto2}`}>Vazio: o Mister calcula pela unidade, como na nota.</p>
        </div>
      )}
      {erro && (
        <p role="alert" className="text-sm font-medium">
          {erro}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => void salvar()} disabled={gravando}>
          {gravando ? 'Salvando…' : 'Salvar'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={aoCancelar} disabled={gravando}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

function GavetaDosApelidos({ insumos, aoFechar, aoMudar }: { insumos: ReturnType<typeof useInsumos>; aoFechar: () => void; aoMudar: () => void }) {
  const [lista, setLista] = useState<Apelido[] | null>(null);
  const [erro, setErro] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [item, setItem] = useState('');
  const [gravando, setGravando] = useState(false);
  const [erroDoEditor, setErroDoEditor] = useState('');
  const [esquecer, setEsquecer] = useState<Apelido | null>(null);

  const ler = useCallback(async () => {
    setErro(false);
    try {
      setLista(((await api.get('/mister/modelos/apelidos')) as { apelidos: Apelido[] }).apelidos);
    } catch {
      setErro(true);
    }
  }, []);
  useEffect(() => void ler(), [ler]);

  async function salvar(a: Apelido) {
    setErroDoEditor('');
    if (!item) {
      setErroDoEditor('Escolha o insumo.');
      return;
    }
    setGravando(true);
    try {
      await api.patch('/mister/modelos/apelidos', { chave: a.chave, itemId: item });
      toast.success('Apelido mudado.');
      setEditando(null);
      void ler();
      aoMudar();
    } catch (e) {
      setErroDoEditor(erroDe(e, 'Não deu para mudar.'));
    } finally {
      setGravando(false);
    }
  }

  return (
    <Gaveta
      titulo="Apelidos da empresa"
      aoFechar={aoFechar}
      rodape={
        <Button type="button" onClick={aoFechar}>
          Fechar
        </Button>
      }
    >
      <p className={`text-sm ${texto2}`}>O nome que você usa para um insumo na lista de compras, para qualquer fornecedor. Nasce quando você confirma um nome diferente do cadastro.</p>
      {erro ? (
        <p role="alert" className="mt-3 text-sm">
          Não consegui ler os apelidos.{' '}
          <button type="button" className="font-semibold underline" onClick={() => void ler()}>
            Tentar de novo
          </button>
        </p>
      ) : !lista ? (
        <SkeletonList rows={3} />
      ) : lista.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">Nenhum apelido ainda.</p>
      ) : (
        <ul className="mt-3 text-sm" aria-label="Apelidos da empresa e o insumo de cada um">
          {lista.map((a) => (
            <li key={a.chave} className="border-b border-border py-3 last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="min-w-0 break-words font-medium">&quot;{a.texto}&quot;</span>
                <span className="flex min-w-0 flex-wrap items-center gap-2 break-words text-right">
                  <span aria-hidden>→</span>
                  {a.insumoSumiu ? <Selo tom="aviso">o insumo saiu do estoque</Selo> : <span className="font-semibold">{a.itemNome}</span>}
                </span>
              </div>
              <p className={`mt-1 text-xs ${texto2}`}>
                {plural(a.vezes, 'vez', 'vezes')} · desde {dia(a.atualizadoEm)}
              </p>
              {editando === a.chave ? (
                <div className="mt-3 space-y-3 rounded-md border border-border p-3">
                  <EscolhaDoInsumo id={`apelido-${a.chave.replace(/[^a-z0-9]/gi, '-')}`} insumos={insumos} valor={item} aoMudar={setItem} comFora={false} />
                  {erroDoEditor && (
                    <p role="alert" className="text-sm font-medium">
                      {erroDoEditor}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={() => void salvar(a)} disabled={gravando}>
                      {gravando ? 'Salvando…' : 'Salvar'}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setEditando(null)} disabled={gravando}>
                      Cancelar
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setItem(a.insumoSumiu ? '' : a.itemId);
                      setErroDoEditor('');
                      setEditando(a.chave);
                    }}
                    aria-label={`Mudar o apelido ${a.texto}`}
                  >
                    Mudar
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setEsquecer(a)} aria-label={`Esquecer o apelido ${a.texto}`}>
                    Esquecer
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {esquecer && (
        <DialogoEsquecer
          titulo="Esquecer este apelido?"
          texto={`"${esquecer.texto}" deixa de ligar sozinho na lista de compras. O insumo não muda.`}
          aoFechar={() => setEsquecer(null)}
          aoConfirmar={async () => {
            await api.post('/mister/modelos/apelidos/esquecer', { chave: esquecer.chave });
            toast.success('Apelido esquecido.');
            setEsquecer(null);
            void ler();
            aoMudar();
          }}
        />
      )}
    </Gaveta>
  );
}

function DialogoEsquecer({ titulo, texto, aoFechar, aoConfirmar }: { titulo: string; texto: string; aoFechar: () => void; aoConfirmar: () => Promise<void> }) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');
  async function confirmar() {
    setGravando(true);
    setErro('');
    try {
      await aoConfirmar();
    } catch (e) {
      setErro(erroDe(e, 'Não deu para esquecer.'));
      setGravando(false);
    }
  }
  return (
    <Dialogo
      alerta
      titulo={titulo}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar} disabled={gravando}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={() => void confirmar()} disabled={gravando}>
            {gravando ? 'Esquecendo…' : 'Esquecer'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">{texto}</p>
        {erro && (
          <p role="alert" className="font-medium">
            {erro}
          </p>
        )}
      </div>
    </Dialogo>
  );
}
