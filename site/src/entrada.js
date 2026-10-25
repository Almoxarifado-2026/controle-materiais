// ============================================================
// Entrada do bundle web (GitHub Pages). Roda ANTES de public/js/app.mjs.
//
//  1. Lê window.FIREBASE_CONFIG (public/firebase-config.js; chaves públicas do app Web).
//  2. Inicializa Firebase App + Firestore + Authentication.
//  3. Liga os repositories ao Firestore e expõe, para a interface:
//       window.__CM_FETCH__  — substituto de fetch (api.mjs usa quando existe)
//       window.__CM_AUTH__   — { configurado, usuario(), entrar(), sair(), aoMudar() }
//
// A trava de segurança real são as regras do Firestore (firestore.rules); nada aqui é segredo.
// ============================================================
import { initializeApp } from 'firebase/app';
import * as sdk from 'firebase/firestore';
import { initializeAuth, browserLocalPersistence, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import provedorWeb from './provedorWeb.js';
import fetchLocalModulo from './fetchLocal.js';

const { configurarFirestore } = provedorWeb;
const { criarFetchLocal } = fetchLocalModulo;

const OBRIGATORIAS = ['apiKey', 'authDomain', 'projectId', 'appId'];

function configValida(cfg) {
  return !!cfg && OBRIGATORIAS.every((k) => typeof cfg[k] === 'string' && cfg[k].trim() !== '' && !/^COLE/i.test(cfg[k]));
}

const MENSAGENS_AUTH = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/user-not-found': 'E-mail ou senha incorretos.',
  'auth/invalid-email': 'Informe um e-mail válido.',
  'auth/user-disabled': 'Este usuário está desativado.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  'auth/operation-not-allowed': 'O login por e-mail e senha não está ativado no Firebase (Authentication > Método de login).',
  'auth/configuration-not-found': 'O Firebase Authentication ainda não foi configurado neste projeto (Console > Authentication > Começar).',
  'auth/invalid-api-key': 'A chave do Firebase (apiKey) em firebase-config.js está inválida.',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.': 'A chave do Firebase (apiKey) em firebase-config.js está inválida.',
  'auth/unauthorized-domain': 'Este endereço do site não está autorizado no Firebase (Authentication > Configurações > Domínios autorizados).',
  'auth/network-request-failed': 'Sem conexão com o Firebase. Verifique a internet e tente de novo.',
};

function mensagemAuth(err) {
  const codigo = err && err.code;
  if (!MENSAGENS_AUTH[codigo]) console.warn('Falha no login (código do Firebase):', codigo); // ajuda a diagnosticar
  return MENSAGENS_AUTH[codigo] || `Não foi possível entrar. Tente novamente.${codigo ? ` (${codigo})` : ''}`;
}

const cfg = globalThis.FIREBASE_CONFIG;
const configurado = configValida(cfg);
let usuarioAtual = null;
const ouvintes = new Set();

if (configurado) {
  const app = initializeApp(cfg, 'controle-materiais-web');
  // Long polling forçado: o canal de streaming padrão do Firestore (fetch streams) é cortado
  // por extensões do navegador, antivírus e proxies, gerando "AbortError: signal is aborted
  // without reason" em cascata. Com long polling as consultas passam por requisições comuns.
  const db = sdk.initializeFirestore(app, { experimentalForceLongPolling: true });
  // Só e-mail/senha: initializeAuth SEM o resolvedor de popup/redirect evita que o Firebase tente
  // carregar apis.google.com (bloqueado pela CSP, que só permite scripts do próprio site).
  const auth = initializeAuth(app, { persistence: browserLocalPersistence });
  configurarFirestore({ db, sdk });

  onAuthStateChanged(auth, (u) => {
    usuarioAtual = u ? { email: u.email || '' } : null;
    for (const cb of ouvintes) cb(usuarioAtual);
  });

  globalThis.__CM_AUTH__ = {
    configurado: true,
    usuario: () => usuarioAtual,
    async entrar(email, senha) {
      try {
        await signInWithEmailAndPassword(auth, String(email || '').trim(), String(senha || ''));
      } catch (err) {
        throw new Error(mensagemAuth(err));
      }
    },
    sair: () => signOut(auth),
    aoMudar(cb) {
      ouvintes.add(cb);
      cb(usuarioAtual);
      return () => ouvintes.delete(cb);
    },
  };
} else {
  globalThis.__CM_AUTH__ = {
    configurado: false,
    usuario: () => null,
    entrar: async () => { throw new Error('O Firebase ainda não foi configurado (public/firebase-config.js).'); },
    sair: async () => {},
    aoMudar(cb) { cb(null); return () => {}; },
  };
}

globalThis.__CM_FETCH__ = criarFetchLocal({ autenticado: () => usuarioAtual !== null });
