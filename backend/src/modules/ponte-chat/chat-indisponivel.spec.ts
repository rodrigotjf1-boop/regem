import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ERRO_A_LOJA_JA_FALOU, ERRO_CHAT_FORA_30_MIN, ERRO_CHAT_INDISPONIVEL, pareceChatDa99Fora } from './chat-indisponivel';

// O CHAT DA 99 QUE NÃO ABRE (ERR-556): quais frases da ponte contam, conferidas contra o programa de verdade.
const raiz = join(__dirname, '../../../..');

describe('o chat da 99 que não abre', () => {
  it('reconhece as frases de conversa que não abriu — com o texto exato da 99 depois, na ponte nova', () => {
    for (const e of [
      'a 99 encerrou a conversa deste pedido ("não é possível enviar mensagens"): o aviso não tem como chegar ao cliente',
      'a conversa aberta é a do (sem número), não a do #436011 — não escrevi nada',
      'a conversa da 99 não terminou de carregar (o campo não apareceu)',
      'cliquei no botão do chat e a conversa não abriu',
      'a conversa fechou antes de carregar',
    ])
      expect(pareceChatDa99Fora(e)).toBe(true);
  });

  it('o que é de outra causa não entra', () => {
    for (const e of [
      null,
      undefined,
      '',
      'a conversa aberta é a do #436010, não a do #436011 — não escrevi nada', // outra conversa: conferência de segurança
      'a busca da 99 não achou o pedido #436011 entre os em andamento',
      'envio incerto: o programa apertou "Enviar" e a mensagem não voltou pelo chat — confira no portal da 99',
      'o texto não pode sair pelo chat: telefone',
      'esperando a tela da 99: alguém mexendo',
    ])
      expect(pareceChatDa99Fora(e)).toBe(false);
  });

  it('as frases são as que a ponte escreve e as que a tela compara', () => {
    const ponte = readFileSync(join(raiz, 'ponte-chat/src/envio-99.js'), 'utf8');
    for (const trecho of ['a 99 encerrou a conversa', "'(sem número)'", 'a conversa da 99 não terminou de carregar', 'cliquei no botão do chat e a conversa não abriu', 'a conversa fechou antes de carregar'])
      expect(ponte).toContain(trecho);
    const tela = readFileSync(join(raiz, 'frontend/src/lib/ponte-do-chat.ts'), 'utf8');
    for (const frase of [ERRO_CHAT_INDISPONIVEL, ERRO_CHAT_FORA_30_MIN, ERRO_A_LOJA_JA_FALOU]) expect(tela).toContain(`'${frase}'`);
  });
});
