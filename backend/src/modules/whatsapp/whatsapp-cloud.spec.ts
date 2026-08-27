import { WhatsappCloudService } from './whatsapp-cloud.service';

// Portões do recebimento da API oficial (Meta Cloud API). São eles que impedem os
// dois modos de falhar feio numa migração meio-feita:
//   - loja ainda no Evolution respondendo TAMBÉM pela Cloud (cliente recebe em dobro);
//   - robô respondendo por cima de um humano que já assumiu a conversa.
// Banco falso em memória — não depende de Postgres.

/* eslint-disable @typescript-eslint/no-explicit-any */
function fakeDb(row: any) {
  return {
    select: () => ({ from: () => ({ where: () => Promise.resolve(row ? [row] : []) }) }),
  } as any;
}

const PHONE_ID = '1296816510179011';
const DE = '5521999998888';

const LOJA = {
  tenantId: 'tenant-1',
  token: 'abc123',
  nomePublico: 'Mister Burguer',
  aberto: true,
  ativo: true,
  roboAtivo: true,
  roboPausados: [] as string[],
  roboSaudacao: 'Ola!',
  roboPrompt: 'prompt da loja',
  provedor: 'cloud',
  waCloudPhoneId: PHONE_ID,
};

function evento(texto = 'oi', from = DE) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_ID, display_phone_number: '5521989751705' },
              contacts: [{ wa_id: from, profile: { name: 'Maria' } }],
              messages: [
                { from, id: 'wamid.TESTE', type: 'text', timestamp: '1756200000', text: { body: texto } },
              ],
            },
          },
        ],
      },
    ],
  };
}

// Monta o service com o log silenciado e captura o que iria para o n8n.
function comLoja(row: any) {
  const svc = new WhatsappCloudService(fakeDb(row));
  (svc as any).logger = { log() {}, warn() {}, error() {}, debug() {} };
  const enviados: any[] = [];
  (svc as any).encaminhar = async (m: any) => {
    enviados.push(m);
  };
  return { svc, enviados };
}

describe('WhatsappCloudService — portões do recebimento', () => {
  it('não encaminha quando o phone_number_id não pertence a nenhuma loja', async () => {
    const { svc, enviados } = comLoja(null);
    await svc.processar(evento());
    expect(enviados).toHaveLength(0);
  });

  it('ignora o evento quando a loja está no Evolution (evita resposta duplicada)', async () => {
    const { svc, enviados } = comLoja({ ...LOJA, provedor: 'evolution' });
    await svc.processar(evento());
    expect(enviados).toHaveLength(0);
  });

  it('não encaminha com o robô desligado', async () => {
    const { svc, enviados } = comLoja({ ...LOJA, roboAtivo: false });
    await svc.processar(evento());
    expect(enviados).toHaveLength(0);
  });

  it('não encaminha com a loja inativa', async () => {
    const { svc, enviados } = comLoja({ ...LOJA, ativo: false });
    await svc.processar(evento());
    expect(enviados).toHaveLength(0);
  });

  it('não encaminha quando um humano assumiu a conversa', async () => {
    const { svc, enviados } = comLoja({ ...LOJA, roboPausados: [DE] });
    await svc.processar(evento());
    expect(enviados).toHaveLength(0);
  });

  it('reconhece a pausa mesmo gravada como jid completo', async () => {
    const { svc, enviados } = comLoja({ ...LOJA, roboPausados: [`${DE}@s.whatsapp.net`] });
    await svc.processar(evento());
    expect(enviados).toHaveLength(0);
  });

  it('encaminha o payload normalizado quando tudo está em ordem', async () => {
    const { svc, enviados } = comLoja(LOJA);
    await svc.processar(evento('quero uma pizza'));
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({
      provedor: 'cloud',
      tenantId: 'tenant-1',
      cardapioToken: 'abc123',
      phoneNumberId: PHONE_ID,
      de: DE,
      nome: 'Maria',
      tipo: 'text',
      texto: 'quero uma pizza',
      mensagemId: 'wamid.TESTE',
      roboPrompt: 'prompt da loja',
    });
  });

  it('usa a legenda da mídia como texto e expõe o id para download', async () => {
    const { svc, enviados } = comLoja(LOJA);
    const ev: any = evento();
    ev.entry[0].changes[0].value.messages = [
      { from: DE, id: 'wamid.IMG', type: 'image', timestamp: '1', image: { id: 'media-1', caption: 'esse aqui' } },
    ];
    await svc.processar(ev);
    expect(enviados[0]).toMatchObject({ tipo: 'image', texto: 'esse aqui', midiaId: 'media-1' });
  });

  it('não quebra com evento que só traz status de entrega', async () => {
    const { svc, enviados } = comLoja(LOJA);
    await svc.processar({
      entry: [{ changes: [{ value: { metadata: { phone_number_id: PHONE_ID }, statuses: [{ id: 'x', status: 'delivered' }] } }] }],
    });
    expect(enviados).toHaveLength(0);
  });
});
