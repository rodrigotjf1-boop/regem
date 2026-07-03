import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { colaborador } from '../../db/schema';
import { mergeUiPrefs, sanitizeUiPrefs, UiPrefs } from '../../common/regras-negocio';
import { UpdatePrefsDto } from './dto/update-prefs.dto';

@Injectable()
export class PrefsService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async get(tenantId: string, colaboradorId: string): Promise<UiPrefs> {
    const [row] = await this.db
      .select({ uiPrefs: colaborador.uiPrefs })
      .from(colaborador)
      .where(
        and(eq(colaborador.id, colaboradorId), eq(colaborador.tenantId, tenantId)),
      );
    return sanitizeUiPrefs(row?.uiPrefs);
  }

  // Merge parcial: só as chaves enviadas mudam; o resto é preservado.
  async patch(
    tenantId: string,
    colaboradorId: string,
    dto: UpdatePrefsDto,
  ): Promise<UiPrefs> {
    const atual = await this.get(tenantId, colaboradorId);
    const novo = mergeUiPrefs(atual, dto);
    await this.db
      .update(colaborador)
      .set({ uiPrefs: novo, updatedAt: new Date() })
      .where(
        and(eq(colaborador.id, colaboradorId), eq(colaborador.tenantId, tenantId)),
      );
    return novo;
  }
}
