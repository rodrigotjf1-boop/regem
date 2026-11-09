'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A PÁGINA DO FACEBOOK DA LOJA nos ajustes do Atendimento (o Messenger — mig 386; protótipo
// `mockups/regem-central-atendimento.html` v17, grupo "Messenger do Facebook"). Conectar = entrar com o Facebook de quem
// administra a página e autorizar; com mais de uma página, o Regem pergunta qual (a lista mostra só o nome — o acesso de
// cada página fica com a Regem, cifrado). O app na Meta, o segredo e o aviso de mensagem são da Regem. A volta do login
// chega com `?messenger=<situação>`.

export type EstadoDoMessenger = {
  disponivel: boolean;
  /** O robô do Messenger pode rodar (a distribuição: o fluxo do robô e a senha). */
  roboDisponivel?: boolean;
  /** Os cardápios da empresa, para "Cardápio que o robô usa" (aparece com mais de um). */
  cardapios?: { id: string; nome: string; ativo: boolean }[];
  conta: {
    paginaId: string;
    paginaNome: string | null;
    filaLigada: boolean;
    roboResponde?: boolean;
    cardapioId?: string | null;
    conectadoEm: string | null;
    conectadoPor: string | null;
    erro: string | null;
  } | null;
  /** A pessoa voltou do login com mais de uma página: falta escolher qual. */
  escolhaPendente?: boolean;
};

const VOLTA: Record<string, { tipo: 'success' | 'error' | 'info'; texto: string }> = {
  conectado: { tipo: 'success', texto: 'Página conectada: as conversas novas do Messenger entram na fila.' },
  escolher: { tipo: 'info', texto: 'Você administra mais de uma página: escolha qual conectar.' },
  cancelado: { tipo: 'info', texto: 'A conexão com o Facebook foi cancelada.' },
  expirou: { tipo: 'error', texto: 'O tempo para conectar acabou (15 min). Tente de novo.' },
  'sem-pagina': { tipo: 'error', texto: 'Nenhuma página do Facebook com permissão de mensagens nesta conta. Entre com quem administra a página da loja.' },
  'sem-permissao': { tipo: 'error', texto: 'Só gerente ou presidente conectam a página da loja.' },
  'faltou-permissao': { tipo: 'error', texto: 'Faltou permitir as mensagens da página no Facebook. Conecte de novo e deixe marcadas todas as permissões.' },
  'em-outra-empresa': { tipo: 'error', texto: 'Esta página do Facebook já está conectada a outra empresa no Regem.' },
  erro: { tipo: 'error', texto: 'Não deu para conectar o Facebook agora. Tente de novo.' },
};

const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

/** A frase da situação da página (vai na ajuda do ajuste "Página do Facebook"). */
export function situacaoDoMessenger(e: EstadoDoMessenger | null | undefined): string {
  if (!e?.disponivel && !e?.conta) return 'A Regem está liberando o Messenger com a Meta. Quando estiver pronto, o botão para conectar aparece aqui.';
  if (!e?.conta) return e?.escolhaPendente ? 'Falta escolher a página: você administra mais de uma.' : 'Não conectada. Conecte a página do Facebook da loja para as mensagens do Messenger entrarem na fila.';
  const c = e.conta;
  const desde = c.conectadoEm ? ` · desde ${data(c.conectadoEm)}${c.conectadoPor ? `, por ${c.conectadoPor}` : ''}` : '';
  return `Conectada: ${c.paginaNome || 'a página da loja'}${desde}.${c.erro ? ` ⚠️ ${c.erro}` : ''}`;
}

/** Lê a volta do login (`?messenger=`), avisa e limpa o endereço (um F5 não avisa de novo). Devolve se é para escolher a página. */
export function useVoltaDoMessenger(aoVoltar: (escolher: boolean) => void) {
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get('messenger');
    if (!s) return;
    const v = VOLTA[s] ?? VOLTA.erro;
    toast[v.tipo](v.texto);
    p.delete('messenger');
    const q = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}`);
    aoVoltar(s === 'escolher');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function ContaDoMessenger({
  estado,
  aoMudar,
  escolherAgora = false,
}: {
  estado: EstadoDoMessenger;
  aoMudar: (e: EstadoDoMessenger) => void;
  /** Abrir a escolha da página na hora (a volta do login com `?messenger=escolher`). */
  escolherAgora?: boolean;
}) {
  const [dialogo, setDialogo] = useState<'conectar' | 'desconectar' | 'escolher' | null>(null);
  const [indo, setIndo] = useState(false);
  const [paginas, setPaginas] = useState<{ id: string; nome: string }[] | null>(null);
  const [escolhida, setEscolhida] = useState('');
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (escolherAgora) setDialogo('escolher');
  }, [escolherAgora]);

  // A escolha: a lista das páginas da volta do login (só nome e id — o acesso de cada uma fica com a Regem).
  useEffect(() => {
    if (dialogo !== 'escolher') return;
    let vivo = true;
    setPaginas(null);
    setErro('');
    (async () => {
      try {
        const r: any = await api.messengerPaginas();
        if (!vivo) return;
        const lista = Array.isArray(r?.paginas) ? (r.paginas as { id: string; nome: string }[]) : [];
        setPaginas(lista);
        setEscolhida(lista[0]?.id ?? '');
      } catch (e) {
        if (!vivo) return;
        setPaginas([]);
        setErro(e instanceof ApiError && e.status === 404 ? 'A escolha venceu (15 min). Conecte de novo.' : (e as Error)?.message || 'Não consegui ler as páginas agora.');
      }
    })();
    return () => {
      vivo = false;
    };
  }, [dialogo]);

  async function irParaOFacebook() {
    if (indo) return;
    setIndo(true);
    try {
      const r: any = await api.messengerConectar();
      // Só endereço seguro (https); http apenas na própria máquina (o teste com o Facebook de mentira).
      const ok = typeof r?.url === 'string' && (/^https:\/\//.test(r.url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(r.url));
      if (!ok) throw new Error('A Regem não devolveu o endereço do Facebook.');
      window.location.assign(r.url);
    } catch (e: any) {
      toast.error(e?.message || 'Não deu para abrir o Facebook agora.');
      setIndo(false);
    }
  }

  async function escolher() {
    if (indo || !escolhida) return;
    setIndo(true);
    setErro('');
    try {
      await api.messengerEscolher(escolhida);
      aoMudar((await api.messengerEstado()) as EstadoDoMessenger);
      toast.success('Página conectada: as conversas novas do Messenger entram na fila.');
      setDialogo(null);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setErro(code === 'PAGINA_DE_OUTRA_EMPRESA' ? 'Esta página já está conectada a outra empresa no Regem.' : (e as Error)?.message || 'Não deu para conectar agora.');
    } finally {
      setIndo(false);
    }
  }

  async function desconectar() {
    if (indo) return;
    setIndo(true);
    try {
      await api.messengerDesconectar();
      aoMudar((await api.messengerEstado()) as EstadoDoMessenger);
      toast.success('Página desconectada: as mensagens novas do Messenger ficam só na caixa de entrada da página.');
      setDialogo(null);
    } catch (e: any) {
      toast.error(e?.message || 'Não deu para desconectar agora.');
    } finally {
      setIndo(false);
    }
  }

  if (!estado.disponivel && !estado.conta) return null;
  return (
    <>
      {estado.conta ? (
        <div className="flex flex-wrap gap-2">
          {estado.disponivel && estado.conta.erro && (
            <Button type="button" onClick={() => setDialogo('conectar')}>
              Reconectar
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setDialogo('desconectar')}>
            Desconectar
          </Button>
        </div>
      ) : estado.escolhaPendente ? (
        <Button type="button" onClick={() => setDialogo('escolher')}>
          Escolher a página
        </Button>
      ) : (
        <Button type="button" onClick={() => setDialogo('conectar')}>
          Conectar o Facebook
        </Button>
      )}

      {dialogo === 'conectar' && (
        <Dialogo
          titulo="Conectar a página do Facebook"
          aoFechar={() => setDialogo(null)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setDialogo(null)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void irParaOFacebook()} disabled={indo}>
                {indo ? 'Abrindo o Facebook…' : 'Ir para o Facebook'}
              </Button>
            </>
          }
        >
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              Abre a página do Facebook. Entre com o Facebook de quem <b>administra a página</b> da loja.
            </li>
            <li>
              O Facebook mostra o que o Regem vai poder fazer: <b>ver as páginas</b>, <b>ler e responder as mensagens do Messenger</b> e{' '}
              <b>ligar o aviso de mensagem</b>. Escolha a página da loja e toque em &quot;Continuar&quot;.
            </li>
            <li>Pronto: volta para cá. Se você administra mais de uma página, o Regem pergunta qual conectar.</li>
          </ol>
          <p className="mt-3 text-xs text-secondary-foreground">A loja não cria app nem guarda senha: o acesso fica com a Regem, cifrado. O perfil pessoal não serve — precisa ser uma página.</p>
        </Dialogo>
      )}
      {dialogo === 'escolher' && (
        <Dialogo
          titulo="Qual página conectar?"
          aoFechar={() => setDialogo(null)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setDialogo(null)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void escolher()} disabled={indo || !escolhida}>
                {indo ? 'Conectando…' : 'Conectar esta página'}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            <p>Você administra mais de uma página. As mensagens do Messenger da página escolhida entram no Atendimento.</p>
            {paginas === null ? (
              <p className="text-secondary-foreground">Lendo as páginas…</p>
            ) : (
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Páginas que você administra">
                {paginas.map((p) => (
                  <label key={p.id} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 ${escolhida === p.id ? 'border-primary bg-primary/10' : 'border-input bg-card'}`}>
                    <input type="radio" name="pagina-do-facebook" value={p.id} checked={escolhida === p.id} onChange={() => setEscolhida(p.id)} className="h-4 w-4" />
                    <span className="min-w-0 break-words font-semibold">{p.nome}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="text-xs text-secondary-foreground">Uma página por empresa. Para trocar depois, desconecte e conecte de novo.</p>
            {erro && (
              <p role="alert" className="font-semibold text-destructive">
                {erro}
              </p>
            )}
          </div>
        </Dialogo>
      )}
      {dialogo === 'desconectar' && (
        <Dialogo
          titulo="Desconectar a página do Facebook"
          alerta
          aoFechar={() => setDialogo(null)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setDialogo(null)}>
                Voltar
              </Button>
              <Button type="button" variant="destructive" onClick={() => void desconectar()} disabled={indo}>
                Desconectar
              </Button>
            </>
          }
        >
          <p className="text-sm">
            As mensagens novas do Messenger deixam de entrar na fila e a loja não responde mais pelo Regem — elas continuam na caixa de entrada da página. Os casos que
            já estão na fila ficam, para resolver.
          </p>
        </Dialogo>
      )}
    </>
  );
}
