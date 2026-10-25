'use strict';

// ============================================================
// FAKE em memória do subconjunto do SDK do Firestore usado pelos repositories.
//
//   >>> É UM DUBLÊ DE TESTE (MOCK). NÃO É O FIRESTORE. <<<
//   Rodar a suíte de contrato sobre ele valida a LÓGICA dos repositories
//   (montagem de consultas, lotes do operador "in", transações, mapeamento,
//   agregação em código). NÃO valida regras de segurança, índices, latência,
//   nem o comportamento real do servidor — isso só o Firestore Emulator prova.
//
// Fidelidade deliberada a restrições REAIS do Firestore, para o fake não ser
// mais permissivo que o serviço:
//  - operador "in": no máximo 30 valores (acima disso: invalid-argument);
//  - ID de documento: sem "/", diferente de "." e "..", fora do padrão
//    reservado __x__, no máximo 1500 bytes;
//  - transação: todas as leituras ANTES das escritas (leitura após escrita
//    lança erro); escritas só são aplicadas no commit, atomicamente;
//  - transações são serializadas (o serviço real repete a transação em
//    conflito; o resultado observável de unicidade é o mesmo);
//  - create implícito: tx.update em documento inexistente falha (not-found);
//  - Timestamp com fromDate/toDate; sum() de conjunto vazio = 0;
//  - strings comparadas por bytes UTF-8.
// ============================================================

const crypto = require('node:crypto');

class Timestamp {
  constructor(ms) { this._ms = ms; }
  static fromDate(d) { return new Timestamp(d.getTime()); }
  toDate() { return new Date(this._ms); }
}

const erroSdk = (code, message) => Object.assign(new Error(message || code), { code });
const SENTINELA_ID = Symbol('documentId');

function validarIdDocumento(id) {
  if (typeof id !== 'string' || id === '' || id.includes('/') || id === '.' || id === '..' || /^__.*__$/.test(id) || Buffer.byteLength(id, 'utf8') > 1500) {
    throw erroSdk('invalid-argument', 'ID de documento inválido (fake)');
  }
}

function comparar(a, b) {
  if (typeof a === 'string' && typeof b === 'string') return Buffer.compare(Buffer.from(a), Buffer.from(b));
  return a < b ? -1 : a > b ? 1 : 0;
}

function copiar(v) {
  if (v instanceof Timestamp) return new Timestamp(v._ms);
  if (Array.isArray(v)) return v.map(copiar);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copiar(x)]));
  return v;
}

function criarFakeFirestore() {
  const colecoes = new Map(); // nome -> Map(id -> dados)
  let fila = Promise.resolve();
  const contadores = { leiturasDocumentos: 0, consultas: 0, agregacoes: 0, transacoes: 0 };
  const consultasExecutadas = [];

  const tabela = (nome) => {
    if (!colecoes.has(nome)) colecoes.set(nome, new Map());
    return colecoes.get(nome);
  };

  const db = { __fake: true };
  const novoSnap = (colecao, id) => {
    const t = tabela(colecao);
    const existe = t.has(id);
    return { id, exists: () => existe, data: () => (existe ? copiar(t.get(id)) : undefined) };
  };

  const sdk = {
    Timestamp,
    collection: (_db, nome) => ({ __tipo: 'colecao', nome }),
    doc(pai, id) {
      if (pai.__tipo !== 'colecao') throw erroSdk('invalid-argument', 'fake: doc() só aceita coleção');
      const idFinal = id === undefined ? crypto.randomBytes(15).toString('base64url').slice(0, 20) : String(id);
      validarIdDocumento(idFinal);
      return { __tipo: 'doc', colecao: pai.nome, id: idFinal };
    },
    documentId: () => SENTINELA_ID,
    where: (campo, op, valor) => {
      if (!['==', '>=', '<=', 'in'].includes(op)) throw erroSdk('invalid-argument', `fake: operador não suportado ${op}`);
      if (op === 'in' && (!Array.isArray(valor) || valor.length === 0 || valor.length > 30)) {
        throw erroSdk('invalid-argument', 'fake: "in" aceita de 1 a 30 valores');
      }
      return { __tipo: 'filtro', campo, op, valor };
    },
    orderBy: (campo, dir = 'asc') => ({ __tipo: 'ordem', campo, dir }),
    query: (col, ...restricoes) => ({ __tipo: 'consulta', colecao: col.nome, filtros: restricoes.filter((r) => r.__tipo === 'filtro'), ordens: restricoes.filter((r) => r.__tipo === 'ordem') }),
    async getDoc(ref) {
      contadores.leiturasDocumentos += 1;
      return novoSnap(ref.colecao, ref.id);
    },
    async getDocs(q) {
      contadores.consultas += 1;
      const docs = executar(q);
      contadores.leiturasDocumentos += docs.length;
      return { docs, size: docs.length };
    },
    count: () => ({ __agg: 'count' }),
    sum: (campo) => ({ __agg: 'sum', campo }),
    async getAggregateFromServer(q, specs) {
      contadores.agregacoes += 1;
      const docs = executar(q);
      const out = {};
      for (const [nome, s] of Object.entries(specs)) {
        out[nome] = s.__agg === 'count' ? docs.length : docs.reduce((acc, d) => acc + d.data()[s.campo], 0);
      }
      return { data: () => out };
    },
    async runTransaction(_db, fn) {
      const anterior = fila;
      let liberar;
      fila = new Promise((r) => { liberar = r; });
      await anterior;
      try {
        contadores.transacoes += 1;
        const escritas = [];
        let escreveu = false;
        const visto = (ref) => {
          const pend = [...escritas].reverse().find((e) => e.ref.colecao === ref.colecao && e.ref.id === ref.id);
          return pend; // leituras dentro da transação veem o estado anterior ao commit (como no Firestore)
        };
        void visto;
        const tx = {
          async get(ref) {
            if (escreveu) throw erroSdk('invalid-argument', 'fake: leituras da transação devem vir ANTES das escritas');
            contadores.leiturasDocumentos += 1;
            return novoSnap(ref.colecao, ref.id);
          },
          set(ref, dados) { escreveu = true; escritas.push({ tipo: 'set', ref, dados: copiar(dados) }); return tx; },
          update(ref, dados) { escreveu = true; escritas.push({ tipo: 'update', ref, dados: copiar(dados) }); return tx; },
          delete(ref) { escreveu = true; escritas.push({ tipo: 'delete', ref }); return tx; },
        };
        const resultado = await fn(tx);
        // commit atômico: valida tudo antes de aplicar qualquer coisa
        for (const e of escritas) {
          if (e.tipo === 'update' && !tabela(e.ref.colecao).has(e.ref.id)) {
            // considera criações do próprio commit anteriores a este update
            const criadoAntes = escritas.some((x) => x !== e && x.tipo === 'set' && x.ref.colecao === e.ref.colecao && x.ref.id === e.ref.id && escritas.indexOf(x) < escritas.indexOf(e));
            if (!criadoAntes) throw erroSdk('not-found', 'fake: update em documento inexistente');
          }
        }
        for (const e of escritas) {
          const t = tabela(e.ref.colecao);
          if (e.tipo === 'set') t.set(e.ref.id, e.dados);
          else if (e.tipo === 'update') t.set(e.ref.id, { ...t.get(e.ref.id), ...e.dados });
          else t.delete(e.ref.id);
        }
        return resultado;
      } finally {
        liberar();
      }
    },
  };

  function valorDoCampo(id, dados, campo) {
    return campo === SENTINELA_ID ? id : dados[campo];
  }

  function executar(q) {
    consultasExecutadas.push({ colecao: q.colecao, filtros: q.filtros.map((f) => ({ campo: f.campo === SENTINELA_ID ? '__name__' : f.campo, op: f.op, n: Array.isArray(f.valor) ? f.valor.length : 1 })), ordens: q.ordens.map((o) => o.campo) });
    let linhas = [...tabela(q.colecao).entries()];
    for (const f of q.filtros) {
      linhas = linhas.filter(([id, dados]) => {
        const v = valorDoCampo(id, dados, f.campo);
        if (v === undefined) return false; // documento sem o campo não entra em consulta por ele (como no Firestore)
        if (f.op === '==') return v === f.valor;
        if (f.op === '>=') return comparar(v, f.valor) >= 0;
        if (f.op === '<=') return comparar(v, f.valor) <= 0;
        return f.valor.includes(v);
      });
    }
    for (const o of [...q.ordens].reverse()) {
      linhas.sort((a, b) => comparar(a[1][o.campo], b[1][o.campo]) * (o.dir === 'desc' ? -1 : 1));
    }
    if (q.ordens.length === 0) linhas.sort((a, b) => comparar(a[0], b[0]));
    return linhas.map(([id]) => novoSnap(q.colecao, id));
  }

  return {
    db,
    sdk,
    contadores,
    consultasExecutadas,
    limpar: () => colecoes.clear(),
    // acesso direto (para os testes semearem/corromperem documentos e inspecionarem o armazenamento)
    bruto: (colecao) => tabela(colecao),
  };
}

module.exports = { criarFakeFirestore, Timestamp, erroSdk };
