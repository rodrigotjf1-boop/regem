import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { CAMINHO_DO_MANIFESTO } from './ligacao.regras';
import { manifestoDaPorta } from './manifesto-integracao';

// O MANIFESTO da porta de integração (Padrão DMS §13; F4, parte A), SEM credencial: é a documentação pública da porta, e
// só dela. Fora do prefixo `/api/v1` (`ROTAS_FORA_DO_PREFIXO`), como os metadados do recurso (RFC 9728). Só na nuvem,
// como a porta.
@Controller()
@CloudOnly()
export class ManifestoController {
  @Get(CAMINHO_DO_MANIFESTO)
  @Header('Cache-Control', 'public, max-age=300')
  @ApiExcludeEndpoint()
  manifesto() {
    return manifestoDaPorta();
  }
}
