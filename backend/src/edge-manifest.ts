// Manifesto do edge-core (Fase 1) — classificação autoritativa dos módulos por
// onde podem rodar. Fonte: docs/roadmap-seguranca-migracao.md §8. Usado como
// referência para o SPLIT DE BUILD (o bundle do edge inclui só EDGE_CORE + SYNC +
// INFRA; nunca CLOUD_ONLY) e para conferir o @CloudOnly nos controllers.
//
// ⚠️ Isto é o CONTRATO. Módulo novo deve ser classificado aqui. O corte real é por
// build; o @CloudOnly/CloudOnlyGuard é a blindagem em runtime (defesa em profundidade).

// Só na NUVEM — segredos de terceiros, cross-tenant, licença, integrações,
// consolidação, identidade/onboarding, cardápio ONLINE. Marcar os controllers com
// @CloudOnly() (o edge nem os serve).
export const CLOUD_ONLY_MODULES = [
  'DistribuicaoModule', // console cross-tenant (frota, licenças, telemetria)
  'LicencaModule', // autoridade de licença/lease
  'IntegracoesModule', // iFood/Anota/99food/Cardápio Web/Open Delivery + segredos
  'BotModule', // bot de suporte (segredos n8n/IA)
  'WhatsappModule', // inbox/onboarding do bot (Evolution/n8n)
  'DiretoriaModule', // Visão C&O (consolidação multiunidade)
  'CardapioModule', // cardápio ONLINE (/c/:token) — cardapioBaseUrl é sempre nuvem
  'ClienteModule', // identidade do cliente do cardápio (link mágico/OTP)
  'OnboardingModule', // wizard/onboarding da empresa (nasce na nuvem)
] as const;

// Operacional — roda LOCAL (fonte da verdade da loja). Entra no bundle do edge.
export const EDGE_CORE_MODULES = [
  'VendasModule', 'ProducaoModule', 'ProducaoPedidoModule', 'OrdemProducaoModule',
  'ImpressaoModule', 'EstoqueModule', 'ContagemModule', 'DesperdicioModule',
  'RecebimentoModule', 'ComprasModule', 'PontoModule', 'EscalaModule',
  'DiaEspecialModule', 'ChecklistModule', 'TarefaModule', 'DocumentoModule',
  'GuiasModule', 'VistoriaModule', 'OcorrenciaModule', 'PicoModule', 'TurnoModule',
  'EquipamentoModule', 'DashboardModule', 'MuralModule', 'PedidoManutencaoModule',
  'DesligamentoModule', 'EtiquetaModule', 'EtiquetaValidadeModule',
  'DeliveryModule', // PAINEL de delivery (aceitar/pronto/despachar) roda no edge;
                    // a INGESTÃO de integração é da nuvem → endpoints @CloudOnly pontuais.
] as const;

// Existem nos DOIS; a nuvem é master e replica pro edge (PULL). Entram no bundle,
// mas a escrita canônica é na nuvem (ou reconciliada).
export const SYNC_MODULES = [
  'ProdutoModule', 'FichasModule', // catálogo (master nuvem → PULL)
  'SetorModule', 'FuncaoModule', 'ColaboradorModule', 'PerfilModule', // cadastros/RBAC
  'EmpresaModule', 'UnidadeModule', // identidade/rede (master nuvem)
  'ModuloModule', // ativação de módulos (presidente edita; edge LÊ o estado)
  'MidiaModule', // storage canônico nuvem; edge tem fallback em disco + serve local
  'FidelidadeModule', 'CashbackModule', // ⚠️ saldo = master nuvem + cache (decidir §8.4)
  'FinanceiroModule', 'FiscalModule', 'TefModule', 'RelatoriosModule', // financeiro/fiscal: leitura/emissão cloud-assisted
] as const;

// Infra sempre presente (auth, orm, agendador, sync, edge, realtime).
export const INFRA_MODULES = [
  'AuthModule', 'DrizzleModule', 'ConfigModule', 'ScheduleModule', 'ThrottlerModule',
  'EventEmitterModule', 'RealtimeModule', 'JobsModule', 'SyncModule', 'EdgeModule',
  'EdgeFlashSyncModule',
] as const;
