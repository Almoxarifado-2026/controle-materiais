'use strict';

// ============================================================
// Validação ÚNICA de datas do sistema (formato YYYY-MM-DD).
//
// Usada tanto pelo domínio (data_recebimento) quanto pelo filtro
// centralizado (dataInicial / dataFinal). Não existe outra
// validação de data no código-fonte — se a regra mudar, muda aqui.
//
// Por que não usar Date.parse()/new Date():
//   Date.parse('2026-02-31') NÃO falha — o JavaScript normaliza
//   silenciosamente para 2026-03-03. Uma data inválida seria aceita
//   e gravada no histórico. Por isso a validação é ARITMÉTICA:
//   confere ANO + MÊS + DIA contra o calendário gregoriano, sem
//   criar nenhum objeto Date e sem normalizar nada.
//
// Decisão: o ano 0000 é rejeitado (o calendário gregoriano civil
// não tem ano zero). Anos aceitos: 0001 a 9999.
// ============================================================

// [0-9] (e não \d) para deixar explícito que só dígitos ASCII valem.
const FORMATO = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

function anoBissexto(ano) {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

function diasNoMes(ano, mes) {
  if (mes === 2) return anoBissexto(ano) ? 29 : 28;
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

/**
 * Retorna null se o valor é uma data real no formato YYYY-MM-DD,
 * ou uma string explicando por que foi rejeitado.
 */
function motivoDataInvalida(valor) {
  if (typeof valor !== 'string') {
    return 'deve ser um texto no formato YYYY-MM-DD';
  }
  const partes = FORMATO.exec(valor);
  if (!partes) {
    return 'formato inválido (esperado YYYY-MM-DD, com zeros à esquerda)';
  }
  const ano = Number(partes[1]);
  const mes = Number(partes[2]);
  const dia = Number(partes[3]);

  if (ano < 1) return 'ano deve ser 0001 ou maior';
  if (mes < 1 || mes > 12) return `mês ${partes[2]} não existe`;

  const maxDia = diasNoMes(ano, mes);
  if (dia < 1 || dia > maxDia) {
    return `dia ${partes[3]} não existe em ${partes[1]}-${partes[2]} (máximo ${maxDia})`;
  }
  return null;
}

function isDataValida(valor) {
  return motivoDataInvalida(valor) === null;
}

/**
 * Lança Error com mensagem clara se a data for inválida.
 * nomeCampo aparece na mensagem (ex.: "dataInicial").
 */
function validarData(valor, nomeCampo) {
  const motivo = motivoDataInvalida(valor);
  if (motivo !== null) {
    throw new Error(
      `${nomeCampo} inválida: ${motivo}. Valor recebido: ${JSON.stringify(valor)}. Use uma data real no formato YYYY-MM-DD.`
    );
  }
  return valor;
}

module.exports = { anoBissexto, diasNoMes, motivoDataInvalida, isDataValida, validarData };
