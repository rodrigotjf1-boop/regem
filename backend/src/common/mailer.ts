import { Logger } from '@nestjs/common';

// Envio de e-mail transacional via Resend (HTTP, sem SMTP). Config por ENV:
//   RESEND_API_KEY  — chave da conta Resend (sem ela: modo dev, só loga).
//   MAIL_FROM       — remetente verificado (ex.: "Regem <nao-responda@dmsregem.com>").
// Fail-safe: qualquer erro retorna false (o chamador decide o que fazer) e NUNCA
// estoura — envio de e-mail não pode derrubar um cadastro.

const logger = new Logger('Mailer');

export async function enviarEmail(
  para: string,
  assunto: string,
  html: string,
  texto?: string,
): Promise<boolean> {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim() || 'Regem <nao-responda@dmsregem.com>';
  if (!key) {
    // Dev/local: sem provider configurado, apenas registra (permite testar o fluxo).
    logger.warn(`[DEV] RESEND_API_KEY ausente — e-mail não enviado. para=${para} assunto="${assunto}"`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [para], subject: assunto, html, ...(texto ? { text: texto } : {}) }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      logger.warn(`Resend falhou (${res.status}): ${t.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e: any) {
    logger.warn(`Resend erro: ${e?.message ?? e}`); // eslint-disable-line @typescript-eslint/no-explicit-any
    return false;
  }
}

// E-mail com o código de 6 dígitos da verificação de cadastro.
export async function enviarCodigoVerificacao(para: string, nome: string, codigo: string): Promise<boolean> {
  const saudacao = nome ? `Olá, ${nome}!` : 'Olá!';
  const assunto = `Regem — seu código de verificação: ${codigo}`;
  const html = `
  <div style="background:#0B1220;padding:32px 0;font-family:Helvetica,Arial,sans-serif">
    <div style="max-width:480px;margin:0 auto;background:#0F1A2E;border:1px solid #243150;border-radius:16px;overflow:hidden">
      <div style="padding:28px 32px;border-bottom:1px solid #243150">
        <span style="color:#EDF1F8;font-size:20px;font-weight:700">Regem</span>
        <span style="color:#909CB4;font-size:12px;letter-spacing:.14em;text-transform:uppercase;display:block;margin-top:4px">Do balcão ao balanço</span>
      </div>
      <div style="padding:32px">
        <p style="color:#EDF1F8;font-size:15px;margin:0 0 8px">${saudacao}</p>
        <p style="color:#909CB4;font-size:14px;margin:0 0 24px">Use o código abaixo para confirmar seu e-mail e criar sua conta:</p>
        <div style="text-align:center;background:#0B1220;border:1px solid #243150;border-radius:12px;padding:20px;margin-bottom:24px">
          <span style="color:#E2A340;font-size:34px;font-weight:700;letter-spacing:.5em;font-family:'Courier New',monospace">${codigo}</span>
        </div>
        <p style="color:#5c6a86;font-size:12px;margin:0">O código vale por 15 minutos. Se você não pediu este cadastro, ignore este e-mail.</p>
      </div>
    </div>
  </div>`;
  const texto = `${saudacao}\n\nSeu código de verificação Regem é ${codigo}. Ele vale por 15 minutos.\nSe você não pediu este cadastro, ignore este e-mail.`;
  return enviarEmail(para, assunto, html, texto);
}
