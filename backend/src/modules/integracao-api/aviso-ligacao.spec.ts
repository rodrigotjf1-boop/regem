import { emailDaLigacaoNova } from './aviso-ligacao';

// O e-mail da ligação nova (Padrão DMS §3, B1-4) manda o presidente a uma tela do Regem: o caminho e o verbo têm de
// ser os do menu e do botão do Regem, não os do RegemCast, de onde o texto veio (ERR-269).
describe('e-mail da ligação nova', () => {
  const e = emailDaLigacaoNova({
    nome: 'Ana Souza',
    aplicativo: 'Liame',
    loja: 'Centro',
    desde: '22/10/2026',
    liberadoEm: '30/09/2026',
    link: 'https://app.exemplo.test/integracoes',
  });

  it('leva ao caminho do menu do Regem: Configurações › Aplicativos conectados', () => {
    for (const t of [e.texto, e.html]) {
      expect(t).toContain('Configurações › Aplicativos conectados');
      expect(t).not.toContain('Integrações');
    }
  });

  it('usa o verbo do botão da tela (Revogar), nunca "desligar"', () => {
    for (const t of [e.texto, e.html]) {
      expect(t).toContain('revoga quando quiser');
      expect(t).toContain('Revogue-o nessa mesma tela');
      expect(t.toLowerCase()).not.toMatch(/deslig/);
    }
  });

  it('o assunto e a saudação seguem a loja e o primeiro nome', () => {
    expect(e.assunto).toBe('O acesso do Liame à loja Centro mudou de forma');
    expect(e.texto.startsWith('Ana, desde 22/10/2026 o Liame lê a loja Centro no Regem')).toBe(true);
    expect(e.texto).toContain('https://app.exemplo.test/integracoes');
  });
});
