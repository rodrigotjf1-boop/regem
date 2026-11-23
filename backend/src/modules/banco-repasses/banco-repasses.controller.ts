import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { BancoRepassesService } from './banco-repasses.service';
import { ClassificarLancamentoDto } from './dto/classificar-lancamento.dto';
import { LIMITE_DE_BYTES } from './ofx';

const NO_ENVIO = { limits: { fileSize: LIMITE_DE_BYTES + 1, files: 1 } };

// FINANCEIRO › BANCO E REPASSES (R1 da versão 8 do Mister, mig 499). SÓ O PRESIDENTE (V8-2) em TODA rota, recusado aqui no
// servidor: o gerente não recebe nem a contagem. Só na nuvem: as tabelas não vão ao servidor da loja.
@Controller('banco-repasses')
@CloudOnly()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('presidente')
export class BancoRepassesController {
  constructor(private readonly banco: BancoRepassesService) {}

  @Get()
  listar(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Query('periodo') periodo?: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
    @Query('situacao') situacao?: string,
    @Query('fonte') fonte?: string,
    @Query('busca') busca?: string,
    @Query('limite') limite?: string,
    @Query('deslocamento') deslocamento?: string,
  ) {
    return this.banco.listar(user.tenantId, atual, { periodo, de, ate, situacao, fonte, busca, limite, deslocamento });
  }

  /** Passo 2: lê o arquivo e diz o que entraria. Não grava nada. */
  @Post('importar/conferir')
  @UseInterceptors(FileInterceptor('file', NO_ENVIO))
  conferir(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null, @UploadedFile() file?: { buffer?: Buffer }) {
    if (!file?.buffer) throw new BadRequestException('Escolha o arquivo do extrato.');
    return this.banco.conferir(user.tenantId, atual, file.buffer);
  }

  /** Passo 3: grava numa transação. O mesmo arquivo de novo não cria nada. */
  @Post('importar')
  @UseInterceptors(FileInterceptor('file', NO_ENVIO))
  importar(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null, @UploadedFile() file?: { buffer?: Buffer }) {
    if (!file?.buffer) throw new BadRequestException('Escolha o arquivo do extrato.');
    return this.banco.importar(user, atual, file.buffer);
  }

  /** "Isso é o quê?" e "Lembrar para os próximos". */
  @Patch('lancamentos/:id')
  classificar(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ClassificarLancamentoDto,
  ) {
    return this.banco.classificar(user, atual, id, dto);
  }
}
