import { posicaoDaPlataforma } from './posicao-da-plataforma';

// A posição exata que o iFood e a 99 mandam no pedido (ponte do chat, parte A2) — o "chegando" e a previsão de chegada
// usam esta antes de procurar o endereço pelo texto.
describe('posição do cliente que a plataforma mandou', () => {
  it('iFood: delivery.deliveryAddress.coordinates (número ou texto)', () => {
    expect(posicaoDaPlataforma('ifood', { delivery: { deliveryAddress: { coordinates: { latitude: -22.9068, longitude: -43.1729 } } } })).toEqual({ lat: -22.9068, lng: -43.1729 });
    expect(posicaoDaPlataforma('ifood', { delivery: { deliveryAddress: { coordinates: { latitude: '-22.9', longitude: '-43.1' } } } })).toEqual({ lat: -22.9, lng: -43.1 });
  });

  it('99: receive_address.poi_lat/poi_lng em wgs84 (ou sem o tipo)', () => {
    expect(posicaoDaPlataforma('99food', { receive_address: { poi_lat: -22.85, poi_lng: -43.31, coordinate_type: 'wgs84' } })).toEqual({ lat: -22.85, lng: -43.31 });
    expect(posicaoDaPlataforma('99food', { receive_address: { poi_lat: '-22.85', poi_lng: '-43.31' } })).toEqual({ lat: -22.85, lng: -43.31 });
    expect(posicaoDaPlataforma('99food', { receive_address: { poi_lat: -22.85, poi_lng: -43.31, coordinate_type: 'WGS84 ' } })).toEqual({ lat: -22.85, lng: -43.31 });
  });

  it('outro sistema de coordenadas, sem posição, (0, 0), fora do globo ou texto: null (fica a geocodificação)', () => {
    expect(posicaoDaPlataforma('99food', { receive_address: { poi_lat: -22.85, poi_lng: -43.31, coordinate_type: 'gcj02' } })).toBeNull();
    expect(posicaoDaPlataforma('ifood', { delivery: { deliveryAddress: {} } })).toBeNull();
    expect(posicaoDaPlataforma('ifood', { delivery: { deliveryAddress: { coordinates: { latitude: 0, longitude: 0 } } } })).toBeNull();
    expect(posicaoDaPlataforma('ifood', { delivery: { deliveryAddress: { coordinates: { latitude: 95, longitude: -43 } } } })).toBeNull();
    expect(posicaoDaPlataforma('99food', { receive_address: { poi_lat: 'abc', poi_lng: -43 } })).toBeNull();
    expect(posicaoDaPlataforma('99food', { receive_address: { poi_lat: '', poi_lng: '' } })).toBeNull();
    expect(posicaoDaPlataforma('ifood', null)).toBeNull();
  });

  it('os canais da loja (cardápio, WhatsApp) não têm posição da plataforma', () => {
    expect(posicaoDaPlataforma('cardapio', { delivery: { deliveryAddress: { coordinates: { latitude: -22.9, longitude: -43.1 } } } })).toBeNull();
    expect(posicaoDaPlataforma('anotaai', { receive_address: { poi_lat: -22.85, poi_lng: -43.31 } })).toBeNull();
  });
});
