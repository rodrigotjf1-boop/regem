'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { EVENTO_DIAS_ESPECIAIS, NOME_DO_DIA, avisarQueMudou, diaDaSemana, minusculo, porExtenso } from '@/lib/dia-especial';
import { Button, buttonVariants } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A FAIXA DO FERIADO SEM RESPOSTA (H2a dos dias especiais; protótipo `mockups/regem-dias-especiais.html`, "Na loja", a faixa
// do topo — decisão 4: a pergunta na tela, sem custo). Abaixo do topo, em qualquer tela, 10 dias antes de um feriado que a
// loja ainda não respondeu, só para quem pode mudar o horário (presidente e gerente com a permissão da loja — a mesma das
// rotas). "Fechada" e "Horário normal" gravam na hora; "Outro horário…" abre a gaveta em Delivery › Configurações ›
// Horários. Some quando alguém responde. Lê ao abrir e a cada 30 minutos com a aba à vista (o feriado muda por dia, não por
// minuto); 403/404 = para de perguntar.

type Feriado = { chave: string; data: string; nome: string; normal: string | null };
const MEIA_HORA = 30 * 60_000;

export function FaixaDoFeriado({ ativo }: { ativo: boolean }) {
  const [feriado, setFeriado] = useState<Feriado | null>(null);
  const [gravando, setGravando] = useState(false);
  const parar = useRef(false);
  const leitura = useRef(0);

  const ler = useCallback(async () => {
    if (!ativo || parar.current) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const minha = ++leitura.current;
    try {
      const r: any = await api.diasEspeciaisSemResposta(10);
      if (minha !== leitura.current) return;
      const f = Array.isArray(r?.itens) ? r.itens[0] : null;
      setFeriado(f && typeof f.data === 'string' && typeof f.nome === 'string' ? f : null);
    } catch (e: any) {
      const status = Number(e?.status ?? e?.statusCode ?? 0);
      if (status === 403 || status === 404) parar.current = true;
      // Outra falha: fica como estava e tenta de novo na próxima volta (a faixa não pisca).
    }
  }, [ativo]);

  useEffect(() => {
    if (!ativo) {
      setFeriado(null);
      return;
    }
    void ler();
    const t = setInterval(() => void ler(), MEIA_HORA);
    const voltou = () => document.visibilityState === 'visible' && void ler();
    const mudou = () => void ler();
    document.addEventListener('visibilitychange', voltou);
    window.addEventListener(EVENTO_DIAS_ESPECIAIS, mudou);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', voltou);
      window.removeEventListener(EVENTO_DIAS_ESPECIAIS, mudou);
    };
  }, [ativo, ler]);

  if (!feriado) return null;

  async function responder(f: Feriado, funcionamento: 'fechada' | 'normal') {
    if (gravando) return;
    setGravando(true);
    try {
      await api.criarDiaEspecialDoHorario({ data: f.data, nome: f.nome.slice(0, 40), funcionamento, feriadoChave: f.chave });
      toast.success(funcionamento === 'fechada' ? `${porExtenso(f.data)}: a loja fica fechada (${f.nome}).` : `${porExtenso(f.data)}: vale o horário normal da semana.`);
      setFeriado(null);
      avisarQueMudou(); // a lista de Horários, se estiver aberta, relê (e esta faixa também, pelo mesmo aviso)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Não deu para gravar a resposta.');
    } finally {
      setGravando(false);
    }
  }

  const dia = minusculo(NOME_DO_DIA[diaDaSemana(feriado.data)]);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-warn/40 bg-warn/10 px-5 py-2.5 text-sm" role="status" aria-live="polite">
      <p className="min-w-0 flex-1 basis-72">
        <b>
          {porExtenso(feriado.data)}, é {feriado.nome}.
        </b>{' '}
        Como a loja fica nesse dia? Até alguém responder, vale o horário de {dia}
        {feriado.normal ? ` (${feriado.normal})` : ' (fechada)'}.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={gravando} onClick={() => void responder(feriado, 'fechada')}>
          Fechada
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={gravando} onClick={() => void responder(feriado, 'normal')}>
          Horário normal
        </Button>
        <a className={buttonVariants({ variant: 'outline', size: 'sm' })} href={`/delivery/configuracoes?aba=horarios&feriado=${encodeURIComponent(feriado.chave)}`}>
          Outro horário…
        </a>
      </div>
    </div>
  );
}
