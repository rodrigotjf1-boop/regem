import {
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { MidiaService, UploadedFileLike } from './midia.service';

@Controller('midia')
@UseGuards(JwtAuthGuard)
export class MidiaController {
  constructor(private readonly service: MidiaService) {}

  // multipart/form-data, campo "file". Qualquer usuário autenticado pode enviar.
  @Post('upload')
  // Corta no Multer antes de bufferizar arquivo gigante (defesa em profundidade;
  // o service ainda valida os magic bytes de imagem).
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedFileLike,
  ) {
    return this.service.upload(user.tenantId, file);
  }
}
