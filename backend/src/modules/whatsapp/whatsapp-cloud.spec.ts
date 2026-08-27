import { WhatsappCloudService } from './whatsapp-cloud.service';
import { whatsappMensagem } from '../../db/schema';

// Portões do recebimento da API oficial (Meta Cloud API). São eles que impedem os
// dois modos de falhar feio numa migração meio-feita:
//   - loja ainda no Evolution respondendo TAMBÉM pela Cloud (cliente recebe em dobro);
//   - robô respondendo por cima de um humano que já assumiu a conversa.
// Banco falso em memória — não depende de Postgres.

/* eslint-disable @typescript-eslint/no-explicit-any */
// Banco falso encadeavel: devolve a config da loja OU as linhas de historico,
// conforme a tabela consultada, e guarda o que foi inserido para as asserçoes.
function fakeDb(row: any, msgs: any[] = []) {
  const gravadas: any[] = [];
  const build = (tbl: any) => {
    const p: any = Promise.resolve(tbl === whatsappMensagem ? [...msgs] : row ? [row] : []);
    p.from = () => p;
    p.where = () => p;
    p.orderBy = () => p;
    p.limit = () => p;
    return p;
  };
  return {
    gravadas,
    select: () => ({ from: (t: any) => build(t) }),
    insert: () => ({
      values: (v: any) => {
        gravadas.push(v);
        return { onConflictDoNothing: () => Promise.resolve() };
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
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
function comLoja(row: any, msgs: any[] = []) {
  const db = fakeDb(row, msgs);
  const svc = new WhatsappCloudService(db);
  (svc as any).logger = { log() {}, warn() {}, error() {}, debug() {} };
  const enviados: any[] = [];
  (svc as any).encaminhar = async (m: any) => {
    enviados.push(m);
  };
  return { svc, enviados, gravadas: db.gravadas as any[] };
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

describe('WhatsappCloudService — proxy de mídia', () => {
  const SECRET = 'segredo-do-bot';
  beforeEach(() => {
    process.env.BOT_RESOLVER_SECRET = SECRET;
    process.env.WA_CLOUD_TOKEN = 'token-falso';
  });

  // Todos os casos abaixo falham ANTES de qualquer chamada de rede — é justamente
  // isso que se quer garantir: nada sai para a Meta sem passar pelas travas.
  it('recusa secret errado', async () => {
    const { svc } = comLoja(LOJA);
    await expect(svc.baixarMidia('errado', PHONE_ID, '123456')).rejects.toThrow();
  });

  it('recusa mediaId fora do formato (o id vai concatenado na URL da Graph)', async () => {
    const { svc } = comLoja(LOJA);
    await expect(svc.baixarMidia(SECRET, PHONE_ID, '../../me')).rejects.toThrow();
    await expect(svc.baixarMidia(SECRET, PHONE_ID, '12')).rejects.toThrow();
  });

  it('recusa número não vinculado a nenhuma loja', async () => {
    const { svc } = comLoja(null);
    await expect(svc.baixarMidia(SECRET, PHONE_ID, '123456789')).rejects.toThrow();
  });

  it('recusa loja que está no Evolution', async () => {
    const { svc } = comLoja({ ...LOJA, provedor: 'evolution' });
    await expect(svc.baixarMidia(SECRET, PHONE_ID, '123456789')).rejects.toThrow();
  });
});

describe('WhatsappCloudService — histórico (F2b)', () => {
  it('grava a mensagem recebida mesmo com a conversa pausada', async () => {
    // O caso que mais importa: com um humano atendendo, o robô não responde — mas o
    // painel PRECISA mostrar o que o cliente escreveu. Gravar só quando o robô age
    // deixaria o atendente cego justamente na hora em que ele está atendendo.
    const { svc, enviados, gravadas } = comLoja({ ...LOJA, roboPausados: [DE] });
    await svc.processar(evento('preciso mudar o endereço'));
    expect(enviados).toHaveLength(0);
    expect(gravadas).toHaveLength(1);
    expect(gravadas[0]).toMatchObject({
      telefone: DE,
      direcao: 'entrada',
      texto: 'preciso mudar o endereço',
      wamid: 'wamid.TESTE',
    });
  });

  it('não grava evento de loja que está no Evolution', async () => {
    const { svc, gravadas } = comLoja({ ...LOJA, provedor: 'evolution' });
    await svc.processar(evento());
    expect(gravadas).toHaveLength(0);
  });

  it('monta a lista de conversas no mesmo contrato do Evolution', async () => {
    const agora = new Date();
    const antes = new Date(agora.getTime() - 60000);
    const msgs = [
      { id: 'm2', telefone: DE, direcao: 'entrada', tipo: 'text', texto: 'e aí?', wamid: 'w2', nomeContato: 'Maria', criadoEm: agora },
      { id: 'm1', telefone: DE, direcao: 'saida', tipo: 'text', texto: 'oi!', wamid: 'w1', nomeContato: null, criadoEm: antes },
    ];
    const { svc } = comLoja(LOJA, msgs);
    const convs: any[] = await svc.listarConversas('tenant-1');
    expect(convs).toHaveLength(1);
    expect(convs[0]).toMatchObject({
      telefone: DE,
      jids: [DE],
      nome: 'Maria',
      ultimaMensagem: 'e aí?',
      pausada: false,
    });
    // 1 mensagem do cliente depois da última resposta nossa = 1 esperando resposta.
    expect(convs[0].naoLidas).toBe(1);
  });

  it('marca a conversa como pausada quando um humano assumiu', async () => {
    const msgs = [
      { id: 'm1', telefone: DE, direcao: 'entrada', tipo: 'text', texto: 'oi', wamid: 'w1', criadoEm: new Date() },
    ];
    const { svc } = comLoja({ ...LOJA, roboPausados: [DE] }, msgs);
    const convs: any[] = await svc.listarConversas('tenant-1');
    expect(convs[0].pausada).toBe(true);
  });

  it('devolve as mensagens em ordem cronológica, com fromMe', async () => {
    const agora = new Date();
    const antes = new Date(agora.getTime() - 60000);
    const msgs = [
      { id: 'm2', telefone: DE, direcao: 'saida', tipo: 'text', texto: 'claro!', wamid: 'w2', status: 'delivered', criadoEm: agora },
      { id: 'm1', telefone: DE, direcao: 'entrada', tipo: 'text', texto: 'tem hambúrguer?', wamid: 'w1', criadoEm: antes },
    ];
    const { svc } = comLoja(LOJA, msgs);
    const lista: any[] = await svc.mensagens('tenant-1', DE);
    expect(lista.map((m) => m.texto)).toEqual(['tem hambúrguer?', 'claro!']);
    expect(lista[0].fromMe).toBe(false);
    expect(lista[1]).toMatchObject({ fromMe: true, status: 'delivered' });
  });

  it('rotula mídia sem texto para o painel não mostrar linha vazia', async () => {
    const msgs = [
      { id: 'm1', telefone: DE, direcao: 'entrada', tipo: 'audio', texto: null, midiaId: 'a1', wamid: 'w1', criadoEm: new Date() },
    ];
    const { svc } = comLoja(LOJA, msgs);
    const convs: any[] = await svc.listarConversas('tenant-1');
    expect(convs[0].ultimaMensagem).toBe('[audio]');
    const lista: any[] = await svc.mensagens('tenant-1', DE);
    expect(lista[0].midia).toBe('audio');
  });
});

describe('WhatsappCloudService — envio por modelo (F2d)', () => {
  const SECRET = 'segredo-do-bot';
  beforeEach(() => {
    process.env.BOT_RESOLVER_SECRET = SECRET;
    process.env.WA_CLOUD_TOKEN = 'token-falso';
  });

  // Fora da janela de 24h a Meta só aceita modelo aprovado. Estas travas rodam
  // ANTES de qualquer chamada — nada sai para a Meta mal formado.
  it('recusa número inválido', async () => {
    const { svc } = comLoja(LOJA);
    await expect(svc.enviarTemplate('tenant-1', 'abc', 'pedido_confirmado', 'pt_BR', [])).rejects.toThrow();
  });

  it('recusa modelo sem nome', async () => {
    const { svc } = comLoja(LOJA);
    await expect(svc.enviarTemplate('tenant-1', DE, '  ', 'pt_BR', [])).rejects.toThrow();
  });

  it('recusa loja sem número da API oficial vinculado', async () => {
    const { svc } = comLoja({ ...LOJA, waCloudPhoneId: null });
    await expect(svc.enviarTemplate('tenant-1', DE, 'pedido_confirmado', 'pt_BR', [])).rejects.toThrow();
  });

  it('pelo bot: recusa secret errado', async () => {
    const { svc } = comLoja(LOJA);
    await expect(
      svc.enviarTemplatePeloBot('errado', PHONE_ID, DE, 'pedido_confirmado', 'pt_BR', []),
    ).rejects.toThrow();
  });

  it('pelo bot: recusa loja que está no Evolution', async () => {
    const { svc } = comLoja({ ...LOJA, provedor: 'evolution' });
    await expect(
      svc.enviarTemplatePeloBot(SECRET, PHONE_ID, DE, 'pedido_confirmado', 'pt_BR', []),
    ).rejects.toThrow();
  });
});
