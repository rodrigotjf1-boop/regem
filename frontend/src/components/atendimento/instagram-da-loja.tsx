'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O INSTAGRAM DA LOJA nos ajustes do Atendimento (mig 377 — protótipo `mockups/regem-central-atendimento.html` v7, grupo
// "Instagram Direct"). Conectar = entrar com a conta PROFISSIONAL do Instagram e autorizar; o resto (o app na Meta, o
// segredo, o aviso de mensagem, a renovação do acesso) é da Regem. A volta do login chega com `?instagram=<situação>`.

export type EstadoDoInstagram = {
  /** O robô do Direct pode rodar (a distribuição: o fluxo do robô e a senha) — mig 378. */
  roboDisponivel?: boolean;
  /** Os cardápios da empresa, para "Cardápio que o robô usa" (aparece com mais de um). */
  cardapios?: { id: string; nome: string; ativo: boolean }[];
  disponivel: boolean;
  conta: {
    usuario: string | null;
    nome: string | null;
    filaLigada: boolean;
    /** "Robô responde no Direct" (mig 378) — nasce desligado. */
    roboResponde?: boolean;
    /** "Cardápio que o robô usa" — vazio = o único cardápio da empresa. */
    cardapioId?: string | null;
    conectadoEm: string | null;
    conectadoPor: string | null;
    erro: string | null;
  } | null;
  /** Os comentários dos posts (F6, mig 384): `permitido` = a conta tem a permissão de comentários (quem conectou antes
   *  dela precisa reconectar); "Robô responde comentários" (nasce desligado) e "Comentário que pede a equipe vira caso". */
  comentarios?: { permitido: boolean; roboResponde: boolean; naFila: boolean } | null;
};

const VOLTA: Record<string, { tipo: 'success' | 'error' | 'info'; texto: string }> = {
  conectado: { tipo: 'success', texto: 'Instagram conectado: as conversas novas do Direct entram na fila.' },
  cancelado: { tipo: 'info', texto: 'A conexão com o Instagram foi cancelada.' },
  expirou: { tipo: 'error', texto: 'O tempo para conectar acabou (15 min). Tente de novo.' },
  'sem-permissao': { tipo: 'error', texto: 'Só gerente ou presidente conectam o Instagram da loja.' },
  'em-outra-empresa': { tipo: 'error', texto: 'Esta conta do Instagram já está conectada a outra empresa no Regem.' },
  erro: { tipo: 'error', texto: 'Não deu para conectar o Instagram agora. Confira se a conta é profissional e tente de novo.' },
};

const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

/** A frase da situação da conta (vai na ajuda do ajuste "Instagram da loja"). */
export function situacaoDoInstagram(e: EstadoDoInstagram | null | undefined): string {
  if (!e?.disponivel && !e?.conta) return 'A Regem está liberando o Instagram com a Meta. Quando estiver pronto, o botão para conectar aparece aqui.';
  if (!e?.conta) return 'Não conectado. Conecte a conta profissional do Instagram da loja para as mensagens do Direct entrarem na fila.';
  const c = e.conta;
  const quem = c.usuario ? `@${c.usuario}` : c.nome || 'a conta da loja';
  const desde = c.conectadoEm ? ` · desde ${data(c.conectadoEm)}${c.conectadoPor ? `, por ${c.conectadoPor}` : ''}` : '';
  return `Conectado: ${quem}${desde}.${c.erro ? ` ⚠️ ${c.erro}` : ''}`;
}

/** Lê a volta do login (`?instagram=`), avisa e limpa o endereço (um F5 não avisa de novo). */
export function useVoltaDoInstagram(aoVoltar: () => void) {
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const s = p.get('instagram');
    if (!s) return;
    const v = VOLTA[s] ?? VOLTA.erro;
    toast[v.tipo](v.texto);
    p.delete('instagram');
    const q = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}`);
    aoVoltar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

export function ContaDoInstagram({ estado, aoMudar }: { estado: EstadoDoInstagram; aoMudar: (e: EstadoDoInstagram) => void }) {
  const [dialogo, setDialogo] = useState<'conectar' | 'desconectar' | null>(null);
  const [indo, setIndo] = useState(false);

  async function irParaOInstagram() {
    if (indo) return;
    setIndo(true);
    try {
      const r: any = await api.instagramConectar();
      // Só endereço seguro (https); http apenas na própria máquina (o teste com a Meta de mentira).
      const ok = typeof r?.url === 'string' && (/^https:\/\//.test(r.url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(r.url));
      if (!ok) throw new Error('A Regem não devolveu o endereço do Instagram.');
      window.location.assign(r.url);
    } catch (e: any) {
      toast.error(e?.message || 'Não deu para abrir o Instagram agora.');
      setIndo(false);
    }
  }

  async function desconectar() {
    if (indo) return;
    setIndo(true);
    try {
      await api.instagramDesconectar();
      aoMudar((await api.instagramEstado()) as EstadoDoInstagram);
      toast.success('Instagram desconectado: as mensagens novas do Direct ficam só no app do Instagram.');
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
          {/* Reconectar: com erro no acesso, ou sem a permissão dos comentários (conectada antes dela — F6, ERR-406). */}
          {estado.disponivel && (estado.conta.erro || estado.comentarios?.permitido === false) && (
            <Button type="button" onClick={() => setDialogo('conectar')}>
              Reconectar
            </Button>
          )}
          <Button type="button" variant="outline" onClick={() => setDialogo('desconectar')}>
            Desconectar
          </Button>
        </div>
      ) : (
        <Button type="button" onClick={() => setDialogo('conectar')}>
          Conectar o Instagram
        </Button>
      )}

      {dialogo === 'conectar' && (
        <Dialogo
          titulo="Conectar o Instagram da loja"
          aoFechar={() => setDialogo(null)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setDialogo(null)}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void irParaOInstagram()} disabled={indo}>
                {indo ? 'Abrindo o Instagram…' : 'Ir para o Instagram'}
              </Button>
            </>
          }
        >
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            <li>
              Abre a página do Instagram. Entre com a conta <b>profissional</b> da loja (comercial ou criador de conteúdo).
            </li>
            <li>
              O Instagram mostra o que o Regem vai poder fazer: <b>ver o perfil</b>, <b>ler e responder as mensagens do Direct</b> e{' '}
              <b>responder e esconder os comentários dos posts</b>. Toque em &quot;Permitir&quot;.
            </li>
            <li>Pronto: volta para cá e esta tela mostra &quot;Conectado&quot;. A partir daí, as conversas novas do Direct entram na fila.</li>
          </ol>
          <p className="mt-3 text-xs text-secondary-foreground">
            A loja não cria app nem guarda senha: o acesso fica com a Regem, cifrado, e é renovado sozinho. A conta pessoal do Instagram não serve — no app
            do Instagram, em Configurações › Tipo de conta, dá para mudar para conta profissional sem custo.
          </p>
        </Dialogo>
      )}
      {dialogo === 'desconectar' && (
        <Dialogo
          titulo="Desconectar o Instagram da loja"
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
            As mensagens novas do Direct deixam de entrar na fila e a loja não responde mais pelo Regem — elas continuam no app do Instagram. Os casos que já
            estão na fila ficam, para resolver.
          </p>
        </Dialogo>
      )}
    </>
  );
}
