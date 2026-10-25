'use strict';

// ============================================================
// CONTRATOS dos repositories (Sprint 4).
//
// Contrato ASSÍNCRONO (todas as operações de dados devolvem Promise), porque o
// Firestore é assíncrono. A implementação SQLite também cumpre o contrato
// assíncrono (corpo síncrono dentro de uma função async: continua bloqueando o
// event loop exatamente como o SQLite de hoje, nada pior).
//
// Desde a Sprint 5 (integração), o domínio (src/domain/*.js) USA estes contratos
// em todas as operações, obtendo os repositories ativos em src/repositories/provedor.js
// (ver RELATORIO_SPRINT5_INTEGRACAO_REPOSITORIES.md).
//
// Entidades (formato canônico, igual nas duas implementações):
//   Material: { id, nome, categoria: string|null, ativo: boolean,
//               criadoEm: ISO-8601, atualizadoEm: ISO-8601 }
//   Registro: { id, materialId, pesoKg, dataRecebimento: 'YYYY-MM-DD',
//               observacao: string|null, criadoEm, atualizadoEm,
//               materialNome, materialCategoria }
//   id: opaco. SQLite -> number; Firestore -> string (inteiros migrados do
//   SQLite viram "7", "142"; documentos novos usam ID automático).
//
// Filtro: { materialId?, categoria?, dataInicial?, dataFinal? } (mesma forma do
// filterBuilder). Semântica preservada: período fechado nas duas pontas,
// categoria = comparação exata com a categoria ATUAL do material (como o JOIN).
// ============================================================

const METODOS_MATERIAIS = Object.freeze([
  'normalizarId', // síncrona e pura: id válido -> id canônico; inválido -> null
  'listar',
  'buscarPorId',
  'contarPorStatus',
  'criar',
  'atualizar',
  'definirAtivo',
]);

const METODOS_REGISTROS = Object.freeze([
  'normalizarId', // síncrona e pura
  'criar',
  'buscarPorId',
  'listar',
  'totais',
  'consultarHistorico',
  'consultarIndicadores',
  'pesoPorMaterial',
  'pesoPorBalde',
]);

function naoImplementado(contrato, metodo) {
  return new Error(`${contrato}.${metodo} não implementado pela classe concreta.`);
}

class MateriaisRepository {
  /** @returns {number|string|null} */
  normalizarId(_valor) { throw naoImplementado('MateriaisRepository', 'normalizarId'); }
  /** Padrão: só ativos. Ordem: nome (bytes UTF-8). @returns {Promise<Material[]>} */
  async listar(_opcoes) { throw naoImplementado('MateriaisRepository', 'listar'); }
  /** ID inválido ou inexistente -> null. @returns {Promise<Material|null>} */
  async buscarPorId(_id) { throw naoImplementado('MateriaisRepository', 'buscarPorId'); }
  /** @returns {Promise<{ativos:number, inativos:number}>} */
  async contarPorStatus() { throw naoImplementado('MateriaisRepository', 'contarPorStatus'); }
  /** Unicidade atômica de nome. Lança ErroDominio DUPLICADO. @returns {Promise<Material>} */
  async criar(_dados, _opcoes) { throw naoImplementado('MateriaisRepository', 'criar'); }
  /** Campo undefined = manter. Lança NAO_ENCONTRADO / DUPLICADO. @returns {Promise<Material>} */
  async atualizar(_id, _campos) { throw naoImplementado('MateriaisRepository', 'atualizar'); }
  /** Idempotente (sem gravar se já está no estado). Nunca exclui. @returns {Promise<Material>} */
  async definirAtivo(_id, _ativo) { throw naoImplementado('MateriaisRepository', 'definirAtivo'); }
}

class RegistrosPesoRepository {
  normalizarId(_valor) { throw naoImplementado('RegistrosPesoRepository', 'normalizarId'); }
  /**
   * opcoes.validarMaterial(material|null): guarda de NEGÓCIO fornecida pelo domínio
   * (ex.: material inexistente/inativo), executada DENTRO da transação.
   * @returns {Promise<Registro>}
   */
  async criar(_dados, _opcoes) { throw naoImplementado('RegistrosPesoRepository', 'criar'); }
  async buscarPorId(_id) { throw naoImplementado('RegistrosPesoRepository', 'buscarPorId'); }
  /** Ordem: dataRecebimento DESC e, no empate, o lançamento mais recente primeiro. @returns {Promise<Registro[]>} */
  async listar(_filtro) { throw naoImplementado('RegistrosPesoRepository', 'listar'); }
  /** @returns {Promise<{quantidadeRegistros:number,totalKg:number,mediaKg:number}>} */
  async totais(_filtro) { throw naoImplementado('RegistrosPesoRepository', 'totais'); }
  /** totais + registros do MESMO conjunto. @returns {Promise<{totais, registros}>} */
  async consultarHistorico(_filtro) { throw naoImplementado('RegistrosPesoRepository', 'consultarHistorico'); }
  /** @returns {Promise<{quantidadeRegistros,totalKg,mediaKg,materiaisEnvolvidos}>} */
  async consultarIndicadores(_filtro) { throw naoImplementado('RegistrosPesoRepository', 'consultarIndicadores'); }
  /** Ordem: pesoKg DESC, nome ASC (bytes), id ASC. @returns {Promise<{materialId,material,pesoKg}[]>} */
  async pesoPorMaterial(_filtro) { throw naoImplementado('RegistrosPesoRepository', 'pesoPorMaterial'); }
  /** granularidade 'dia'|'mes'|'ano'; só baldes com dado, ordenados por chave. @returns {Promise<{chave,pesoKg}[]>} */
  async pesoPorBalde(_filtro, _granularidade) { throw naoImplementado('RegistrosPesoRepository', 'pesoPorBalde'); }
}

/** Lança se `repo` não implementa (com função real, não a abstrata) todos os métodos do contrato. */
function verificarContrato(repo, metodos, base, nome) {
  const faltando = metodos.filter((m) => typeof repo[m] !== 'function' || repo[m] === base.prototype[m]);
  if (faltando.length > 0) {
    throw new Error(`${nome}: método(s) do contrato não implementado(s): ${faltando.join(', ')}.`);
  }
  return repo;
}

const verificarMateriais = (repo) => verificarContrato(repo, METODOS_MATERIAIS, MateriaisRepository, 'MateriaisRepository');
const verificarRegistros = (repo) => verificarContrato(repo, METODOS_REGISTROS, RegistrosPesoRepository, 'RegistrosPesoRepository');

module.exports = {
  MateriaisRepository,
  RegistrosPesoRepository,
  METODOS_MATERIAIS,
  METODOS_REGISTROS,
  verificarMateriais,
  verificarRegistros,
};
