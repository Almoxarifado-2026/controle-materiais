'use strict';

// ============================================================
// Erro de domínio com CÓDIGO estável.
//
// O domínio não conhece HTTP: ele apenas classifica a falha
// (validação, não encontrado, duplicidade). A camada de servidor
// traduz o código para o status HTTP correspondente. Assim as
// regras de negócio ficam fora do servidor e as mensagens de erro
// continuam claras e previsíveis.
// ============================================================

const CODIGOS = Object.freeze({
  VALIDACAO: 'VALIDACAO',
  NAO_ENCONTRADO: 'NAO_ENCONTRADO',
  DUPLICADO: 'DUPLICADO',
  // Sprint 3 (lançamento de pesos): o material é uma REFERÊNCIA dentro do corpo
  // do lançamento (não o recurso da URL), então estes dois códigos são distintos
  // de NAO_ENCONTRADO e o servidor os traduz para 400 (mesmo status que essas
  // falhas já tinham na v1.1.0).
  MATERIAL_INEXISTENTE: 'MATERIAL_INEXISTENTE',
  MATERIAL_INATIVO: 'MATERIAL_INATIVO',
});

class ErroDominio extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroDominio';
    this.codigo = codigo;
  }
}

const erroValidacao = (msg) => new ErroDominio(CODIGOS.VALIDACAO, msg);
const erroNaoEncontrado = (msg) => new ErroDominio(CODIGOS.NAO_ENCONTRADO, msg);
const erroDuplicado = (msg) => new ErroDominio(CODIGOS.DUPLICADO, msg);
const erroMaterialInexistente = (msg) => new ErroDominio(CODIGOS.MATERIAL_INEXISTENTE, msg);
const erroMaterialInativo = (msg) => new ErroDominio(CODIGOS.MATERIAL_INATIVO, msg);

module.exports = {
  ErroDominio,
  CODIGOS,
  erroValidacao,
  erroNaoEncontrado,
  erroDuplicado,
  erroMaterialInexistente,
  erroMaterialInativo,
};
