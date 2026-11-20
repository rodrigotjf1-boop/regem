import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { linkDoCardapioDaLoja } from '../whatsapp/links-do-robo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A PALAVRA "PRIVACIDADE" NO WHATSAPP (F1c do docs/plano-perfil-cliente.md, §3.6; protótipo, aba "No cardápio": "Mude quando
// quiser no Perfil ou mandando PRIVACIDADE no WhatsApp"). Como o SAIR: a palavra sozinha, antes do robô, com a resposta fixa
// — o link de Sua conta › Perfil do cardápio, onde ficam as escolhas. As escolhas só mudam lá: lá o cliente prova a posse
// do número com o código (V79); a resposta do WhatsApp não muda nada.
// Só com o módulo "Perfil do cliente" ligado na empresa; desligado, a mensagem segue o caminho de sempre (o robô responde).

export const PEDE_PRIVACIDADE = /^(privacidade|meus dados|minha privacidade)\.?$/;

export function textoDaPrivacidade(link: string): string {
  return [
    'Para ver e mudar o que a loja guarda sobre você, entre no cardápio com este número e abra Sua conta › Perfil › Privacidade:',
    link,
    'Lá você liga ou desliga as recomendações, o jeito de atendimento e as ofertas, e pode marcar "Não quero ser analisado".',
  ].join('\n');
}

/**
 * A resposta à palavra PRIVACIDADE, ou `null` (não é a palavra, o módulo está desligado, a loja não tem cardápio, ou a
 * leitura falhou — nesses casos a mensagem segue o caminho de sempre). Nunca rejeita (V3).
 */
export async function respostaDePrivacidade(
  db: any,
  p: { tenantId: string; cardapioToken: string | null | undefined; texto: string | null | undefined },
): Promise<string | null> {
  const txt = String(p.texto ?? '').trim().toLowerCase();
  if (!PEDE_PRIVACIDADE.test(txt) || !p.cardapioToken) return null;
  try {
    const r: any = await db.execute(sql`
      select exists (select 1 from modulo_ativacao
                      where tenant_id = ${p.tenantId}::uuid and modulo = 'perfil_cliente' and ativo) as ativo`);
    if (!(r.rows ?? r)[0]?.ativo) return null;
    return textoDaPrivacidade(`${linkDoCardapioDaLoja(p.cardapioToken)}?conta=perfil`);
  } catch (e: any) {
    new Logger('PrivacidadePeloWhatsapp').warn(`PRIVACIDADE não conferida (segue como antes): ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
    return null;
  }
}
