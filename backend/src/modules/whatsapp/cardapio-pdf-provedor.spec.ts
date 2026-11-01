import { WhatsappProvedorService } from './whatsapp-provedor.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CARDÁPIO EM PDF PELA VIA DA LOJA (Bloco 6 do plano do robô, 01/11/2026): o botão "Enviar cardápio" da caixa de
// conversas só mandava pela Evolution — na loja da API oficial dava erro. Agora o mesmo PDF vai pela via da loja.

/** O banco só para a pergunta "qual o provedor da loja?" (select … from cardapio_config where …). */
const bancoDaLoja = (provedor: 'cloud' | 'evolution') =>
  ({ select: () => ({ from: () => ({ where: async () => [{ provedor }] }) }) }) as any;

function servico(provedor: 'cloud' | 'evolution') {
  const chamadas: any[] = [];
  const evolution = {
    pdfDoCardapio: async (t: string, c?: string) => {
      chamadas.push(['pdf', t, c ?? null]);
      return { pdf: Buffer.from('%PDF'), arquivo: 'cardapio-loja.pdf', legenda: 'Cardápio · Loja', itens: 12 };
    },
    enviarCardapio: async (t: string, n: string, c?: string) => {
      chamadas.push(['evolution', t, n, c ?? null]);
      return { ok: true, itens: 12 };
    },
  } as any;
  const cloud = {
    enviarDocumentoPdf: async (t: string, n: string, pdf: Buffer, arquivo: string, legenda: string) => {
      chamadas.push(['oficial', t, n, pdf.toString(), arquivo, legenda]);
      return { ok: true, id: 'wamid.X' };
    },
  } as any;
  return { svc: new WhatsappProvedorService(bancoDaLoja(provedor), {} as any, evolution, cloud), chamadas };
}

describe('cardápio em PDF pela via da loja', () => {
  it('loja da API oficial: o PDF do cardápio sobe à Meta e vai como documento', async () => {
    const { svc, chamadas } = servico('cloud');
    expect(await svc.enviarCardapio('t-1', '5521987654321', 'card-1')).toEqual({ ok: true, itens: 12 });
    expect(chamadas).toEqual([
      ['pdf', 't-1', 'card-1'],
      ['oficial', 't-1', '5521987654321', '%PDF', 'cardapio-loja.pdf', 'Cardápio · Loja'],
    ]);
  });

  it('loja com o WhatsApp por QR: segue pela Evolution, como sempre', async () => {
    const { svc, chamadas } = servico('evolution');
    expect(await svc.enviarCardapio('t-1', '5521987654321')).toEqual({ ok: true, itens: 12 });
    expect(chamadas).toEqual([['evolution', 't-1', '5521987654321', null]]);
  });
});
