'use client';

import { useEffect, useState } from 'react';
import { Copy, Mail, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const CANAL: Record<string, string> = { whatsapp: 'WhatsApp', email: 'e-mail' };
/** "enviado por WhatsApp em 10/10 às 14:32" — ou '' quando o pedido não foi marcado como enviado. */
export function textoDoEnvio(p: { enviadoEm?: string | null; enviadoCanal?: string | null } | null | undefined): string {
  if (!p?.enviadoEm) return '';
  const d = new Date(p.enviadoEm);
  if (Number.isNaN(d.getTime())) return '';
  const dia = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return `enviado por ${CANAL[p.enviadoCanal ?? ''] ?? 'outro meio'} em ${dia} às ${hora}`;
}

// Mesma aparência do botão do sistema, num LINK de verdade: quem abre o WhatsApp e o e-mail é o
// navegador da pessoa (um link não é barrado como janela indesejada).
const linkBotao = 'inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

// Enviar o pedido ao fornecedor (decisão do dono, 10/10/2026): o Regem NÃO envia sozinho. O diálogo
// mostra o pedido em texto e abre o WhatsApp ou o e-mail de quem está usando, com tudo já escrito;
// a pessoa toca em enviar lá e volta aqui para MARCAR como enviado — é ela quem sabe se saiu.
// Sem fornecedor no pedido (não é obrigatório) ou sem contato no cadastro, fica o "copiar texto".
export function EnviarPedido({ pedido, voltarPara, aoFechar, aoMarcar }: { pedido: { id: string; nome: string }; voltarPara?: string; aoFechar: () => void; aoMarcar: () => void }) {
  const [dados, setDados] = useState<any>(null);
  const [erro, setErro] = useState('');
  // O canal que a pessoa acabou de abrir: a tela pergunta se enviou.
  const [abriu, setAbriu] = useState<'whatsapp' | 'email' | null>(null);
  const [marcando, setMarcando] = useState(false);

  useEffect(() => {
    let vivo = true;
    api.pedidoParaEnviar(pedido.id)
      .then((r: any) => { if (vivo) setDados(r); })
      .catch((e: unknown) => { if (vivo) setErro(e instanceof Error ? e.message : 'Não consegui montar o pedido para envio.'); });
    return () => { vivo = false; };
  }, [pedido.id]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(dados.texto);
      toast.success('Texto do pedido copiado.');
    } catch {
      toast.error('Não consegui copiar. Selecione o texto e copie à mão.');
    }
  }
  async function marcar() {
    if (!abriu || marcando) return;
    setMarcando(true);
    try {
      await api.marcarPedidoEnviado(pedido.id, abriu);
      toast.success(`Pedido marcado como enviado por ${CANAL[abriu]}.`);
      aoMarcar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao marcar o envio');
      setMarcando(false);
    }
  }

  const f = dados?.fornecedor;
  const jaEnviado = textoDoEnvio(dados);
  return (
    <Dialogo largura="md" titulo="Enviar ao fornecedor" aoFechar={aoFechar} voltarPara={voltarPara} fecharNoFundo={false}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar}>{abriu ? 'Fechar' : 'Agora não'}</Button>
          {dados?.email && (
            <a href={dados.email} className={`${linkBotao} border border-input bg-card hover:bg-secondary`} onClick={() => setAbriu('email')}>
              <Mail className="h-4 w-4" aria-hidden="true" /> Abrir e-mail
            </a>
          )}
          {dados?.whatsapp && (
            <a href={dados.whatsapp} target="_blank" rel="noopener noreferrer" className={`${linkBotao} bg-primary text-primary-foreground hover:bg-primary/90`} onClick={() => setAbriu('whatsapp')}>
              <MessageCircle className="h-4 w-4" aria-hidden="true" /> Abrir WhatsApp
            </a>
          )}
        </>
      }>
      <div className="space-y-3 text-sm">
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erro}</p>}
        {!dados && !erro && <p className={texto2}>Montando o pedido…</p>}
        {dados && (
          <>
            {f ? (
              <p>
                Para <b>{f.nome}</b>{f.contato ? ` (a/c ${f.contato})` : ''}
                <span className={`block break-words text-xs ${texto2}`}>{[f.telefone, f.email].filter(Boolean).join(' · ') || 'sem telefone nem e-mail no cadastro'}</span>
              </p>
            ) : (
              <p className={texto2}>Este pedido não tem fornecedor. Copie o texto e envie por onde preferir.</p>
            )}
            {f && !dados.whatsapp && !dados.email && (
              <p className="rounded-md border-l-4 border-info bg-info/10 px-3 py-2">
                O cadastro de <b>{f.nome}</b> não tem um telefone com DDD nem um e-mail que sirvam para abrir o envio. Complete em Cadastros › Fornecedores — ou copie o texto abaixo.
              </p>
            )}
            {(dados.whatsapp || dados.email) && (
              <p className={texto2}>O botão abre o seu WhatsApp ou o seu e-mail com o pedido já escrito: é você quem toca em enviar. Os valores não vão no texto.</p>
            )}
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">Texto do pedido</span>
                <Button type="button" variant="outline" size="sm" onClick={copiar}><Copy className="h-4 w-4" aria-hidden="true" /> Copiar texto</Button>
              </div>
              <pre className="max-h-[38vh] overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-secondary px-3 py-2 font-sans" aria-label="Texto do pedido">{dados.texto}</pre>
            </div>
            {abriu ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2" role="status">
                <span className="min-w-0 flex-1 basis-48">Enviou o pedido pelo {CANAL[abriu]}? Marque para ficar registrado no pedido.</span>
                <Button type="button" size="sm" onClick={marcar} disabled={marcando}>{marcando ? 'Marcando…' : 'Marcar como enviado'}</Button>
              </div>
            ) : jaEnviado ? (
              <p className="font-semibold" role="status">Este pedido já foi marcado como {jaEnviado}.</p>
            ) : null}
          </>
        )}
      </div>
    </Dialogo>
  );
}
