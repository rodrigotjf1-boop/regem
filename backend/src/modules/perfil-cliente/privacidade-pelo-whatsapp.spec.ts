import { PEDE_PRIVACIDADE, respostaDePrivacidade } from './privacidade-pelo-whatsapp';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A palavra PRIVACIDADE no WhatsApp (F1c do plano do perfil do cliente): só a palavra sozinha, só com o módulo ligado, o
// link de Sua conta › Perfil, e nunca rejeita (a mensagem segue o caminho de sempre).
describe('PRIVACIDADE pelo WhatsApp', () => {
  const T = '00000000-0000-0000-0000-000000000001';
  const banco = (ativo: boolean | Error) => {
    const chamadas: any[] = [];
    return {
      chamadas,
      execute: async (q: any) => {
        chamadas.push(q);
        if (ativo instanceof Error) throw ativo;
        return { rows: [{ ativo }] };
      },
    };
  };

  it('reconhece só a palavra sozinha (com ponto), não a frase', () => {
    for (const t of ['privacidade', 'privacidade.', 'meus dados', 'minha privacidade']) expect(PEDE_PRIVACIDADE.test(t)).toBe(true);
    for (const t of ['qual a política de privacidade?', 'privacidade do pedido 12', 'sair', '']) expect(PEDE_PRIVACIDADE.test(t)).toBe(false);
  });

  it('com o módulo ligado: o link de Sua conta › Perfil do cardápio da loja', async () => {
    const db = banco(true);
    const r = await respostaDePrivacidade(db, { tenantId: T, cardapioToken: 'abc123', texto: '  PRIVACIDADE ' });
    expect(r).toContain('/c/abc123?conta=perfil');
    expect(r).toContain('Sua conta › Perfil › Privacidade');
  });

  it('módulo desligado, sem cardápio ou leitura que falha: null (segue para o robô)', async () => {
    expect(await respostaDePrivacidade(banco(false), { tenantId: T, cardapioToken: 'abc123', texto: 'privacidade' })).toBeNull();
    expect(await respostaDePrivacidade(banco(true), { tenantId: T, cardapioToken: null, texto: 'privacidade' })).toBeNull();
    expect(await respostaDePrivacidade(banco(new Error('caiu')), { tenantId: T, cardapioToken: 'abc123', texto: 'privacidade' })).toBeNull();
  });

  it('mensagem comum não consulta o banco (cada mensagem do cliente passa por aqui)', async () => {
    const db = banco(true);
    expect(await respostaDePrivacidade(db, { tenantId: T, cardapioToken: 'abc123', texto: 'quero um x-burguer' })).toBeNull();
    expect(db.chamadas).toHaveLength(0);
  });
});
