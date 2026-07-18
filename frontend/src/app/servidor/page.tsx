'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Restauração do estado da nuvem — só no edge e só para o presidente/C&O. Usada
// ao voltar pro modo local depois de ter operado na nuvem (queda do edge/PC): faz
// os 2 tempos (empurra pendente local → puxa a nuvem), aditivo (não apaga local).
function RestaurarServidor() {
  const [status, setStatus] = useState<any>(null);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState('');
  // Resolve o perfil no cliente (evita divergência de hidratação SSR/cliente).
  const [presidente, setPresidente] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setStatus(await api.edgeRestaurarStatus());
    } catch {
      /* fora do edge / sem permissão */
    }
  }, []);
  useEffect(() => {
    setPresidente(getCategoria() === 'presidente');
    carregar();
    const t = setInterval(carregar, 10000); // acompanha o andamento
    return () => clearInterval(t);
  }, [carregar]);

  if (!presidente) return null; // restaurar é só do presidente/C&O

  async function restaurar() {
    if (
      !confirm(
        'Restaurar do estado da nuvem? Primeiro sobem as vendas locais pendentes, depois o sistema puxa o que foi feito na nuvem. É aditivo (não apaga o que é só local). Faça com a loja parada.',
      )
    )
      return;
    setEnviando(true);
    setMsg('');
    try {
      await api.edgeRestaurar();
      setMsg('Restauração iniciada. Ela roda no próximo ciclo de sync — acompanhe o status abaixo.');
      await carregar();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao iniciar restauração');
    } finally {
      setEnviando(false);
    }
  }

  const emAndamento = status?.restaurando || status?.solicitado;
  return (
    <Card className="p-6 lg:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Restaurar do estado da nuvem</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Use ao voltar para o modo local depois de ter operado na nuvem (ex.: o servidor
            local caiu). Traz para cá o que foi feito na nuvem, sem apagar o que é local.
          </p>
        </div>
        <Button type="button" onClick={restaurar} disabled={enviando || emAndamento}>
          {status?.restaurando
            ? 'Restaurando…'
            : status?.solicitado
              ? 'Na fila…'
              : enviando
                ? 'Iniciando…'
                : 'Restaurar agora'}
        </Button>
      </div>
      {status?.restauradoEm && (
        <p className="mt-2 text-xs text-muted-foreground">
          Última restauração: {new Date(status.restauradoEm).toLocaleString('pt-BR')}
        </p>
      )}
      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
    </Card>
  );
}

// Só aparece no app rodando NO edge (build com NEXT_PUBLIC_EDGE=1). Verifica na
// nuvem se há versão nova e, se houver, deixa o gestor INSTALAR (a tarefa SYSTEM
// do Windows faz a troca com backup + rollback). Na nuvem o card fica oculto.
function AtualizacaoServidor() {
  const [status, setStatus] = useState<any>(null);
  const [carregando, setCarregando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [revertendo, setRevertendo] = useState(false);
  const [msg, setMsg] = useState('');

  const carregar = useCallback(async () => {
    try {
      setStatus(await api.edgeAtualizacaoStatus());
    } catch {
      /* fora do edge / sem sync_state ainda */
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function verificar() {
    setMsg('');
    setCarregando(true);
    try {
      const r: any = await api.edgeVerificarAtualizacao();
      if (r.ok === false) setMsg(r.erro || 'Não consegui verificar agora. Tente de novo.');
      else if (!r.disponivel) setMsg('Você já está com a versão mais recente.');
      setStatus(r);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao verificar');
    } finally {
      setCarregando(false);
    }
  }

  async function aplicar() {
    if (
      !confirm(
        'Instalar a atualização agora? Os serviços do servidor vão reiniciar por 1–2 minutos (KDS, PDV e ponto ficam indisponíveis nesse intervalo). Recomendado com a loja fechada.',
      )
    )
      return;
    setAplicando(true);
    setMsg('');
    try {
      await api.edgeAplicarAtualizacao();
      setMsg('Atualização iniciada. O servidor vai reiniciar em instantes — aguarde 1–2 minutos e recarregue a página.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao iniciar');
    } finally {
      setAplicando(false);
    }
  }

  async function reverter() {
    if (
      !confirm(
        'Reverter para a versão anterior?\n\nIsto desfaz a ÚLTIMA atualização e volta o servidor à versão que estava antes dela (código e app; o banco é mantido). Os serviços reiniciam por 1–2 minutos.\n\nSó confirme se algo passou a dar problema DEPOIS da última atualização. Recomendado com a loja fechada.',
      )
    )
      return;
    setRevertendo(true);
    setMsg('');
    try {
      await api.edgeReverterAtualizacao();
      setMsg('Rollback iniciado. O servidor vai reiniciar na versão anterior — aguarde 1–2 minutos e recarregue a página.');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Erro ao reverter');
    } finally {
      setRevertendo(false);
    }
  }

  return (
    <Card className="p-6 lg:col-span-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold">Atualização do servidor</h2>
          <p className="text-sm text-muted-foreground">
            Versão instalada: <strong className="font-mono">{status?.atual ?? '—'}</strong>
            {status?.disponivel && status?.ultima ? (
              <>
                {' '}· nova disponível:{' '}
                <strong className="font-mono text-primary">{status.ultima}</strong>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={verificar} disabled={carregando}>
            {carregando ? 'Verificando…' : 'Verificar atualização'}
          </Button>
          {status?.disponivel && (
            <Button type="button" onClick={aplicar} disabled={aplicando}>
              {aplicando ? 'Iniciando…' : 'Instalar atualização'}
            </Button>
          )}
          <Button type="button" variant="ghost" onClick={reverter} disabled={revertendo} className="text-muted-foreground">
            {revertendo ? 'Revertendo…' : 'Reverter atualização'}
          </Button>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        <strong>Reverter atualização</strong> volta o servidor à versão anterior à última atualização (código e app; o banco é mantido). Use só se algo passou a dar problema depois de atualizar.
      </p>
      {status?.disponivel && status?.notas && (
        <div className="mt-3 rounded-lg border border-border bg-secondary/40 p-3 text-sm">
          <p className="mb-1 text-xs font-bold uppercase text-muted-foreground">O que muda</p>
          <p className="whitespace-pre-line text-muted-foreground">{status.notas}</p>
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-muted-foreground">{msg}</p>}
    </Card>
  );
}

// URL do instalador (.exe) hospedado. Configure NEXT_PUBLIC_EDGE_INSTALLER_URL
// (build-time). Sem valor, mostra "em breve".
const INSTALLER = process.env.NEXT_PUBLIC_EDGE_INSTALLER_URL || '';

const PASSOS = [
  {
    t: 'Baixe e execute o instalador',
    d: 'Se o Windows avisar "protegeu o computador", clique em Mais informações → Executar assim mesmo.',
  },
  {
    t: 'Aceite o aviso de administrador',
    d: 'É preciso para instalar o servidor e o banco de dados no computador.',
  },
  {
    t: 'Entre com sua conta do Regem',
    d: 'O mesmo e-mail e senha que você usa no app. Pronto — ele configura e ativa tudo sozinho.',
  },
];

export default function ServidorPage() {
  const router = useRouter();
  useEffect(() => {
    if (!getToken()) router.replace('/entrar');
  }, [router]);

  return (
    <Shell eyebrow="Instalação" title="Servidor local">
      <div className="grid gap-4 lg:grid-cols-3">
        {process.env.NEXT_PUBLIC_EDGE === '1' && <AtualizacaoServidor />}
        {process.env.NEXT_PUBLIC_EDGE === '1' && <RestaurarServidor />}
        <Card className="p-6 lg:col-span-2">
          <h2 className="font-display text-xl font-bold">Instale o Regem na sua loja</h2>
          <p className="mt-2 max-w-prose text-sm text-muted-foreground">
            O servidor local deixa o <strong>KDS, o PDV e o ponto</strong> funcionando na sua rede
            <strong> mesmo sem internet</strong> — os pedidos sobem para a nuvem quando reconecta. É opcional,
            mas recomendado para o dia a dia da operação.
          </p>

          <div className="mt-5">
            {INSTALLER ? (
              <a href={INSTALLER}>
                <Button className="h-11 px-5">⬇ Baixar o instalador (Windows)</Button>
              </a>
            ) : (
              <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                O download ficará disponível aqui em breve. Enquanto isso, fale com a distribuição.
              </p>
            )}
          </div>

          <ol className="mt-6 flex flex-col gap-4">
            {PASSOS.map((p, i) => (
              <li key={p.t} className="flex gap-3">
                <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-primary/15 font-mono text-sm font-bold text-primary">
                  {i + 1}
                </span>
                <div>
                  <p className="font-semibold">{p.t}</p>
                  <p className="text-sm text-muted-foreground">{p.d}</p>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-6 text-xs text-muted-foreground">
            Ao final, o instalador mostra o <strong>endereço do servidor</strong> (ex.: <code>https://regem.local:3001</code>).
            Aponte os aparelhos da loja para esse endereço.
          </p>
        </Card>

        <Card className="h-fit p-6">
          <h3 className="font-display text-base font-bold">Antes de começar</h3>
          <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
            <li className="flex gap-2"><span className="text-ok">✓</span> Um PC com <strong>Windows</strong> na loja (fica ligado no horário de funcionamento).</li>
            <li className="flex gap-2"><span className="text-ok">✓</span> Na <strong>mesma rede</strong> (WiFi ou cabo) dos aparelhos.</li>
            <li className="flex gap-2"><span className="text-ok">✓</span> Cerca de <strong>2 GB livres</strong>.</li>
            <li className="flex gap-2"><span className="text-ok">✓</span> <strong>Internet só na instalação</strong> (para baixar e ativar). Depois, o servidor funciona <strong>sem internet</strong>.</li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            A instalação leva alguns minutos e é automática — você só entra com a conta. Depois de pronta,
            a loja opera offline e sincroniza com a nuvem quando reconecta.
          </p>
        </Card>
      </div>
    </Shell>
  );
}
