/**
 * @file Escolhe o próximo responsável do rodízio, preservando o lock até atualizar o ponteiro.
 * @layer service
 */
import {
  atualizarPonteiro,
  inicializarPonteiro,
  lerPonteiroBloqueado,
  withRodizioTransaction,
} from '../adapters/crm-rodizio.repository.js';

export function proximoDaVez(candidatos, ultimo) {
  if (!ultimo) {
    return candidatos[0];
  }

  return candidatos.find((id) => id > ultimo) ?? candidatos[0];
}

export function avancarRodizio(tenantId, chave, candidatos) {
  return withRodizioTransaction(tenantId, async (tx) => {
    await inicializarPonteiro(tx, tenantId, chave);

    const [{ ultimo_usuario_id: ultimo }] = await lerPonteiroBloqueado(tx, tenantId, chave);
    const escolhido = proximoDaVez(candidatos, ultimo);

    await atualizarPonteiro(tx, tenantId, chave, escolhido);

    return escolhido;
  });
}
