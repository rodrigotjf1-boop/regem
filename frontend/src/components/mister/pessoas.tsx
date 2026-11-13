'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Selo, texto2 } from '@/components/ui/lista';
import { ResponsiveTable, type Column } from '@/components/ui/responsive-table';
import { SkeletonList } from '@/components/ui/skeleton';
import { Dialogo } from '@/components/ui/sobreposto';

// MISTER › PESSOAS (protótipo `mockups/regem-mister.html`, aprovado em 13/11/2026; rotas da mig 417).
// Quem fala com o Mister: presidente e gerentes. Cada um liga o PRÓPRIO WhatsApp, pelo celular dele — o código sai aqui
// para quem está logado e a ligação acontece quando a mensagem chega ao número do Mister. O presidente vê todos e pode
// desligar o de outra pessoa; o gerente recebe só a própria linha (o servidor nem manda as outras).
// O que cada gerente pode fica pela hierarquia até existir o perfil de permissões: por isso não há "Editar o que pode".

type Pessoa = {
  colaboradorId: string;
  nome: string;
  nivel: 'presidente' | 'gerente';
  loja: string | null;
  voce: boolean;
  ligado: boolean;
  final: string | null;
  ligadoEm: string | null;
  pausado: boolean;
  pode: Array<'avisos' | 'consulta' | 'autorizacao'>;
};
type Lista = { disponivel: boolean; numeroDoMister: string | null; souPresidente: boolean; total: number; pessoas: Pessoa[] };
type Meu = {
  disponivel: boolean;
  ligado: boolean;
  final: string | null;
  ligadoEm: string | null;
  codigo: { codigo: string; mensagem: string; link: string | null; expiraEm: string } | null;
};

const mensagem = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);
const PODE: Record<Pessoa['pode'][number], string> = { avisos: 'Avisos', consulta: 'Consulta', autorizacao: 'Autorização' };
const diaMes = (ts: string | null) => (ts ? new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '');
const horaMin = (ts: string) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** "5521900000000" → "+55 21 90000-0000". Número de outro país fica com o "+" e os dígitos. */
function telefoneBonito(digitos: string | null): string {
  const d = String(digitos ?? '').replace(/\D/g, '');
  const m = /^55(\d{2})(\d{4,5})(\d{4})$/.exec(d);
  return m ? `+55 ${m[1]} ${m[2]}-${m[3]}` : d ? `+${d}` : '';
}

const papel = (p: Pessoa) => (p.nivel === 'presidente' ? 'presidente · todas as lojas' : p.loja ? `gerente · ${p.loja}` : 'gerente');

export function PessoasDoMister() {
  const [lista, setLista] = useState<Lista | null>(null);
  const [erro, setErro] = useState('');
  const [ligando, setLigando] = useState(false);
  const [desligando, setDesligando] = useState<Pessoa | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const ler = useCallback(async () => {
    setErro('');
    try {
      setLista((await api.get('/mister/pessoas')) as Lista);
    } catch (e) {
      setLista(null);
      setErro(mensagem(e, 'Não consegui carregar as pessoas agora.'));
    }
  }, []);

  useEffect(() => {
    void ler();
  }, [ler]);

  async function desligar(p: Pessoa) {
    setOcupado(true);
    try {
      await api.del(`/mister/pessoas/${p.colaboradorId}`);
      toast.success('WhatsApp desligado.');
      setDesligando(null);
      await ler();
    } catch (e) {
      toast.error(mensagem(e, 'Não deu para desligar agora.'));
    } finally {
      setOcupado(false);
    }
  }

  const eu = lista?.pessoas.find((p) => p.voce) ?? null;
  const colunas: Column<Pessoa>[] = [
    {
      key: 'nome',
      header: 'Pessoa',
      hideOnCard: true,
      render: (p) => (
        <div className="min-w-0">
          <p className="break-words font-semibold">
            {p.nome}
            {p.voce && <span className="font-normal"> (você)</span>}
          </p>
          <p className={`text-xs ${texto2}`}>{papel(p)}</p>
        </div>
      ),
    },
    {
      key: 'whatsapp',
      header: 'WhatsApp',
      render: (p) =>
        !p.ligado ? (
          <div>
            <Selo tom="neutro">não ligado</Selo>
            {!p.voce && <p className={`mt-1 text-xs ${texto2}`}>Só a própria pessoa liga, entrando com o usuário dela.</p>}
          </div>
        ) : (
          <div>
            <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
              <Selo tom={p.pausado ? 'aviso' : 'ok'}>{p.pausado ? 'avisos parados' : 'ligado'}</Selo>
              <span>
                final <span className="font-mono">{p.final}</span>
                {p.ligadoEm && <> · desde {diaMes(p.ligadoEm)}</>}
              </span>
            </span>
            {p.pausado && <p className={`mt-1 text-xs ${texto2}`}>Respondeu PARAR AVISOS. Para voltar, responde VOLTAR AVISOS.</p>}
          </div>
        ),
    },
    { key: 'pode', header: 'O que pode', render: (p) => p.pode.map((x) => PODE[x]).join(' · ') },
  ];

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h2 className="font-display text-base font-bold">Quem fala com o Mister</h2>
        <p className={`mt-1 max-w-3xl text-sm ${texto2}`}>
          {lista && !lista.souPresidente
            ? 'Ligue o seu WhatsApp pelo seu celular: é por ele que o Mister sabe que é você. Você fala da sua loja.'
            : 'Presidente e gerentes. Cada um liga o próprio WhatsApp, pelo celular dele: ninguém liga o número de outra pessoa. Gerente só fala da loja dele.'}
        </p>

        {erro && (
          <EmptyState
            className="mt-4"
            icon="⚠️"
            title="Não consegui carregar as pessoas agora."
            description={erro}
            action={
              <Button type="button" variant="outline" onClick={() => void ler()}>
                Tentar de novo
              </Button>
            }
          />
        )}
        {!erro && !lista && <SkeletonList rows={2} className="mt-4" />}

        {lista && (
          <>
            {lista.disponivel && lista.numeroDoMister ? (
              <p className="mt-4 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-sm" role="note">
                O número do Mister é <strong className="whitespace-nowrap font-mono">{telefoneBonito(lista.numeroDoMister)}</strong>. Salve nos seus contatos como &quot;Mister&quot;.
              </p>
            ) : (
              <p className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm" role="status">
                O Mister ainda não está disponível pelo WhatsApp: a Regem está preparando o número. Até lá não dá para ligar.
              </p>
            )}

            {lista.pessoas.length === 0 ? (
              <EmptyState className="mt-4" icon="👥" title="Nenhum gerente ou presidente com acesso nesta empresa." />
            ) : (
              <div className="mt-4">
                <ResponsiveTable
                  caption="Pessoas que podem falar com o Mister, a situação do WhatsApp de cada uma e o que cada uma pode"
                  columns={colunas}
                  rows={lista.pessoas}
                  rowKey={(p) => p.colaboradorId}
                  cardTitle={(p) => (
                    <span>
                      <span className="break-words font-semibold">
                        {p.nome}
                        {p.voce && <span className="font-normal"> (você)</span>}
                      </span>
                      <span className={`block text-xs font-normal ${texto2}`}>{papel(p)}</span>
                    </span>
                  )}
                  actions={(p) =>
                    p.voce && !p.ligado ? (
                      <Button type="button" onClick={() => setLigando(true)} disabled={!lista.disponivel}>
                        Ligar o meu WhatsApp
                      </Button>
                    ) : p.ligado && (p.voce || lista.souPresidente) ? (
                      <Button type="button" variant="outline" onClick={() => setDesligando(p)}>
                        Desligar
                      </Button>
                    ) : null
                  }
                />
                {lista.total > lista.pessoas.length && (
                  <p className={`mt-2 text-xs ${texto2}`} role="status">
                    Mostrando {lista.pessoas.length} de {lista.total} pessoas.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </Card>
      <p className={`max-w-3xl text-xs ${texto2}`}>
        Sempre vale: o Mister só reconhece o número ligado, de quem ainda é gerente ou presidente · quem sai da empresa deixa de ser reconhecido na hora · um número liga uma pessoa só · PARAR
        AVISOS no WhatsApp para os avisos, VOLTAR AVISOS religa.
      </p>

      {ligando && (
        <DialogoDeLigar
          desdeAntes={eu?.ligadoEm ?? null}
          aoFechar={() => {
            setLigando(false);
            void ler();
          }}
          aoLigar={() => void ler()}
        />
      )}

      {desligando && (
        <Dialogo
          titulo={desligando.voce ? 'Desligar o meu WhatsApp' : `Desligar o WhatsApp de ${desligando.nome}`}
          aoFechar={() => setDesligando(null)}
          alerta
          fecharNoFundo={false}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setDesligando(null)} disabled={ocupado}>
                Cancelar
              </Button>
              <Button type="button" variant="destructive" onClick={() => void desligar(desligando)} disabled={ocupado}>
                {ocupado ? 'Desligando…' : 'Desligar'}
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {desligando.voce
              ? 'O Mister deixa de reconhecer o seu WhatsApp na hora. Para voltar, ligue de novo pelo seu celular.'
              : 'O Mister deixa de reconhecer o WhatsApp desta pessoa na hora. Para voltar, a própria pessoa liga de novo, pelo celular dela.'}
          </p>
        </Dialogo>
      )}
    </div>
  );
}

/**
 * O código para ligar o próprio WhatsApp ao Mister: o QR e o link abrem o WhatsApp do celular com "MISTER 123456"
 * pronto para o número do Mister. A tela espera a mensagem (lê a própria situação a cada 3 s, só enquanto o diálogo
 * está aberto e o código vale) até aparecer ligado com outro "desde" — o relógio é o do servidor.
 */
function DialogoDeLigar({ desdeAntes, aoFechar, aoLigar }: { desdeAntes: string | null; aoFechar: () => void; aoLigar: () => void }) {
  const [codigo, setCodigo] = useState<NonNullable<Meu['codigo']> | null>(null);
  const [qr, setQr] = useState('');
  const [erro, setErro] = useState('');
  const [venceu, setVenceu] = useState(false);
  const [ligado, setLigado] = useState<string | null>(null); // o final do número que ligou
  // O aviso de "ligou" por referência: a espera não recomeça a cada desenho de quem abriu o diálogo.
  const aoLigarAgora = useRef(aoLigar);
  aoLigarAgora.current = aoLigar;

  const gerar = useCallback(async () => {
    setErro('');
    setVenceu(false);
    setCodigo(null);
    setQr('');
    try {
      const r = (await api.post('/mister/whatsapp/codigo', {})) as Meu;
      if (!r.codigo) throw new Error('Não deu para gerar o código agora. Tente de novo.');
      setCodigo(r.codigo);
      if (r.codigo.link)
        QRCode.toDataURL(r.codigo.link, { width: 220, margin: 1 })
          .then(setQr)
          .catch(() => setQr(''));
    } catch (e) {
      setErro(mensagem(e, 'Não deu para gerar o código agora. Tente de novo.'));
    }
  }, []);

  useEffect(() => {
    void gerar();
  }, [gerar]);

  useEffect(() => {
    if (!codigo || venceu || ligado) return;
    let vivo = true;
    const t = setInterval(() => {
      if (Date.now() > new Date(codigo.expiraEm).getTime()) {
        setVenceu(true);
        return;
      }
      (api.get('/mister/whatsapp') as Promise<Meu>)
        .then((m) => {
          if (vivo && m.ligado && m.ligadoEm !== desdeAntes) {
            setLigado(m.final ?? '');
            aoLigarAgora.current();
          }
        })
        .catch(() => undefined); // sem rede agora: tenta na próxima
    }, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [codigo, venceu, ligado, desdeAntes]);

  return (
    <Dialogo
      titulo="Ligar o meu WhatsApp ao Mister"
      fecharNoFundo={false}
      aoFechar={aoFechar}
      rodape={
        <Button type="button" variant="outline" onClick={aoFechar}>
          Fechar
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          Faça no <strong>seu</strong> celular: o número que mandar a mensagem fica ligado a você.
        </p>
        {ligado !== null ? (
          <p className="rounded-lg border border-ok/40 bg-ok/10 px-3 py-2" role="status">
            <strong>Ligado.</strong> {ligado && <>Final <span className="font-mono">{ligado}</span>. </>}O Mister já respondeu no seu WhatsApp.
          </p>
        ) : erro ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2" role="alert">
            <span className="min-w-0 flex-1">{erro}</span>
            <Button type="button" variant="outline" onClick={() => void gerar()}>
              Tentar de novo
            </Button>
          </div>
        ) : !codigo ? (
          <p className={texto2} role="status">
            Gerando o código…
          </p>
        ) : venceu ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2" role="status">
            <span className="min-w-0 flex-1">O código venceu. Gere outro para ligar.</span>
            <Button type="button" onClick={() => void gerar()}>
              Gerar outro código
            </Button>
          </div>
        ) : (
          <>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                Aponte a câmera do celular para o código abaixo.
                {codigo.link && (
                  <>
                    {' '}
                    Ou, no celular,{' '}
                    <a href={codigo.link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center font-semibold underline">
                      abra o WhatsApp por este link
                    </a>
                    .
                  </>
                )}
              </li>
              <li>
                O WhatsApp abre com a mensagem <strong className="whitespace-nowrap font-mono">{codigo.mensagem}</strong> para o número do Mister. Toque em enviar.
              </li>
              <li>Pronto: o Mister responde no seu WhatsApp e esta tela mostra &quot;Ligado&quot;.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-4">
              {qr && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qr} alt="Código para abrir o WhatsApp com a mensagem pronta" width={176} height={176} className="rounded-lg border border-border bg-white p-1" />
              )}
              <div className="min-w-[12rem] flex-1">
                <p className="whitespace-nowrap font-mono text-xl font-bold">{codigo.mensagem}</p>
                <p className={`mt-2 text-xs ${texto2}`} role="status">
                  Esperando a sua mensagem · o código vale até {horaMin(codigo.expiraEm)} e uma vez só. Um número liga uma pessoa só.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </Dialogo>
  );
}
