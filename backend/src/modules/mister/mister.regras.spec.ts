import {
  BOTOES_MAX,
  TITULO_DO_BOTAO_MAX,
  TEXTOS,
  codigoNaMensagem,
  dentroDaJanela,
  ehPararAvisos,
  ehTrocarDeEmpresa,
  ehVoltarAvisos,
  empresaEscolhida,
  idDoBotaoDaEmpresa,
  linkDoCodigo,
  mensagemDoCodigo,
  novoCodigo,
  pareceCodigo,
  passou,
  perguntaDaEmpresa,
  primeiroNome,
  situacaoDaEmpresa,
} from './mister.regras';

const A = { tenantId: '11111111-1111-4111-8111-111111111111', nome: 'Burger da Praça' };
const B = { tenantId: '22222222-2222-4222-8222-222222222222', nome: 'Pizzaria do Porto' };
const C = { tenantId: '33333333-3333-4333-8333-333333333333', nome: 'Empório Sabor da Serra Comércio de Alimentos' };
const D = { tenantId: '44444444-4444-4444-8444-444444444444', nome: 'Cantina Bella' };

describe('Mister — o código de ligar', () => {
  it('o código novo tem seis dígitos e nunca começa por zero', () => {
    for (let i = 0; i < 200; i++) expect(novoCodigo()).toMatch(/^[1-9]\d{5}$/);
    expect(novoCodigo(() => 100000)).toBe('100000');
    expect(novoCodigo(() => 999999)).toBe('999999');
  });

  it('a mensagem e o link levam a palavra MISTER — nunca a do número da loja', () => {
    expect(mensagemDoCodigo('482913')).toBe('MISTER 482913');
    expect(linkDoCodigo('+55 (21) 90000-0000', '482913')).toBe('https://wa.me/5521900000000?text=MISTER%20482913');
  });

  it('lê o código como a pessoa manda: pelo link, digitado, com dois-pontos, com espaço no meio', () => {
    expect(codigoNaMensagem('MISTER 482913')).toBe('482913');
    expect(codigoNaMensagem('mister482913')).toBe('482913');
    expect(codigoNaMensagem('  Mister: 482 913. ')).toBe('482913');
    expect(codigoNaMensagem('MISTER\n482913')).toBe('482913');
  });

  it('não confunde conversa com código: outra palavra, número solto, tamanho errado, frase em volta', () => {
    expect(codigoNaMensagem('REGEM 482913')).toBeNull();
    expect(codigoNaMensagem('482913')).toBeNull();
    expect(codigoNaMensagem('MISTER 48291')).toBeNull();
    expect(codigoNaMensagem('MISTER 4829131')).toBeNull();
    expect(codigoNaMensagem('oi mister 482913')).toBeNull();
    expect(codigoNaMensagem('mister, vendi 482913 hoje?')).toBeNull();
    expect(codigoNaMensagem(null)).toBeNull();
  });

  it('código de formato errado conta como tentativa; conversa que cita o Mister, não', () => {
    expect(pareceCodigo('MISTER 48291')).toBe(true);
    expect(pareceCodigo('mister: 1')).toBe(true);
    expect(pareceCodigo('mister, quanto vendi?')).toBe(false);
    expect(pareceCodigo('oi')).toBe(false);
  });
});

describe('Mister — as palavras fixas', () => {
  it('PARAR AVISOS e VOLTAR AVISOS, com as variações de quem digita', () => {
    for (const t of ['PARAR AVISOS', 'parar avisos.', 'Parar os avisos', 'parar aviso', 'parar de receber avisos']) expect(ehPararAvisos(t)).toBe(true);
    for (const t of ['VOLTAR AVISOS', 'voltar os avisos!', 'religar avisos', 'ligar avisos']) expect(ehVoltarAvisos(t)).toBe(true);
  });

  it('frase que só contém as palavras não para nem volta nada', () => {
    for (const t of ['parar', 'pode parar os avisos do caixa?', 'não quero parar avisos', 'avisos']) expect(ehPararAvisos(t)).toBe(false);
    for (const t of ['voltar', 'quando os avisos vão voltar?', 'voltar avisos amanhã']) expect(ehVoltarAvisos(t)).toBe(false);
  });

  it('"trocar de empresa" (ou de loja), sem confundir com pedido', () => {
    for (const t of ['trocar de empresa', 'Trocar empresa', 'mudar de loja.']) expect(ehTrocarDeEmpresa(t)).toBe(true);
    for (const t of ['trocar', 'quero trocar de empresa de entrega', 'empresa']) expect(ehTrocarDeEmpresa(t)).toBe(false);
  });

  it('o primeiro nome', () => {
    expect(primeiroNome('  Ana   Souza ')).toBe('Ana');
    expect(primeiroNome('')).toBe('');
    expect(primeiroNome(null)).toBe('');
  });
});

describe('Mister — de qual empresa é a conversa', () => {
  it('até três empresas: botões, com o id da empresa e o título no limite do WhatsApp', () => {
    const p = perguntaDaEmpresa([A, B, C]);
    expect(p.texto).toBe('Este WhatsApp está ligado a 3 empresas. De qual você quer falar?');
    expect(p.botoes).toHaveLength(BOTOES_MAX);
    expect(p.botoes![0]).toEqual({ id: idDoBotaoDaEmpresa(A.tenantId), titulo: 'Burger da Praça' });
    for (const b of p.botoes!) expect(b.titulo.length).toBeLessThanOrEqual(TITULO_DO_BOTAO_MAX);
    expect(p.botoes![2].titulo.endsWith('…')).toBe(true);
    expect(perguntaDaEmpresa([A, B]).texto).toContain('duas empresas');
  });

  it('mais de três: lista numerada, sem botão', () => {
    const p = perguntaDaEmpresa([A, B, C, D]);
    expect(p.botoes).toBeUndefined();
    expect(p.texto).toContain('1. Burger da Praça');
    expect(p.texto).toContain('4. Cantina Bella');
    expect(p.texto).toContain('Responda com o número.');
  });

  it('a escolha vale pelo botão, pelo número, pelo nome inteiro, pelo título cortado e pelo começo que só uma tem', () => {
    const todas = [A, B, C, D];
    expect(empresaEscolhida({ botaoId: idDoBotaoDaEmpresa(B.tenantId) }, todas)).toBe(B.tenantId);
    expect(empresaEscolhida({ texto: '4' }, todas)).toBe(D.tenantId);
    expect(empresaEscolhida({ texto: 'burger da praca' }, todas)).toBe(A.tenantId);
    expect(empresaEscolhida({ texto: perguntaDaEmpresa([A, B, C]).botoes![2].titulo }, todas)).toBe(C.tenantId);
    expect(empresaEscolhida({ texto: 'pizz' }, todas)).toBe(B.tenantId);
  });

  it('na dúvida não chuta: botão de empresa que não é dela, número fora, começo que duas têm, texto curto', () => {
    const todas = [A, B, { tenantId: D.tenantId, nome: 'Burger do Centro' }];
    expect(empresaEscolhida({ botaoId: idDoBotaoDaEmpresa(C.tenantId) }, todas)).toBeNull();
    expect(empresaEscolhida({ botaoId: idDoBotaoDaEmpresa(C.tenantId), texto: 'Burger da Praça' }, todas)).toBeNull();
    expect(empresaEscolhida({ texto: '0' }, todas)).toBeNull();
    expect(empresaEscolhida({ texto: '9' }, todas)).toBeNull();
    expect(empresaEscolhida({ texto: 'burger' }, todas)).toBeNull();
    expect(empresaEscolhida({ texto: 'pi' }, todas)).toBeNull();
    expect(empresaEscolhida({ texto: 'vendas de hoje' }, todas)).toBeNull();
    expect(empresaEscolhida({}, todas)).toBeNull();
  });
});

describe('Mister — tempo', () => {
  const agora = new Date('2026-11-13T12:00:00Z');
  it('a janela de 24 h da Meta', () => {
    expect(dentroDaJanela(null, agora)).toBe(false);
    expect(dentroDaJanela(new Date('2026-11-12T12:00:01Z'), agora)).toBe(true);
    expect(dentroDaJanela(new Date('2026-11-12T12:00:00Z'), agora)).toBe(false);
  });
  it('o intervalo entre respostas repetidas', () => {
    expect(passou(null, agora, 30)).toBe(true);
    expect(passou(new Date('2026-11-13T11:30:00Z'), agora, 30)).toBe(true);
    expect(passou(new Date('2026-11-13T11:30:01Z'), agora, 30)).toBe(false);
  });
});

describe('Mister — a situação da empresa no console', () => {
  const base = { modulo: true, temIa: true, chaveSituacao: 'ok' as string | null, pessoas: 2 };
  it('uma situação só, a que impede primeiro: módulo, IA, WhatsApp', () => {
    expect(situacaoDaEmpresa(base)).toEqual({ situacao: 'funcionando', motivo: null });
    expect(situacaoDaEmpresa({ ...base, modulo: false, temIa: false, pessoas: 0 })).toEqual({ situacao: 'modulo_desligado', motivo: null });
    expect(situacaoDaEmpresa({ ...base, temIa: false, chaveSituacao: null })).toEqual({ situacao: 'falta_chave', motivo: null });
    expect(situacaoDaEmpresa({ ...base, temIa: false, chaveSituacao: null, pessoas: 0 })).toEqual({ situacao: 'falta_chave_e_whatsapp', motivo: null });
    expect(situacaoDaEmpresa({ ...base, pessoas: 0 })).toEqual({ situacao: 'falta_whatsapp', motivo: null });
  });
  it('a chave própria com problema para a IA e diz o motivo; sem chave própria (IA incluída) não há motivo', () => {
    for (const motivo of ['sem_credito', 'teto_atingido', 'chave_recusada']) expect(situacaoDaEmpresa({ ...base, chaveSituacao: motivo })).toEqual({ situacao: 'ia_parada', motivo });
    expect(situacaoDaEmpresa({ ...base, chaveSituacao: 'sem_credito', pessoas: 0 })).toEqual({ situacao: 'ia_parada', motivo: 'sem_credito' });
    expect(situacaoDaEmpresa({ ...base, chaveSituacao: null })).toEqual({ situacao: 'funcionando', motivo: null });
    expect(situacaoDaEmpresa({ ...base, chaveSituacao: 'situacao_nova' })).toEqual({ situacao: 'funcionando', motivo: null });
  });
});

describe('Mister — os textos só prometem o que existe', () => {
  it('a resposta a quem não está ligado não traz dado de ninguém e manda ao menu Mister', () => {
    expect(TEXTOS.desconhecido).toContain('no menu Mister, em "Pessoas"');
    expect(TEXTOS.desconhecido).not.toMatch(/R\$|\d{3,}/);
  });
  it('enquanto as perguntas não estão no ar, nenhum texto diz "pode me perguntar"', () => {
    const todos = [TEXTOS.desconhecido, TEXTOS.ligado('Ana', 'X'), TEXTOS.parou('Ana'), TEXTOS.voltou('Ana'), TEXTOS.seguindo('X'), TEXTOS.aindaNaoRespondo('Ana', 'X')];
    for (const t of todos) expect(t).not.toMatch(/pode me perguntar|relat[óo]rio/i);
  });
});
