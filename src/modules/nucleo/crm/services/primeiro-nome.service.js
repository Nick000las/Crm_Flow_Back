/**
 * SERVICE: primeiro nome (M10, docs/crm/plano-configuracoes.md) — campo do
 * sistema derivado do Nome e editável, pra personalizar mensagens.
 *
 * Regra (a migration 0024 fez o backfill com a mesma):
 * - derivado = a primeira palavra do nome;
 * - na criação, sem primeiro nome informado (ou vazio) → o derivado;
 * - na edição, mudar o nome sem mandar o primeiro nome rederiva só se o
 *   atual ainda era o derivado do nome antigo (ou estava vazio): o que foi
 *   editado à mão ("Zé") fica;
 * - primeiro nome `null`/vazio → volta ao derivado. Com nome, nunca fica vazio.
 *
 * Funções puras: quem chama lê o lead atual quando `precisaDoLeadAtual`.
 */

/**
 * @param {unknown} nome
 * @returns {string | null}
 */
export function primeiroNomeDe(nome) {
  if (typeof nome !== 'string') return null;
  const [primeira] = nome.trim().split(/\s+/);
  return primeira || null;
}

/** @param {unknown} valor */
function textoInformado(valor) {
  return typeof valor === 'string' ? valor.trim() : '';
}

/**
 * @template {{ nome: string, primeiroNome?: string | null }} T
 * @param {T} dados
 * @returns {T}
 */
export function comPrimeiroNomeNaCriacao(dados) {
  return { ...dados, primeiroNome: textoInformado(dados.primeiroNome) || primeiroNomeDe(dados.nome) };
}

/**
 * A edição só precisa do lead de antes quando mexe no nome ou limpa o
 * primeiro nome sem mandar o nome novo.
 *
 * @param {{ nome?: string, primeiroNome?: string | null }} input
 */
export function precisaDoLeadAtual(input) {
  if (input.primeiroNome === undefined) return input.nome !== undefined;
  return !textoInformado(input.primeiroNome) && input.nome === undefined;
}

/**
 * @template {{ nome?: string, primeiroNome?: string | null }} T
 * @param {T} input  payload da edição (parcial)
 * @param {{ nome: string, primeiro_nome?: string | null } | null | undefined} atual
 *   linha do lead de antes; sem ela (lead não existe), devolve o input — o 404 vem depois
 * @returns {T}
 */
export function comPrimeiroNomeNaEdicao(input, atual) {
  if (input.primeiroNome === undefined) {
    if (input.nome === undefined || !atual) return input;
    const anterior = atual.primeiro_nome ?? null;
    const seguiaONome = !anterior || anterior === primeiroNomeDe(atual.nome);
    return seguiaONome ? { ...input, primeiroNome: primeiroNomeDe(input.nome) } : input;
  }

  const informado = textoInformado(input.primeiroNome);
  if (informado) return { ...input, primeiroNome: informado };
  const nome = input.nome ?? atual?.nome;
  return nome === undefined ? input : { ...input, primeiroNome: primeiroNomeDe(nome) };
}
