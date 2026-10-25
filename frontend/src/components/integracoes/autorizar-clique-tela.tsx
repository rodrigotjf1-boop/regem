'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Info, Lock, Pause, TriangleAlert, X } from 'lucide-react';
import { ApiError, api, getToken, sair } from '@/lib/api';
import { toast } from '@/lib/toast';
import { guardarVoltaAutorizacao, limparVoltaAutorizacao } from '@/lib/volta-autorizacao';
import { Button } from '@/components/ui/button';
import { AutorizarCliqueFormulario, type Escolha } from './autorizar-clique-formulario';
import { AutorizarMoldura, CartaoCurto, Disco, ParDeSelos } from './autorizar-moldura';
import { dentroDeOutroAplicativo, ehParceiro, listaNaFrase, type AppResumo, type Pessoa, type SituacaoDaTela, type TelaDaAutorizacao } from './clique-tipos';
import { NIVEL, plural } from './textos';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Estado =
  | { fase: 'carregando' }
  | { fase: 'so_nuvem' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'indisponivel' }
  | { fase: 'invalido'; aplicativo: AppResumo | null }
  | { fase: 'pausado'; aplicativo: AppResumo }
  | { fase: 'nao_presidente'; aplicativo: AppResumo; pessoa: Pessoa }
  | { fase: 'travada'; aplicativo: AppResumo; pessoa: Pessoa; minutos: number }
  | { fase: 'limite'; aplicativo: AppResumo; pessoa: Pessoa; frase: string }
  | { fase: 'escolha'; aplicativo: AppResumo; pessoa: Pessoa; tela: TelaDaAutorizacao; enviando: boolean; erro: string | null; erroSenha: string | null; erroConfirmacao: boolean }
  | { fase: 'voltando'; aplicativo: AppResumo; titulo: string; texto: string; ok: boolean; destino: string; empresa: string | null; quem: string | null };

const titulo = 'font-display text-[19px] font-extrabold leading-tight sm:text-[22px]';
const quemE = (p: Pessoa) => `${p.nome ?? 'Você'} · ${NIVEL[p.nivel] ?? p.nivel}`;

function Girando({ texto }: { texto: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold text-secondary-foreground">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-input border-t-foreground motion-reduce:animate-none" aria-hidden="true" />
      {texto}
    </span>
  );
}

/** Aberto no Instagram ou no Facebook: a volta ao aplicativo pode não funcionar. Deixa autorizar assim mesmo. */
function AvisoDeOutroAplicativo({ app }: { app: string }) {
  async function copiar() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Endereço copiado. Cole no navegador do celular.');
    } catch {
      toast.error('Não deu para copiar daqui. Toque e segure na barra de endereço para copiar.');
    }
  }
  return (
    <div role="note" className="flex w-full max-w-[640px] gap-2.5 rounded-[11px] border border-border bg-card px-3.5 py-3 text-[13px]">
      <Info className="mt-px h-[18px] w-[18px] flex-none text-secondary-foreground" aria-hidden="true" />
      <div className="grid min-w-0 gap-1.5">
        <b className="font-bold">Você abriu este link dentro de outro aplicativo.</b>
        <span className="text-secondary-foreground">
          Para voltar ao {app} no fim, abra esta página no navegador do celular: copie o endereço e cole lá.
        </span>
        <span>
          <Button type="button" variant="outline" size="sm" className="font-bold" onClick={() => void copiar()}>
            Copiar o endereço
          </Button>
        </span>
      </div>
    </div>
  );
}

// A autorização POR CLIQUE (Hub DMS, F3, parte C; protótipo "Autorização no Regem", aprovado em 21/10/2026): a página
// abre com `?client_id=…&request_uri=…`, o pedido que o aplicativo empurrou. Tudo o que importa é decidido pelo
// servidor (a situação, a tela, a senha, a trava); a página desenha e leva a pessoa de volta pelo endereço que o
// servidor devolve — nunca um endereço do link.
export function AutorizarCliqueTela() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [noApp, setNoApp] = useState(false);
  const consulta = () => new URLSearchParams(window.location.search);

  const carregar = useCallback(async () => {
    const caminho = `/integracoes/autorizar${window.location.search}`;
    if (process.env.NEXT_PUBLIC_EDGE === '1') return setEstado({ fase: 'so_nuvem' });
    // Sem sessão (ou com ela vencida, quando a chamada abaixo devolve 401): o login traz de volta.
    guardarVoltaAutorizacao(caminho);
    if (!getToken()) return router.replace('/entrar');
    setNoApp(dentroDeOutroAplicativo(navigator.userAgent));
    try {
      const q = consulta();
      const s = (await api.get(
        `/integracoes/autorizacao?${new URLSearchParams({ client_id: q.get('client_id') ?? '', request_uri: q.get('request_uri') ?? '' })}`,
      )) as SituacaoDaTela;
      limparVoltaAutorizacao();
      if (s.situacao === 'escolha') {
        setEstado({ fase: 'escolha', aplicativo: s.aplicativo, pessoa: s.pessoa, tela: s.tela, enviando: false, erro: null, erroSenha: null, erroConfirmacao: false });
      } else if (s.situacao === 'invalido') setEstado({ fase: 'invalido', aplicativo: s.aplicativo });
      else if (s.situacao === 'pausado') setEstado({ fase: 'pausado', aplicativo: s.aplicativo });
      else if (s.situacao === 'nao_presidente') setEstado({ fase: 'nao_presidente', aplicativo: s.aplicativo, pessoa: s.pessoa });
      else if (s.situacao === 'travada') setEstado({ fase: 'travada', aplicativo: s.aplicativo, pessoa: s.pessoa, minutos: s.minutos });
      else if (s.situacao === 'limite') setEstado({ fase: 'limite', aplicativo: s.aplicativo, pessoa: s.pessoa, frase: s.frase });
      else setEstado({ fase: 'indisponivel' });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : -1;
      if (status === 401) return; // o cliente de API já está levando ao login
      limparVoltaAutorizacao();
      setEstado({ fase: 'erro', mensagem: e instanceof Error ? e.message : 'Não foi possível abrir a autorização.' });
    }
  }, [router]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function voltar(aplicativo: AppResumo, destino: string, ok: boolean, t: string, texto: string, empresa: string | null, quem: string | null) {
    setEstado({ fase: 'voltando', aplicativo, titulo: t, texto, ok, destino, empresa, quem });
    window.location.assign(destino);
  }

  async function autorizar(e: Extract<Estado, { fase: 'escolha' }>, escolha: Escolha) {
    setEstado({ ...e, enviando: true, erro: null, erroSenha: null, erroConfirmacao: false });
    const q = consulta();
    try {
      const r: any = await api.post('/integracoes/autorizacao', {
        clientId: q.get('client_id'),
        requestUri: q.get('request_uri'),
        senha: escolha.senha,
        lojas: escolha.lojas,
        opcionais: escolha.opcionais,
        confirmoOutraEmpresa: escolha.confirmoOutraEmpresa,
        // A tela do aplicativo de parceiro traz o resumo do texto mostrado: o servidor confere que é o mesmo.
        ...(e.tela.resumo ? { resumo: e.tela.resumo } : {}),
      });
      const app = e.aplicativo.nome;
      const mais = e.tela.modo === 'mais';
      voltar(
        e.aplicativo,
        r.redirect,
        true,
        mais
          ? `Pronto: o ${app} passa a receber ${listaNaFrase(e.tela.novas.filter((n) => !n.opcional || escolha.opcionais.includes(n.id)).map((n) => n.naFrase))}`
          : `Pronto: ${plural(escolha.lojas.length, 'loja autorizada', 'lojas autorizadas')}`,
        mais
          ? 'Os presidentes da empresa recebem um e-mail com o que mudou. Para revogar, use Configurações › Aplicativos conectados.'
          : `Falta ligar cada loja do Regem a uma loja do ${app}: é o próximo passo, lá. Os presidentes da empresa recebem um e-mail com o que foi liberado.`,
        e.tela.empresa.nome,
        quemE(e.pessoa),
      );
    } catch (erro) {
      const status = erro instanceof ApiError ? erro.status : -1;
      const msg = erro instanceof Error ? erro.message : 'Não foi possível autorizar. Tente de novo.';
      if (status === 401) return;
      if (status === 422) return setEstado({ ...e, enviando: false, erroSenha: msg });
      if (status === 423 || status === 403) return void carregar(); // a trava (ou o nível) se lê de novo da página
      if (status === 410) return setEstado({ fase: 'invalido', aplicativo: e.aplicativo });
      if (status === 503) return setEstado({ fase: 'pausado', aplicativo: e.aplicativo });
      if (status === 404) return setEstado({ fase: 'indisponivel' });
      // O texto do aplicativo de parceiro mudou desde que a página abriu: abre de novo, com o texto novo, para conferir.
      if (status === 409) {
        toast.error(msg);
        return void carregar();
      }
      if (status === 400 && /confirmação/.test(msg)) return setEstado({ ...e, enviando: false, erroConfirmacao: true });
      setEstado({ ...e, enviando: false, erro: msg });
    }
  }

  /** "Cancelar", "Agora não" ou "Voltar ao <aplicativo>": gasta o pedido e volta com a recusa. */
  async function recusar(aplicativo: AppResumo, mais: boolean, empresa: string | null, quem: string | null) {
    const q = consulta();
    try {
      const r: any = await api.post('/integracoes/autorizacao/recusar', { clientId: q.get('client_id'), requestUri: q.get('request_uri') });
      voltar(
        aplicativo,
        r.redirect,
        false,
        mais ? 'Nada mudou' : 'Nada foi compartilhado',
        mais ? `O ${aplicativo.nome} continua só com o que já tinha.` : `Você cancelou. O ${aplicativo.nome} não recebeu nenhum dado.`,
        empresa,
        quem,
      );
    } catch (erro) {
      const status = erro instanceof ApiError ? erro.status : -1;
      if (status === 401) return;
      // O pedido já não vale: volta ao início cadastrado do aplicativo, nunca a um endereço do link.
      if (status === 410) return setEstado({ fase: 'invalido', aplicativo });
      toast.error(erro instanceof Error ? erro.message : 'Não foi possível voltar agora. Tente de novo.');
    }
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
            O servidor da loja não autoriza aplicativos. Abra o Regem em <span className="font-mono text-[13px]">app.dmsregem.com</span> e comece de
            novo pelo aplicativo.
          </p>
        </CartaoCurto>
      </AutorizarMoldura>
    );
  }

  if (estado.fase === 'erro' || estado.fase === 'indisponivel') {
    return (
      <AutorizarMoldura>
        <CartaoCurto papel="alert">
          <Disco tom="atencao">
            <TriangleAlert aria-hidden="true" />
          </Disco>
          <h1 className={titulo}>{estado.fase === 'indisponivel' ? 'A autorização ainda não está disponível' : 'Não deu para abrir a autorização'}</h1>
          <p className="text-secondary-foreground">
            {estado.fase === 'erro' ? `${estado.mensagem} ` : ''}Nada foi compartilhado.
          </p>
          <Button type="button" variant="outline" className="font-bold" onClick={() => void carregar()}>
            Tentar de novo
          </Button>
        </CartaoCurto>
      </AutorizarMoldura>
    );
  }

  if (estado.fase === 'invalido') {
    const app = estado.aplicativo;
    return (
      <AutorizarMoldura>
        <CartaoCurto papel="alert">
          <Disco tom="perigo">
            <TriangleAlert aria-hidden="true" />
          </Disco>
          <h1 className={titulo}>Este pedido de autorização não vale</h1>
          <p className="text-secondary-foreground">
            Ele já foi usado, venceu (vale 10 minutos) ou chegou incompleto. Por segurança, o Regem não manda você para um endereço que veio no link. Nada
            foi compartilhado.
          </p>
          {app && (
            <p className="flex gap-2.5 rounded-[11px] border border-border bg-secondary px-3.5 py-3 text-left text-[13px] text-secondary-foreground">
              <Info className="mt-px h-[18px] w-[18px] flex-none text-secondary-foreground" aria-hidden="true" />
              {ehParceiro(app.cliente) ? (
                <span>Para tentar de novo, volte ao {app.nome} e conecte o Regem de novo por lá.</span>
              ) : (
                <span>
                  Para tentar de novo, volte ao {app.nome}, em <b className="text-foreground">Contas conectadas</b>, e conecte o Regem de novo.
                </span>
              )}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2.5">
            <Button type="button" variant="outline" className="font-bold" onClick={() => router.replace('/painel')}>
              Ir para o Regem
            </Button>
            {app && (
              <Button type="button" className="font-bold" onClick={() => window.location.assign(app.inicio)}>
                Voltar ao {app.nome}
              </Button>
            )}
          </div>
        </CartaoCurto>
      </AutorizarMoldura>
    );
  }

  if (estado.fase === 'pausado') {
    return (
      <AutorizarMoldura>
        <CartaoCurto papel="alert">
          <Disco tom="atencao">
            <Pause aria-hidden="true" />
          </Disco>
          <h1 className={titulo}>O {estado.aplicativo.nome} está parado pela DMS</h1>
          <p className="text-secondary-foreground">
            A DMS parou o {estado.aplicativo.nome} em todos os produtos, por segurança. Enquanto durar, nenhuma autorização nova é aceita, e as que já existem
            não leem nada. Nada foi compartilhado.
          </p>
          <Button type="button" variant="outline" className="font-bold" onClick={() => router.replace('/painel')}>
            Ir para o Regem
          </Button>
        </CartaoCurto>
      </AutorizarMoldura>
    );
  }

  if (estado.fase === 'nao_presidente') {
    const { aplicativo, pessoa } = estado;
    const nivel = NIVEL[pessoa.nivel] ?? pessoa.nivel;
    return (
      <AutorizarMoldura quem={quemE(pessoa)}>
        <CartaoCurto>
          <ParDeSelos cliente={aplicativo.cliente} rotulo={aplicativo.nome} pequeno />
          <Disco tom="atencao">
            <Lock aria-hidden="true" />
          </Disco>
          <h1 className={titulo}>Só o presidente autoriza o {aplicativo.nome}</h1>
          <p className="text-secondary-foreground">
            Você entrou como {pessoa.nome ?? 'outra pessoa'}, {nivel}. Deixar outra ferramenta ler as vendas é decisão do presidente da empresa. Nada foi
            compartilhado.
          </p>
          <div className="flex flex-wrap justify-center gap-2.5">
            <Button type="button" variant="outline" className="font-bold" onClick={() => void recusar(aplicativo, false, null, quemE(pessoa))}>
              Voltar ao {aplicativo.nome}
            </Button>
            <Button type="button" className="font-bold" onClick={() => void trocarDeConta()}>
              Entrar com outra conta
            </Button>
          </div>
        </CartaoCurto>
      </AutorizarMoldura>
    );
  }

  if (estado.fase === 'travada') {
    const { aplicativo, pessoa, minutos } = estado;
    return (
      <AutorizarMoldura quem={quemE(pessoa)}>
        <CartaoCurto papel="alert">
          <Disco tom="perigo">
            <Lock aria-hidden="true" />
          </Disco>
          <h1 className={titulo}>Autorização travada por {plural(minutos, 'minuto', 'minutos')}</h1>
          <p className="text-secondary-foreground">
            Foram cinco senhas erradas seguidas, e nada foi liberado. Daqui a {plural(minutos, 'minuto', 'minutos')}, comece de novo pelo {aplicativo.nome}. Se
            esqueceu a senha, use “Esqueci minha senha” na entrada do Regem. Entrar no Regem continua normal.
          </p>
          <Button type="button" variant="outline" className="font-bold" onClick={() => void recusar(aplicativo, false, null, quemE(pessoa))}>
            Voltar ao {aplicativo.nome}
          </Button>
        </CartaoCurto>
      </AutorizarMoldura>
    );
  }

  if (estado.fase === 'limite') {
    const { aplicativo, pessoa } = estado;
    return (
      <AutorizarMoldura quem={quemE(pessoa)}>
        <CartaoCurto papel="alert">
          <ParDeSelos cliente={aplicativo.cliente} rotulo={aplicativo.nome} pequeno />
          <Disco tom="atencao">
            <Info aria-hidden="true" />
          </Disco>
          <h1 className={titulo}>O {aplicativo.nome} não aceita mais lojas agora</h1>
          <p className="text-secondary-foreground">{estado.frase} Nada foi compartilhado.</p>
          <Button type="button" variant="outline" className="font-bold" onClick={() => void recusar(aplicativo, false, null, quemE(pessoa))}>
            Voltar ao {aplicativo.nome}
          </Button>
        </CartaoCurto>
      </AutorizarMoldura>
    );
  }

  if (estado.fase === 'voltando') {
    return (
      <AutorizarMoldura empresa={estado.empresa} quem={estado.quem}>
        <CartaoCurto papel="status">
          <Disco tom={estado.ok ? 'ok' : 'atencao'}>{estado.ok ? <Check aria-hidden="true" /> : <X aria-hidden="true" />}</Disco>
          <h1 className={titulo}>{estado.titulo}</h1>
          <p className="text-secondary-foreground">{estado.texto}</p>
          <Girando texto={`Voltando ao ${estado.aplicativo.nome}…`} />
          <p className="text-[12.5px] text-secondary-foreground">
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

  const e = estado;
  return (
    <AutorizarMoldura empresa={e.tela.empresa.nome} quem={quemE(e.pessoa)}>
      <div className="grid w-full justify-items-center gap-3">
        {noApp && <AvisoDeOutroAplicativo app={e.aplicativo.nome} />}
        {e.erro && (
          <p role="alert" className="w-full max-w-[640px] rounded-[11px] border border-destructive/30 bg-destructive/10 px-3.5 py-3 text-sm font-semibold text-destructive">
            {e.erro}
          </p>
        )}
        <AutorizarCliqueFormulario
          // O texto do parceiro mudou (409 → a página abriu de novo): o formulário recomeça do zero — a confirmação, a
          // senha e as marcas eram do texto de antes.
          key={e.tela.resumo ?? 'tela'}
          tela={e.tela}
          enviando={e.enviando}
          erroSenha={e.erroSenha}
          erroConfirmacao={e.erroConfirmacao}
          aoAutorizar={(escolha) => void autorizar(e, escolha)}
          aoCancelar={() => void recusar(e.aplicativo, e.tela.modo === 'mais', e.tela.empresa.nome, quemE(e.pessoa))}
        />
      </div>
    </AutorizarMoldura>
  );
}
