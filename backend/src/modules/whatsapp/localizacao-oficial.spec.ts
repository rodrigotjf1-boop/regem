import { WhatsappCloudService } from './whatsapp-cloud.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A LOCALIZAÇÃO QUE O CLIENTE MANDA PELA API OFICIAL (F3 do robô, 30/10/2026): chegava ao robô como texto vazio — e o
// pedido por distância precisa dela. Vira o mesmo texto da Evolution ("[localização] lat,lng").
describe('mensagem da API oficial para o robô', () => {
  const textoDe = (m: any): string => (Object.create(WhatsappCloudService.prototype) as any).textoDe(m);

  it('localização: o mesmo texto da Evolution', () => {
    expect(textoDe({ type: 'location', location: { latitude: -22.9068, longitude: -43.1729, name: 'Casa' } })).toBe('[localização] -22.9068,-43.1729');
    expect(textoDe({ type: 'location', location: {} })).toBe('');
  });

  it('o resto como antes: texto, botão, legenda', () => {
    expect(textoDe({ text: { body: 'oi' } })).toBe('oi');
    expect(textoDe({ interactive: { button_reply: { title: 'Sim, monta pra mim' } } })).toBe('Sim, monta pra mim');
    expect(textoDe({ image: { caption: 'meu endereço' } })).toBe('meu endereço');
    expect(textoDe({ audio: { id: 'x' } })).toBe('');
  });
});
