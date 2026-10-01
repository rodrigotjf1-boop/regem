'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Info, Lock, TriangleAlert, X } from 'lucide-react';
import { ApiError, api, getToken, sair } from '@/lib/api';
import { guardarVoltaAutorizacao, limparVoltaAutorizacao } from '@/lib/volta-autorizacao';
import { Button } from '@/components/ui/button';
import { AutorizarFormulario, type PedidoOk } from './autorizar-formulario';
import { AutorizarMoldura, CartaoCurto, Disco, ParDeSelos } from './autorizar-moldura';
import { NIVEL, plural } from './textos';

/* eslint-disable @typescript-eslint/no-explicit-any */

type NaoPresidente = {
  situacao: 'nao_presidente';
  cliente: { chave: string; rotulo: string };
  empresa: string;
  quem: { nome: string | null; nivel: string };
  cancelarUrl: string;
};

type Estado =
  | { fase: 'carregando' }
  | { fase: 'so_nuvem' }
  | { fase: 'invalido' }
  | { fase: 'indisponivel'; mensagem: string }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'nao_presidente'; pedido: NaoPresidente }
  | { fase: 'escolha'; pedido: PedidoOk; enviando: boolean; erro: string | null }
  | { fase: 'voltando'; app: string; empresa: string; quem: string | null; destino: string; lojas: number | null };

const titulo = 'font-display text-[19px] font-extrabold leading-tight sm:text-[22px]';

// Página "Autorizar o <aplicativo>" (`/integracoes/autorizar` — trilha C, C1b; mockup
// `mockups/regem-autorizar-liame.html`, aprovado em 01/10/2026). Quem decide tudo é o servidor:
// o pedido é conferido lá (endereço de volta, PKCE), só o presidente recebe as lojas, e os dois
// endereços de saída (autorizou ou cancelou) vêm prontos de lá — a tela nunca monta um.
export function AutorizarTela() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });

  const carregar = useCallback(async () => {
    const consulta = window.location.search;
    const caminho = `/integracoes/autorizar${consulta}`;
    if (process.env.NEXT_PUBLIC_EDGE === '1') return setEstado({ fase: 'so_nuvem' });
    // Sem sessão (ou com ela vencida, quando a chamada abaixo devolve 401): o login traz de volta.
    guardarVoltaAutorizacao(caminho);
    if (!getToken()) return router.replace('/entrar');
    setEstado({ fase: 'carregando' });
    try {
      const p: any = await api.get(`/integracao-autorizacao/pedido${consulta}`);
      limparVoltaAutorizacao();
      if (p.situacao === 'nao_presidente') setEstado({ fase: 'nao_presidente', pedido: p });
      else setEstado({ fase: 'escolha', pedido: p, enviando: false, erro: null });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : -1;
      if (status === 401) return; // o cliente de API já está levando ao login
      limparVoltaAutorizacao();
      if (status === 400 || status === 404) setEstado({ fase: 'invalido' });
      else if (status === 503) setEstado({ fase: 'indisponivel', mensagem: (e as Error).message });
      else setEstado({ fase: 'erro', mensagem: e instanceof Error ? e.message : 'Não foi possível abrir a autorização.' });
    }
  }, [router]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function autorizar(pedido: PedidoOk, lojas: string[], opcionais: Record<string, boolean>) {
    setEstado({ fase: 'escolha', pedido, enviando: true, erro: null });
    try {
      const q = new URLSearchParams(window.location.search);
      const r: any = await api.post('/integracao-autorizacao', {
        cliente: q.get('cliente'),
        redirect_uri: q.get('redirect_uri'),
        state: q.get('state'),
        code_challenge: q.get('code_challenge'),
        code_challenge_method: q.get('code_challenge_method'),
        lojas,
        ...opcionais,
      });
      setEstado({ fase: 'voltando', app: pedido.cliente.rotulo, empresa: pedido.empresa, quem: `${pedido.quem.nome} · presidente`, destino: r.redirect, lojas: lojas.length });
      window.location.assign(r.redirect);
    } catch (e) {
      setEstado({ fase: 'escolha', pedido, enviando: false, erro: e instanceof Error ? e.message : 'Não foi possível autorizar. Tente de novo.' });
    }
  }

  function cancelar(app: string, empresa: string, quem: string | null, destino: string) {
    setEstado({ fase: 'voltando', app, empresa, quem, destino, lojas: null });
    window.location.assign(destino);
  }

  async function trocarDeConta() {
    guardarVoltaAutorizacao(`/integracoes/autorizar${window.location.search}`);
    await sair();
    router.replace('/entrar');
  }

  if (estado.fase === 'carregando') {
    return (
      <AutorizarMoldura>
        <CartaoCurto papel="status">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-input border-t-foreground motion-reduce:animate-none" aria-hidden="true" />
          <p className="text-secondary-foreground">Abrindo a autorização…</p>
        </CartaoCurto>
      </AutorizarMoldura>
    );
  }

  if (estado.fase === 'so_nuvem') {
    return (
      <AutorizarMoldura>
        <CartaoCurto>
          <Disco tom="atencao">
            <Info aria-hidden="true" />
          </Disco>
          <h1 className={titulo}>Esta autorização é feita pela internet</h1>
          <p className="text-secondary-foreground">
            O servidor da loja não autoriza aplicativos. Abra o Regem em <span className="font-mono text-[13px]">app.dmsregem.com</span> e comece
            de novo pelo aplicativo.
          </p>
        </CartaoCurto>
      </AutorizarMoldura>
    );
  }

  if (estado.fase === 'invalido') {
    return (
      <AutorizarMoldura>
        <CartaoCurto papel="alert">
          <Disco tom="perigo">
            <TriangleAlert aria-hidden="true" />
          </Disco>
          <h1 className={titulo}>Este pedido de autorização não vale</h1>
          <p className="text-secondary-foreground">
            O link chegou incompleto ou venceu. Por segurança, o Regem não devolve você a um endereço que não reconhece. Nada foi compartilhado.
          </p>
          <p className="flex gap-2.5 rounded-[11px] border border-border bg-secondary px-3.5 py-3 text-left text-[13px] text-secondary-foreground">
            <Info className="mt-px h-[18px] w-[18px] flex-none text-muted-foreground" aria-hidden="true" />
            <span>
              Para tentar de novo, volte ao aplicativo e comece por lá. No Liame, é em <b className="text-foreground">Contas conectadas → Conectar o Regem</b>.
            </span>
          </p>
          <Button type="button" variant="outline" className="font-bold" onClick={() => router.replace('/painel')}>
            Ir para o Regem
          </Button>
        </CartaoCurto>
      </AutorizarMoldura>
    );
  }

  if (estado.fase === 'indisponivel' || estado.fase === 'erro') {
    return (
      <AutorizarMoldura>
        <CartaoCurto papel="alert">
          <Disco tom="atencao">
            <TriangleAlert aria-hidden="true" />
          </Disco>
          <h1 className={titulo}>{estado.fase === 'indisponivel' ? 'A autorização ainda não está disponível' : 'Não deu para abrir a autorização'}</h1>
          <p className="text-secondary-foreground">{estado.mensagem} Nada foi compartilhado.</p>
          <Button type="button" variant="outline" className="font-bold" onClick={() => void carregar()}>
            Tentar de novo
          </Button>
        </CartaoCurto>
      </AutorizarMoldura>
    );
  }

  if (estado.fase === 'nao_presidente') {
    const { pedido } = estado;
    const nivel = NIVEL[pedido.quem.nivel] ?? pedido.quem.nivel;
    const quem = `${pedido.quem.nome ?? 'Você'} · ${nivel}`;
    return (
      <AutorizarMoldura empresa={pedido.empresa} quem={quem}>
        <CartaoCurto>
          <ParDeSelos cliente={pedido.cliente.chave} rotulo={pedido.cliente.rotulo} pequeno />
          <Disco tom="atencao">
            <Lock aria-hidden="true" />
          </Disco>
          <h1 className={titulo}>Só o presidente autoriza o {pedido.cliente.rotulo}</h1>
          <p className="text-secondary-foreground">
            Você entrou como {pedido.quem.nome ?? 'outra pessoa'}, {nivel}. Deixar outra ferramenta ler as vendas é decisão do presidente da empresa.
            Nada foi compartilhado.
          </p>
          <div className="flex flex-wrap justify-center gap-2.5">
            <Button type="button" variant="outline" className="font-bold" onClick={() => cancelar(pedido.cliente.rotulo, pedido.empresa, quem, pedido.cancelarUrl)}>
              Voltar ao {pedido.cliente.rotulo}
            </Button>
            <Button type="button" className="font-bold" onClick={() => void trocarDeConta()}>
              Entrar com outra conta
            </Button>
          </div>
        </CartaoCurto>
      </AutorizarMoldura>
    );
  }

  if (estado.fase === 'voltando') {
    const ok = estado.lojas !== null;
    return (
      <AutorizarMoldura empresa={estado.empresa} quem={estado.quem}>
        <CartaoCurto papel="status">
          <Disco tom={ok ? 'ok' : 'atencao'}>{ok ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}</Disco>
          <h1 className={titulo}>{ok ? `Pronto: ${plural(estado.lojas as number, 'loja autorizada', 'lojas autorizadas')}` : 'Nada foi compartilhado'}</h1>
          <p className="text-secondary-foreground">
            {ok
              ? `Falta ligar cada loja do Regem a uma loja do ${estado.app}. É o próximo passo, lá.`
              : `Você cancelou a autorização. O ${estado.app} não recebeu nenhum dado.`}
          </p>
          <span className="inline-flex items-center gap-2 font-semibold text-secondary-foreground">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-input border-t-foreground motion-reduce:animate-none" aria-hidden="true" />
            Voltando ao {estado.app}…
          </span>
          <p className="text-[12.5px] text-muted-foreground">
            Se não voltar sozinho,{' '}
            <a className="font-bold text-foreground underline underline-offset-2" href={estado.destino}>
              continue por aqui
            </a>
            .
          </p>
        </CartaoCurto>
      </AutorizarMoldura>
    );
  }

  const { pedido } = estado;
  return (
    <AutorizarMoldura empresa={pedido.empresa} quem={`${pedido.quem.nome} · presidente`}>
      <div className="grid w-full justify-items-center gap-3">
        {estado.erro && (
          <p role="alert" className="w-full max-w-[640px] rounded-[11px] border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm font-semibold text-destructive">
            {estado.erro}
          </p>
        )}
        <AutorizarFormulario
          pedido={pedido}
          enviando={estado.enviando}
          aoAutorizar={(lojas, opcionais) => void autorizar(pedido, lojas, opcionais)}
          aoCancelar={() => cancelar(pedido.cliente.rotulo, pedido.empresa, `${pedido.quem.nome} · presidente`, pedido.cancelarUrl)}
        />
      </div>
    </AutorizarMoldura>
  );
}
