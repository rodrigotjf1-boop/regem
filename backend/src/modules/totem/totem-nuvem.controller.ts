import { All, Controller, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GogemProxyService } from './gogem-proxy.service';

// R3c — as rotas do totem que continuam sendo da NUVEM do GoGeM, repassadas pelo
// servidor local. Assim o aparelho tem UM endereço só: se a internet da loja cair, basta
// levar uma conexão ao servidor e tudo volta — sem tocar em cada totem.
//
// A lista é EXPLÍCITA de propósito. Um "pega tudo" no edge engoliria qualquer rota não
// casada da API inteira do Regem, e uma rota nova do Regem passaria a vazar para a nuvem
// do GoGeM sem ninguém perceber.
//
// Sem guard: o pareamento acontece ANTES de o aparelho ter token, e as demais são
// autenticadas lá na nuvem pelo `X-Device-Token`, que o repasse leva adiante. O edge não
// é a autoridade dessas rotas — não inventa uma segunda opinião sobre elas.
@Controller()
export class TotemNuvemController {
  constructor(private readonly proxy: GogemProxyService) {}

  @All([
    'publico/dispositivos/parear',
    'dispositivos/heartbeat',
    'telemetria/evento',
    'kiosk/latest',
    'pagamentos/pix',
    'pagamentos/pix/:id',
    'pagamentos/point',
    'pagamentos/point/:id',
    'pagamentos/point/:id/cancelar',
    'pagamentos/status/:orderId',
    // Estorno do pagamento APROVADO (nota que não saiu, cupom que não imprimiu). Só a nuvem do
    // GoGeM tem as credenciais do Mercado Pago: o Regem repassa e não interpreta nada.
    'pagamentos/estorno',
  ])
  async repassar(@Req() req: any, @Res({ passthrough: true }) res: Response) {
    const r = await this.proxy.encaminhar(req);
    res.status(r.status);
    return r.corpo;
  }
}
