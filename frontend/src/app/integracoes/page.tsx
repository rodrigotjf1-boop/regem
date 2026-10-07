'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plug, Unplug } from 'lucide-react';
import { ApiError, api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonList } from '@/components/ui/skeleton';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio, distintos, semAcento, texto2,
  type Situacao,
} from '@/components/ui/lista';
import { DialogoRevogar } from '@/components/integracoes/dialogo-revogar';
import { SeloApp } from '@/components/integracoes/selo-app';
import { type Acesso, type Aplicativo, autorizadoPor, comoSaiu, haQuanto, resumoDoAcesso } from '@/components/integracoes/textos';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Estado =
  | { fase: 'carregando' }
  | { fase: 'so_nuvem' }
  | { fase: 'sem_acesso' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; aplicativos: Aplicativo[] };

/** Uma linha da lista: o acesso de um aplicativo a uma loja (ou à empresa inteira). */
type Linha = { app: Aplicativo; acesso: Acesso };
/** `acesso` nulo = todas as lojas do aplicativo. */
type Pedido = { app: Aplicativo; acesso: Acesso | null };

const lojaDe = (l: Linha) => l.acesso.lojaNome ?? 'Todas as lojas';
const SITUACOES: Situacao<Linha>[] = [
  { rotulo: 'Ativos', filtro: (l) => l.acesso.ativo },
  { rotulo: 'Ainda não acessaram', filtro: (l) => l.acesso.ativo && !l.acesso.ultimoUsoEm, tom: 'aviso' },
  { rotulo: 'Revogados', filtro: (l) => !l.acesso.ativo },
];
const ID_TITULO = 'aplicativos-titulo';

// Configurações → Aplicativos conectados (trilha C, C1b; mockup `mockups/regem-configuracoes.html`, que
// levou a tela de 01/10/2026 ao modelo de lista): as ferramentas que leem dados das lojas com a
// autorização do presidente — um acesso por linha, com o que recebe, o último acesso e o botão de
// revogar. Só o presidente (o servidor recusa os demais) e só na nuvem.
export default function AplicativosConectadosPage() {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>({ fase: 'carregando' });
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const [revogando, setRevogando] = useState(false);
  const [agora, setAgora] = useState(() => new Date());
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [filtroApp, setFiltroApp] = useState('');
  const [filtroLoja, setFiltroLoja] = useState('');

  const carregar = useCallback(async () => {
    try {
      const r: any = await api.get('/aplicativos-conectados');
      setAgora(new Date());
      setEstado({ fase: 'pronto', aplicativos: r.aplicativos ?? [] });
    } catch (e) {
      const status = e instanceof ApiError ? e.status : -1;
      if (status === 401) return;
      if (status === 403) setEstado({ fase: 'sem_acesso' });
      else if (status === 404) setEstado({ fase: 'so_nuvem' });
      else setEstado({ fase: 'erro', mensagem: e instanceof Error ? e.message : 'Não foi possível carregar.' });
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    if (process.env.NEXT_PUBLIC_EDGE === '1') {
      setEstado({ fase: 'so_nuvem' });
      return;
    }
    void carregar();
  }, [carregar, router]);

  async function revogar() {
    if (!pedido) return;
    const { app, acesso } = pedido;
    setRevogando(true);
    try {
      if (acesso) await api.post(`/aplicativos-conectados/${acesso.id}/revogar`, {});
      else await api.post('/aplicativos-conectados/revogar-todos', { cliente: app.cliente });
      toast.success(
        acesso?.lojaNome ? `Revogado. O ${app.rotulo} não lê mais a ${acesso.lojaNome}.` : `Revogado. O ${app.rotulo} não lê mais nenhuma loja.`,
      );
      setPedido(null);
      await carregar();
      // A linha deixou de ter o botão que abriu o diálogo: o foco vai para o título da lista.
      document.getElementById(ID_TITULO)?.focus();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível revogar. Tente de novo.');
    } finally {
      setRevogando(false);
    }
  }

  const aviso = (titulo: string, descricao: string, acao?: React.ReactNode) => (
    <Shell eyebrow="Configurações" title="Aplicativos conectados">
      <EmptyState icon={<Plug className="h-6 w-6" aria-hidden="true" />} title={titulo} description={descricao} action={acao} />
    </Shell>
  );
  if (estado.fase === 'carregando')
    return (
      <Shell eyebrow="Configurações" title="Aplicativos conectados">
        <SkeletonList rows={3} />
      </Shell>
    );
  if (estado.fase === 'so_nuvem')
    return aviso('Disponível pelo Regem na internet', 'Os aplicativos conectados são vistos e revogados em app.dmsregem.com. O servidor da loja não guarda essas autorizações.');
  if (estado.fase === 'sem_acesso')
    return aviso('Só o presidente vê os aplicativos conectados', 'Autorizar e revogar a leitura dos dados das lojas é decisão do presidente da empresa.');
  if (estado.fase === 'erro')
    return aviso('Não deu para carregar os aplicativos', estado.mensagem, <Button type="button" variant="outline" onClick={() => { setEstado({ fase: 'carregando' }); void carregar(); }}>Tentar de novo</Button>);

  const apps = estado.aplicativos;
  const todas: Linha[] = apps.flatMap((app) => app.acessos.map((acesso) => ({ app, acesso })));
  const b = semAcento(busca);
  const base = todas.filter(
    (l) => (!b || semAcento(`${l.app.rotulo} ${lojaDe(l)}`).includes(b)) && (!filtroApp || l.app.rotulo === filtroApp) && (!filtroLoja || lojaDe(l) === filtroLoja),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || filtroApp || filtroLoja || sit >= 0);
  const limpar = () => { setBusca(''); setFiltroApp(''); setFiltroLoja(''); setSit(-1); };

  return (
    <Shell eyebrow="Configurações" title="Aplicativos conectados">
      <section className="space-y-3" aria-labelledby={ID_TITULO}>
        <TituloLista id={ID_TITULO} titulo="Aplicativos conectados" total={todas.length} mostrando={linhas.length} um="acesso" varios="acessos"
          extra="ferramentas que leem dados das suas lojas com a sua autorização · você revoga quando quiser">
          {apps.filter((a) => a.ativos > 1).map((a) => (
            <Button key={a.cliente} type="button" variant="outline" onClick={() => setPedido({ app: a, acesso: null })}>
              <Unplug className="h-4 w-4" aria-hidden="true" /> Revogar o {a.rotulo} em todas as lojas
            </Button>
          ))}
        </TituloLista>

        {todas.length === 0 ? (
          <EmptyState
            icon={<Plug className="h-6 w-6" aria-hidden="true" />}
            title="Nenhum aplicativo conectado"
            description="Quando você autorizar uma ferramenta a ler dados das lojas, ela aparece aqui, com o que recebe e o botão de revogar."
          />
        ) : (
          <>
            <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
            <Filtros>
              <FiltroBusca id="aplicativos-busca" valor={busca} aoMudar={setBusca} placeholder="Loja ou aplicativo" />
              <FiltroSelect id="aplicativos-app" rotulo="Aplicativo" todos="Todos os aplicativos" opcoes={distintos(todas, (l) => l.app.rotulo)} valor={filtroApp} aoMudar={setFiltroApp} />
              <FiltroSelect id="aplicativos-loja" rotulo="Loja" todos="Todas as lojas" opcoes={distintos(todas, lojaDe).filter((x) => x !== 'Todas as lojas')} valor={filtroLoja} aoMudar={setFiltroLoja} />
            </Filtros>
            {linhas.length === 0 ? (
              <Vazio aoLimpar={limpar} />
            ) : (
              <ListaDados
                legenda="Acessos dos aplicativos às lojas: o que recebem, quem autorizou e o último acesso"
                linhas={linhas}
                chave={(l) => l.acesso.id}
                nome={(l) => `${l.app.rotulo} ${l.acesso.lojaNome ? `na ${l.acesso.lojaNome}` : 'em todas as lojas'}`}
                colunas={[
                  {
                    titulo: 'Aplicativo',
                    celula: (l) => (
                      <span className="flex items-center gap-2.5">
                        <SeloApp cliente={l.app.cliente} rotulo={l.app.rotulo} pequeno />
                        <span className="min-w-0"><NomeComApoio nome={l.app.rotulo} apoio={l.app.descricao || undefined} /></span>
                      </span>
                    ),
                  },
                  { titulo: 'Loja', celula: (l) => lojaDe(l) },
                  {
                    titulo: 'Recebe',
                    celula: (l) => {
                      if (!l.acesso.ativo) return '—';
                      const r = resumoDoAcesso(l.acesso.escopos, l.app.cliente);
                      return <>{r.recebe}{r.nota && <span className={`block text-xs ${texto2}`}>{r.nota}</span>}</>;
                    },
                  },
                  { titulo: 'Autorizado por', celula: (l) => autorizadoPor(l.acesso) },
                  { titulo: 'Último acesso', celula: (l) => (l.acesso.ativo ? haQuanto(l.acesso.ultimoUsoEm, agora) : comoSaiu(l.acesso, l.app.rotulo)) },
                  { titulo: 'Situação', celula: (l) => <Selo tom={l.acesso.ativo ? 'ok' : 'neutro'}>{l.acesso.ativo ? 'ativo' : 'revogado'}</Selo> },
                ]}
                acoes={(l) => (l.acesso.ativo ? [{ rotulo: 'Revogar', icone: Unplug, aoClicar: (x: Linha) => setPedido({ app: x.app, acesso: x.acesso }), tom: 'perigo' as const }] : [])}
              />
            )}
            {filtrando && linhas.length > 0 && (
              <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
            )}
            {/* Como incluir outra loja ou religar: um recado por aplicativo (era o rodapé de cada cartão). */}
            <Card className={`space-y-1.5 p-3 text-sm ${texto2}`}>
              {apps.map((a) => (
                <p key={a.cliente}>
                  <b className="text-foreground">{a.rotulo}:</b>{' '}
                  {a.abrangencia === 'empresa'
                    ? 'este acesso é emitido pela distribuição DMS a pedido do presidente. Para ligar de novo depois de revogar, fale com o suporte.'
                    : `para incluir outra loja ou mudar o que o ${a.rotulo} recebe, comece pelo ${a.rotulo}, em Contas conectadas.`}
                </p>
              ))}
            </Card>
          </>
        )}
      </section>

      {pedido && (
        <DialogoRevogar
          app={pedido.app.rotulo}
          leitura={pedido.app.cliente === 'liame' ? 'os pedidos' : 'os dados'}
          loja={pedido.acesso?.lojaNome ?? null}
          revogando={revogando}
          aoManter={() => setPedido(null)}
          aoRevogar={() => void revogar()}
          voltarPara={ID_TITULO}
        />
      )}
    </Shell>
  );
}
