import { Controller, Get, Query } from '@nestjs/common';
import { EdgeService } from './edge.service';

// Rota pública de identificação: o cliente confirma que achou o servidor Regem
// (na LAN via mDNS/IP, ou a nuvem). Sem auth — só diz "sou o Regem".
@Controller()
export class EdgeController {
  constructor(private readonly service: EdgeService) {}

  @Get('ping')
  ping() {
    return this.service.info();
  }

  // O edge consulta se há versão nova publicada (Fase E-D). Só informa versão +
  // url/sha do pacote — nada sensível, por isso público.
  @Get('edge/update-check')
  updateCheck(@Query('versao') versao?: string) {
    return this.service.atualizacao(versao);
  }
}
