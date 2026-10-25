'use strict';

const path = require('node:path');
const express = require('express');
const materiais = require('../domain/materiais');
const registrosPeso = require('../domain/registrosPeso');
const dashboard = require('../domain/dashboard');
const graficos = require('../domain/graficos');
const evolucaoTemporal = require('../domain/evolucaoTemporal');
const { aplicarVisaoPadrao } = require('../filters/filterBuilder');
const { criarBackup, listarBackups, resolverCaminhoBackup, verificarIntegridadeBackup } = require('../backup/backup');
const { restaurar } = require('../backup/restore');
const { checkIntegrity } = require('../db/database');
const config = require('../../config/config');
const { ErroDominio, CODIGOS, erroValidacao } = require('../domain/erros');
const { ErroPersistencia, CODIGOS_PERSISTENCIA } = require('../repositories/erros');
const { obterRepositorios } = require('../repositories/provedor');

// Pasta da interface visual (Sprint 6.5): HTML + CSS + JavaScript sem build.
const PUBLIC_DIR = path.join(__dirname, '..', '..', 'public');

const STATUS_POR_CODIGO = {
  [CODIGOS.VALIDACAO]: 400,
  [CODIGOS.NAO_ENCONTRADO]: 404,
  [CODIGOS.DUPLICADO]: 409,
  // Lançamento de peso: o material é uma referência no CORPO da requisição
  // (não o recurso da URL) e a falha continua sendo 400, como na v1.1.0.
  [CODIGOS.MATERIAL_INEXISTENTE]: 400,
  [CODIGOS.MATERIAL_INATIVO]: 400,
};

function responderErroDominio(res, err) {
  if (err instanceof ErroDominio) {
    return res.status(STATUS_POR_CODIGO[err.codigo] || 400).json({ erro: err.message });
  }
  // Falha de INFRAESTRUTURA vinda de um repository (ex.: Firestore indisponível, permissão
  // negada, índice ausente): a mensagem de ErroPersistencia é FIXA e segura (nunca traz texto
  // do SDK, URL, projeto ou caminho). Indisponibilidade -> 503; demais -> 500. No modo SQLite
  // esse erro não é lançado (o comportamento de sempre continua: 500 genérico abaixo).
  if (err instanceof ErroPersistencia) {
    console.error(`Falha de persistência (${err.codigo}${err.codigoOrigem ? `/${err.codigoOrigem}` : ''})`);
    return res.status(err.codigo === CODIGOS_PERSISTENCIA.CONEXAO ? 503 : 500).json({ erro: err.message });
  }
  console.error(err);
  return res.status(500).json({ erro: 'Erro interno ao processar a requisição.' });
}

// Parâmetro de query booleano estrito: ausente -> false; "true"/"false"; qualquer outra coisa é erro.
function lerBooleanoQuery(valor, nome) {
  if (valor === undefined) return false;
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  throw erroValidacao(`Parâmetro ${nome} deve ser "true" ou "false".`);
}

// ============================================================
// Servidor — camada de interface HTTP.
//
// Escopo deste Sprint: SOMENTE os endpoints necessários para
// provar que a fundação (persistência, domínio, filtros, backup)
// funciona de ponta a ponta.
//
// FORA DE ESCOPO NESTE SPRINT (propositalmente):
//   - Gráfico de linha (a interface visual — Dashboard, pizza e barras em SVG — existe desde o
//     Sprint 6.5, em /public, consumindo as APIs abaixo)
//   - Geração de PDF
//   - Relatórios completos
//   - Autenticação
// Esses itens serão construídos em Sprints próprios, sobre esta
// mesma base de domínio e filtros.
// ============================================================

function criarApp() {
  const app = express();
  app.use(express.json());

  // --- Saúde / diagnóstico ---
  app.get('/health', (req, res) => {
    try {
      checkIntegrity();
      res.json({ status: 'ok', schemaVersion: config.schemaVersion });
    } catch (err) {
      console.error('Falha na verificação de integridade do banco (/health):', err);
      res.status(500).json({ status: 'erro', mensagem: 'Não foi possível verificar a integridade do banco.' });
    }
  });

  // --- Materiais (cadastro dinâmico, sem hardcode) ---
  // Toda regra de validação vive em src/domain/materiais.js; aqui só se
  // repassa a entrada e se traduz o erro de domínio para status HTTP.
  // Não existe DELETE de material (desativar != excluir).
  app.post('/api/materiais', async (req, res) => {
    try {
      res.status(201).json(await materiais.criar(req.body ?? {}));
    } catch (err) {
      responderErroDominio(res, err);
    }
  });

  // Padrão: somente ativos. ?incluirInativos=true -> todos (administração).
  app.get('/api/materiais', async (req, res) => {
    try {
      const incluirInativos = lerBooleanoQuery(req.query.incluirInativos, 'incluirInativos');
      res.json(await materiais.listar({ incluirInativos }));
    } catch (err) {
      responderErroDominio(res, err);
    }
  });

  app.get('/api/materiais/:id', async (req, res) => {
    try {
      res.json(await materiais.obter(req.params.id));
    } catch (err) {
      responderErroDominio(res, err);
    }
  });

  app.patch('/api/materiais/:id', async (req, res) => {
    try {
      res.json(await materiais.atualizar(req.params.id, req.body ?? {}));
    } catch (err) {
      responderErroDominio(res, err);
    }
  });

  app.patch('/api/materiais/:id/ativar', async (req, res) => {
    try {
      res.json(await materiais.ativar(req.params.id));
    } catch (err) {
      responderErroDominio(res, err);
    }
  });

  app.patch('/api/materiais/:id/desativar', async (req, res) => {
    try {
      res.json(await materiais.desativar(req.params.id));
    } catch (err) {
      responderErroDominio(res, err);
    }
  });

  // --- Registros de peso (histórico permanente, kg) ---
  // Toda regra do lançamento vive em src/domain/registrosPeso.js; aqui só se
  // repassa o corpo e se traduz o erro de domínio para status HTTP (validação e
  // material inexistente/inativo -> 400; erro inesperado -> 500 genérico, sem
  // stack trace). Não existe DELETE de registro.
  app.post('/api/registros', async (req, res) => {
    try {
      res.status(201).json(await registrosPeso.criar(req.body ?? {}));
    } catch (err) {
      responderErroDominio(res, err);
    }
  });

  // Histórico + filtros combináveis (Sprint 4): materialId, categoria, dataInicial, dataFinal.
  // Somente leitura. Toda a regra (validação dos filtros, mês atual como período padrão,
  // totais coerentes com o filtro) vive no domínio (registrosPeso.historico) e no filtro
  // centralizado (filterBuilder); aqui só se repassa a query string e se traduz o erro:
  // filtro inválido -> 400 com mensagem clara; erro inesperado -> 500 genérico, sem detalhe interno.
  app.get('/api/registros', async (req, res) => {
    try {
      const { materialId, categoria, dataInicial, dataFinal } = req.query;
      res.json(await registrosPeso.historico({ materialId, categoria, dataInicial, dataFinal }));
    } catch (err) {
      responderErroDominio(res, err);
    }
  });

  // Dashboard (Sprint 5; visão temporal na Sprint 10): indicadores resumidos, SOMENTE leitura.
  // Aceita os mesmos filtros do histórico (materialId, categoria, dataInicial, dataFinal) e a
  // mesma regra de período (sem datas = mês atual). Toda a regra vive em src/domain/dashboard.js
  // e no filtro centralizado; aqui só se repassa a query string e se traduz o erro (filtro
  // inválido -> 400 com mensagem clara; erro inesperado -> 500 genérico, sem detalhe interno).
  // Sprint 10: aceita também ?visao= (dia/semana/mes/ano/personalizado). dataInicial/dataFinal
  // explícitas sempre vencem (aplicarVisaoPadrao só entra quando as duas vêm ausentes); sem visao
  // o comportamento é idêntico ao de sempre (mês atual). O resultado da visão vira dataInicial/
  // dataFinal comuns — dashboard.consultar() e o formato da resposta continuam exatamente os
  // mesmos da Sprint 5 (a evolução temporal por período é a rota própria abaixo).
  app.get('/api/dashboard', async (req, res) => {
    try {
      let { materialId, categoria, dataInicial, dataFinal, visao } = req.query;
      ({ dataInicial, dataFinal } = aplicarVisaoPadrao({ dataInicial, dataFinal, visao }));
      res.json(await dashboard.consultar({ materialId, categoria, dataInicial, dataFinal }));
    } catch (err) {
      responderErroDominio(res, err);
    }
  });

  // Gráficos (Sprint 6; visão temporal na Sprint 10): DADOS de pizza (distribuição de peso por
  // material, com percentual) e de barras (peso total por material), SOMENTE leitura. Aceita os
  // mesmos filtros do histórico e do dashboard (materialId, categoria, dataInicial, dataFinal) e
  // a mesma regra de período (sem datas = mês atual). Toda a regra vive em src/domain/graficos.js
  // e no filtro centralizado; aqui só se repassa a query string e se traduz o erro (filtro
  // inválido -> 400 com mensagem clara; erro inesperado -> 500 genérico, sem detalhe interno).
  // Sprint 10: aceita também ?visao=, resolvida em dataInicial/dataFinal da MESMA forma que
  // /api/dashboard (aplicarVisaoPadrao) antes de chamar graficos.consultar() — formato da
  // resposta inalterado (pizza e barras continuam as únicas séries; ver G40/G39 no relatório).
  app.get('/api/graficos', async (req, res) => {
    try {
      let { materialId, categoria, dataInicial, dataFinal, visao } = req.query;
      ({ dataInicial, dataFinal } = aplicarVisaoPadrao({ dataInicial, dataFinal, visao }));
      res.json(await graficos.consultar({ materialId, categoria, dataInicial, dataFinal }));
    } catch (err) {
      responderErroDominio(res, err);
    }
  });

  // Evolução temporal (Sprint 10): peso total agrupado por período (dia/mês/ano, conforme a
  // largura do intervalo resolvido — ver src/domain/evolucaoTemporal.js), SOMENTE leitura. Rota
  // NOVA (justificativa no relatório): /api/dashboard e /api/graficos têm formato de resposta
  // travado pela regressão das Sprints 5/6 (filtroAplicado/indicadores e filtroAplicado/pizza/
  // barras, respectivamente) — acrescentar uma série temporal a qualquer uma delas quebraria essa
  // regressão. Aceita materialId, categoria, dataInicial, dataFinal e visao (mesmos filtros e
  // mesma regra de período das outras duas rotas).
  app.get('/api/dashboard/evolucao', async (req, res) => {
    try {
      const { materialId, categoria, dataInicial, dataFinal, visao } = req.query;
      res.json(await evolucaoTemporal.consultar({ materialId, categoria, dataInicial, dataFinal, visao }));
    } catch (err) {
      responderErroDominio(res, err);
    }
  });

  // --- Backup / Restauração / Integridade (Sprint 8) ---
  //
  // Nenhuma lógica de backup/restauração vive aqui: esta camada só traduz HTTP <-> domínio
  // (src/backup/backup.js, src/backup/restore.js, checkIntegrity de src/db/database.js).
  //
  // Segurança (seção 11 do prompt): o cliente NUNCA envia nem recebe um caminho de arquivo.
  // Toda referência a um backup é pelo "nomeArquivo" (o mesmo devolvido por listarBackups()),
  // resolvido para dentro de config.paths.backupsDir por resolverCaminhoBackup() — que rejeita
  // "../", caminho absoluto e qualquer coisa fora do padrão gerado por criarBackup().
  //
  // Erros: nunca repassar err.message cru ao cliente quando ele pode conter caminho interno
  // (restore.js inclui o caminho do backup de segurança na falha de troca de arquivo) ou
  // detalhe do SQLite (seção 17) — só as mensagens abaixo, já sabidamente seguras, vão ao
  // cliente; o detalhe completo é sempre registrado no console do servidor.

  app.post('/api/backup', async (req, res) => {
    try {
      const resultado = await criarBackup({ motivo: 'manual' });
      res.status(201).json({
        nomeArquivo: path.basename(resultado.arquivo),
        motivo: resultado.motivo,
        tamanhoBytes: resultado.tamanhoBytes,
        criadoEm: resultado.criadoEm,
        integro: resultado.integro,
      });
    } catch (err) {
      console.error('Falha ao criar backup:', err);
      res.status(500).json({ erro: 'Não foi possível criar o backup. Tente novamente.' });
    }
  });

  // Lista real dos backups existentes. "arquivo" (caminho físico absoluto) é uso interno do
  // domínio e nunca sai daqui — só nomeArquivo/motivo/tamanhoBytes/criadoEm chegam ao cliente.
  app.get('/api/backup', (req, res) => {
    try {
      res.json(listarBackups().map(({ arquivo, ...resto }) => resto));
    } catch (err) {
      console.error('Falha ao listar backups:', err);
      res.status(500).json({ erro: 'Não foi possível listar os backups.' });
    }
  });

  // Integridade do banco ATUAL (não de um backup) — somente leitura, não altera nada.
  app.get('/api/backup/integridade', (req, res) => {
    try {
      checkIntegrity();
      res.json({ integro: true, status: 'ok' });
    } catch (err) {
      console.error('Verificação de integridade do banco atual falhou:', err);
      res.json({ integro: false, status: 'erro' });
    }
  });

  // Integridade de UM backup específico, sob demanda (nunca afirmada só pela existência do
  // arquivo — seção 9). ":id" é o nomeArquivo do backup (mesma convenção de nome de parâmetro
  // do resto da API, ex. /api/materiais/:id) — nunca um caminho.
  app.get('/api/backup/:id/integridade', (req, res) => {
    try {
      res.json(verificarIntegridadeBackup(req.params.id));
    } catch (err) {
      // Erros daqui (identificador inválido / backup não encontrado) já são mensagens
      // seguras, geradas por resolverCaminhoBackup — nunca contêm caminho.
      res.status(400).json({ erro: err.message });
    }
  });

  app.post('/api/backup/restaurar', async (req, res) => {
    const { nomeArquivo, confirmar } = req.body || {};
    try {
      const caminho = resolverCaminhoBackup(nomeArquivo); // 400 seguro se identificador inválido/inexistente

      if (confirmar !== true) {
        return res.status(400).json({
          erro: 'Restauração bloqueada: é necessário confirmar explicitamente para evitar restauração acidental.',
        });
      }

      // Validação do backup de origem (seção 12): íntegro antes de tocar em qualquer coisa.
      const verificacao = verificarIntegridadeBackup(nomeArquivo);
      if (!verificacao.integro) {
        return res.status(400).json({
          erro: 'O backup selecionado não passou na verificação de integridade e não pode ser restaurado.',
        });
      }

      const resultado = await restaurar({ arquivoOrigem: caminho, confirmar });
      res.json({
        restaurado: true,
        nomeArquivoRestaurado: nomeArquivo,
        backupDeSegurancaCriado: path.basename(resultado.backupDeSegurancaCriado),
        restauradoEm: resultado.restauradoEm,
      });
    } catch (err) {
      if (err.message === 'Identificador de backup inválido.' || err.message === 'Backup não encontrado.') {
        return res.status(400).json({ erro: err.message });
      }
      // Falha de verdade (backup de segurança falhou, troca de arquivo falhou, integridade
      // pós-restauração falhou): a mensagem de restore.js pode conter caminho/detalhe interno
      // (ver comentário no topo do bloco) — nunca repassada ao cliente.
      console.error('Falha ao restaurar backup:', err);
      res.status(500).json({
        erro: 'Não foi possível concluir a restauração. O banco atual foi preservado sempre que tecnicamente possível. Tente novamente.',
      });
    }
  });

  // --- Interface visual (Sprint 6.5) ---
  // Serve apenas os arquivos estáticos de /public (index.html em "/"). É registrado DEPOIS de todas as
  // rotas /api e /health, então nunca as sobrepõe; qualquer outro caminho continua 404. Sem regra de
  // negócio aqui: a interface só consome as APIs acima. Sem listagem de diretório, sem redirecionamento,
  // sem servir arquivos ocultos; "no-cache" faz o navegador revalidar (evita tela desatualizada após atualização).
  app.use(
    express.static(PUBLIC_DIR, {
      index: 'index.html',
      dotfiles: 'ignore',
      redirect: false,
      setHeaders(res) {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );

  // Corpo JSON malformado (ou grande demais) -> resposta JSON clara, não página HTML.
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ erro: 'JSON inválido no corpo da requisição.' });
    }
    if (err && err.status >= 400 && err.status < 500 && err.expose) {
      return res.status(err.status).json({ erro: 'Requisição inválida.' });
    }
    return next(err);
  });

  return app;
}

if (require.main === module) {
  // Persistência validada ANTES de abrir a porta: PERSISTENCIA inválida ou Firestore impossível de
  // carregar encerram o processo com mensagem clara, em vez de subir e responder 500 em toda rota.
  obterRepositorios()
    .then(({ modo }) => {
      criarApp().listen(config.server.port, () => {
        console.log(`Controle de Materiais rodando na porta ${config.server.port} (persistência: ${modo})`);
      });
    })
    .catch((err) => {
      console.error(`Não foi possível iniciar a persistência: ${err.message}`);
      process.exit(1);
    });
}

module.exports = { criarApp };
