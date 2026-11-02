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
    // Como o índice único (tenant, wamid) do banco: o mesmo wamid não entra duas vezes, e o
    // `returning` volta vazio para a linha que já existia.
    insert: () => ({
      values: (v: any) => {
        const repetida = !!v?.wamid && gravadas.some((g) => g.wamid === v.wamid);
        if (!repetida) gravadas.push(v);
        const p: any = Promise.resolve();
        p.returning = () => Promise.resolve(repetida ? [] : [{ id: `id-${gravadas.length}` }]);
        return { onConflictDoNothing: () => p };
      },
    }),
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    // Lista de saída das ofertas (registrarSaida/registrarVolta): só precisa não quebrar.
    transaction: async (fn: any) =>
      fn({ execute: async () => ({ rows: [], rowCount: 0 }), insert: () => ({ values: async () => undefined }) }),
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

  // ERR-319: a Meta reenvia o webhook quando não recebe 200 a tempo. O histórico já não duplicava,
  // mas o robô respondia de novo.
  it('mensagem reenviada pela Meta (mesmo wamid) não vai ao robô de novo', async () => {
    const { svc, enviados, gravadas } = comLoja(LOJA);
    await svc.processar(evento('cadê meu pedido?'));
    await svc.processar(evento('cadê meu pedido?'));
    expect(gravadas).toHaveLength(1);
    expect(enviados).toHaveLength(1);
  });

  it('mensagens diferentes do mesmo cliente seguem todas para o robô', async () => {
    const { svc, enviados } = comLoja(LOJA);
    const segunda: any = evento('e a taxa?');
    segunda.entry[0].changes[0].value.messages[0].id = 'wamid.OUTRA';
    await svc.processar(evento('oi'));
    await svc.processar(segunda);
    expect(enviados.map((m) => m.texto)).toEqual(['oi', 'e a taxa?']);
  });

  // ERR-317: "cancelar" é o cliente querendo cancelar o PEDIDO — tirava das ofertas e o robô nem via.
  it('"cancelar" vai ao robô e NÃO tira o cliente das ofertas', async () => {
    const { svc, enviados } = comLoja(LOJA);
    const textos: string[] = [];
    (svc as any).enviarTexto = async (_t: string, _p: string, texto: string) => {
      textos.push(texto);
    };
    await svc.processar(evento('Cancelar'));
    expect(enviados).toHaveLength(1);
    expect(enviados[0].texto).toBe('Cancelar');
    expect(textos).toHaveLength(0);
  });

  it('SAIR continua tirando das ofertas, sem ir ao robô — e o reenvio não confirma duas vezes', async () => {
    const { svc, enviados } = comLoja(LOJA);
    const textos: string[] = [];
    (svc as any).enviarTexto = async (_t: string, _p: string, texto: string) => {
      textos.push(texto);
    };
    await svc.processar(evento('SAIR'));
    await svc.processar(evento('SAIR'));
    expect(enviados).toHaveLength(0);
    expect(textos).toHaveLength(1);
    expect(textos[0]).toContain('não vai mais receber ofertas');
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

// Fase 2 do robô: opções com toque e nota de voz pela API oficial, nos limites da Meta.
describe('WhatsappCloudService — opções com toque e voz (Fase 2)', () => {
  let pedidos: any[];
  let espiao: jest.SpyInstance;
  beforeEach(() => {
    process.env.WA_CLOUD_TOKEN = 'token-falso';
    pedidos = [];
    espiao = jest.spyOn(global, 'fetch' as any).mockImplementation(async (url: any, init: any) => {
      pedidos.push({ url: String(url), init });
      const midia = String(url).endsWith('/media');
      return {
        ok: true,
        status: 200,
        json: async () => (midia ? { id: '987654321' } : { messages: [{ id: 'wamid.X', message_status: 'accepted' }] }),
        text: async () => '',
      } as any;
    });
  });
  afterEach(() => espiao.mockRestore());

  it('até 3 opções que cabem inteiras: BOTÕES', async () => {
    const { svc, gravadas } = comLoja(LOJA);
    await svc.enviarOpcoes('tenant-1', DE, 'O que deseja?', [{ id: 'cardapio', titulo: 'Ver o cardápio' }, { titulo: 'Falar com atendente' }]);
    const corpo = JSON.parse(pedidos[0].init.body);
    expect(pedidos[0].url).toContain(`/${PHONE_ID}/messages`);
    expect(corpo.interactive.type).toBe('button');
    expect(corpo.interactive.action.buttons).toEqual([
      { type: 'reply', reply: { id: 'cardapio', title: 'Ver o cardápio' } },
      { type: 'reply', reply: { id: '2', title: 'Falar com atendente' } },
    ]);
    expect(gravadas[0]).toMatchObject({ direcao: 'saida', tipo: 'interactive' });
  });

  // F5 (teste do dono, 31/10/2026): "Pagar na entrega (dinheiro ou maquininha)" chegava como "Pagar na entrega (d…".
  it('título que não cabe no botão (20): vai em LISTA, inteiro na descrição e no id da resposta', async () => {
    const { svc } = comLoja(LOJA);
    await svc.enviarOpcoes('tenant-1', DE, 'Como prefere pagar?', [
      { titulo: 'Pagar na entrega (dinheiro ou maquininha)' },
      { titulo: 'Vale-refeição' },
    ]);
    const corpo = JSON.parse(pedidos[0].init.body);
    expect(corpo.interactive.type).toBe('list');
    const [linha] = corpo.interactive.action.sections[0].rows;
    expect(linha.title.length).toBeLessThanOrEqual(24);
    expect(linha.description).toBe('Pagar na entrega (dinheiro ou maquininha)');
    expect(linha.id).toBe('t:Pagar na entrega (dinheiro ou maquininha)');
  });

  it('de 4 a 10: LISTA; mais de 10 é recusado', async () => {
    const { svc } = comLoja(LOJA);
    const ops = (n: number) => Array.from({ length: n }, (_, i) => ({ titulo: `Item ${i + 1}`, descricao: 'x'.repeat(100) }));
    await svc.enviarOpcoes('tenant-1', DE, 'Escolha', ops(5), 'Ver os itens');
    const corpo = JSON.parse(pedidos[0].init.body);
    expect(corpo.interactive.type).toBe('list');
    expect(corpo.interactive.action.button).toBe('Ver os itens');
    expect(corpo.interactive.action.sections[0].rows).toHaveLength(5);
    expect(corpo.interactive.action.sections[0].rows[0].description.length).toBeLessThanOrEqual(72);
    await expect(svc.enviarOpcoes('tenant-1', DE, 'Escolha', ops(11))).rejects.toThrow('de 1 a 10');
  });

  it('voz: sobe o áudio à Meta e manda como NOTA DE VOZ (voice: true); acima de 512 KB recusa', async () => {
    const { svc } = comLoja(LOJA);
    await svc.enviarVoz('tenant-1', DE, Buffer.from('ogg-falso').toString('base64'), 'audio/ogg; codecs=opus');
    expect(pedidos[0].url).toContain(`/${PHONE_ID}/media`);
    const corpo = JSON.parse(pedidos[1].init.body);
    expect(corpo).toMatchObject({ type: 'audio', audio: { id: '987654321', voice: true } });
    const grande = Buffer.alloc(513 * 1024).toString('base64');
    await expect(svc.enviarVoz('tenant-1', DE, grande)).rejects.toThrow('512 KB');
  });

  // Bloco 6 (01/11/2026): o cardápio em PDF da caixa de conversas, que só saía pela Evolution.
  it('documento (PDF): sobe à Meta e manda como DOCUMENTO com o nome do arquivo e a legenda; grava na conversa', async () => {
    const { svc, gravadas } = comLoja(LOJA);
    await svc.enviarDocumentoPdf('tenant-1', DE, Buffer.from('%PDF-falso'), 'cardapio-loja.pdf', 'Cardápio · Loja');
    expect(pedidos[0].url).toContain(`/${PHONE_ID}/media`);
    expect(pedidos[0].init.body.get('type')).toBe('application/pdf');
    const corpo = JSON.parse(pedidos[1].init.body);
    expect(corpo).toMatchObject({ type: 'document', document: { id: '987654321', filename: 'cardapio-loja.pdf', caption: 'Cardápio · Loja' } });
    expect(gravadas[0]).toMatchObject({ direcao: 'saida', tipo: 'document', texto: 'Cardápio · Loja' });
    await expect(svc.enviarDocumentoPdf('tenant-1', DE, Buffer.alloc(0), 'x.pdf')).rejects.toThrow('vazio');
  });
});

// A RESPOSTA AO "ENTREGADOR SEM CONTATO" (Onda 0, 01/11/2026): a regra está em resposta-ao-sem-contato.ts (testada com o
// Postgres); aqui, a ligação na entrada da API oficial.
describe('WhatsappCloudService — resposta ao "entregador sem contato"', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const resposta = require('./resposta-ao-sem-contato');
  afterEach(() => jest.restoreAllMocks());

  it('é a resposta: não vai ao robô — nem com o robô desligado nem com a conversa pausada', async () => {
    for (const loja of [LOJA, { ...LOJA, roboAtivo: false }, { ...LOJA, roboPausados: [DE] }]) {
      const { svc, enviados } = comLoja(loja);
      const visto: any[] = [];
      (svc as any).respostaAoSemContato = async (...a: any[]) => {
        visto.push(a);
        return true;
      };
      await svc.processar(evento('Estou descendo'));
      expect(enviados).toHaveLength(0);
      expect(visto).toEqual([[expect.objectContaining({ tenantId: 'tenant-1' }), DE, 'Maria', 'Estou descendo']]);
    }
  });

  it('não é a resposta: segue o caminho de sempre (o robô recebe)', async () => {
    const { svc, enviados } = comLoja(LOJA);
    (svc as any).respostaAoSemContato = async () => false;
    await svc.processar(evento('quero uma pizza'));
    expect(enviados).toHaveLength(1);
  });

  it('a confirmação sai pelo número oficial e fica no pedido; se não sair, o pedido registra a falha', async () => {
    const { svc } = comLoja(LOJA);
    jest.spyOn(resposta, 'portaoDaRespostaAoSemContato').mockResolvedValue({ tratou: true, responder: 'Recebido', pedidoId: 'p1' });
    const registros: any[] = [];
    jest.spyOn(resposta, 'registrarConfirmacao').mockImplementation(async (...a: any[]) => void registros.push(a.slice(1)));
    const textos: any[] = [];
    (svc as any).enviarTexto = async (t: string, para: string, texto: string) => void textos.push({ t, para, texto });
    expect(await (svc as any).respostaAoSemContato(LOJA, DE, 'Maria', 'oi')).toBe(true);
    expect(textos).toEqual([{ t: 'tenant-1', para: DE, texto: 'Recebido' }]);
    expect(registros).toEqual([['tenant-1', 'p1', 'enviado']]);

    registros.length = 0;
    (svc as any).enviarTexto = async () => {
      throw new Error('fora da janela');
    };
    expect(await (svc as any).respostaAoSemContato(LOJA, DE, 'Maria', 'oi')).toBe(true);
    expect(registros).toEqual([['tenant-1', 'p1', 'falhou', 'fora da janela']]);
  });

  it('a conferência falhou (banco fora): a mensagem segue ao robô, como antes', async () => {
    const { svc } = comLoja(LOJA);
    jest.spyOn(resposta, 'portaoDaRespostaAoSemContato').mockRejectedValue(new Error('banco fora'));
    expect(await (svc as any).respostaAoSemContato(LOJA, DE, 'Maria', 'oi')).toBe(false);
  });
});
