'use strict';

// Regras de segurança (../firestore.rules) contra o Firestore EMULATOR, usando o SDK real,
// os repositories reais e o roteador local. Rodar na máquina do projeto:
//     cd site && npm ci && npm run emulador
// Requer Java + firebase-tools (o emulador baixa o .jar na primeira execução).
// Este teste NÃO roda sem o emulador (FIRESTORE_EMULATOR_HOST é definido pelo emulators:exec).

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const sdk = require('firebase/firestore');

const RAIZ = path.join(__dirname, '..', '..');
const { criarRepositorios } = require(path.join(RAIZ, 'src', 'repositories'));
const { definirRepositorios } = require(path.join(RAIZ, 'src', 'repositories', 'provedor'));
const { criarFetchLocal } = require('../src/fetchLocal');

const LISTA_EDITORES = /request\.auth\.token\.email in \[[^\]]*\]/;
const EDITOR = 'editor@teste.com';
const hoje = () => new Date().toISOString().slice(0, 10);

let total = 0;
let falhas = 0;
async function t(nome, fn) {
  total += 1;
  try { await fn(); console.log(`✅ PASS - ${nome}`); } catch (err) {
    falhas += 1;
    console.log(`❌ FAIL - ${nome}\n   ${String(err && err.message).split('\n').join('\n   ')}`);
  }
}

(async () => {
  let regras = fs.readFileSync(path.join(RAIZ, 'firestore.rules'), 'utf8');
  assert.ok(LISTA_EDITORES.test(regras), 'firestore.rules deveria conter a lista de e-mails editores');
  regras = regras.replace(LISTA_EDITORES, `request.auth.token.email in ['${EDITOR}']`);

  const env = await initializeTestEnvironment({
    projectId: 'demo-controle-materiais',
    firestore: { rules: regras, host: '127.0.0.1', port: Number(String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':').pop()) },
  });

  const publico = () => env.unauthenticatedContext().firestore();
  const editor = () => env.authenticatedContext('u-editor', { email: EDITOR }).firestore();
  const intruso = () => env.authenticatedContext('u-intruso', { email: 'qualquer@pessoa.com' }).firestore();
  const api = async (db, autenticadoNaUI = true) => {
    definirRepositorios(await criarRepositorios({ modo: 'firestore', firestore: { db, sdk } }));
    const f = criarFetchLocal({ autenticado: () => autenticadoNaUI });
    return async (m, u, corpo) => {
      const r = await f(u, { method: m, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
      return { status: r.status, json: await r.json() };
    };
  };

  await env.clearFirestore();

  await t('RG01 — Público LÊ materiais e registros (consulta livre pelo link)', async () => {
    await assertSucceeds(sdk.getDocs(sdk.collection(publico(), 'materiais')));
    await assertSucceeds(sdk.getDocs(sdk.collection(publico(), 'registrosPeso')));
  });

  await t('RG02 — Público NÃO lê o índice interno de nomes nem coleções desconhecidas', async () => {
    await assertFails(sdk.getDocs(sdk.collection(publico(), 'materiaisNomesIndex')));
    await assertFails(sdk.getDocs(sdk.collection(publico(), 'qualquerOutra')));
  });

  await t('RG03 — Público NÃO grava (nem material, nem registro, nem índice)', async () => {
    await assertFails(sdk.setDoc(sdk.doc(publico(), 'materiais/x'), { nome: 'X', ativo: true }));
    await assertFails(sdk.setDoc(sdk.doc(publico(), 'registrosPeso/x'), { materialId: 'm', pesoKg: 1, dataRecebimento: hoje() }));
    await assertFails(sdk.setDoc(sdk.doc(publico(), 'materiaisNomesIndex/x'), { chave: 'x' }));
  });

  await t('RG04 — Usuário AUTENTICADO com e-mail fora da lista NÃO grava (qualquer pessoa pode criar conta pela API pública)', async () => {
    await assertFails(sdk.setDoc(sdk.doc(intruso(), 'materiais/x'), { nome: 'X', ativo: true }));
    await assertFails(sdk.setDoc(sdk.doc(intruso(), 'registrosPeso/x'), { materialId: 'm', pesoKg: 1, dataRecebimento: hoje() }));
  });

  await t('RG05 — Editor, pelos repositories REAIS: cria material, rejeita nome duplicado (409), renomeia, desativa e reativa', async () => {
    const chamar = await api(editor());
    const c = await chamar('POST', '/api/materiais', { nome: 'Papelão', categoria: 'Papel' });
    assert.equal(c.status, 201, JSON.stringify(c.json));
    assert.equal((await chamar('POST', '/api/materiais', { nome: ' papelão ' })).status, 409);
    const id = encodeURIComponent(c.json.id);
    assert.equal((await chamar('PATCH', `/api/materiais/${id}`, { nome: 'Papelão Branco' })).status, 200);
    assert.equal((await chamar('PATCH', `/api/materiais/${id}/desativar`)).json.ativo, 0);
    assert.equal((await chamar('PATCH', `/api/materiais/${id}/ativar`)).json.ativo, 1);
  });

  await t('RG06 — Editor lança peso; dashboard, gráficos, histórico e evolução funcionam (consultas e agregações liberadas)', async () => {
    const chamar = await api(editor());
    const m = (await chamar('GET', '/api/materiais')).json[0];
    const l = await chamar('POST', '/api/registros', { materialId: m.id, pesoKg: 12.5, dataRecebimento: hoje() });
    assert.equal(l.status, 201, JSON.stringify(l.json));
    for (const u of ['/api/registros', '/api/dashboard', '/api/graficos', '/api/dashboard/evolucao?visao=mes']) {
      const r = await chamar('GET', u);
      assert.equal(r.status, 200, `${u} -> ${r.status} ${JSON.stringify(r.json)}`);
    }
    assert.equal((await chamar('GET', '/api/registros')).json.totais.total_kg, 12.5);
  });

  await t('RG07 — Público, pelos repositories REAIS: leitura 200; mesmo "logado" só na tela, a gravação é barrada pelo Firestore (erro de permissão, mensagem fixa)', async () => {
    const chamar = await api(publico(), true);
    assert.equal((await chamar('GET', '/api/materiais')).status, 200);
    const origErr = console.error;
    console.error = () => {};
    const r = await chamar('POST', '/api/materiais', { nome: 'Invasor' });
    console.error = origErr;
    assert.ok([403, 500].includes(r.status), `status ${r.status}`);
    assert.doesNotMatch(JSON.stringify(r.json), /permission|firestore\.googleapis|demo-controle/i);
    const lista = await (await api(editor()))('GET', '/api/materiais?incluirInativos=true');
    assert.ok(!lista.json.some((x) => x.nome === 'Invasor'));
  });

  await t('RG08 — NINGUÉM apaga material ou registro (nem o editor) e registro é imutável (sem update)', async () => {
    const db = editor();
    const mats = await sdk.getDocs(sdk.collection(db, 'materiais'));
    const regs = await sdk.getDocs(sdk.collection(db, 'registrosPeso'));
    assert.ok(mats.size >= 1 && regs.size >= 1);
    await assertFails(sdk.deleteDoc(mats.docs[0].ref));
    await assertFails(sdk.deleteDoc(regs.docs[0].ref));
    await assertFails(sdk.updateDoc(regs.docs[0].ref, { pesoKg: 999 }));
  });

  await t('RG09 — Validação nas regras: editor não grava peso zero/negativo/texto nem material sem nome', async () => {
    const db = editor();
    await assertFails(sdk.setDoc(sdk.doc(db, 'registrosPeso/ruim1'), { materialId: 'm', pesoKg: 0, dataRecebimento: hoje() }));
    await assertFails(sdk.setDoc(sdk.doc(db, 'registrosPeso/ruim2'), { materialId: 'm', pesoKg: -3, dataRecebimento: hoje() }));
    await assertFails(sdk.setDoc(sdk.doc(db, 'registrosPeso/ruim3'), { materialId: 'm', pesoKg: '10', dataRecebimento: hoje() }));
    await assertFails(sdk.setDoc(sdk.doc(db, 'materiais/ruim4'), { ativo: true }));
    await assertFails(sdk.setDoc(sdk.doc(db, 'colecaoNova/x'), { a: 1 }));
  });

  await env.cleanup();
  console.log(`\nRegras do Firestore (EMULATOR) — Total: ${total} | PASS: ${total - falhas} | FAIL: ${falhas}`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
