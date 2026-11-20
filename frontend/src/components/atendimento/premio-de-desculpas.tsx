'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Gaveta } from '@/components/ui/sobreposto';
import { cn } from '@/lib/utils';

// "MANDAR UM PRÊMIO DE DESCULPAS" no caso do Atendimento (fase A1b do Clube; protótipo `mockups/regem-clube-banner.html`,
// "Atendimento"). Só aparece com o prêmio surpresa e o gatilho "Depois de uma reclamação" ligados no Clube; o servidor
// diz se este caso pode receber (telefone do cliente, fora do iFood/99, o perfil de quem está logado, o limite por
// cliente, um por caso) e confere tudo de novo ao mandar. No servidor da loja, a nuvem decide (a rota repassa).

type Estado = {
  mostrar: boolean;
  disponivel: boolean;
  motivo: string | null;
  cliente: string | null;
  premios: Array<{ id: string; nome: string; descricao: string }>;
  limite: string;
  recebidos: number;
  dado: { premio: string; em: string; link: string } | null;
  mensagemPadrao: string;
  mensagemMax: number;
};
type Mandado = { premio: string; link: string; validoAte: string; enviado: boolean; motivoEnvio: string | null };

const diaMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function CopiarLink({ link }: { link: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-card px-3 py-2">
      <code className="min-w-0 flex-1 break-all font-mono text-xs">{link}</code>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          navigator.clipboard
            ?.writeText(link)
            .then(() => toast.success('Link copiado.'))
            .catch(() => toast.error('Não deu para copiar: selecione o link e copie.'))
        }
      >
        Copiar o link
      </Button>
    </div>
  );
}

export function PremioDeDesculpas({ casoId }: { casoId: string }) {
  const id = useId();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [aberta, setAberta] = useState(false);
  const [premioId, setPremioId] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [mandando, setMandando] = useState(false);
  const [erro, setErro] = useState('');
  const [mandado, setMandado] = useState<Mandado | null>(null);

  const ler = useCallback(() => {
    let vivo = true;
    api
      .atendimentoPremioDesculpas(casoId)
      .then((e: any) => vivo && setEstado(e as Estado))
      .catch(() => vivo && setEstado(null)); // sem o estado (sem a nuvem), o quadro não aparece: nada de botão que não grava
    return () => {
      vivo = false;
    };
  }, [casoId]);
  useEffect(() => {
    setMandado(null);
    return ler();
  }, [ler]);

  if (!estado?.mostrar) return null;

  function abrir() {
    setPremioId(estado?.premios[0]?.id ?? '');
    setMensagem('');
    setErro('');
    setAberta(true);
  }

  async function mandar() {
    setErro('');
    if (!premioId) {
      setErro('Escolha o prêmio.');
      return;
    }
    setMandando(true);
    try {
      const r = (await api.atendimentoMandarPremioDesculpas(casoId, { premioId, mensagem: mensagem.trim() || undefined })) as Mandado;
      setMandado(r);
      setAberta(false);
      if (r.enviado) toast.success(`Prêmio de desculpas mandado: ${r.premio}.`);
      else toast.error(r.motivoEnvio ?? 'O prêmio foi dado, mas a mensagem não saiu.');
      ler();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não foi possível mandar o prêmio.';
      setErro(msg);
      toast.error(msg);
    } finally {
      setMandando(false);
    }
  }

  const nome = estado.cliente?.split(' ')[0] || 'o cliente';
  return (
    <section className="space-y-2 rounded-lg border border-border bg-card p-3" aria-labelledby={`${id}-titulo`}>
      <h4 id={`${id}-titulo`} className="font-display text-sm font-bold">
        🎁 Prêmio de desculpas
      </h4>
      {estado.dado ? (
        <>
          <p className="text-sm">
            Este caso já recebeu <b>{estado.dado.premio}</b> em {diaMes(estado.dado.em)}. O link para revelar:
          </p>
          <CopiarLink link={estado.dado.link} />
        </>
      ) : (
        <>
          <p className="text-sm text-secondary-foreground">
            Resolvido o problema, a equipe pode mandar um prêmio de desculpas. Ele aparece na conta do cliente e vai pelo WhatsApp da
            conversa.
          </p>
          {!estado.disponivel && estado.motivo && <p className="text-sm font-semibold">{estado.motivo}</p>}
          <Button type="button" variant="outline" disabled={!estado.disponivel} onClick={abrir}>
            🎁 Mandar um prêmio de desculpas
          </Button>
        </>
      )}
      {mandado && !mandado.enviado && (
        <div className="space-y-1" role="status">
          <p className="text-sm">{mandado.motivoEnvio}</p>
          <CopiarLink link={mandado.link} />
        </div>
      )}

      {aberta && (
        <Gaveta
          titulo="Mandar um prêmio de desculpas"
          aoFechar={() => setAberta(false)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setAberta(false)}>Cancelar</Button>
              <Button type="button" onClick={mandar} disabled={mandando}>{mandando ? 'Mandando…' : 'Mandar o prêmio'}</Button>
            </>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-secondary-foreground">Atendimento · {estado.cliente || 'cliente'}</p>
            <div className="space-y-2">
              <span id={`${id}-premios`} className="text-sm font-semibold">Prêmio</span>
              <div className="grid grid-cols-1 gap-2" role="group" aria-labelledby={`${id}-premios`}>
                {estado.premios.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={premioId === p.id}
                    onClick={() => setPremioId(p.id)}
                    className={cn(
                      'grid min-h-12 gap-0.5 rounded-lg border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      premioId === p.id ? 'border-primary bg-primary/10' : 'border-border bg-card',
                    )}
                  >
                    <b className="text-sm">{p.nome}</b>
                    <span className="text-xs text-secondary-foreground">{p.descricao}</span>
                  </button>
                ))}
              </div>
            </div>
            <p className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm">
              {estado.recebidos
                ? `${nome.charAt(0).toUpperCase() + nome.slice(1)} já recebeu ${estado.recebidos} prêmio de desculpas no período (limite: ${estado.limite}).`
                : `${nome.charAt(0).toUpperCase() + nome.slice(1)} ainda não recebeu prêmio de desculpas no período (limite: ${estado.limite}).`}
            </p>
            <div className="space-y-1">
              <Label htmlFor={`${id}-msg`}>Mensagem junto (opcional)</Label>
              <textarea
                id={`${id}-msg`}
                className="min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                maxLength={estado.mensagemMax}
                value={mensagem}
                placeholder={estado.mensagemPadrao}
                onChange={(e) => setMensagem(e.target.value)}
              />
              <p className="text-xs text-secondary-foreground">
                Sem mensagem, vai a padrão. O link para revelar o prêmio entra no fim. É a mesma conversa do atendimento: não conta como
                marketing.
              </p>
            </div>
            {erro && (
              <p role="alert" className="text-sm font-semibold text-destructive">
                {erro}
              </p>
            )}
          </div>
        </Gaveta>
      )}
    </section>
  );
}
