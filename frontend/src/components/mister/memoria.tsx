'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import { Filtros, FiltroBusca, FiltroSelect, ListaDados, NomeComApoio, Situacoes, TituloLista, Vazio, semAcento, texto2 } from '@/components/ui/lista';

// MISTER › "JEITO E MEMÓRIA" › "O QUE O MISTER SABE" (versão 4, fase M4b, mig 449; protótipo
// `mockups/regem-mister-jeito-memoria.html`, aprovado pelo dono em 18/11/2026). A memória curta do Mister — o padrão
// MEMORY.md/USER.md do Hermes, com os mesmos limites (2.200 letras da empresa, 1.375 de cada pessoa): o que ele anotou nas
// conversas e o que o presidente escreveu aqui. Lista no modelo do Estoque (título com a contagem, "Da empresa" e "De cada
// pessoa" com a quantidade, busca, origem), "Anotar" e "Mudar" em gaveta, "Esquecer" em diálogo. Quem confere o texto
// (número, dado de cliente, senha, link) e o limite é o SERVIDOR — a recusa volta com a frase e aparece no campo.

type Item = { id: string; colaboradorId: string | null; texto: string; origem: 'conversa' | 'presidente'; criadoEm: string; anotadoPor?: string | null };
type Pessoa = { colaboradorId: string; nome: string; itens: Item[]; letras: number };
type Resposta = {
  disponivel: boolean;
  limites: { empresa: number; pessoa: number };
  empresa: { itens: Item[]; letras: number };
  pessoas: Pessoa[];
  pessoasLigadas: { id: string; nome: string }[];
};
/** Uma linha da lista: a anotação com o dono (a empresa ou a pessoa). */
type Linha = Item & { nomeDaPessoa: string | null };

/** O texto de uma anotação cabe nisto (a mesma conta do servidor e da mig 449). */
export const MEMORIA_TEXTO_MAX = 300;
const ORIGENS = [
  { v: 'conversa', rotulo: 'Anotado na conversa' },
  { v: 'presidente', rotulo: 'Escrito por você' },
];

const milhar = (n: number) => n.toLocaleString('pt-BR');
const quando = (iso: string) => {
  const d = new Date(iso);
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return `${dia} ${hora}`;
};
/** De onde veio, como o protótipo escreve: "Anotado na conversa com Ana" / "Escrito por você". */
const deOndeVeio = (l: Linha) => {
  if (l.origem === 'presidente') return 'Escrito por você';
  const primeiro = (l.anotadoPor ?? '').trim().split(/\s+/)[0];
  return primeiro ? `Anotado na conversa com ${primeiro}` : 'Anotado na conversa';
};

export function MemoriaDoMister() {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [busca, setBusca] = useState('');
  const [origem, setOrigem] = useState('');
  // -1 = "Da empresa" (a primeira ficha); 0 = "De cada pessoa".
  const [quem, setQuem] = useState(-1);
  const [gaveta, setGaveta] = useState<{ item: Linha | null } | null>(null);
  const [esquecendo, setEsquecendo] = useState<Linha | null>(null);

  const ler = useCallback(async () => {
    setFalhou(false);
    try {
      const r = (await api.get('/mister/memoria')) as Partial<Resposta> | null;
      // Resposta sem a forma esperada (servidor antigo, sem a mig 449): a mesma frase de "ainda não está disponível".
      setDados(
        r?.disponivel && r.empresa && r.limites
          ? { disponivel: true, limites: r.limites, empresa: r.empresa, pessoas: r.pessoas ?? [], pessoasLigadas: r.pessoasLigadas ?? [] }
          : { disponivel: false, limites: { empresa: 2200, pessoa: 1375 }, empresa: { itens: [], letras: 0 }, pessoas: [], pessoasLigadas: [] },
      );
    } catch {
      setFalhou(true);
    }
  }, []);
  useEffect(() => {
    void ler();
  }, [ler]);

  const todas: Linha[] = useMemo(
    () => [
      ...(dados?.empresa.itens ?? []).map((i) => ({ ...i, nomeDaPessoa: null })),
      ...(dados?.pessoas ?? []).flatMap((p) => p.itens.map((i) => ({ ...i, nomeDaPessoa: p.nome }))),
    ],
    [dados],
  );
  const base = useMemo(() => {
    const t = semAcento(busca.trim());
    return todas.filter((l) => (!origem || l.origem === origem) && (!t || semAcento(`${l.texto} ${l.nomeDaPessoa ?? ''}`).includes(t)));
  }, [todas, busca, origem]);
  const daEmpresa = (l: Linha) => !l.colaboradorId;
  const dePessoa = (l: Linha) => !!l.colaboradorId;
  const linhas = base.filter(quem < 0 ? daEmpresa : dePessoa);
  const limpar = () => {
    setBusca('');
    setOrigem('');
  };
  const salvo = () => {
    setGaveta(null);
    setEsquecendo(null);
    void ler();
  };

  if (falhou)
    return (
      <Card className="p-6 text-center" role="alert">
        <p className="font-semibold">Não deu para ler o que o Mister sabe agora.</p>
        <Button className="mt-3" variant="outline" onClick={() => void ler()}>
          Tentar de novo
        </Button>
      </Card>
    );

  return (
    <section className="space-y-4" aria-labelledby="mister-sabe">
      <TituloLista
        id="mister-sabe"
        titulo="O que o Mister sabe"
        total={todas.length}
        mostrando={base.length}
        um="anotação"
        varios="anotações"
        extra="vale da próxima conversa em diante"
      >
        {dados?.disponivel && (
          <Button type="button" onClick={() => setGaveta({ item: null })}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Anotar
          </Button>
        )}
      </TituloLista>
      <p className={`max-w-[72ch] text-sm ${texto2}`}>
        O que ele anotou nas conversas — quando alguém pede &quot;lembra que…&quot; ou corrige o jeito dele — e o que você escreveu aqui. Ele nunca guarda número
        (venda, valor, estoque — número vem sempre da consulta), dado de cliente, senha, código ou PIN: o Regem recusa na hora.
      </p>
      {!dados ? (
        <SkeletonList rows={3} />
      ) : !dados.disponivel ? (
        <Card className={`p-6 text-center text-sm ${texto2}`} role="status">
          A memória do Mister ainda não está disponível nesta instalação.
        </Card>
      ) : (
        <>
          <Situacoes base={base} todas={{ rotulo: 'Da empresa', filtro: daEmpresa }} opcoes={[{ rotulo: 'De cada pessoa', filtro: dePessoa }]} valor={quem} aoMudar={setQuem} />
          <Medidor dados={dados} quem={quem} />
          <Filtros emLinha>
            <FiltroBusca id="memoria-busca" valor={busca} aoMudar={setBusca} placeholder="Buscar no que ele sabe" />
            <FiltroSelect id="memoria-origem" rotulo="De onde veio" todos="Todas as origens" opcoes={ORIGENS} valor={origem} aoMudar={setOrigem} />
          </Filtros>
          {todas.length === 0 ? (
            <Card className={`space-y-1 p-6 text-center text-sm ${texto2}`}>
              <p className="font-semibold text-foreground">O Mister ainda não anotou nada.</p>
              <p>Ele anota o que vocês pedirem para lembrar (&quot;lembra que o pico é às 20h&quot;) e o jeito de cada um. Você também pode escrever aqui, em &quot;Anotar&quot;.</p>
            </Card>
          ) : linhas.length === 0 ? (
            busca || origem ? (
              <Vazio aoLimpar={limpar} />
            ) : (
              <Vazio>{quem < 0 ? 'Nada anotado da empresa ainda.' : 'Nada anotado de nenhuma pessoa ainda.'}</Vazio>
            )
          ) : (
            <ListaDados
              legenda="O que o Mister sabe, com de onde veio e quando"
              linhas={linhas}
              chave={(l) => l.id}
              nome={(l) => l.texto}
              colunas={[
                {
                  titulo: 'Anotação',
                  celula: (l) => <NomeComApoio nome={<span className="font-normal">{l.texto}</span>} apoio={l.nomeDaPessoa ? `De ${l.nomeDaPessoa}` : undefined} />,
                },
                { titulo: 'De onde veio', celula: (l) => <span>{deOndeVeio(l)}</span> },
                { titulo: 'Quando', celula: (l) => <span className="whitespace-nowrap font-mono">{quando(l.criadoEm)}</span> },
              ]}
              acoes={() => [
                { rotulo: 'Mudar', icone: Pencil, aoClicar: (l: Linha) => setGaveta({ item: l }) },
                { rotulo: 'Esquecer', icone: Trash2, tom: 'perigo', aoClicar: (l: Linha) => setEsquecendo(l) },
              ]}
            />
          )}
        </>
      )}
      {gaveta && dados && <GavetaDaAnotacao dados={dados} item={gaveta.item} aoFechar={() => setGaveta(null)} aoSalvar={salvo} />}
      {esquecendo && <DialogoEsquecer item={esquecendo} aoFechar={() => setEsquecendo(null)} aoEsquecer={salvo} />}
    </section>
  );
}

/** Quanto da memória está cheio: a da empresa com a barra; a de cada pessoa, uma conta por pessoa. */
function Medidor({ dados, quem }: { dados: Resposta; quem: number }) {
  if (quem < 0) {
    const pct = Math.min(100, Math.round((dados.empresa.letras / dados.limites.empresa) * 100));
    return (
      <div className="grid max-w-[520px] gap-1">
        <div className="h-2 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
          <span className={`block h-full ${pct >= 90 ? 'bg-warn' : 'bg-ok'}`} style={{ width: `${pct}%` }} />
        </div>
        <p className={`text-sm ${texto2}`}>
          {milhar(dados.empresa.letras)} de {milhar(dados.limites.empresa)} letras usadas. Cheio, o Mister junta as anotações parecidas ou pede para esquecer uma.
        </p>
      </div>
    );
  }
  if (!dados.pessoas.length) return null;
  return (
    <p className={`text-sm ${texto2}`}>
      {dados.pessoas.map((p) => `${p.nome}: ${milhar(p.letras)} de ${milhar(dados.limites.pessoa)} letras`).join(' · ')}.
    </p>
  );
}

/** Anotar (item null) ou mudar uma anotação. O servidor confere o texto e o limite; a recusa aparece no campo. */
function GavetaDaAnotacao({ dados, item, aoFechar, aoSalvar }: { dados: Resposta; item: Linha | null; aoFechar: () => void; aoSalvar: () => void }) {
  const [sobre, setSobre] = useState('empresa');
  const [texto, setTexto] = useState(item?.texto ?? '');
  const [erro, setErro] = useState('');
  const [gravando, setGravando] = useState(false);
  const deQuem = item ? (item.colaboradorId ?? 'empresa') : sobre;
  const pessoa = deQuem === 'empresa' ? null : dados.pessoas.find((p) => p.colaboradorId === deQuem);
  const nomeDaPessoa = deQuem === 'empresa' ? null : (pessoa?.nome ?? dados.pessoasLigadas.find((p) => p.id === deQuem)?.nome ?? item?.nomeDaPessoa ?? 'esta pessoa');
  const limite = deQuem === 'empresa' ? dados.limites.empresa : dados.limites.pessoa;
  const usadas = (deQuem === 'empresa' ? dados.empresa.letras : (pessoa?.letras ?? 0)) - (item?.texto.length ?? 0);
  const cabem = Math.max(0, limite - usadas);
  const limpo = texto.replace(/\s+/g, ' ').trim();

  async function salvar() {
    if (!limpo) {
      setErro('Escreva o que o Mister deve lembrar.');
      return;
    }
    setGravando(true);
    setErro('');
    try {
      if (item) await api.patch(`/mister/memoria/${item.id}`, { texto: limpo });
      else await api.post('/mister/memoria', { sobre, texto: limpo });
      toast.success(item ? 'Anotação mudada. Vale da próxima conversa em diante.' : 'Anotado. Vale da próxima conversa em diante.');
      aoSalvar();
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : 'Não deu para salvar agora. Tente de novo.');
      setGravando(false);
    }
  }

  return (
    <Gaveta
      titulo={item ? 'Mudar a anotação' : 'Anotar'}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={gravando}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void salvar()} disabled={gravando || !limpo}>
            {gravando ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {item ? (
          <p className="text-sm">
            <span className={texto2}>Sobre: </span>
            <span className="font-semibold">{nomeDaPessoa ?? 'a empresa (vale para todos)'}</span>
          </p>
        ) : (
          <div className="space-y-1">
            <Label htmlFor="memoria-sobre">Sobre</Label>
            <Select id="memoria-sobre" value={sobre} onChange={(e) => setSobre(e.target.value)} aria-describedby="memoria-sobre-ajuda">
              <option value="empresa">A empresa (vale para todos)</option>
              {dados.pessoasLigadas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Select>
            <p id="memoria-sobre-ajuda" className={`text-xs ${texto2}`}>
              Da empresa: entra em toda conversa. De uma pessoa: só na conversa dela (aparecem as que ligaram o WhatsApp ao Mister).
            </p>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="memoria-texto">O que o Mister deve lembrar</Label>
          <textarea
            id="memoria-texto"
            rows={4}
            maxLength={MEMORIA_TEXTO_MAX}
            value={texto}
            onChange={(e) => {
              setErro('');
              setTexto(e.target.value);
            }}
            aria-invalid={erro ? true : undefined}
            aria-describedby={erro ? 'memoria-texto-ajuda memoria-texto-erro' : 'memoria-texto-ajuda'}
            placeholder="Ex.: O fornecedor da carne entrega às terças e sextas, até as 11h."
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p id="memoria-texto-ajuda" className={`flex flex-wrap justify-between gap-x-3 text-xs ${texto2}`}>
            <span>Uma frase. Contexto e preferência — nunca número, dado de cliente, senha ou código.</span>
            <span className="font-mono">
              {texto.length} de {MEMORIA_TEXTO_MAX}
            </span>
          </p>
          {erro && (
            <p id="memoria-texto-erro" role="alert" className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2 text-sm font-medium">
              {erro}
            </p>
          )}
        </div>
        <p className={`text-sm ${texto2}`}>
          Ainda cabem {milhar(cabem)} letras {nomeDaPessoa ? `de ${nomeDaPessoa}` : 'da empresa'}.
        </p>
      </div>
    </Gaveta>
  );
}

function DialogoEsquecer({ item, aoFechar, aoEsquecer }: { item: Linha; aoFechar: () => void; aoEsquecer: () => void }) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');
  async function confirmar() {
    setGravando(true);
    setErro('');
    try {
      await api.del(`/mister/memoria/${item.id}`);
      toast.success('Esquecido. O Mister deixa de usar isso a partir da próxima conversa.');
      aoEsquecer();
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : '';
      // Já esquecida (outra aba, ou pela conversa): a lista se atualiza, sem erro a resolver.
      if (msg === 'Essa anotação não existe mais.') {
        toast.success('Essa anotação já tinha sido esquecida.');
        aoEsquecer();
        return;
      }
      setErro(msg || 'Não deu para esquecer agora. Tente de novo.');
      setGravando(false);
    }
  }
  return (
    <Dialogo
      alerta
      titulo="Esquecer esta anotação?"
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
        <p className="rounded-md bg-secondary px-3 py-2">&quot;{item.texto}&quot;</p>
        <p>O Mister deixa de usar isto a partir da próxima conversa. Não dá para desfazer; se precisar, é só anotar de novo.</p>
        {erro && (
          <p role="alert" className="font-medium">
            {erro}
          </p>
        )}
      </div>
    </Dialogo>
  );
}
