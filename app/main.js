import { app, BrowserWindow, ipcMain, Notification, nativeTheme, shell, screen } from 'electron';
nativeTheme.themeSource = 'light';
import { dirname, join } from 'path';
import { appendFileSync } from 'fs';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const AUTO = process.argv.includes('--auto');
const SELFTEST = process.argv.includes('--selftest');

// lib 모듈들이 로드되기 전에 데이터 폴더(설정/상태 파일 위치)를 앱 데이터 폴더로 지정
process.env.AUTO_NEWRROW_HOME = app.getPath('userData');
if (AUTO) app.dock?.hide();

const { loadSettings, saveSettings } = await import('./store.js');
const { openLoginWindow } = await import('./login.js');
const { createClient, todayKST } = await import('../lib/client.js');
const { runDaily } = await import('../lib/core.js');
const { installDaily, uninstallDaily, isDailyInstalled } = await import('../lib/daily.js');
const { checkForUpdate, downloadAsset, currentBundlePath, canReplaceInPlace, stageInPlaceUpdate } = await import('./update.js');

let win = null;
let running = false;

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

async function runJob(emit) {
  if (running) throw new Error('이미 실행 중이에요');
  const s = loadSettings();
  const useGpt = s.aiProvider === 'openai';
  const missing = [!s.email && '이메일', !s.password && '비밀번호', (useGpt ? !s.openaiKey : !s.geminiKey) && (useGpt ? 'OpenAI API 키' : 'Gemini API 키')].filter(Boolean);
  if (missing.length) throw new Error(`설정이 비어 있어요: ${missing.join(', ')}`);
  process.env.AI_PROVIDER = useGpt ? 'openai' : 'gemini';
  process.env.GEMINI_API_KEY = s.geminiKey;
  process.env.OPENAI_API_KEY = s.openaiKey;
  running = true;
  send('status', { running: true });
  let session;
  try {
    try {
      session = await openLoginWindow(s.email, s.password, (m) => emit(`▸ ${m}`));
    } catch (err) {
      // 앱 첫 실행 직후엔 내장 네트워크 서비스가 한 번 재시작되며 로그인이 실패할 수 있어 1회 재시도
      emit(`⚠ 로그인 재시도: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
      session = await openLoginWindow(s.email, s.password, (m) => emit(`▸ ${m}`));
    }
    const client = createClient({ getToken: session.getToken, refreshToken: session.refreshToken });
    const out = await runDaily(client, {
      say: (l) => emit(l),
      setStatus: (m) => emit(`▸ ${m}`),
      truncate: (t, n) => (t.length > n ? t.slice(0, n) + '…' : t),
    });
    emit(out.result === 'already_done' ? `✅ 이미 완료됨 (${out.dateLabel})` : `✅ 계획+회고 완료 (${out.dateLabel})`);
    saveSettings({ lastRun: { date: out.dateLabel, result: out.result, at: new Date().toISOString() } });
    return out;
  } catch (err) {
    saveSettings({ lastRun: { date: todayKST(), result: 'error', at: new Date().toISOString(), message: err.message } });
    throw err;
  } finally {
    session?.close();
    running = false;
    send('status', { running: false });
  }
}

function launchSpec() {
  // 개발 중엔 electron <앱폴더>, 배포본은 앱 실행파일 자체를 --auto로 호출
  const appDir = join(here, '..');
  return process.defaultApp
    ? { args: [process.execPath, appDir, '--auto'], cwd: appDir }
    : { args: [process.execPath, '--auto'], cwd: dirname(process.execPath) };
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body }).show();
}

function createWindow() {
  win = new BrowserWindow({
    show: false, width: Math.min(1280, screen.getPrimaryDisplay().workAreaSize.width), height: Math.min(900, screen.getPrimaryDisplay().workAreaSize.height), minWidth: 560, minHeight: 640,
    title: 'Auto Newrrow',
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 20 } } : { autoHideMenuBar: true }),
    backgroundColor: '#ffffff',
    webPreferences: { preload: join(here, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.loadFile(join(here, 'index.html'));
}

if (AUTO || SELFTEST) {
  const logFile = join(app.getPath('userData'), 'auto.log');
  const origLog = console.log, origErr = console.error;
  const tee = (fn) => (...a) => { fn(...a); try { appendFileSync(logFile, a.join(' ') + '\n'); } catch {} };
  console.log = tee(origLog); console.error = tee(origErr);
  // 키체인 팝업 등으로 아무도 못 보는 곳에서 영원히 멈추는 것을 방지
  setTimeout(() => {
    console.error('❌ 자동 실행 시간 초과 (15분) — 키체인 접근 팝업 등으로 멈췄는지 확인해 주세요');
    if (AUTO) notify('Auto Newrrow 실패', '15분 안에 끝나지 않았어요. 앱을 열어 키체인 접근을 "항상 허용"해 주세요');
    setTimeout(() => app.exit(1), 1000);
  }, 15 * 60 * 1000).unref();
  app.whenReady().then(async () => {
    let code = 0;
    try {
      if (SELFTEST && process.env.SELFTEST_EMAIL) saveSettings({ email: process.env.SELFTEST_EMAIL, password: process.env.SELFTEST_PASSWORD, geminiKey: process.env.SELFTEST_GEMINI });
      console.log(`[${new Date().toISOString()}] 자동 계획+회고 시작`);
      const out = await runJob((l) => console.log(l));
      if (AUTO) notify('Auto Newrrow', out.result === 'already_done' ? '오늘은 이미 완료되어 있어요' : '오늘 계획·회고를 완료했어요');
    } catch (err) {
      console.error('❌ 자동 실행 실패:', err.message);
      if (AUTO) notify('Auto Newrrow 실패', err.message);
      code = 1;
    }
    setTimeout(() => app.exit(code), AUTO ? 1500 : 0);
  });
} else {
  if (!app.requestSingleInstanceLock()) app.quit();
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  ipcMain.handle('settings:get', () => {
    const s = loadSettings();
    return { email: s.email, hasPassword: !!s.password, hasGeminiKey: !!s.geminiKey, hasOpenaiKey: !!s.openaiKey, aiProvider: s.aiProvider, dailyTime: s.dailyTime, lastRun: s.lastRun ?? null };
  });
  ipcMain.handle('settings:save', (_e, patch) => {
    const clean = {};
    for (const k of ['email', 'password', 'geminiKey', 'openaiKey', 'dailyTime']) if (typeof patch[k] === 'string' && patch[k].trim() !== '') clean[k] = patch[k].trim();
    if (patch.aiProvider === 'gemini' || patch.aiProvider === 'openai') clean.aiProvider = patch.aiProvider;
    saveSettings(clean);
    return true;
  });
  ipcMain.handle('job:run', async () => {
    try {
      const out = await runJob((l) => send('log', { time: stamp(), text: l }));
      return { ok: true, result: out.result };
    } catch (err) {
      send('log', { time: stamp(), text: `❌ ${err.message}` });
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('daily:get', () => ({ on: isDailyInstalled(), time: loadSettings().dailyTime }));
  ipcMain.handle('daily:set', (_e, on, time) => {
    try {
      if (on) { saveSettings({ dailyTime: time }); return { ok: true, message: installDaily(time, launchSpec()) }; }
      return { ok: true, message: uninstallDaily() };
    } catch (err) { return { ok: false, message: err.message }; }
  });

  let lastUpdate = null;
  ipcMain.handle('update:check', async () => {
    lastUpdate = await checkForUpdate(app.getVersion());
    return { version: app.getVersion(), update: lastUpdate?.hasUpdate ? { latest: lastUpdate.latest, canInstall: !!lastUpdate.assetUrl, pageUrl: lastUpdate.pageUrl } : null };
  });
  ipcMain.handle('update:install', async () => {
    try {
      if (!lastUpdate?.hasUpdate) throw new Error('받을 업데이트가 없어요');
      const bundle = app.isPackaged ? currentBundlePath() : null;
      if (lastUpdate.zipUrl && canReplaceInPlace(bundle)) {
        await stageInPlaceUpdate(lastUpdate.zipUrl, lastUpdate.zipName, bundle, (p) => send('update:progress', p));
        send('update:progress', 'installing');
        setTimeout(() => app.quit(), 800); // 종료되면 교체 스크립트가 앱을 바꾸고 다시 실행함
        return { ok: true, opened: 'replace' };
      }
      if (!lastUpdate.assetUrl) { await shell.openExternal(lastUpdate.pageUrl); return { ok: true, opened: 'page' }; }
      const file = await downloadAsset(lastUpdate.assetUrl, lastUpdate.assetName, app.getPath('downloads'), (p) => send('update:progress', p));
      await shell.openPath(file);
      return { ok: true, opened: 'dmg', file };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
