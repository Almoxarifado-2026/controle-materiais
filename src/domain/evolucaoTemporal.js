'use strict';

const { obterRepositorios } = require('../repositories/provedor');
const { normalizarFiltro, aplicarVisaoPadrao } = require('../filters/filterBuilder');
const { erroValidacao } = require('./erros');

// ============================================================
// Domínio: Evolução Temporal (Sprint 10) — peso total agrupado por período
// (dia, mês ou ano), SOMENTE leitura. Alimenta um gráfico de BARRAS com o
// tempo no eixo (não é um gráfico de linha/polilinha: é o mesmo tipo de
// gráfico já usado para peso por material, só que agrupado por período em
// vez de por material — por isso não introduz nenhum tipo novo de gráfico).
//
// UMA fonte de dados: as mesmas tabelas do histórico, do Dashboard e dos
// Gráficos (registros_peso + materiais). Nada é armazenado, cacheado nem
// simulado: cada consulta recalcula tudo.
//
// UMA lógica de filtro/período: normalizarFiltro()/construirFiltro() (a
// MESMA validação e o MESMO WHERE parametrizado do histórico/Dashboard/
// Gráficos) e aplicarVisaoPadrao() (a MESMA resolução de período das rotas
// /api/dashboard e /api/graficos — ver src/filters/filterBuilder.js).
// Nenhuma validação, SQL de filtro ou regra de período é reimplementada aqui.
//
// Granularidade do agrupamento (documentada — seções 6, 9 e 12 do prompt):
// decidida SEMPRE pela LARGURA do período já resolvido (em dias corridos,
// inclusive) — a mesma regra para as 5 visões, em vez de uma regra por
// visão. Isso automaticamente dá o resultado pedido pelo enunciado para
// cada visão padrão (dia: 1 dia -> DIA; semana: 7 dias -> DIA; mês: ~28–31
// dias -> DIA; ano: ~365 dias -> MÊS) e, ao mesmo tempo, protege qualquer
// visão contra um período CUSTOMIZADO absurdamente largo informado junto
// (ex.: visão "Dia" com dataInicial/dataFinal manuais cobrindo 40 anos) —
// que geraria dezenas de milhares de baldes de um dia se a granularidade
// dependesse só do rótulo da visão em vez da largura real do período:
//   - até 62 dias                -> agrupa por DIA (r.data_recebimento, já
//     no formato YYYY-MM-DD; o schema não guarda horário — ver schema.sql —
//     então o balde "dia" é sempre o TOTAL do dia, nunca uma repartição por
//     hora inventada);
//   - de 63 dias até 1830 dias (~5 anos) -> agrupa por MÊS (mês sem
//     lançamento entra com peso 0, nunca é omitido — vale para a visão Ano);
//   - acima de 1830 dias          -> agrupa por ANO.
// Todos os baldes do intervalo aparecem, mesmo sem lançamento (peso 0):
// nunca "pulam" um período por falta de dado.
//
// Exige um período LIMITADO (dataInicial E dataFinal): diferente do
// histórico/Dashboard/Gráficos (que aceitam filtro só com dataInicial OU só
// com dataFinal, um período aberto), gerar baldes de um intervalo aberto não
// faz sentido — ver validação em consultar().
// ============================================================

const UM_DIA_MS = 24 * 60 * 60 * 1000;
const LIMITE_DIAS_GRANULARIDADE_DIA = 62;
const LIMITE_DIAS_GRANULARIDADE_MES = 1830; // ~5 anos

function paraDataUtc(iso) {
  const [ano, mes, dia] = iso.split('-').map(Number);
  return Date.UTC(ano, mes - 1, dia);
}

const pad2 = (n) => String(n).padStart(2, '0');

function fmtDiaUtc(timestamp) {
  const d = new Date(timestamp);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Baldes 'YYYY-MM-DD', um por dia, de dataInicial a dataFinal (inclusive). */
function baldesDia(dataInicial, dataFinal) {
  const baldes = [];
  const fim = paraDataUtc(dataFinal);
  for (let t = paraDataUtc(dataInicial); t <= fim; t += UM_DIA_MS) baldes.push(fmtDiaUtc(t));
  return baldes;
}

/** Baldes 'YYYY-MM', um por mês, de dataInicial a dataFinal (inclusive). */
function baldesMes(dataInicial, dataFinal) {
  const [anoIni, mesIni] = dataInicial.split('-').map(Number);
  const [anoFim, mesFim] = dataFinal.split('-').map(Number);
  const baldes = [];
  let ano = anoIni;
  let mes = mesIni;
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    baldes.push(`${ano}-${pad2(mes)}`);
    mes += 1;
    if (mes > 12) {
      mes = 1;
      ano += 1;
    }
  }
  return baldes;
}

/** Baldes 'YYYY', um por ano, de dataInicial a dataFinal (inclusive). */
function baldesAno(dataInicial, dataFinal) {
  const anoIni = Number(dataInicial.slice(0, 4));
  const anoFim = Number(dataFinal.slice(0, 4));
  const baldes = [];
  for (let ano = anoIni; ano <= anoFim; ano += 1) baldes.push(String(ano));
  return baldes;
}

/** Granularidade a usar para o período JÁ RESOLVIDO, pela LARGURA em dias (regra documentada acima). */
function granularidadePorLargura(dataInicial, dataFinal) {
  const larguraDias = Math.round((paraDataUtc(dataFinal) - paraDataUtc(dataInicial)) / UM_DIA_MS) + 1;
  if (larguraDias <= LIMITE_DIAS_GRANULARIDADE_DIA) return 'dia';
  if (larguraDias <= LIMITE_DIAS_GRANULARIDADE_MES) return 'mes';
  return 'ano';
}

// Integração dos repositories: a soma por balde (UMA consulta agregada, GROUP BY balde)
// é do RegistrosPesoRepository.pesoPorBalde(filtro, granularidade), que devolve só os
// baldes COM lançamento. Os baldes vazios (peso 0) são completados aqui, como sempre.

/**
 * Evolução temporal do peso (soma em kg por balde de tempo) para o filtro e
 * a visão informados.
 *
 * entrada: { materialId, categoria, dataInicial, dataFinal, visao }. Sem
 * visao -> 'mes'. Sem nenhuma data -> período padrão da visão (dia atual /
 * semana atual / mês atual / ano atual); com QUALQUER data informada, o
 * período é exatamente o informado (aplicarVisaoPadrao) — mas as DUAS datas
 * precisam estar presentes ao final (ver erro abaixo), porque gerar baldes
 * de um intervalo aberto não é uma operação bem definida.
 *
 * Retorna { filtroAplicado, visaoAplicada, granularidade, pontos }:
 *   pontos: [{ chave, pesoKg }], um por balde do período, ORDENADOS por
 *   chave ASC (mesmo sem lançamento -> pesoKg: 0; nunca NaN/Infinity).
 */
async function consultar(entrada = {}, { dataReferencia = new Date() } = {}) {
  const { materialId, categoria, dataInicial, dataFinal, visao } = entrada;
  const repos = await obterRepositorios();
  const periodo = aplicarVisaoPadrao({ dataInicial, dataFinal, visao }, { dataReferencia });
  const filtro = normalizarFiltro(
    { materialId, categoria, dataInicial: periodo.dataInicial, dataFinal: periodo.dataFinal },
    { normalizarId: (v) => repos.materiais.normalizarId(v) }
  );

  if (filtro.dataInicial === undefined || filtro.dataFinal === undefined) {
    throw erroValidacao(
      'Evolução temporal requer um período limitado: informe dataInicial e dataFinal juntas, ou nenhuma das duas (usa o período padrão da visão selecionada).'
    );
  }

  const granularidade = granularidadePorLargura(filtro.dataInicial, filtro.dataFinal);
  const baldes =
    granularidade === 'dia' ? baldesDia(filtro.dataInicial, filtro.dataFinal)
    : granularidade === 'mes' ? baldesMes(filtro.dataInicial, filtro.dataFinal)
    : baldesAno(filtro.dataInicial, filtro.dataFinal);

  const linhas = await repos.registros.pesoPorBalde(filtro, granularidade);
  const mapa = new Map(linhas.map((l) => [l.chave, l.pesoKg]));
  const pontos = baldes.map((chave) => {
    const pesoKg = mapa.has(chave) ? mapa.get(chave) : 0;
    if (!Number.isFinite(pesoKg)) {
      throw new Error('Inconsistência nos dados de peso: valor não finito encontrado no histórico.');
    }
    return { chave, pesoKg };
  });
  return { filtroAplicado: filtro, visaoAplicada: periodo.visao, granularidade, pontos };
}

module.exports = { consultar, granularidadePorLargura, baldesDia, baldesMes, baldesAno };
