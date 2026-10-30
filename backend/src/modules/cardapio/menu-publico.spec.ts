import { menuParaOPublico } from './menu-publico';

// O cardápio público (link/QR) não entrega a base de conhecimento nem as respostas prontas do robô (30/10/2026): elas
// são da loja para o robô, que as lê por `publico/bot/loja`, com a senha.
describe('menu para o público', () => {
  const menu = {
    loja: { nome: 'Mister' },
    produtos: [{ id: 'p1' }],
    robo: { ativo: true, saudacao: 'Olá!', ausencia: 'Fechados', prompt: 'combinado interno', mensagens: [{ gatilho: 'a', resposta: 'b' }] },
  };

  it('tira prompt e mensagens; mantém o resto', () => {
    const p: any = menuParaOPublico(menu);
    expect(p.robo).toEqual({ ativo: true, saudacao: 'Olá!', ausencia: 'Fechados' });
    expect(p.produtos).toBe(menu.produtos);
    expect(JSON.stringify(p)).not.toContain('combinado interno');
  });

  it('não mexe no objeto recebido (o menu pode vir de cache)', () => {
    menuParaOPublico(menu);
    expect(menu.robo.prompt).toBe('combinado interno');
    expect(menu.robo.mensagens).toHaveLength(1);
  });

  it('menu sem o bloco do robô passa como está', () => {
    const sem = { loja: { nome: 'X' } } as any;
    expect(menuParaOPublico(sem)).toBe(sem);
    expect(menuParaOPublico(null as any)).toBeNull();
  });
});
