import { conferirUrlPublica, ipPrivadoOuLocal, urlPublicaSegura } from './ssrf-guard';
import { enderecoRecusado } from './envio-seguro';

// A CLASSIFICAÇÃO DE ENDEREÇO DO GUARDA É A DO ENVIO ESTRITO (segunda rodada da avaliação de segurança, 16/11/2026, a
// ressalva do A-05). O guarda dos endereços que a loja cadastra só conhecia as faixas privadas: aceitava as reservadas
// do IPv4 e as do IPv6 que levam um IPv4 dentro (NAT64, 6to4, Teredo), por onde um endereço "público" pode chegar a
// uma rede interna. O que o guarda segue aceitando, de propósito: http e porta fora do padrão.

describe('guarda dos endereços da loja: as faixas especiais', () => {
  const ESPECIAIS = [
    '64:ff9b::a00:1', // NAT64 de 10.0.0.1
    '64:ff9b::7f00:1', // NAT64 de 127.0.0.1
    '64:ff9b:1::a00:1', // NAT64 local
    '2002:a00:1::1', // 6to4 de 10.0.0.1
    '2002:c0a8:101::1', // 6to4 de 192.168.1.1
    '2001:0:4136:e378:8000:63bf:3fff:fdd2', // Teredo
    '::10.0.0.1', // IPv4 "compatível"
    '198.18.0.1', // teste de desempenho entre redes
    '240.0.0.1', // reservado
    '224.0.0.1', // multicast
    '255.255.255.255', // difusão
  ];
  const PRIVADOS = ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.16.0.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1'];
  const PUBLICOS = ['8.8.8.8', '1.1.1.1', '200.160.2.3', '2001:4860:4860::8888', '2606:4700:4700::1111', '2804:14c::1'];

  it('recusa as faixas especiais que antes passavam', () => {
    for (const ip of ESPECIAIS) expect([ip, ipPrivadoOuLocal(ip)]).toEqual([ip, true]);
  });

  it('segue recusando as privadas e o que não é IP', () => {
    for (const ip of [...PRIVADOS, 'nao-e-ip', '', '999.1.1.1']) expect([ip, ipPrivadoOuLocal(ip)]).toEqual([ip, true]);
  });

  it('segue aceitando o endereço público, IPv4 e IPv6', () => {
    for (const ip of PUBLICOS) expect([ip, ipPrivadoOuLocal(ip)]).toEqual([ip, false]);
  });

  it('o guarda não aceita NADA que o envio estrito recusa (a mesma classificação)', () => {
    for (const ip of [...ESPECIAIS, ...PRIVADOS, ...PUBLICOS]) {
      if (enderecoRecusado(ip)) expect([ip, ipPrivadoOuLocal(ip)]).toEqual([ip, true]);
    }
  });

  it('pelo endereço inteiro: IP especial escrito na URL é recusado; nome que resolve para um deles, também', async () => {
    expect(await urlPublicaSegura('https://[64:ff9b::a00:1]/aviso')).toBe(false);
    expect(await urlPublicaSegura('https://[2002:a00:1::1]/aviso')).toBe(false);
    expect(await urlPublicaSegura('http://198.18.0.1:8080/aviso')).toBe(false);
    const resolver = async () => [{ address: '8.8.8.8', family: 4 }, { address: '64:ff9b::a00:1', family: 6 }];
    expect(await conferirUrlPublica('https://robo.exemplo.invalid/aviso', { resolver })).toBeNull();
  });

  it('o que o guarda segue aceitando, de propósito: http e porta fora do padrão em endereço público', async () => {
    const resolver = async () => [{ address: '200.160.2.3', family: 4 }];
    const r = await conferirUrlPublica('http://robo.exemplo.invalid:5678/webhook/regem', { resolver });
    expect(r?.enderecos).toEqual([{ address: '200.160.2.3', family: 4 }]);
    expect(r?.url.port).toBe('5678');
  });
});
