import { caminhoParaNuvem } from './gogem-proxy.service';

// Errar o caminho do repasse manda pagamento para o lugar errado — por isso tem teste.
describe('caminhoParaNuvem (R3c)', () => {
  it('tira o prefixo global e preserva o resto', () => {
    expect(caminhoParaNuvem('/api/v1/pagamentos/point')).toBe('/pagamentos/point');
    expect(caminhoParaNuvem('/api/v1/publico/dispositivos/parear')).toBe(
      '/publico/dispositivos/parear',
    );
  });

  it('preserva a query (id da cobrança, versão do catálogo…)', () => {
    expect(caminhoParaNuvem('/api/v1/kiosk/latest?versionCode=12')).toBe(
      '/kiosk/latest?versionCode=12',
    );
  });

  it('não corta caminho que só COMEÇA parecido', () => {
    expect(caminhoParaNuvem('/api/v1x/pagamentos')).toBe('/api/v1x/pagamentos');
  });

  it('sempre devolve caminho absoluto', () => {
    expect(caminhoParaNuvem('pagamentos/pix')).toBe('/pagamentos/pix');
    expect(caminhoParaNuvem(undefined)).toBe('/');
  });
});
