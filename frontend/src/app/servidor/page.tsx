'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

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
            <li className="flex gap-2"><span className="text-ok">✓</span> Cerca de <strong>2 GB livres</strong> + internet na 1ª instalação.</li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            A instalação leva alguns minutos e é automática — você só entra com a conta.
          </p>
        </Card>
      </div>
    </Shell>
  );
}
