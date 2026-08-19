import { crmModule } from '#modules/nucleo/crm/index.js';
import { kanbanUniversalModule } from '#modules/nucleo/kanban-universal/index.js';
import { agendamentoModule } from '#modules/nucleo/agendamento/index.js';
import { pagamentoInChatModule } from '#modules/nucleo/pagamento-inchat/index.js';

import { esteticaCapilarModule } from '#modules/verticais/estetica-capilar/index.js';
import { tatuagemModule } from '#modules/verticais/tatuagem/index.js';

/**
 * ÚNICO lugar do repositório onde módulos são listados.
 * Adicionar um módulo novo = adicionar uma linha aqui.
 * Ver MODULE_CONTRACT.md, seção 9.
 *
 * @type {import('#core/types/module.js').Module[]}
 */
export const MODULES = [
  // Núcleo — Bloco 1.1
  crmModule,
  kanbanUniversalModule,
  agendamentoModule,
  pagamentoInChatModule,

  // Verticais — Bloco 1.1
  esteticaCapilarModule,
  tatuagemModule,
];
