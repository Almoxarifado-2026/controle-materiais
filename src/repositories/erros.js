'use strict';

// ============================================================
// Erros da camada de persistência (Sprint 4).
//
// Dois grupos:
//  1) ErroDominio (src/domain/erros.js) — VALIDACAO, NAO_ENCONTRADO,
//     DUPLICADO, MATERIAL_INEXISTENTE, MATERIAL_INATIVO. Os repositories
//     REUSAM esses códigos para que o servidor HTTP continue traduzindo
//     status da mesma forma que hoje.
//  2) ErroPersistencia — falhas de INFRAESTRUTURA (conexão, permissão,
//     índice ausente, referência inválida, integridade, erro genérico do
//     Firestore). A mensagem é sempre FIXA e segura: nunca contém a mensagem
//     original do SDK (que pode trazer URL do console, ID de projeto ou
//     caminho de coleção), stack trace, credencial ou caminho interno.
//     Só o código curto do SDK (ex.: "permission-denied") é guardado, em
//     `codigoOrigem`, para diagnóstico.
// ============================================================

const { ErroDominio, erroDuplicado, erroNaoEncontrado } = require('../domain/erros');

const CODIGOS_PERSISTENCIA = Object.freeze({
  CONEXAO: 'PERSISTENCIA_CONEXAO',
  PERMISSAO: 'PERSISTENCIA_PERMISSAO',
  INDICE_AUSENTE: 'PERSISTENCIA_INDICE_AUSENTE',
  REFERENCIA_INVALIDA: 'PERSISTENCIA_REFERENCIA_INVALIDA',
  INTEGRIDADE: 'PERSISTENCIA_INTEGRIDADE',
  FIRESTORE: 'PERSISTENCIA_FIRESTORE',
  CONFIGURACAO: 'PERSISTENCIA_CONFIGURACAO',
});

const MENSAGENS = Object.freeze({
  [CODIGOS_PERSISTENCIA.CONEXAO]: 'Não foi possível conectar ao banco de dados. Verifique a conexão e tente novamente.',
  [CODIGOS_PERSISTENCIA.PERMISSAO]: 'Acesso ao banco de dados negado. Verifique as permissões.',
  [CODIGOS_PERSISTENCIA.INDICE_AUSENTE]: 'A consulta exige um índice que ainda não foi criado no banco de dados.',
  [CODIGOS_PERSISTENCIA.REFERENCIA_INVALIDA]: 'Inconsistência nos dados: um registro referencia um material que não existe.',
  [CODIGOS_PERSISTENCIA.INTEGRIDADE]: 'Falha ao confirmar a persistência dos dados.',
  [CODIGOS_PERSISTENCIA.FIRESTORE]: 'Erro ao acessar o banco de dados.',
  [CODIGOS_PERSISTENCIA.CONFIGURACAO]: 'Persistência não configurada corretamente.',
});

class ErroPersistencia extends Error {
  constructor(codigo, codigoOrigem = null) {
    super(MENSAGENS[codigo] || MENSAGENS[CODIGOS_PERSISTENCIA.FIRESTORE]);
    this.name = 'ErroPersistencia';
    this.codigo = codigo;
    this.codigoOrigem = codigoOrigem;
  }
}

const erroPersistencia = (codigo, codigoOrigem) => new ErroPersistencia(codigo, codigoOrigem);

// Códigos de erro do SDK do Firestore (propriedade `code`, string curta).
function pareceErroDoSdk(err) {
  return Boolean(err) && typeof err === 'object' && typeof err.code === 'string' && !(err instanceof ErroDominio) && !(err instanceof ErroPersistencia);
}

/**
 * Traduz qualquer erro lançado dentro de uma operação do Firestore.
 *  - ErroDominio e ErroPersistencia passam sem alteração.
 *  - Erro do SDK (tem `code` textual) vira erro de domínio/persistência com
 *    mensagem fixa.
 *  - Qualquer outra coisa (bug, TypeError) é devolvida como está: o servidor
 *    já responde 500 genérico para erros desconhecidos.
 */
function traduzirErroFirestore(err) {
  if (!pareceErroDoSdk(err)) return err;
  const origem = err.code.slice(0, 60);
  switch (origem) {
    case 'permission-denied':
    case 'unauthenticated':
      return erroPersistencia(CODIGOS_PERSISTENCIA.PERMISSAO, origem);
    case 'unavailable':
    case 'deadline-exceeded':
    case 'cancelled':
      return erroPersistencia(CODIGOS_PERSISTENCIA.CONEXAO, origem);
    case 'failed-precondition':
      return /index/i.test(String(err.message || ''))
        ? erroPersistencia(CODIGOS_PERSISTENCIA.INDICE_AUSENTE, origem)
        : erroPersistencia(CODIGOS_PERSISTENCIA.FIRESTORE, origem);
    case 'already-exists':
      return erroDuplicado('Já existe um documento com esse identificador.');
    case 'not-found':
      return erroNaoEncontrado('Documento não encontrado.');
    default:
      return erroPersistencia(CODIGOS_PERSISTENCIA.FIRESTORE, origem);
  }
}

module.exports = { ErroPersistencia, CODIGOS_PERSISTENCIA, erroPersistencia, traduzirErroFirestore };
