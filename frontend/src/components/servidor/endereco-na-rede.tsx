'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { SkeletonList } from '@/components/ui/skeleton';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Endereço do servidor da loja na rede (conexão PC ↔ servidor, parte 1 — protótipo aprovado em 20/10/2026,
// mockups/regem-conexao-servidor.html peça 1). Os PCs acham o servidor pelo nome regem.local; quando a rede
// não resolve o nome, o dono digita o IP numa emergência. O roteador pode dar outro IP ao servidor quando
// ele reinicia: o cartão mostra o IP de antes e ensina a fixar o IP no roteador (com o MAC).
// No servidor da loja lê `GET /edge/rede`; na nuvem, o que o servidor informou na batida
// (`minha-loja/servidor` → `rede`) — dá para ver o IP pelo celular.

const NO_EDGE = process.env.NEXT_PUBLIC_EDGE === '1';

type Rede = {
  nome: string;
  maquina: string | null;
  ip: string | null;
  interface: string | null;
  mac: string | null;
  gateway: string | null;
  outros: Array<{ ip: string; interface: string }>;
  portas: { app: number; api: number };
  desde: string | null;
  anterior: string | null;
  medidoEm: string;
};

type Estado =
  | { tipo: 'carregando' }
  | { tipo: 'erro'; msg: string }
  | { tipo: 'sem-servidor' }
  | { tipo: 'ok'; rede: Rede | null; pcs: number; online: boolean };

// "17/10 às 19h02"
function quando(iso: string | null | undefined) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }).replace(':', 'h');
  return `${dia} às ${h}`;
}

function copiar(valor: string) {
  try {
    navigator.clipboard.writeText(valor).then(
      () => toast.success('Copiado.'),
      () => toast.error('Não deu para copiar. Selecione o texto e use Ctrl+C.'),
    );
  } catch {
    toast.error('Não deu para copiar. Selecione o texto e use Ctrl+C.');
  }
}

function Linha({ rotulo, valor, ajuda, copia }: { rotulo: string; valor: React.ReactNode; ajuda?: React.ReactNode; copia?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 border-b border-border py-3 sm:grid-cols-[minmax(150px,210px)_minmax(0,1fr)_auto]">
      <dt className="col-span-2 text-sm font-semibold text-secondary-foreground sm:col-span-1">{rotulo}</dt>
      <dd className="min-w-0">
        <span className="break-words font-mono text-sm font-bold">{valor}</span>
        {ajuda && <p className="mt-0.5 text-xs text-secondary-foreground">{ajuda}</p>}
      </dd>
      {copia ? (
        <Button type="button" variant="outline" size="sm" onClick={() => copiar(copia)} aria-label={`Copiar ${rotulo.toLowerCase()}`}>
          Copiar
        </Button>
      ) : (
        <span aria-hidden="true" />
      )}
    </div>
  );
}

export function EnderecoNaRede() {
  const [estado, setEstado] = useState<Estado>({ tipo: 'carregando' });

  const carregar = useCallback(async () => {
    setEstado({ tipo: 'carregando' });
    try {
      if (NO_EDGE) {
        const r: any = await api.edgeRede();
        setEstado({ tipo: 'ok', rede: r?.ip ? r : null, pcs: Number(r?.pcsConectados ?? 0), online: true });
      } else {
        const s: any = await api.meuServidor();
        if (!s?.instalado) return setEstado({ tipo: 'sem-servidor' });
        setEstado({ tipo: 'ok', rede: s.rede ?? null, pcs: Number(s.pcsConectados ?? 0), online: !!s.online });
      }
    } catch (e) {
      setEstado({ tipo: 'erro', msg: e instanceof Error ? e.message : 'Erro ao consultar o servidor' });
    }
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (estado.tipo === 'carregando') return <Card className="p-6 lg:col-span-3"><SkeletonList rows={3} /></Card>;
  if (estado.tipo === 'sem-servidor') return null;
  if (estado.tipo === 'erro')
    return (
      <Card className="flex flex-wrap items-center justify-between gap-3 p-6 lg:col-span-3">
        <p className="text-sm" role="alert"><b>Não deu para ver o endereço do servidor agora.</b> {estado.msg}</p>
        <Button type="button" variant="outline" onClick={() => void carregar()}>Tentar de novo</Button>
      </Card>
    );

  const { rede, pcs, online } = estado;
  const titulo = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-display text-lg font-bold">Endereço na rede</h2>
        <p className="max-w-prose text-sm text-secondary-foreground">
          Os PCs da loja encontram o servidor pelo nome. Se um PC não achar, use o IP numa emergência.
        </p>
      </div>
      {NO_EDGE ? (
        <span className="rounded-full bg-ok/15 px-2 py-0.5 text-xs font-medium">● respondendo</span>
      ) : online ? (
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
          informado {rede?.medidoEm ? `em ${quando(rede.medidoEm)}` : 'pelo servidor'}
        </span>
      ) : (
        <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium">○ servidor sem sinal</span>
      )}
    </div>
  );

  // Servidor numa versão que ainda não manda o endereço (ou sem medição ainda).
  if (!rede)
    return (
      <Card className="p-6 lg:col-span-3">
        {titulo}
        <p className="mt-4 text-sm">
          O servidor da loja ainda não informou o endereço dele. Ele passa a informar depois da próxima atualização do servidor.
          Até lá, os PCs continuam usando <span className="font-mono font-bold">https://regem.local:3001</span>.
        </p>
      </Card>
    );

  const endereco = `https://${rede.nome}:${rede.portas.app}`;
  const desde = quando(rede.desde);
  const roteador = rede.gateway ?? '192.168.0.1';

  return (
    <Card className="p-6 lg:col-span-3">
      {titulo}

      {!NO_EDGE && !online && (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm" role="alert">
          <p className="font-semibold">O servidor não manda sinal agora.</p>
          <p className="mt-1 text-secondary-foreground">
            Confira se o PC servidor está ligado e com internet. O endereço abaixo é o último que ele informou; se ele foi reiniciado
            depois disso, o IP pode ter mudado.
          </p>
        </div>
      )}

      <dl className="mt-4 border-t border-border">
        <Linha
          rotulo="Endereço para os PCs"
          valor={<>https://<wbr />{rede.nome}<wbr />:{rede.portas.app}</>}
          ajuda="O instalador já usa este nome. Ele não muda quando o roteador troca o IP."
          copia={endereco}
        />
        <Linha
          rotulo={!NO_EDGE && !online ? 'Último IP informado' : 'IP do servidor agora'}
          valor={rede.ip}
          ajuda={
            desde && rede.anterior ? (
              <>Desde {desde}. Antes era <span className="font-mono">{rede.anterior}</span>: o roteador trocou o IP quando o servidor reiniciou.</>
            ) : (
              'Use numa emergência, se um PC não achar o servidor pelo nome.'
            )
          }
          copia={rede.ip ?? undefined}
        />
        {rede.gateway && <Linha rotulo="Roteador" valor={rede.gateway} />}
        {rede.maquina && <Linha rotulo="Nome do PC servidor" valor={rede.maquina} />}
        {rede.mac && <Linha rotulo="Placa de rede (MAC)" valor={rede.mac} ajuda="É o que o roteador pede para fixar o IP." copia={rede.mac} />}
        <Linha
          rotulo="Portas"
          valor={`${rede.portas.app} · ${rede.portas.api}`}
          ajuda={`${rede.portas.app} é o app; ${rede.portas.api} é por onde as estações, o ponto e o KDS falam.`}
        />
      </dl>

      {rede.outros.length > 0 && (
        <p className="mt-3 text-xs text-secondary-foreground">
          Outros endereços desta máquina:{' '}
          {rede.outros.map((o, i) => (
            <span key={o.ip}>
              {i > 0 && ', '}
              <span className="font-mono">{o.ip}</span> ({o.interface})
            </span>
          ))}
          . Os PCs da loja não usam estes.
        </p>
      )}

      <p className="mt-3 text-sm">
        <b>PCs conectados agora: {pcs}</b> ·{' '}
        <Link href="/equipamentos" className="underline underline-offset-2">ver em Equipamentos</Link>
      </p>

      <details className="mt-4 rounded-lg border border-border bg-secondary/40">
        <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
          Fixar o IP no roteador <span className="ml-1 rounded-full bg-ok/15 px-2 py-0.5 text-xs font-medium">recomendado</span>
        </summary>
        <div className="space-y-2 px-4 pb-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Num PC da loja, abra o navegador e digite <span className="font-mono font-bold">{roteador}</span>
              {rede.gateway ? ' (o endereço do roteador).' : ' (o endereço mais comum de roteador; se não abrir, tente 192.168.1.1).'}
            </li>
            <li>Entre com o usuário e a senha do roteador. Costumam estar na etiqueta embaixo dele.</li>
            <li>
              Procure a opção <b>DHCP</b> e, dentro dela, <b>Reserva de endereço</b>. Conforme a marca, ela aparece como
              &quot;IP fixo&quot;, &quot;Address Reservation&quot; ou &quot;Static Lease&quot;.
            </li>
            <li>
              Adicione uma reserva com o MAC <span className="font-mono font-bold">{rede.mac ?? '(o MAC acima)'}</span> e o IP{' '}
              <span className="font-mono font-bold">{rede.ip}</span>.
            </li>
            <li>Salve. O servidor passa a voltar sempre com o mesmo IP, mesmo depois de reiniciar.</li>
          </ol>
          <p className="text-xs text-secondary-foreground">
            Para conferir: reinicie o roteador; depois que a internet voltar, este cartão continua mostrando{' '}
            <span className="font-mono">{rede.ip}</span>.
          </p>
        </div>
      </details>
    </Card>
  );
}
