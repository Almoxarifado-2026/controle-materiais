'use strict';

// ============================================================
// Controle de Materiais — programa para Windows (Electron).
//
// Abre o MESMO sistema do site (pasta dist/ gerada por site/build.mjs), com os mesmos dados no
// Firebase e o mesmo login. Não existe servidor local nem banco local.
//
// Segurança: sem Node na página (nodeIntegration off, contextIsolation e sandbox on), sem preload,
// navegação restrita a app://cm/, links https externos abrem no navegador padrão, nenhuma
// permissão de dispositivo (câmera, microfone, localização...) é concedida.
// O protocolo próprio app://cm/ dá uma origem estável (a sessão de login persiste entre aberturas).
// ============================================================

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, protocol, session, shell } = require('electron');
const { resolverArquivo, HOST } = require('./src/servir');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const RAIZ_SITE = app.isPackaged ? path.join(process.resourcesPath, 'site') : path.join(__dirname, '..', 'dist');
const URL_INICIAL = `app://${HOST}/index.html`;
let janela = null;

function menu() {
  return Menu.buildFromTemplate([
    { label: 'Editar', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Exibir',
      submenu: [
        { label: 'Recarregar', accelerator: 'F5', click: () => janela && janela.webContents.reload() },
        { type: 'separator' },
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4f6f5',
    title: 'Controle de Materiais',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, devTools: !app.isPackaged },
  });
  janela.once('ready-to-show', () => janela.show());
  janela.on('closed', () => { janela = null; });

  // Links externos (https) abrem no navegador do sistema; nada mais abre janela nova.
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  janela.webContents.on('will-navigate', (ev, url) => {
    if (!url.startsWith(`app://${HOST}/`)) {
      ev.preventDefault();
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  janela.webContents.on('did-fail-load', (_ev, codigo, descricao, url, principal) => {
    if (principal && codigo !== -3) dialog.showErrorBox('Controle de Materiais', `Não foi possível abrir a tela (${descricao}).\n${url}`);
  });
  janela.loadURL(URL_INICIAL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (janela) {
      if (janela.isMinimized()) janela.restore();
      janela.focus();
    }
  });

  app.whenReady().then(() => {
    if (!fs.existsSync(path.join(RAIZ_SITE, 'index.html'))) {
      dialog.showErrorBox('Controle de Materiais', 'Os arquivos do site não foram encontrados.\nGere o site antes: na pasta "site", rode "npm run build".');
      app.quit();
      return;
    }
    protocol.handle('app', async (request) => {
      const r = resolverArquivo(RAIZ_SITE, request.url);
      if (!r) return new Response('Não encontrado', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      try {
        return new Response(await fs.promises.readFile(r.arquivo), { status: 200, headers: { 'Content-Type': r.tipo, 'Cache-Control': 'no-cache' } });
      } catch {
        return new Response('Não encontrado', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    });
    session.defaultSession.setPermissionRequestHandler((_wc, _permissao, resposta) => resposta(false));
    Menu.setApplicationMenu(menu());
    criarJanela();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) criarJanela(); });
  });

  app.on('window-all-closed', () => app.quit());
}
