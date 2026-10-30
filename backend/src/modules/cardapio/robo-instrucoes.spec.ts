import { instrucoesDoRobo, VERSAO_INSTRUCOES } from './robo-instrucoes';

// AS INSTRUÇÕES DO ROBÔ (Fase 5, F1 — pedido do dono de 30/10/2026). O texto é a "mensagem do sistema" do agente no
// n8n; aqui se confere que cada pedido do dono está escrito nele, e que o texto só cita ferramentas que o fluxo tem.
describe('instruções do robô', () => {
  const { texto, versao, fluxo } = instrucoesDoRobo({ loja: 'Mister Burguer' }, '1');

  it('leva a versão e o nome da loja', () => {
    expect(versao).toBe(VERSAO_INSTRUCOES);
    expect(fluxo).toBe(1);
    expect(texto.startsWith('Você atende os clientes da Mister Burguer no WhatsApp.')).toBe(true);
    expect(instrucoesDoRobo({ loja: '  ' }).texto).toContain('clientes da loja no WhatsApp');
  });

  it('tom humano: curto, pelo nome, uma pergunta por vez, sem markdown', () => {
    expect(texto).toContain('nunca como um robô');
    expect(texto).toContain('pelo primeiro nome');
    expect(texto).toContain('Uma pergunta por vez');
    expect(texto).toContain('Sem markdown');
  });

  it('o cardápio online vem primeiro, com as versões do produto, e "x-bacon" = "xbacon"', () => {
    expect(texto).toContain('O CARDÁPIO ONLINE VEM PRIMEIRO');
    expect(texto).toContain('só o sanduíche ou o trio');
    expect(texto).toContain('"X-Bacon", "xbacon" e "x bacon" são o mesmo produto');
    expect(texto).toContain('se ele quer ajuda para fazer o pedido');
  });

  it('cliente chateado: acolhe, não promete, e chama a equipe com urgência', () => {
    expect(texto).toContain('CLIENTE CHATEADO OU IRRITADO');
    expect(texto).toContain('Não prometa prazo, desconto, reembolso nem solução');
    expect(texto).toContain('urgente = true');
  });

  it('não oferece "falar com atendente" de início', () => {
    expect(texto).toContain('Nunca ofereça "falar com atendente" no começo da conversa');
    expect(texto).toContain('nunca ponha "atendente" nas opções');
  });

  it('as regras que já existiam continuam (preço, links, loja fechada, distância, cupom, cartão)', () => {
    expect(texto).toContain('Nunca invente preço');
    expect(texto).toContain('Os ÚNICOS links que você pode escrever');
    expect(texto).toContain('fechaNoDiaSeguinte');
    expect(texto).toContain('taxaPor = distancia');
    expect(texto).toContain('Cupom, promoção ou desconto: nunca diga que não há');
    expect(texto).toContain('Nunca peça número de cartão');
    expect(texto).toContain('OPCOES: primeira | segunda | terceira');
  });

  it('só cita as ferramentas que o fluxo 1 tem', () => {
    const citadas = new Set(texto.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []);
    const doFluxo1 = ['consultar_loja', 'buscar_no_cardapio', 'taxa_de_entrega', 'pedidos_do_cliente', 'link_personalizado', 'chamar_atendente'];
    for (const nome of citadas) expect(doFluxo1).toContain(nome);
    for (const nome of doFluxo1) expect(citadas.has(nome)).toBe(true);
  });

  it('fluxo desconhecido recebe o texto do fluxo 1', () => {
    expect(instrucoesDoRobo({ loja: 'X' }, '99').fluxo).toBe(1);
    expect(instrucoesDoRobo({ loja: 'X' }).fluxo).toBe(1);
  });
});
