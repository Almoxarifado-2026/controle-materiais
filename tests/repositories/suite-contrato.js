'use strict';

// ============================================================
// SUÍTE DE CONTRATO dos repositories (Sprint 4).
//
// A MESMA suíte roda contra a implementação SQLite (tests/test-repositories-sqlite.js)
// e contra a implementação Firestore (tests/test-repositories-firestore.js, que exige o
// Firestore Emulator). Cada ambiente fornece `novoAmbiente({ agora })`, que devolve
// repositories VAZIOS e isolados, com o relógio injetado (tempo estritamente crescente:
// torna determinísticos o desempate de ordenação e o atualizadoEm).
//
// Nada aqui depende de o ID ser número ou string: os IDs são tratados como opacos.
// Diferenças legítimas entre as implementações (sintaxe de ID) ficam de fora da
// suíte e são testadas nos arquivos específicos de cada implementação.
// ============================================================

const assert = require('node:assert/strict');
const { ErroDominio, CODIGOS } = require('../../src/domain/erros');

function criarRelogio(inicio = Date.UTC(2026, 0, 1, 12, 0, 0)) {
  let t = inicio;
  return () => new Date((t += 1000));
}

async function rejeita(promessa, codigo, trecho) {
  let erro = null;
  try {
    await promessa;
  } catch (e) {
    erro = e;
  }
  assert.ok(erro, `esperava rejeição (${codigo})`);
  assert.ok(erro instanceof ErroDominio, `esperava ErroDominio, veio ${erro && erro.name}: ${erro && erro.message}`);
  assert.equal(erro.codigo, codigo, `código: ${erro.codigo} — ${erro.message}`);
  if (trecho) assert.match(erro.message, trecho);
  return erro;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function executarSuiteContrato({ rotulo, novoAmbiente }) {
  const resultados = [];
  const teste = async (nome, fn) => {
    try {
      const amb = await novoAmbiente({ agora: criarRelogio() });
      await fn(amb);
      resultados.push('PASS');
      console.log(`✅ PASS - [${rotulo}] ${nome}`);
    } catch (e) {
      resultados.push('FAIL');
      console.log(`❌ FAIL - [${rotulo}] ${nome}\n   ${e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n   ') : e}`);
    }
  };

  const novoMaterial = (amb, nome, categoria) => amb.materiais.criar({ nome, categoria });
  const novoRegistro = (amb, material, pesoKg, dataRecebimento, observacao) =>
    amb.registros.criar({ materialId: material.id, pesoKg, dataRecebimento, observacao });
  const ids = (lista) => lista.map((r) => r.id);

  // ----------------------------------------------------------
  // MATERIAIS
  // ----------------------------------------------------------
  await teste('M01 criar material devolve a entidade canônica completa', async (a) => {
    const m = await novoMaterial(a, 'Ferro', 'Metal');
    assert.notEqual(m.id, undefined);
    assert.equal(m.nome, 'Ferro');
    assert.equal(m.categoria, 'Metal');
    assert.equal(m.ativo, true);
    assert.match(m.criadoEm, ISO);
    assert.equal(m.criadoEm, m.atualizadoEm);
    assert.deepEqual(Object.keys(m).sort(), ['ativo', 'atualizadoEm', 'categoria', 'criadoEm', 'id', 'nome']);
    assert.deepEqual(await a.materiais.buscarPorId(m.id), m);
  });

  await teste('M02 categoria ausente, null, vazia ou só espaços vira null; nome e categoria são normalizados (trim + NFC)', async (a) => {
    assert.equal((await novoMaterial(a, 'A')).categoria, null);
    assert.equal((await novoMaterial(a, 'B', null)).categoria, null);
    assert.equal((await novoMaterial(a, 'C', '   ')).categoria, null);
    const d = await novoMaterial(a, '  Cafe\u0301  ', ' Orga\u0302nico ');
    assert.equal(d.nome, 'Café');
    assert.equal(d.categoria, 'Orgânico');
  });

  await teste('M03 nomes inválidos são rejeitados com VALIDACAO e nada é gravado', async (a) => {
    for (const nome of ['', '   ', undefined, null, 10, {}, [], 'x'.repeat(121), 'a\nb', 'a\tb', 'a\u0000b']) {
      await rejeita(a.materiais.criar({ nome }), CODIGOS.VALIDACAO);
    }
    await rejeita(a.materiais.criar({ nome: 'ok', categoria: 5 }), CODIGOS.VALIDACAO);
    await rejeita(a.materiais.criar({ nome: 'ok', categoria: 'y'.repeat(61) }), CODIGOS.VALIDACAO);
    await rejeita(a.materiais.criar(null), CODIGOS.VALIDACAO);
    await rejeita(a.materiais.criar([]), CODIGOS.VALIDACAO);
    assert.deepEqual(await a.materiais.listar({ incluirInativos: true }), []);
    assert.equal((await novoMaterial(a, 'x'.repeat(120))).nome.length, 120);
  });

  await teste('M04 unicidade ignora maiúsculas/minúsculas, espaços externos e forma Unicode (NFC/NFD), com regras pt-BR', async (a) => {
    await novoMaterial(a, 'Ferro');
    for (const nome of ['ferro', 'FERRO', ' Ferro ', 'fErRo']) await rejeita(a.materiais.criar({ nome }), CODIGOS.DUPLICADO, /Já existe um material com o nome "Ferro"/);
    await novoMaterial(a, 'Papelão');
    for (const nome of ['PAPELÃO', 'papelão', 'Papela\u0303o']) await rejeita(a.materiais.criar({ nome }), CODIGOS.DUPLICADO);
    assert.equal((await a.materiais.listar({ incluirInativos: true })).length, 2);
  });

  await teste('M05 nomes com "/", ".", "..", "__x__" e outros símbolos são criáveis e únicos (a chave do índice nunca vira ID inválido)', async (a) => {
    const nomes = ['a/b', '/', '.', '..', '__reservado__', 'a%2Fb', '100%', 'x y', 'ç#?&=', '😀 vidro'];
    for (const nome of nomes) assert.equal((await novoMaterial(a, nome)).nome, nome);
    for (const nome of nomes) await rejeita(a.materiais.criar({ nome }), CODIGOS.DUPLICADO);
    assert.equal((await a.materiais.listar()).length, nomes.length);
    // "a/b" e "a%2Fb" são nomes DIFERENTES (a codificação é injetiva)
    assert.equal((await a.materiais.listar()).filter((m) => m.nome === 'a/b' || m.nome === 'a%2Fb').length, 2);
  });

  await teste('M06 buscarPorId: existente -> entidade; inexistente e inválido -> null (nunca lança)', async (a) => {
    const m = await novoMaterial(a, 'Ferro');
    assert.equal((await a.materiais.buscarPorId(m.id)).nome, 'Ferro');
    for (const id of [undefined, null, '', 'a/b', {}, [], -1, 0, 1.5, NaN, true]) assert.equal(await a.materiais.buscarPorId(id), null, String(id));
    const apagado = await a.materiais.buscarPorId(typeof m.id === 'number' ? 999999 : 'naoExisteNoBanco');
    assert.equal(apagado, null);
  });

  await teste('M07 listar: só ativos por padrão, ordenado por nome em bytes UTF-8 (sem locale); incluirInativos lista todos; não-boolean é VALIDACAO', async (a) => {
    for (const nome of ['b', 'a', 'Z', 'Y', 'á', 'x']) await novoMaterial(a, nome);
    const inativo = await novoMaterial(a, 'm');
    await a.materiais.definirAtivo(inativo.id, false);
    assert.deepEqual((await a.materiais.listar()).map((m) => m.nome), ['Y', 'Z', 'a', 'b', 'x', 'á']);
    assert.deepEqual((await a.materiais.listar({})).map((m) => m.nome), ['Y', 'Z', 'a', 'b', 'x', 'á']);
    assert.deepEqual((await a.materiais.listar({ incluirInativos: true })).map((m) => m.nome), ['Y', 'Z', 'a', 'b', 'm', 'x', 'á']);
    for (const v of ['true', 1, null]) await rejeita(a.materiais.listar({ incluirInativos: v }), CODIGOS.VALIDACAO);
  });

  await teste('M08 atualizar nome e categoria: id, criadoEm e ativo preservados; atualizadoEm avança', async (a) => {
    const m = await novoMaterial(a, 'Ferro', 'Metal');
    const u = await a.materiais.atualizar(m.id, { nome: 'Aço', categoria: 'Liga' });
    assert.equal(u.id, m.id);
    assert.equal(u.nome, 'Aço');
    assert.equal(u.categoria, 'Liga');
    assert.equal(u.ativo, true);
    assert.equal(u.criadoEm, m.criadoEm);
    assert.ok(u.atualizadoEm > m.atualizadoEm);
    assert.deepEqual(await a.materiais.buscarPorId(m.id), u);
  });

  await teste('M09 atualizar: campo ausente mantém o atual; categoria null/vazia remove; nome inválido é VALIDACAO', async (a) => {
    const m = await novoMaterial(a, 'Ferro', 'Metal');
    assert.equal((await a.materiais.atualizar(m.id, { nome: 'Ferro Velho' })).categoria, 'Metal');
    assert.equal((await a.materiais.atualizar(m.id, { categoria: 'Sucata' })).nome, 'Ferro Velho');
    assert.equal((await a.materiais.atualizar(m.id, { categoria: null })).categoria, null);
    assert.equal((await a.materiais.atualizar(m.id, { categoria: 'X' })).categoria, 'X');
    assert.equal((await a.materiais.atualizar(m.id, { categoria: '  ' })).categoria, null);
    for (const nome of ['', '   ', null, 5]) await rejeita(a.materiais.atualizar(m.id, { nome }), CODIGOS.VALIDACAO);
    assert.equal((await a.materiais.buscarPorId(m.id)).nome, 'Ferro Velho');
  });

  await teste('M10 renomear para o nome de OUTRO material é DUPLICADO e não altera nada; renomear libera o nome antigo e reserva o novo', async (a) => {
    const f = await novoMaterial(a, 'Ferro');
    const p = await novoMaterial(a, 'Papel');
    await rejeita(a.materiais.atualizar(p.id, { nome: 'FERRO' }), CODIGOS.DUPLICADO);
    assert.equal((await a.materiais.buscarPorId(p.id)).nome, 'Papel');
    assert.equal((await a.materiais.buscarPorId(p.id)).atualizadoEm, p.atualizadoEm);
    await a.materiais.atualizar(f.id, { nome: 'Aço' });
    const novo = await novoMaterial(a, 'Ferro'); // nome antigo ficou livre
    assert.equal(novo.nome, 'Ferro');
    await rejeita(a.materiais.criar({ nome: 'aço' }), CODIGOS.DUPLICADO); // nome novo ficou reservado
    await rejeita(a.materiais.atualizar(p.id, { nome: 'Aço' }), CODIGOS.DUPLICADO);
  });

  await teste('M11 trocar só a caixa do próprio nome é permitido; o índice passa a mostrar o nome atual', async (a) => {
    const m = await novoMaterial(a, 'ferro');
    assert.equal((await a.materiais.atualizar(m.id, { nome: 'FERRO' })).nome, 'FERRO');
    assert.equal((await a.materiais.atualizar(m.id, { nome: 'FERRO' })).nome, 'FERRO'); // mesmo nome: ok
    await rejeita(a.materiais.criar({ nome: 'Ferro' }), CODIGOS.DUPLICADO, /nome "FERRO"/);
    assert.equal((await a.materiais.listar({ incluirInativos: true })).length, 1);
  });

  await teste('M12 atualizar/definirAtivo: inexistente -> NAO_ENCONTRADO; ID inválido -> VALIDACAO', async (a) => {
    const m = await novoMaterial(a, 'Ferro');
    const inexistente = typeof m.id === 'number' ? 999999 : 'naoExisteNoBanco';
    await rejeita(a.materiais.atualizar(inexistente, { nome: 'X' }), CODIGOS.NAO_ENCONTRADO);
    await rejeita(a.materiais.definirAtivo(inexistente, false), CODIGOS.NAO_ENCONTRADO);
    for (const id of ['a/b', {}, [], -1, 0, 1.5, null, undefined]) {
      await rejeita(a.materiais.atualizar(id, { nome: 'X' }), CODIGOS.VALIDACAO);
      await rejeita(a.materiais.definirAtivo(id, true), CODIGOS.VALIDACAO);
    }
  });

  await teste('M13 desativar/reativar: idempotente (não grava quando já está no estado); nunca libera o nome; nunca exclui', async (a) => {
    const m = await novoMaterial(a, 'Ferro');
    const igual = await a.materiais.definirAtivo(m.id, true);
    assert.deepEqual(igual, m, 'já ativo: nada muda, nem atualizadoEm');
    const d = await a.materiais.definirAtivo(m.id, false);
    assert.equal(d.ativo, false);
    assert.ok(d.atualizadoEm > m.atualizadoEm);
    assert.equal(d.nome, 'Ferro');
    assert.deepEqual(await a.materiais.definirAtivo(m.id, false), d, 'já inativo: nada muda');
    await rejeita(a.materiais.criar({ nome: 'ferro' }), CODIGOS.DUPLICADO); // inativo continua reservando o nome
    const r = await a.materiais.definirAtivo(m.id, true);
    assert.equal(r.ativo, true);
    assert.ok(r.atualizadoEm > d.atualizadoEm);
    assert.equal((await a.materiais.listar({ incluirInativos: true })).length, 1);
    // editar um material INATIVO continua permitido (comportamento atual)
    await a.materiais.definirAtivo(m.id, false);
    assert.equal((await a.materiais.atualizar(m.id, { categoria: 'X' })).ativo, false);
  });

  await teste('M14 contarPorStatus conta ativos e inativos do cadastro (inclui material sem registro)', async (a) => {
    assert.deepEqual(await a.materiais.contarPorStatus(), { ativos: 0, inativos: 0 });
    const x = await novoMaterial(a, 'X');
    await novoMaterial(a, 'Y');
    await novoMaterial(a, 'Z');
    assert.deepEqual(await a.materiais.contarPorStatus(), { ativos: 3, inativos: 0 });
    await a.materiais.definirAtivo(x.id, false);
    assert.deepEqual(await a.materiais.contarPorStatus(), { ativos: 2, inativos: 1 });
  });

  await teste('M15 CONCORRÊNCIA: 6 criações simultâneas do mesmo nome (variações de caixa) -> exatamente 1 sucesso, 5 DUPLICADO', async (a) => {
    const nomes = ['Cobre', 'cobre', 'COBRE', ' Cobre', 'cObRe', 'Cobre '];
    const r = await Promise.allSettled(nomes.map((nome) => a.materiais.criar({ nome })));
    const ok = r.filter((x) => x.status === 'fulfilled');
    const dup = r.filter((x) => x.status === 'rejected' && x.reason instanceof ErroDominio && x.reason.codigo === CODIGOS.DUPLICADO);
    assert.equal(ok.length, 1, JSON.stringify(r.map((x) => x.status === 'rejected' ? x.reason.message : 'ok')));
    assert.equal(dup.length, 5);
    assert.equal((await a.materiais.listar({ incluirInativos: true })).length, 1);
  });

  await teste('M16 CONCORRÊNCIA: dois materiais renomeados ao mesmo tempo para o mesmo nome -> exatamente 1 sucesso', async (a) => {
    const x = await novoMaterial(a, 'X');
    const y = await novoMaterial(a, 'Y');
    const r = await Promise.allSettled([a.materiais.atualizar(x.id, { nome: 'Alvo' }), a.materiais.atualizar(y.id, { nome: 'alvo' })]);
    assert.equal(r.filter((q) => q.status === 'fulfilled').length, 1);
    assert.equal(r.filter((q) => q.status === 'rejected' && q.reason.codigo === CODIGOS.DUPLICADO).length, 1);
    const nomes = (await a.materiais.listar()).map((m) => m.nome.toLowerCase()).sort();
    assert.equal(nomes.filter((n) => n === 'alvo').length, 1);
  });

  await teste('M17 não existe operação de exclusão nos repositories (material só é ativado/desativado; histórico é permanente)', async (a) => {
    for (const repo of [a.materiais, a.registros]) {
      const nomes = new Set();
      for (let p = Object.getPrototypeOf(repo); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) Object.getOwnPropertyNames(p).forEach((n) => nomes.add(n));
      for (const n of nomes) assert.ok(!/excluir|deletar|delete|remover|remove|apagar|destroy|drop|limpar/i.test(n), `método de exclusão: ${n}`);
    }
  });

  // ----------------------------------------------------------
  // REGISTROS DE PESO
  // ----------------------------------------------------------
  await teste('R01 criar registro devolve a entidade canônica, com dados do material, e é relido do armazenamento', async (a) => {
    const m = await novoMaterial(a, 'Ferro', 'Metal');
    const r = await a.registros.criar({ materialId: m.id, pesoKg: 12.5, dataRecebimento: '2026-09-30', observacao: 'lote 1' });
    assert.equal(r.materialId, m.id);
    assert.equal(r.pesoKg, 12.5);
    assert.equal(r.dataRecebimento, '2026-09-30');
    assert.equal(typeof r.dataRecebimento, 'string');
    assert.equal(r.observacao, 'lote 1');
    assert.equal(r.materialNome, 'Ferro');
    assert.equal(r.materialCategoria, 'Metal');
    assert.match(r.criadoEm, ISO);
    assert.equal(r.criadoEm, r.atualizadoEm);
    assert.deepEqual(Object.keys(r).sort(), ['atualizadoEm', 'criadoEm', 'dataRecebimento', 'id', 'materialCategoria', 'materialId', 'materialNome', 'observacao', 'pesoKg']);
    assert.deepEqual(await a.registros.buscarPorId(r.id), r);
  });

  await teste('R02 pesoKg > 0 é imposto: 0, negativos, NaN, Infinity, texto, null, ausente, objeto e acima do teto são VALIDACAO e NADA é gravado', async (a) => {
    const m = await novoMaterial(a, 'Ferro');
    for (const peso of [0, -0, -1, -0.0001, NaN, Infinity, -Infinity, '10', '10abc', '', null, undefined, {}, [], true, 10n, 1e9 + 1, 1e308]) {
      await rejeita(a.registros.criar({ materialId: m.id, pesoKg: peso, dataRecebimento: '2026-09-30' }), CODIGOS.VALIDACAO);
    }
    assert.deepEqual(await a.registros.listar({}), []);
    assert.equal((await novoRegistro(a, m, 1e9, '2026-09-30')).pesoKg, 1e9);
    assert.equal((await novoRegistro(a, m, 0.0000001, '2026-09-30')).pesoKg, 0.0000001);
  });

  await teste('R03 o peso é gravado e relido sem arredondamento (double IEEE-754, Object.is)', async (a) => {
    const m = await novoMaterial(a, 'Ferro');
    for (const peso of [0.1, 1 / 3, 123456.789012345, 0.1 + 0.2, Number.MIN_VALUE, 999999999.9999999]) {
      const r = await novoRegistro(a, m, peso, '2026-09-30');
      assert.ok(Object.is(r.pesoKg, peso), `${peso} != ${r.pesoKg}`);
      assert.ok(Object.is((await a.registros.buscarPorId(r.id)).pesoKg, peso));
    }
  });

  await teste('R04 dataRecebimento deve ser YYYY-MM-DD real; datas impossíveis, formatos errados e não-texto são VALIDACAO; a data nunca vira Timestamp', async (a) => {
    const m = await novoMaterial(a, 'Ferro');
    const invalidas = ['2026-02-31', '2023-02-29', '2026-13-01', '2026-00-10', '2026-01-00', '0000-01-01', '2026-1-1', '20260101', '2026/01/01', '01-01-2026', ' 2026-01-01', '2026-01-01T00:00:00Z', '', null, undefined, 20260101, new Date(), {}, [], true];
    for (const d of invalidas) await rejeita(a.registros.criar({ materialId: m.id, pesoKg: 1, dataRecebimento: d }), CODIGOS.VALIDACAO);
    assert.deepEqual(await a.registros.listar({}), []);
    for (const d of ['2024-02-29', '2000-02-29', '0001-01-01', '9999-12-31', '2026-09-30']) {
      const r = await novoRegistro(a, m, 1, d);
      assert.equal(r.dataRecebimento, d);
      assert.equal(typeof (await a.registros.buscarPorId(r.id)).dataRecebimento, 'string');
    }
  });

  await teste('R05 materialId: inexistente -> MATERIAL_INEXISTENTE; inválido/ausente -> VALIDACAO; nada é gravado', async (a) => {
    const m = await novoMaterial(a, 'Ferro');
    const inexistente = typeof m.id === 'number' ? 999999 : 'naoExisteNoBanco';
    await rejeita(a.registros.criar({ materialId: inexistente, pesoKg: 1, dataRecebimento: '2026-09-30' }), CODIGOS.MATERIAL_INEXISTENTE);
    for (const id of ['a/b', {}, [], -1, 0, 1.5, NaN, true, null, undefined, '']) {
      await rejeita(a.registros.criar({ materialId: id, pesoKg: 1, dataRecebimento: '2026-09-30' }), CODIGOS.VALIDACAO);
    }
    await rejeita(a.registros.criar(null), CODIGOS.VALIDACAO);
    await rejeita(a.registros.criar([]), CODIGOS.VALIDACAO);
    assert.deepEqual(await a.registros.listar({}), []);
  });

  await teste('R06 a guarda de negócio do domínio (validarMaterial) roda dentro da criação: recebe o material ou null; seu erro propaga e nada é gravado', async (a) => {
    const ativo = await novoMaterial(a, 'Ferro');
    const inativo = await novoMaterial(a, 'Papel');
    await a.materiais.definirAtivo(inativo.id, false);
    const guarda = (m) => {
      if (m === null) throw new ErroDominio(CODIGOS.MATERIAL_INEXISTENTE, 'guarda: inexistente');
      if (!m.ativo) throw new ErroDominio(CODIGOS.MATERIAL_INATIVO, 'guarda: inativo');
    };
    const base = { pesoKg: 1, dataRecebimento: '2026-09-30' };
    assert.equal((await a.registros.criar({ ...base, materialId: ativo.id }, { validarMaterial: guarda })).materialNome, 'Ferro');
    await rejeita(a.registros.criar({ ...base, materialId: inativo.id }, { validarMaterial: guarda }), CODIGOS.MATERIAL_INATIVO, /guarda: inativo/);
    const inexistente = typeof ativo.id === 'number' ? 999999 : 'naoExisteNoBanco';
    await rejeita(a.registros.criar({ ...base, materialId: inexistente }, { validarMaterial: guarda }), CODIGOS.MATERIAL_INEXISTENTE, /guarda: inexistente/);
    assert.equal((await a.registros.listar({})).length, 1);
    // sem a guarda, o repository NÃO impõe a regra de negócio "inativo não recebe lançamento"
    assert.equal((await a.registros.criar({ ...base, materialId: inativo.id })).materialNome, 'Papel');
  });

  await teste('R07 observação: ausente/null/""/espaços -> null; texto normalizado; não-texto e caracteres de controle são VALIDACAO; quebra de linha e tab são aceitas', async (a) => {
    const m = await novoMaterial(a, 'Ferro');
    const c = (observacao) => a.registros.criar({ materialId: m.id, pesoKg: 1, dataRecebimento: '2026-09-30', observacao });
    for (const o of [undefined, null, '', '   ']) assert.equal((await c(o)).observacao, null);
    assert.equal((await c('  Cafe\u0301 ')).observacao, 'Café');
    assert.equal((await c('linha 1\nlinha 2\tfim')).observacao, 'linha 1\nlinha 2\tfim');
    for (const o of [5, true, {}, [], 'a\u0000b', 'a\u0007b', '\ud800']) await rejeita(c(o), CODIGOS.VALIDACAO);
  });

  await teste('R08 buscarPorId: existente -> entidade; inexistente e inválido -> null', async (a) => {
    const m = await novoMaterial(a, 'Ferro');
    const r = await novoRegistro(a, m, 1, '2026-09-30');
    assert.equal((await a.registros.buscarPorId(r.id)).id, r.id);
    for (const id of [undefined, null, '', 'a/b', {}, -1, 0, 1.5]) assert.equal(await a.registros.buscarPorId(id), null);
    assert.equal(await a.registros.buscarPorId(typeof r.id === 'number' ? 999999 : 'naoExisteNoBanco'), null);
  });

  await teste('R09 listar: dataRecebimento DESC e, no empate, o lançamento mais recente primeiro; sem filtro lista tudo', async (a) => {
    const m = await novoMaterial(a, 'Ferro');
    const A = await novoRegistro(a, m, 1, '2026-09-01');
    const B = await novoRegistro(a, m, 2, '2026-09-03');
    const C = await novoRegistro(a, m, 3, '2026-09-03');
    const D = await novoRegistro(a, m, 4, '2026-08-31');
    assert.deepEqual(ids(await a.registros.listar({})), [C.id, B.id, A.id, D.id]);
    assert.deepEqual(ids(await a.registros.listar()), [C.id, B.id, A.id, D.id]);
    assert.deepEqual(ids(await a.registros.listar({ materialId: '', categoria: null, dataInicial: undefined, dataFinal: '' })), [C.id, B.id, A.id, D.id]);
  });

  await teste('R10 filtros: material, categoria, período (inclusivo nas duas pontas, só início, só fim) e combinações', async (a) => {
    const ferro = await novoMaterial(a, 'Ferro', 'Metal');
    const cobre = await novoMaterial(a, 'Cobre', 'Metal');
    const papel = await novoMaterial(a, 'Papel', 'Celulose');
    const solto = await novoMaterial(a, 'Solto');
    const r = {};
    r.f1 = await novoRegistro(a, ferro, 10, '2026-01-10');
    r.f2 = await novoRegistro(a, ferro, 20, '2026-02-10');
    r.c1 = await novoRegistro(a, cobre, 5, '2026-02-10');
    r.p1 = await novoRegistro(a, papel, 7, '2026-03-10');
    r.s1 = await novoRegistro(a, solto, 1, '2026-03-11');
    const f = async (filtro) => ids(await a.registros.listar(filtro)).sort();
    const so = (...xs) => xs.map((k) => r[k].id).sort();
    assert.deepEqual(await f({ materialId: ferro.id }), so('f1', 'f2'));
    assert.deepEqual(await f({ categoria: 'Metal' }), so('f1', 'f2', 'c1'));
    assert.deepEqual(await f({ categoria: 'Celulose' }), so('p1'));
    assert.deepEqual(await f({ dataInicial: '2026-02-10', dataFinal: '2026-03-10' }), so('f2', 'c1', 'p1'));
    assert.deepEqual(await f({ dataInicial: '2026-02-11' }), so('p1', 's1'));
    assert.deepEqual(await f({ dataFinal: '2026-01-10' }), so('f1'));
    assert.deepEqual(await f({ dataInicial: '2026-02-10', dataFinal: '2026-02-10' }), so('f2', 'c1'));
    assert.deepEqual(await f({ materialId: ferro.id, dataInicial: '2026-02-01' }), so('f2'));
    assert.deepEqual(await f({ categoria: 'Metal', dataInicial: '2026-02-01', dataFinal: '2026-02-28' }), so('f2', 'c1'));
    assert.deepEqual(await f({ materialId: ferro.id, categoria: 'Metal' }), so('f1', 'f2'));
    assert.deepEqual(await f({ materialId: papel.id, categoria: 'Metal' }), []);
    assert.deepEqual(await f({ materialId: ferro.id, categoria: 'Metal', dataInicial: '2026-02-01', dataFinal: '2026-02-28' }), so('f2'));
    assert.deepEqual(await f({ categoria: 'NaoExiste' }), []);
    assert.deepEqual(await f({ materialId: typeof ferro.id === 'number' ? 999999 : 'naoExisteNoBanco' }), []);
    assert.deepEqual(await f({ dataInicial: '2030-01-01' }), []);
    assert.deepEqual(await f({ dataInicial: '0001-01-01', dataFinal: '9999-12-31' }), so('f1', 'f2', 'c1', 'p1', 's1'));
  });

  await teste('R11 filtros inválidos são VALIDACAO (nunca viram consulta vazia): período invertido, data impossível, categoria não-texto, materialId inválido, filtro não-objeto', async (a) => {
    for (const filtro of [{ dataInicial: '2026-03-01', dataFinal: '2026-02-01' }, { dataInicial: '2026-02-31' }, { dataFinal: '2026-13-01' }, { dataInicial: 20260101 }, { dataInicial: new Date() }, { categoria: 5 }, { categoria: {} }, { materialId: 'a/b' }, { materialId: -1 }, { materialId: {} }, { materialId: 1.5 }, null, [], 'x', 5]) {
      await rejeita(a.registros.listar(filtro), CODIGOS.VALIDACAO);
      await rejeita(a.registros.totais(filtro), CODIGOS.VALIDACAO);
      await rejeita(a.registros.consultarHistorico(filtro), CODIGOS.VALIDACAO);
      await rejeita(a.registros.consultarIndicadores(filtro), CODIGOS.VALIDACAO);
      await rejeita(a.registros.pesoPorMaterial(filtro), CODIGOS.VALIDACAO);
      await rejeita(a.registros.pesoPorBalde(filtro, 'mes'), CODIGOS.VALIDACAO);
    }
  });

  await teste('R12 categoria é comparação exata (diferencia maiúsculas/minúsculas e espaços), como no filtro atual (pendência P3 preservada)', async (a) => {
    const m = await novoMaterial(a, 'Ferro', 'Metal');
    await novoRegistro(a, m, 1, '2026-09-01');
    assert.equal((await a.registros.listar({ categoria: 'Metal' })).length, 1);
    for (const c of ['metal', 'METAL', 'Metal ', ' Metal', 'Meta']) assert.equal((await a.registros.listar({ categoria: c })).length, 0, c);
  });

  await teste('R13 a categoria é SEMPRE a atual do material: editar a categoria muda retroativamente o filtro (comportamento do JOIN preservado)', async (a) => {
    const m = await novoMaterial(a, 'Ferro', 'Metal');
    const r = await novoRegistro(a, m, 4, '2026-09-01');
    assert.deepEqual(ids(await a.registros.listar({ categoria: 'Metal' })), [r.id]);
    await a.materiais.atualizar(m.id, { categoria: 'Liga' });
    assert.deepEqual(await a.registros.listar({ categoria: 'Metal' }), []);
    const depois = await a.registros.listar({ categoria: 'Liga' });
    assert.deepEqual(ids(depois), [r.id]);
    assert.equal(depois[0].materialCategoria, 'Liga');
    assert.equal((await a.registros.totais({ categoria: 'Liga' })).quantidadeRegistros, 1);
    assert.equal((await a.registros.totais({ categoria: 'Metal' })).quantidadeRegistros, 0);
    await a.materiais.atualizar(m.id, { nome: 'Aço' }); // renomear o material reflete nos registros
    assert.equal((await a.registros.buscarPorId(r.id)).materialNome, 'Aço');
  });

  await teste('R14 material inativo NÃO esconde seus registros históricos (nenhum filtro por ativo)', async (a) => {
    const m = await novoMaterial(a, 'Ferro', 'Metal');
    await novoRegistro(a, m, 10, '2026-09-01');
    await a.materiais.definirAtivo(m.id, false);
    assert.equal((await a.registros.listar({})).length, 1);
    assert.equal((await a.registros.totais({})).totalKg, 10);
    assert.equal((await a.registros.listar({ categoria: 'Metal' })).length, 1);
    assert.deepEqual((await a.registros.pesoPorMaterial({})).map((x) => x.material), ['Ferro']);
    assert.equal((await a.registros.consultarIndicadores({})).materiaisEnvolvidos, 1);
  });

  await teste('R15 totais: quantidade, soma e média; conjunto vazio dá 0/0/0 (nunca NaN); respeita todos os filtros', async (a) => {
    assert.deepEqual(await a.registros.totais({}), { quantidadeRegistros: 0, totalKg: 0, mediaKg: 0 });
    const f = await novoMaterial(a, 'Ferro', 'Metal');
    const p = await novoMaterial(a, 'Papel', 'Celulose');
    await novoRegistro(a, f, 10, '2026-01-10');
    await novoRegistro(a, f, 20, '2026-02-10');
    await novoRegistro(a, p, 30.5, '2026-02-11');
    assert.deepEqual(await a.registros.totais({}), { quantidadeRegistros: 3, totalKg: 60.5, mediaKg: 60.5 / 3 });
    assert.deepEqual(await a.registros.totais({ materialId: f.id }), { quantidadeRegistros: 2, totalKg: 30, mediaKg: 15 });
    assert.deepEqual(await a.registros.totais({ categoria: 'Celulose' }), { quantidadeRegistros: 1, totalKg: 30.5, mediaKg: 30.5 });
    assert.deepEqual(await a.registros.totais({ dataInicial: '2026-02-01', dataFinal: '2026-02-28' }), { quantidadeRegistros: 2, totalKg: 50.5, mediaKg: 25.25 });
    assert.deepEqual(await a.registros.totais({ categoria: 'NaoExiste' }), { quantidadeRegistros: 0, totalKg: 0, mediaKg: 0 });
    // decimais binários inexatos: soma/média iguais dentro de 1e-9 (a ordem de soma pode diferir do SQLite)
    for (const v of [0.1, 0.2, 0.3]) await novoRegistro(a, p, v, '2026-05-01');
    const t = await a.registros.totais({ dataInicial: '2026-05-01', dataFinal: '2026-05-01' });
    assert.equal(t.quantidadeRegistros, 3);
    assert.ok(Math.abs(t.totalKg - 0.6) < 1e-9);
    assert.ok(Math.abs(t.mediaKg - 0.2) < 1e-9);
  });

  await teste('R16 consultarHistorico: totais e registros descrevem exatamente o MESMO conjunto, na mesma ordem de listar()', async (a) => {
    const f = await novoMaterial(a, 'Ferro', 'Metal');
    const p = await novoMaterial(a, 'Papel', 'Celulose');
    await novoRegistro(a, f, 10, '2026-02-10');
    await novoRegistro(a, p, 5, '2026-02-12');
    await novoRegistro(a, f, 2.5, '2026-03-01');
    for (const filtro of [{}, { materialId: f.id }, { categoria: 'Celulose' }, { dataInicial: '2026-02-01', dataFinal: '2026-02-28' }, { categoria: 'NaoExiste' }]) {
      const h = await a.registros.consultarHistorico(filtro);
      assert.deepEqual(h.registros, await a.registros.listar(filtro));
      assert.equal(h.totais.quantidadeRegistros, h.registros.length);
      assert.equal(h.totais.totalKg, h.registros.reduce((s, r) => s + r.pesoKg, 0));
      assert.deepEqual(Object.keys(h).sort(), ['registros', 'totais']);
    }
  });

  await teste('R17 consultarIndicadores: totais + materiais DISTINTOS (cada lançamento não conta como um material)', async (a) => {
    assert.deepEqual(await a.registros.consultarIndicadores({}), { quantidadeRegistros: 0, totalKg: 0, mediaKg: 0, materiaisEnvolvidos: 0 });
    const pet = await novoMaterial(a, 'PET', 'Plástico');
    const papel = await novoMaterial(a, 'Papel', 'Celulose');
    await novoMaterial(a, 'SemLancamento', 'Metal');
    await novoRegistro(a, pet, 100, '2026-02-01');
    await novoRegistro(a, papel, 50, '2026-02-02');
    await novoRegistro(a, pet, 20, '2026-03-01');
    assert.deepEqual(await a.registros.consultarIndicadores({}), { quantidadeRegistros: 3, totalKg: 170, mediaKg: 170 / 3, materiaisEnvolvidos: 2 });
    assert.deepEqual(await a.registros.consultarIndicadores({ dataInicial: '2026-03-01' }), { quantidadeRegistros: 1, totalKg: 20, mediaKg: 20, materiaisEnvolvidos: 1 });
    assert.equal((await a.registros.consultarIndicadores({ categoria: 'Metal' })).materiaisEnvolvidos, 0);
  });

  await teste('R18 pesoPorMaterial: soma por material, ordem peso DESC / nome ASC / id ASC, sem fatia vazia; material inativo aparece', async (a) => {
    assert.deepEqual(await a.registros.pesoPorMaterial({}), []);
    const b = await novoMaterial(a, 'Bronze');
    const al = await novoMaterial(a, 'Alumínio');
    const c = await novoMaterial(a, 'Cobre');
    const sem = await novoMaterial(a, 'Zinco');
    await novoRegistro(a, c, 10, '2026-02-01');
    await novoRegistro(a, b, 4, '2026-02-02');
    await novoRegistro(a, b, 6, '2026-02-03');
    await novoRegistro(a, al, 10, '2026-02-04'); // empata com Cobre (10): Alumínio < Cobre por bytes UTF-8? 'A' (0x41) < 'C' (0x43)
    await a.materiais.definirAtivo(b.id, false);
    const r = await a.registros.pesoPorMaterial({});
    assert.deepEqual(r, [
      { materialId: al.id, material: 'Alumínio', pesoKg: 10 },
      { materialId: b.id, material: 'Bronze', pesoKg: 10 },
      { materialId: c.id, material: 'Cobre', pesoKg: 10 },
    ]);
    assert.ok(!r.some((x) => x.materialId === sem.id));
    assert.deepEqual((await a.registros.pesoPorMaterial({ dataInicial: '2026-02-03', dataFinal: '2026-02-03' })).map((x) => [x.material, x.pesoKg]), [['Bronze', 6]]);
  });

  await teste('R19 pesoPorBalde: dia/mês/ano somam por fatia da data; só baldes com dado, ordenados por chave; granularidade inválida é VALIDACAO', async (a) => {
    const m = await novoMaterial(a, 'Ferro', 'Metal');
    const q = await novoMaterial(a, 'Cobre', 'Metal');
    await novoRegistro(a, m, 1, '2025-12-31');
    await novoRegistro(a, m, 2, '2026-01-05');
    await novoRegistro(a, q, 4, '2026-01-05');
    await novoRegistro(a, m, 8, '2026-01-20');
    await novoRegistro(a, m, 16, '2026-03-02');
    assert.deepEqual(await a.registros.pesoPorBalde({}, 'dia'), [
      { chave: '2025-12-31', pesoKg: 1 }, { chave: '2026-01-05', pesoKg: 6 }, { chave: '2026-01-20', pesoKg: 8 }, { chave: '2026-03-02', pesoKg: 16 },
    ]);
    assert.deepEqual(await a.registros.pesoPorBalde({}, 'mes'), [
      { chave: '2025-12', pesoKg: 1 }, { chave: '2026-01', pesoKg: 14 }, { chave: '2026-03', pesoKg: 16 },
    ]);
    assert.deepEqual(await a.registros.pesoPorBalde({}, 'ano'), [{ chave: '2025', pesoKg: 1 }, { chave: '2026', pesoKg: 30 }]);
    assert.deepEqual(await a.registros.pesoPorBalde({ materialId: q.id }, 'mes'), [{ chave: '2026-01', pesoKg: 4 }]);
    assert.deepEqual(await a.registros.pesoPorBalde({ dataInicial: '2026-01-01', dataFinal: '2026-01-31' }, 'ano'), [{ chave: '2026', pesoKg: 14 }]);
    assert.deepEqual(await a.registros.pesoPorBalde({ categoria: 'NaoExiste' }, 'dia'), []);
    for (const g of ['semana', '', undefined, null, 5, 'DIA']) await rejeita(a.registros.pesoPorBalde({}, g), CODIGOS.VALIDACAO);
  });

  await teste('R20 categoria com MAIS de 30 materiais (lotes do operador "in"): listar, totais, indicadores e agrupamentos veem todos', async (a) => {
    const N = 65;
    let esperado = 0;
    const materiaisCriados = [];
    for (let i = 0; i < N; i += 1) {
      const m = await novoMaterial(a, `Mat ${String(i).padStart(3, '0')}`, 'Grande');
      materiaisCriados.push(m);
      await novoRegistro(a, m, i + 1, '2026-06-15');
      esperado += i + 1;
    }
    const outro = await novoMaterial(a, 'Outro', 'Pequena');
    await novoRegistro(a, outro, 1000, '2026-06-15');
    const f = { categoria: 'Grande', dataInicial: '2026-06-01', dataFinal: '2026-06-30' };
    assert.equal((await a.registros.listar(f)).length, N);
    assert.equal((await a.registros.listar({ categoria: 'Grande' })).length, N);
    assert.deepEqual(await a.registros.totais(f), { quantidadeRegistros: N, totalKg: esperado, mediaKg: esperado / N });
    assert.equal((await a.registros.consultarHistorico(f)).registros.length, N);
    assert.deepEqual(await a.registros.consultarIndicadores(f), { quantidadeRegistros: N, totalKg: esperado, mediaKg: esperado / N, materiaisEnvolvidos: N });
    const porMaterial = await a.registros.pesoPorMaterial(f);
    assert.equal(porMaterial.length, N);
    assert.equal(porMaterial[0].material, 'Mat 064');
    assert.deepEqual(await a.registros.pesoPorBalde(f, 'mes'), [{ chave: '2026-06', pesoKg: esperado }]);
    assert.equal((await a.registros.totais({ dataInicial: '2026-06-01', dataFinal: '2026-06-30' })).quantidadeRegistros, N + 1);
  });

  await teste('R21 persistência real: um segundo conjunto de repositories sobre o MESMO armazenamento enxerga o que o primeiro gravou', async (a) => {
    if (!a.novoConjuntoNoMesmoArmazenamento) return; // ambiente sem essa capacidade
    const b = await a.novoConjuntoNoMesmoArmazenamento();
    const m = await novoMaterial(a, 'Ferro', 'Metal');
    const r = await novoRegistro(a, m, 3, '2026-09-01');
    assert.deepEqual(await b.materiais.buscarPorId(m.id), m);
    assert.deepEqual(await b.registros.buscarPorId(r.id), r);
    await rejeita(b.materiais.criar({ nome: 'ferro' }), CODIGOS.DUPLICADO);
  });

  const falhas = resultados.filter((x) => x === 'FAIL').length;
  console.log(`\n[${rotulo}] contrato dos repositories — Total: ${resultados.length} | PASS: ${resultados.length - falhas} | FAIL: ${falhas}`);
  return { total: resultados.length, falhas };
}

module.exports = { executarSuiteContrato, criarRelogio, rejeita };
