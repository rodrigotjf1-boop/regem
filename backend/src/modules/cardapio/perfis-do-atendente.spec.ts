import { BadRequestException } from '@nestjs/common';
import {
  JEITO_MAX,
  LINHA_DAS_REGRAS,
  PERFIS_DO_ATENDENTE,
  ROTULO_DO_JEITO,
  TEXTO_DO_PERFIL,
  jeitoDoAtendente,
  lerPerfisDoAtendente,
  perfilEmVigor,
  perfisDaLinha,
  perfisPadrao,
  temPerfilNoJeito,
} from './perfis-do-atendente';

// O PERFIL DO ATENDENTE VIRTUAL POR CANAL (F2, mig 380 — protótipo `mockups/regem-central-atendimento.html` v11): as
// escolhas, a conferência do que a tela manda, a leitura tolerante do banco e o bloco de texto que vai às instruções.
describe('perfis do atendente — o texto de cada perfil', () => {
  // Os textos EXATOS combinados com o dono (o robô lê isto; mudar é decisão, não detalhe).
  const ESPERADO: Record<string, string> = {
    profissional:
      'PERFIL DE ATENDIMENTO (escolhido pela loja): PROFISSIONAL. Tom cortês e formal: frases completas, sem gírias e sem emoji. Cumprimente com "Olá" e trate o cliente por "você". Seja preciso e direto.',
    cordial:
      'PERFIL DE ATENDIMENTO (escolhido pela loja): CORDIAL. Tom educado e caloroso: cumprimente pelo nome, agradeça o contato e use no máximo 1 emoji quando combinar com o cliente.',
    gentil:
      'PERFIL DE ATENDIMENTO (escolhido pela loja): GENTIL. Tom paciente e delicado: palavras suaves, ofereça ajuda sem pressionar, explique com calma e agradeça a paciência quando o cliente esperar.',
    descontraido:
      'PERFIL DE ATENDIMENTO (escolhido pela loja): DESCONTRAÍDO. Tom leve e simpático, com a linguagem do dia a dia (sem palavrão e sem gíria que o cliente possa não entender), frases curtas e no máximo 1 emoji por mensagem. Mesmo descontraído, nunca brinque com uma reclamação.',
    objetivo:
      'PERFIL DE ATENDIMENTO (escolhido pela loja): OBJETIVO. Respostas curtas e diretas, só o essencial: a informação, o valor e o próximo passo. Sem emoji e sem conversa extra; cumprimente em poucas palavras.',
    acolhedor:
      'PERFIL DE ATENDIMENTO (escolhido pela loja): ACOLHEDOR. Tom empático e próximo: mostre que entendeu o que o cliente quer, transmita segurança ("pode deixar comigo") e ofereça ajuda até o fim do pedido.',
  };
  const REGRAS =
    'O perfil muda só o jeito de falar: todas as regras abaixo continuam valendo. Cliente chateado: fique sério e siga as regras de cliente chateado, em qualquer perfil.';

  it('os sete perfis, na ordem da tela; "Como hoje" primeiro', () => {
    expect(PERFIS_DO_ATENDENTE).toEqual(['hoje', 'profissional', 'cordial', 'gentil', 'descontraido', 'objetivo', 'acolhedor']);
    expect(Object.keys(TEXTO_DO_PERFIL).sort()).toEqual(Object.keys(ESPERADO).sort());
    expect(LINHA_DAS_REGRAS).toBe(REGRAS);
  });

  it.each(Object.keys(ESPERADO))('%s: o texto exato do perfil e, logo depois, a linha das regras', (perfil) => {
    const perfis = { whatsapp: { perfil, foraDoHorario: 'mesmo', jeito: null } };
    expect(jeitoDoAtendente(perfis, 'whatsapp', true)).toBe(`${ESPERADO[perfil]}\n${REGRAS}`);
    expect(temPerfilNoJeito(jeitoDoAtendente(perfis, 'whatsapp', true))).toBe(true);
  });

  it('"Como hoje" sem jeito = nada (as instruções ficam as de hoje); com jeito, só a linha do jeito', () => {
    expect(jeitoDoAtendente(perfisPadrao(), 'whatsapp', true)).toBe('');
    expect(jeitoDoAtendente(perfisPadrao(), 'direct', false)).toBe('');
    expect(jeitoDoAtendente(undefined, 'whatsapp', true)).toBe('');
    const soJeito = jeitoDoAtendente({ direct: { perfil: 'hoje', jeito: 'assine como Burger da Praça' } }, 'direct', true);
    expect(soJeito).toBe(`${ROTULO_DO_JEITO} assine como Burger da Praça`);
    expect(soJeito).toBe('JEITO DA LOJA (escrito pela loja, siga quando não contrariar as regras abaixo): assine como Burger da Praça');
    expect(temPerfilNoJeito(soJeito)).toBe(false);
  });

  it('perfil e jeito: o perfil, as regras e o jeito da loja, nessa ordem', () => {
    const perfis = { whatsapp: { perfil: 'cordial', foraDoHorario: 'mesmo', jeito: 'trate o cliente por você' } };
    expect(jeitoDoAtendente(perfis, 'whatsapp', true)).toBe(`${ESPERADO.cordial}\n${REGRAS}\n${ROTULO_DO_JEITO} trate o cliente por você`);
  });

  it('fora do horário (equipe NÃO atende) troca para o perfil de fora; "O mesmo" mantém; no horário vale o de cima', () => {
    const perfis = {
      whatsapp: { perfil: 'cordial', foraDoHorario: 'objetivo', jeito: null },
      direct: { perfil: 'descontraido', foraDoHorario: 'mesmo', jeito: null },
    };
    expect(perfilEmVigor(perfis, 'whatsapp', true)).toBe('cordial');
    expect(perfilEmVigor(perfis, 'whatsapp', false)).toBe('objetivo');
    expect(jeitoDoAtendente(perfis, 'whatsapp', false)).toBe(`${ESPERADO.objetivo}\n${REGRAS}`);
    expect(jeitoDoAtendente(perfis, 'whatsapp', true)).toBe(`${ESPERADO.cordial}\n${REGRAS}`);
    expect(perfilEmVigor(perfis, 'direct', false)).toBe('descontraido');
    expect(jeitoDoAtendente(perfis, 'direct', false)).toBe(`${ESPERADO.descontraido}\n${REGRAS}`);
    // "Como hoje" de dia e um perfil à noite: de dia nada entra; à noite, o perfil
    const soANoite = { whatsapp: { perfil: 'hoje', foraDoHorario: 'gentil', jeito: null } };
    expect(jeitoDoAtendente(soANoite, 'whatsapp', true)).toBe('');
    expect(jeitoDoAtendente(soANoite, 'whatsapp', false)).toBe(`${ESPERADO.gentil}\n${REGRAS}`);
    // um canal não leva o perfil do outro
    expect(jeitoDoAtendente({ whatsapp: { perfil: 'objetivo' } }, 'direct', true)).toBe('');
  });
});

describe('perfis do atendente — o que a tela manda (lerPerfisDoAtendente)', () => {
  const recusa = (dto: unknown, msg: string) => {
    let erro: unknown;
    try {
      lerPerfisDoAtendente(dto);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(BadRequestException);
    expect((erro as Error).message).toBe(msg);
  };

  it('parcial por canal e por campo: o que não veio fica de fora (V16)', () => {
    expect(lerPerfisDoAtendente(undefined)).toEqual({});
    expect(lerPerfisDoAtendente(null)).toEqual({});
    expect(lerPerfisDoAtendente({})).toEqual({});
    expect(lerPerfisDoAtendente({ whatsapp: { perfil: 'gentil' } })).toEqual({ whatsapp: { perfil: 'gentil' } });
    expect(lerPerfisDoAtendente({ direct: { foraDoHorario: 'mesmo' }, whatsapp: undefined })).toEqual({ direct: { foraDoHorario: 'mesmo' } });
    expect(lerPerfisDoAtendente({ whatsapp: { perfil: 'hoje', foraDoHorario: 'acolhedor', jeito: 'oi' } })).toEqual({
      whatsapp: { perfil: 'hoje', foraDoHorario: 'acolhedor', jeito: 'oi' },
    });
  });

  it('o jeito: uma linha só (quebras viram espaço), vazio = sem jeito, até 300 letras', () => {
    expect(lerPerfisDoAtendente({ whatsapp: { jeito: '  trate por você;\r\n assine como\n\nBurger   ' } }).whatsapp?.jeito).toBe(
      'trate por você; assine como Burger',
    );
    expect(lerPerfisDoAtendente({ whatsapp: { jeito: '   ' } }).whatsapp?.jeito).toBeNull();
    expect(lerPerfisDoAtendente({ whatsapp: { jeito: null } }).whatsapp?.jeito).toBeNull();
    expect(lerPerfisDoAtendente({ direct: { jeito: 'a'.repeat(JEITO_MAX) } }).direct?.jeito).toHaveLength(300);
    recusa({ whatsapp: { jeito: 'a'.repeat(301) } }, 'Jeito da loja (WhatsApp): no máximo 300 letras.');
    // as quebras contam depois de virar espaço (a regra é sobre o que vai ao robô)
    expect(lerPerfisDoAtendente({ direct: { jeito: `${'a'.repeat(150)}\n\n\n${'b'.repeat(149)}` } }).direct?.jeito).toHaveLength(300);
    recusa({ direct: { jeito: 42 } }, 'Jeito da loja (Direct): escreva o texto (ou deixe vazio).');
  });

  it('as recusas, em pt-BR, com o canal', () => {
    recusa({ whatsapp: { perfil: 'bravo' } }, 'Perfil do WhatsApp: escolha um dos perfis da lista.');
    recusa({ direct: { perfil: 'Cordial' } }, 'Perfil do Direct: escolha um dos perfis da lista.');
    recusa({ direct: { foraDoHorario: 'hoje' } }, 'Fora do horário (Direct): escolha "O mesmo" ou um dos perfis.');
    recusa({ whatsapp: { foraDoHorario: null } }, 'Fora do horário (WhatsApp): escolha "O mesmo" ou um dos perfis.');
    recusa(
      { messenger: { perfil: 'cordial' } },
      'Perfil do atendente virtual: o canal "messenger" não tem perfil (só WhatsApp, Direct e chat do iFood e da 99).',
    );
    // o chat do iFood e da 99 (F5, mig 383) tem perfil, com o nome dele na recusa
    recusa({ chat: { perfil: 'bravo' } }, 'Perfil do chat do iFood e da 99: escolha um dos perfis da lista.');
    expect(lerPerfisDoAtendente({ chat: { perfil: 'objetivo', foraDoHorario: 'gentil' } })).toEqual({ chat: { perfil: 'objetivo', foraDoHorario: 'gentil' } });
    recusa({ whatsapp: 'cordial' }, 'Perfil do WhatsApp: mande o perfil, o de fora do horário e o jeito da loja.');
    recusa({ whatsapp: null }, 'Perfil do WhatsApp: mande o perfil, o de fora do horário e o jeito da loja.');
    recusa(['whatsapp'], 'Perfil do atendente virtual: mande o perfil de cada canal.');
    recusa('cordial', 'Perfil do atendente virtual: mande o perfil de cada canal.');
  });

  it('uma recusa em qualquer canal recusa o pedido inteiro (nada parcial passa)', () => {
    recusa({ whatsapp: { perfil: 'cordial' }, direct: { perfil: 'x' } }, 'Perfil do Direct: escolha um dos perfis da lista.');
  });
});

describe('perfis do atendente — o que vem do banco (perfisDaLinha)', () => {
  it('sem nada: os três canais (WhatsApp, Direct e — F5 — o chat do iFood e da 99) em "Como hoje", "O mesmo" e sem jeito', () => {
    const padrao = { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null };
    for (const v of [undefined, null, {}, [], 'lixo', 42, '{"whatsapp":'])
      expect(perfisDaLinha(v)).toEqual({ whatsapp: padrao, direct: padrao, chat: padrao });
  });

  it('valor estranho cai no padrão daquele campo; o resto fica', () => {
    expect(
      perfisDaLinha({
        whatsapp: { perfil: 'cordial', foraDoHorario: 'hoje', jeito: 7 },
        direct: { perfil: 'bravo', foraDoHorario: 'objetivo', jeito: '  oi\n\ntudo bem  ' },
        messenger: { perfil: 'gentil' },
      }),
    ).toEqual({
      whatsapp: { perfil: 'cordial', foraDoHorario: 'mesmo', jeito: null },
      direct: { perfil: 'hoje', foraDoHorario: 'objetivo', jeito: 'oi tudo bem' },
      chat: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
    });
    expect(perfisDaLinha({ whatsapp: 'cordial', direct: ['x'] })).toEqual(perfisPadrao());
  });

  it('o texto JSON da coluna também vale; o jeito longo é cortado em 300, sem quebrar um emoji ao meio', () => {
    expect(perfisDaLinha('{"direct":{"perfil":"gentil"}}').direct.perfil).toBe('gentil');
    expect(perfisDaLinha({ whatsapp: { jeito: 'x'.repeat(400) } }).whatsapp.jeito).toHaveLength(300);
    const comEmoji = perfisDaLinha({ whatsapp: { jeito: `${'x'.repeat(299)}😀fim` } }).whatsapp.jeito ?? '';
    expect(comEmoji).toBe('x'.repeat(299));
    // o jeito longo do banco entra cortado no texto (uma linha só)
    const texto = jeitoDoAtendente({ whatsapp: { jeito: `a\nb ${'c'.repeat(500)}` } }, 'whatsapp', true);
    expect(texto.split('\n')).toHaveLength(1);
    expect(texto).toBe(`${ROTULO_DO_JEITO} ${`a b ${'c'.repeat(500)}`.slice(0, 300)}`);
  });
});
