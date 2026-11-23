'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button, buttonVariants } from '@/components/ui/button';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import { SkeletonList } from '@/components/ui/skeleton';
import { Filtros, FiltroBusca, FiltroSelect, ListaDados, Selo, Situacoes, TituloLista, Vazio, semAcento, texto2, type Tom } from '@/components/ui/lista';

// MISTER › DOCUMENTOS (M3a parte 3; versão 3 do protótipo `mockups/regem-mister.html`, aprovada em 17/11/2026; só o
// presidente). Os boletos e as contas que chegaram por foto no WhatsApp do Mister: o que ele leu (e de onde veio cada
// campo: o código de barras, a leitura da foto, a conversa ou o cadastro), onde lançou e o que ainda falta. O servidor lê
// o período; a situação e a busca filtram aqui. "Desfazer o lançamento" é o mesmo caminho do botão da conversa.

type Origem = 'codigo' | 'ia' | 'pessoa' | null;
type Situacao = 'confirmar' | 'falta' | 'recusado' | 'lancado' | 'desfeito' | 'pago' | 'cancelado';
type Documento = {
  id: string;
  tipo: string;
  beneficiario: string | null;
  fornecedor: string | null;
  valorCentavos: number | null;
  vencimento: string | null;
  situacao: Situacao;
  motivo: string | null;
  origem: { valor: Origem; vencimento: Origem };
  linhaDigitavel: string | null;
  quem: string | null;
  telefoneFinal: string | null;
  criadoEm: string;
  respondidoEm: string | null;
  tituloId: string | null;
  podeDesfazer: boolean;
  /** Só da nota do fornecedor (M3b.3): cada item com o destino — a mesma linha do resumo da conversa. */
  nota: {
    numero: string | null;
    parcelas: number;
    noEstoque: number;
    itens: { descricao: string; quanto: string; destino: string; estado: 'ligado' | 'fora' | 'item' | 'fator' }[];
    recebimentoId: string | null;
    /** Versão 6, M6h (ausente num servidor antigo = nota): o cupom fiscal de compra e a resposta ao "Como deseja lançar?". */
    especie?: 'nota' | 'cupom';
    comoLancar?: 'despesa' | 'estoque' | null;
  } | null;
};
const ehCupom = (d: Documento) => d.tipo === 'nota' && d.nota?.especie === 'cupom';
type Resposta = { dias: number; limite: number; documentos: Documento[] };

const PERIODOS = [
  { v: '30', rotulo: 'Últimos 30 dias' },
  { v: '7', rotulo: 'Últimos 7 dias' },
  { v: '90', rotulo: 'Últimos 90 dias' },
];
const SITUACAO: Record<Situacao, { tom: Tom; rotulo: string }> = {
  lancado: { tom: 'ok', rotulo: 'lançado' },
  pago: { tom: 'neutro', rotulo: 'pago' },
  confirmar: { tom: 'info', rotulo: 'a conferir' },
  falta: { tom: 'aviso', rotulo: 'falta informação' },
  recusado: { tom: 'neutro', rotulo: 'não lançado' },
  desfeito: { tom: 'neutro', rotulo: 'desfeito' },
  cancelado: { tom: 'neutro', rotulo: 'conta cancelada na tela' },
};
const MOTIVO: Record<string, string> = {
  codigo_nao_confere: 'os números da linha não conferiram',
  ilegivel: 'a foto ficou tremida, cortada ou escura',
  leitura_fora_do_formato: 'a foto não deu para ler',
  nao_e_documento: 'não era boleto nem conta',
  nota: 'nota do fornecedor (a leitura de notas chega numa próxima entrega)',
  outra_foto: 'você pediu para mandar outra foto',
  conta: 'conta de consumo: o vencimento veio da foto',
  sem_codigo: 'sem o código de barras',
  fornecedor_novo: 'o beneficiário ainda não é seu fornecedor',
  modo: 'sua empresa pede para conferir antes',
  informado: 'completado com o que você disse na conversa',
  // A nota do fornecedor (M3b).
  itens_nao_somam: 'os itens lidos não somam o total da nota',
  duplicatas_nao_somam: 'as parcelas lidas não somam o total da nota',
  chave_de_outro_emitente: 'a chave de acesso não é do emitente da nota',
  sem_itens: 'não deu para ler os itens',
  // O cupom fiscal de compra (versão 6, M6h).
  como_lancar: 'esperando a resposta de "Como deseja lançar?" na conversa',
  nao_lancar: 'você respondeu "Não lançar"',
  sem_total: 'não deu para ler o total da nota',
  cancelado: 'você cancelou na conversa',
  item: 'esperando você dizer a que insumo vai um item',
  fator: 'esperando a conversão de unidade de um item',
  itens_ligados: 'cada item ligado a um insumo do estoque',
  // A dúvida da leitura (L2b): a pessoa responde na conversa ou manda outra foto.
  duvida: 'esperando você dizer o certo de uma linha que ficou em dúvida',
  total: 'esperando você dizer o total, que não deu para ler',
  soma: 'os itens lidos não somam o total: esperando a sua resposta na conversa',
  foto_nova: 'você mandou outra foto no lugar desta',
};
const ORIGEM: Record<Exclude<Origem, null>, string> = { codigo: 'código', ia: 'IA', pessoa: 'conversa' };

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const diaComSemana = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}, ${DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()]}`;
const quando = (iso: string) => {
  const d = new Date(iso);
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return `${dia} ${hora}`;
};
// O número da nota como no protótipo ("Nota 48.213"); o que não é só número fica como veio.
const numeroDaNota = (n: string | null | undefined) => (n && /^\d+$/.test(n) ? Number(n).toLocaleString('pt-BR') : (n ?? ''));
const nomeDoDocumento = (d: Documento) =>
  d.tipo === 'nota'
    ? `${ehCupom(d) ? 'Cupom' : 'Nota'}${d.nota?.numero ? ` ${numeroDaNota(d.nota.numero)}` : ''} · ${d.beneficiario ?? 'sem nome lido'}`
    : `${d.tipo === 'conta' ? 'Conta' : d.tipo === 'outro' ? 'Imagem' : 'Boleto'} · ${d.beneficiario ?? 'sem nome lido'}`;
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;
const comoFoiLido = (d: Documento) => {
  // A nota que espera a resposta de algum item: quantos ainda não foram ligados ao estoque (o protótipo).
  const pendentes = d.nota?.itens.filter((x) => x.estado === 'item' || x.estado === 'fator').length ?? 0;
  if (d.tipo === 'nota' && d.situacao === 'falta' && pendentes > 0) return `${plural(pendentes, 'item', 'itens')} sem ligação com o estoque`;
  // O motivo da nota vem como "item:2" ou "fator:1" (qual item espera a resposta): vale a parte antes dos dois-pontos.
  if (d.situacao === 'recusado' || d.situacao === 'falta') return d.motivo ? (MOTIVO[d.motivo.split(/[,:]/)[0]] ?? 'não deu para ler tudo') : 'não deu para ler tudo';
  if (d.tipo === 'nota') {
    if (d.situacao === 'confirmar') return 'esperando o "Lançar" na conversa';
    // M6h: o cupom — a despesa já paga, com ou sem a entrada no estoque.
    if (ehCupom(d) && d.nota) {
      return d.nota.comoLancar === 'estoque' ? `${plural(d.nota.noEstoque, 'item', 'itens')} no estoque e a despesa já paga` : 'a despesa já paga, sem mexer no estoque';
    }
    // "3 itens no estoque e a conta a pagar" (o protótipo); com parcelas, "e 2 contas a pagar".
    return d.nota
      ? `${plural(d.nota.noEstoque, 'item', 'itens')} no estoque e ${d.nota.parcelas > 1 ? `${d.nota.parcelas} contas` : 'a conta'} a pagar`
      : 'entrou em Estoque › Recebimento e nas contas a pagar';
  }
  if (d.origem.valor === 'pessoa' || d.origem.vencimento === 'pessoa') return 'valor ou vencimento ditos na conversa';
  if (d.origem.valor === 'codigo' && d.origem.vencimento === 'codigo') return 'lido pelo código de barras';
  if (d.origem.valor === 'codigo') return 'o valor pelo código de barras; o vencimento, da foto';
  return 'lido da foto';
};

export function DocumentosDoMister() {
  const [dias, setDias] = useState('30');
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState(false);
  const [busca, setBusca] = useState('');
  const [situacao, setSituacao] = useState(-1);
  const [aberto, setAberto] = useState<Documento | null>(null);

  const carregar = useCallback(async (d: string) => {
    setErro(false);
    setDados(null);
    try {
      setDados((await api.get(`/mister/documentos?dias=${d}`)) as Resposta);
    } catch {
      setErro(true);
    }
  }, []);
  useEffect(() => void carregar(dias), [dias, carregar]);

  const base = useMemo(() => {
    const t = semAcento(busca.trim());
    return (dados?.documentos ?? []).filter(
      (d) => !t || semAcento(`${d.beneficiario ?? ''} ${d.fornecedor ?? ''} ${d.linhaDigitavel ?? ''} ${d.nota?.numero ?? ''} ${numeroDaNota(d.nota?.numero)}`).includes(t),
    );
  }, [dados, busca]);
  const situacoes = [
    { rotulo: 'Lançados', filtro: (d: Documento) => d.situacao === 'lancado' },
    { rotulo: 'Falta informação', filtro: (d: Documento) => d.situacao === 'falta', tom: 'aviso' as const },
    { rotulo: 'A conferir', filtro: (d: Documento) => d.situacao === 'confirmar', tom: 'aviso' as const },
    { rotulo: 'Pagos', filtro: (d: Documento) => d.situacao === 'pago' },
    { rotulo: 'Não lançados', filtro: (d: Documento) => d.situacao === 'recusado' || d.situacao === 'desfeito' || d.situacao === 'cancelado' },
  ];
  const linhas = situacao < 0 ? base : base.filter(situacoes[situacao].filtro);
  const limpar = () => {
    setBusca('');
    setSituacao(-1);
  };

  if (erro)
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        Não consegui carregar os documentos agora.{' '}
        <Button variant="outline" className="ml-2" onClick={() => void carregar(dias)}>
          Tentar de novo
        </Button>
      </div>
    );

  return (
    <section className="space-y-4" aria-labelledby="documentos-mister">
      <TituloLista
        id="documentos-mister"
        titulo="Documentos lidos"
        total={dados?.documentos.length ?? 0}
        mostrando={linhas.length}
        um="documento"
        varios="documentos"
        extra={`${PERIODOS.find((p) => p.v === dias)?.rotulo.toLowerCase()} · mande a foto de um boleto para o Mister no WhatsApp`}
      />
      {!dados ? (
        <SkeletonList rows={3} />
      ) : (
        <>
          <Situacoes base={base} opcoes={situacoes} valor={situacao} aoMudar={setSituacao} />
          <Filtros emLinha>
            <FiltroBusca id="docs-busca" valor={busca} aoMudar={setBusca} placeholder="Buscar por fornecedor ou número" />
            <FiltroSelect id="docs-periodo" rotulo="Período" opcoes={PERIODOS} valor={dias} aoMudar={setDias} />
          </Filtros>
          {dados.documentos.length >= dados.limite && (
            <p className="text-sm text-muted-foreground" role="status">
              Mostrando os {dados.limite} documentos mais recentes do período. Escolha um período menor para ver os outros.
            </p>
          )}
          {dados.documentos.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">
              <span className="mb-1 block text-2xl" aria-hidden>
                📷
              </span>
              Nenhum documento ainda. Tire a foto de um boleto e mande para o Mister no WhatsApp.
            </p>
          ) : linhas.length === 0 ? (
            <Vazio aoLimpar={limpar}>Nenhum documento com esses filtros.</Vazio>
          ) : (
            <ListaDados
              legenda="Documentos lidos por foto, com valor, vencimento, situação e quem mandou"
              linhas={linhas}
              chave={(d) => d.id}
              nome={(d) => nomeDoDocumento(d)}
              colunas={[
                {
                  titulo: 'Documento',
                  celula: (d) => (
                    <span className="block">
                      <span className="font-semibold">{nomeDoDocumento(d)}</span>
                      <span className={`block text-xs ${texto2}`}>{comoFoiLido(d)}</span>
                    </span>
                  ),
                },
                {
                  titulo: 'Valor e vencimento',
                  celula: (d) =>
                    d.valorCentavos == null && !d.vencimento ? (
                      <span className="text-muted-foreground">não lido</span>
                    ) : (
                      <span className="block">
                        <span className="font-mono">{d.valorCentavos != null ? reais(d.valorCentavos) : '—'}</span>
                        {d.vencimento && <span className={`block text-xs ${texto2}`}>vence {diaComSemana(d.vencimento)}</span>}
                      </span>
                    ),
                },
                { titulo: 'Situação', celula: (d) => <Selo tom={SITUACAO[d.situacao].tom}>{SITUACAO[d.situacao].rotulo}</Selo> },
                { titulo: 'Mandou', celula: (d) => <span className="whitespace-nowrap font-mono">{`${d.quem ?? '—'} · ${quando(d.criadoEm)}`}</span> },
              ]}
              acoes={() => [{ rotulo: 'Ver', icone: Eye, aoClicar: (d: Documento) => setAberto(d) }]}
            />
          )}
          <p className="text-sm text-muted-foreground">
            O boleto vai para as contas a pagar; a nota do fornecedor vai para Estoque › Recebimento e para as contas a pagar; o cupom fiscal de uma compra entra como
            despesa já paga (e no estoque, se você pedir). Desfazer um lançamento por aqui vale até o boleto ser pago; no cupom lançado só como despesa, a qualquer
            momento.
          </p>
        </>
      )}
      {aberto && (
        <GavetaDoDocumento
          d={aberto}
          aoFechar={() => setAberto(null)}
          aoDesfazer={() => {
            setAberto(null);
            void carregar(dias);
          }}
        />
      )}
    </section>
  );
}

function Campo({ rotulo, valor, origem }: { rotulo: string; valor: React.ReactNode; origem?: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border py-2 text-sm last:border-b-0">
      <dt className={texto2}>{rotulo}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2 text-right">
        <span className="min-w-0 break-words">{valor}</span>
        {origem && <Selo tom="neutro">{origem}</Selo>}
      </dd>
    </div>
  );
}

function GavetaDoDocumento({ d, aoFechar, aoDesfazer }: { d: Documento; aoFechar: () => void; aoDesfazer: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [abrindoPdf, setAbrindoPdf] = useState(false);
  const [erroDoPdf, setErroDoPdf] = useState('');
  // O PDF (M3a parte 4b) é do boleto lançado: o lançado, o pago e o da conta cancelada na tela (o desfeito, não).
  const temPdf = d.tipo !== 'nota' && !!d.tituloId && (d.situacao === 'lancado' || d.situacao === 'pago' || d.situacao === 'cancelado');
  async function verPdf() {
    setAbrindoPdf(true);
    setErroDoPdf('');
    try {
      window.open(await api.misterDocumentoPdfUrl(d.id), '_blank');
    } catch (e) {
      setErroDoPdf(e instanceof Error ? e.message : 'Não consegui abrir o PDF agora.');
    } finally {
      setAbrindoPdf(false);
    }
  }
  return (
    <Gaveta
      titulo={nomeDoDocumento(d)}
      aoFechar={aoFechar}
      rodape={
        <>
          {d.podeDesfazer && (
            <Button type="button" variant="outline" onClick={() => setConfirmando(true)}>
              Desfazer o lançamento
            </Button>
          )}
          {temPdf && (
            <Button type="button" variant="outline" onClick={() => void verPdf()} disabled={abrindoPdf}>
              {abrindoPdf ? 'Abrindo o PDF…' : 'Ver o PDF'}
            </Button>
          )}
          {d.nota?.recebimentoId && (
            <Link href="/operacao?aba=recebimento" className={buttonVariants({ variant: 'outline' })}>
              Ver no Recebimento
            </Link>
          )}
          {d.tituloId && (
            <Link href="/financeiro" className={buttonVariants({ variant: 'outline' })}>
              Ver nas contas a pagar
            </Link>
          )}
          <Button type="button" onClick={aoFechar}>
            Fechar
          </Button>
        </>
      }
    >
      <p className="flex flex-wrap items-center gap-2">
        <Selo tom={SITUACAO[d.situacao].tom}>{SITUACAO[d.situacao].rotulo}</Selo>
        <span className={`text-sm ${texto2}`}>{comoFoiLido(d)}</span>
      </p>
      {erroDoPdf && (
        <p role="alert" className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          {erroDoPdf}
        </p>
      )}
      <dl className="mt-3">
        <Campo rotulo={d.nota ? 'Total da nota' : 'Valor'} valor={d.valorCentavos != null ? <span className="font-mono">{reais(d.valorCentavos)}</span> : 'não lido'} origem={d.origem.valor ? ORIGEM[d.origem.valor] : null} />
        <Campo
          rotulo={d.nota && d.nota.parcelas > 1 ? '1ª parcela' : 'Vencimento'}
          valor={d.vencimento ? diaComSemana(d.vencimento) : d.nota ? 'sem vencimento na nota' : 'não lido'}
          origem={d.origem.vencimento ? ORIGEM[d.origem.vencimento] : null}
        />
        {d.nota && d.nota.parcelas > 1 && <Campo rotulo="Parcelas" valor={<span className="font-mono">{d.nota.parcelas}</span>} />}
        <Campo rotulo={d.nota ? 'Emitente' : 'Beneficiário'} valor={d.beneficiario ?? 'não lido'} origem={d.beneficiario ? 'IA' : null} />
        <Campo rotulo="Fornecedor" valor={d.fornecedor ?? 'não cadastrado'} origem={d.fornecedor ? 'cadastro' : null} />
        {d.linhaDigitavel && <Campo rotulo="Linha digitável" valor={<span className="font-mono text-xs">{d.linhaDigitavel}</span>} />}
      </dl>
      {d.nota && d.nota.itens.length > 0 && (
        <>
          <h4 className="mt-4 font-display font-semibold">Itens da nota</h4>
          <ul className="mt-2 text-sm" aria-label="Itens da nota e para onde vai cada um">
            {d.nota.itens.map((it, i) => (
              <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border py-2 last:border-b-0">
                <span className="min-w-0 break-words">
                  {it.descricao} <span className={`font-mono text-xs ${texto2}`}>{it.quanto}</span>
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-2 break-words text-right">
                  <span aria-hidden>→</span>
                  <span className={it.estado === 'fora' ? texto2 : ''}>{it.destino}</span>
                  {(it.estado === 'item' || it.estado === 'fator') && <Selo tom="aviso">falta</Selo>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <h4 className="mt-4 font-display font-semibold">O que aconteceu</h4>
      <ol className="mt-2 space-y-2 border-l-2 border-border pl-4 text-sm">
        <li>
          <span className="font-mono font-semibold">{quando(d.criadoEm)}</span> · {d.quem ?? 'Alguém'} mandou a foto pelo WhatsApp
          {d.telefoneFinal ? ` (final ${d.telefoneFinal})` : ''}
        </li>
        {d.motivo && (
          <li>
            {d.situacao === 'lancado' || d.situacao === 'pago' || d.situacao === 'desfeito' || d.situacao === 'cancelado' ? 'Antes de lançar: ' : ''}
            {MOTIVO[d.motivo.split(/[,:]/)[0]] ??
              (d.motivo === 'sozinho' ? 'o código conferiu e o fornecedor já é cadastrado' : d.motivo)}
          </li>
        )}
        {d.respondidoEm && (
          <li>
            <span className="font-mono font-semibold">{quando(d.respondidoEm)}</span> ·{' '}
            {d.situacao === 'desfeito'
              ? 'lançamento desfeito'
              : d.situacao === 'recusado'
                ? 'fechado sem lançar'
                : ehCupom(d)
                  ? d.nota?.comoLancar === 'estoque'
                    ? 'lançado em Estoque › Recebimento e nas contas a pagar, já pago'
                    : 'lançado nas contas a pagar, já pago'
                  : d.tipo === 'nota'
                    ? 'lançada em Estoque › Recebimento e nas contas a pagar'
                    : 'lançado nas contas a pagar'}
          </li>
        )}
      </ol>
      <p className="mt-4 text-xs text-muted-foreground">
        &quot;código&quot; = lido do código de barras, sem IA; &quot;IA&quot; = lido da foto; &quot;conversa&quot; = você disse ao Mister; &quot;cadastro&quot; = do
        cadastro do Regem. A foto não fica guardada.
      </p>
      {confirmando && <DialogoDesfazer d={d} aoFechar={() => setConfirmando(false)} aoDesfazer={aoDesfazer} />}
    </Gaveta>
  );
}

function DialogoDesfazer({ d, aoFechar, aoDesfazer }: { d: Documento; aoFechar: () => void; aoDesfazer: () => void }) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');
  async function confirmar() {
    setGravando(true);
    setErro('');
    try {
      await api.post(`/mister/documentos/${d.id}/desfazer`, {});
      toast.success('Lançamento desfeito: a conta saiu das contas a pagar.');
      aoDesfazer();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para desfazer.');
      setGravando(false);
    }
  }
  return (
    <Dialogo
      alerta
      titulo="Desfazer o lançamento?"
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar} disabled={gravando}>
            Cancelar
          </Button>
          <Button type="button" variant="destructive" onClick={() => void confirmar()} disabled={gravando}>
            {gravando ? 'Desfazendo…' : 'Desfazer'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">
          {ehCupom(d) ? (
            // M6h: o cupom do "Só despesa" — `desfazerCupom` estorna o pagamento e cancela a conta.
            <>
              A despesa de {d.valorCentavos != null ? reais(d.valorCentavos) : 'valor não lido'} ({d.beneficiario ?? 'sem nome'}) tem o pagamento estornado e sai das
              contas a pagar. O estoque não muda.
            </>
          ) : (
            <>
              A conta a pagar de {d.valorCentavos != null ? reais(d.valorCentavos) : 'valor não lido'} ({d.beneficiario ?? 'sem nome'}) é cancelada e sai das contas a
              pagar. Só dá enquanto ela não foi paga.
            </>
          )}
        </p>
        {erro && (
          <p role="alert" className="font-medium">
            {erro}
          </p>
        )}
      </div>
    </Dialogo>
  );
}
