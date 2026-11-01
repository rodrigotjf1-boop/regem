import {
  MARCA_DO_CHAMADO,
  MensagemDaConversa,
  TETO_SAIDAS,
  anotarNaMemoria,
  avaliarRoboDoOutroLado,
  chaveDaMemoria,
  conversaNaMemoria,
  esquecerConversas,
  menuNumerado,
  mensagemDoChamado,
  textoAutomatico,
} from './robo-do-outro-lado';

// ROBÔ DO OUTRO LADO (Bloco 4 do plano de 31/10/2026): dois sinais diferentes ou o teto calam o robô; um sinal sozinho
// nunca — gente de verdade escreve "não entendi sua mensagem", cola um endereço comprido na hora ou repete a pergunta.

const T0 = new Date('2026-10-31T20:00:00Z').getTime();
const em = (s: number) => new Date(T0 + s * 1000);
const nossa = (s: number): MensagemDaConversa => ({ direcao: 'saida', texto: 'resposta do robô da loja', tipo: 'text', em: em(s) });
const dele = (s: number, texto: string, tipo = 'text'): MensagemDaConversa => ({ direcao: 'entrada', texto, tipo, em: em(s) });

const MENU = 'Olá! Escolha uma opção:\n1 - Pedidos\n2 - Financeiro\n3 - Falar com um atendente';
const AUTO = 'Olá! Esta é uma mensagem automática. Em breve retornaremos o seu contato.';

describe('robô do outro lado', () => {
  it('reconhece o texto de resposta automática e o menu numerado — e não a frase comum', () => {
    expect(menuNumerado(MENU)).toBe(true);
    expect(menuNumerado('1️⃣ Pedidos\n2️⃣ Financeiro\n3️⃣ Suporte')).toBe(true);
    expect(menuNumerado('quero 2 x-bacon\n1 coca')).toBe(false);
    for (const t of [AUTO, 'Opção inválida. Digite 1, 2 ou 3.', 'Sou a assistente virtual da Loja X', 'Obrigado por entrar em contato!', 'Nosso horário de atendimento é das 8h às 18h', 'Protocolo de atendimento: 20261031123'])
      expect(textoAutomatico(t)).toBe(true);
    for (const t of ['não entendi', 'quero um x-bacon sem cebola', 'qual o horário de vocês?', 'oi, tudo bem?', 'é robô?'])
      expect(textoAutomatico(t)).toBe(false);
  });

  it('o pedido de uma pessoa (toques rápidos, um endereço colado na hora, "não entendi sua mensagem") não cala', () => {
    const conversa = [
      dele(0, 'oi, quero pedir'),
      nossa(5),
      dele(7, 'Trio X-Bacon', 'interactive'), // botão: rápido, mas não conta
      nossa(10),
      dele(11, 'Rua das Laranjeiras, 123, apto 402, perto da padaria do centro'), // colado: rápido UMA vez
      nossa(15),
      dele(40, 'não entendi sua mensagem'), // texto de robô, mas sozinho
      nossa(45),
      dele(70, 'Cartão'),
    ];
    expect(avaliarRoboDoOutroLado(conversa, em(70))).toEqual({ robo: false, sinais: ['texto_automatico'], teto: false });
  });

  it('texto automático + a mesma mensagem chegando de novo = robô', () => {
    const conversa = [dele(0, MENU), nossa(3), dele(60, MENU)];
    const a = avaliarRoboDoOutroLado(conversa, em(60));
    expect(a).toEqual({ robo: true, sinais: ['texto_automatico', 'repeticao'], teto: false });
  });

  it('texto automático + duas respostas compridas em poucos segundos = robô; uma só rápida, não', () => {
    const duas = [nossa(0), dele(1, AUTO), nossa(10), dele(11.5, 'Para falar com o financeiro, digite 2. Para pedidos, digite 1.')];
    expect(avaliarRoboDoOutroLado(duas, em(12))).toMatchObject({ robo: true, sinais: ['texto_automatico', 'rapidez'] });
    const uma = [nossa(0), dele(1, AUTO), nossa(10), dele(40, 'Para falar com o financeiro, digite 2. Para pedidos, digite 1.')];
    expect(avaliarRoboDoOutroLado(uma, em(40))).toMatchObject({ robo: false, sinais: ['texto_automatico'] });
  });

  it('o teto: mensagens nossas demais em 10 minutos calam, mesmo sem sinal', () => {
    const conversa: MensagemDaConversa[] = [];
    for (let i = 0; i < TETO_SAIDAS; i++) conversa.push(dele(i * 15, `pergunta ${i}`), nossa(i * 15 + 6));
    expect(avaliarRoboDoOutroLado(conversa, em(TETO_SAIDAS * 15))).toMatchObject({ robo: true, teto: true });
    // Um pedido inteiro (umas 15 respostas) fica longe do teto.
    expect(avaliarRoboDoOutroLado(conversa.slice(0, 30), em(15 * 15))).toMatchObject({ robo: false, teto: false });
  });

  it('só a conversa recente conta: o menu de 40 minutos atrás não é sinal', () => {
    const conversa = [dele(0, MENU), nossa(3), dele(40 * 60, MENU)];
    expect(avaliarRoboDoOutroLado(conversa, em(40 * 60))).toMatchObject({ robo: false, sinais: ['texto_automatico'] });
  });

  it('a mensagem do chamado começa pela marca e diz o que se viu', () => {
    const m = mensagemDoChamado({ robo: true, sinais: ['texto_automatico', 'rapidez'], teto: false });
    expect(m.startsWith(MARCA_DO_CHAMADO)).toBe(true);
    expect(m).toContain('(baixa prioridade): texto de resposta automática, respostas compridas em poucos segundos.');
    expect(m).toContain('resolva este chamado e o robô volta a atender');
  });

  it('a conversa na memória (Evolution): pela instância e pela chave do telefone; o que passou da janela sai', () => {
    esquecerConversas();
    const k = chaveDaMemoria('loja-1', '5521987654321');
    expect(chaveDaMemoria('loja-1', '552187654321')).toBe(k); // sem o nono dígito: a mesma conversa
    expect(chaveDaMemoria('', '5521987654321')).toBeNull();
    anotarNaMemoria(k, dele(0, 'velha'));
    anotarNaMemoria(k, nossa(31 * 60));
    anotarNaMemoria(k, dele(31 * 60 + 2, 'nova'));
    expect(conversaNaMemoria(k).map((m) => m.texto)).toEqual(['resposta do robô da loja', 'nova']);
    expect(conversaNaMemoria(chaveDaMemoria('loja-2', '5521987654321'))).toEqual([]);
    esquecerConversas();
  });
});
