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
const { openLoginWindow, waitForNetwork } = await import('./login.js');
const { createClient, todayKST } = await import('../lib/client.js');
const { runDaily } = await import('../lib/core.js');
const { parseSchool } = await import('../lib/school.js');
const { installDaily, uninstallDaily, isDailyInstalled, DAILY_OFFSETS_H } = await import('../lib/daily.js');
const { fetchReleaseNotes, checkForUpdate, downloadAsset, currentBundlePath, canReplaceInPlace, stageInPlaceUpdate } = await import('./update.js');

let win = null;
let running = false;

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
const stamp = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

// 실행 기록: 최근 15건과 각 실행의 로그(최대 60줄)를 저장
function addHistory(entry) {
  saveSettings({ history: [entry, ...(loadSettings().history ?? [])].slice(0, 15) });
}

// 여러 날짜를 한 번의 로그인으로 처리 (날짜가 하나면 실패 시 그대로 오류를 던짐)
async function runJob(emitRaw, dates = [todayKST()]) {
  const buf = [];
  const emit = (l, detail) => { buf.push(l); emitRaw(l, detail); };
  const startedAt = new Date().toISOString();
  const trigger = AUTO ? 'auto' : 'manual';
  const record = (entry, from = 0) => addHistory({ at: startedAt, trigger, ...entry, log: buf.slice(from).slice(-60).join('\n') });
  if (running) throw new Error('이미 실행 중이에요');
  const s = loadSettings();
  const prov = ['openai', 'claude'].includes(s.aiProvider) ? s.aiProvider : 'gemini';
  const keyLabel = { gemini: 'Gemini API 키', openai: 'OpenAI API 키', claude: 'Claude 토큰' }[prov];
  const custom = s.school === 'custom';
  const missing = [custom && !s.schoolUrl && '학교 주소', !s.email && '이메일', !s.password && '비밀번호', !s[`${prov}Key`] && keyLabel].filter(Boolean);
  if (missing.length) throw new Error(`설정이 비어 있어요: ${missing.join(', ')}`);
  process.env.NEWRROW_SCHOOL_URL = custom ? s.schoolUrl : '';
  parseSchool(process.env.NEWRROW_SCHOOL_URL); // 주소 형식이 틀리면 여기서 안내 메시지로 중단
  process.env.AI_PROVIDER = prov;
  process.env.GEMINI_API_KEY = s.geminiKey;
  process.env.OPENAI_API_KEY = s.openaiKey;
  process.env.CLAUDE_CODE_OAUTH_TOKEN = s.claudeKey;
  running = true;
  send('status', { running: true });
  let session;
  try {
    await waitForNetwork((m) => emit(`▸ ${m}`));
    try {
      session = await openLoginWindow(s.email, s.password, (m) => emit(`▸ ${m}`), { show: !!s.showBrowser });
    } catch (err) {
      if (err.code === 'BAD_CREDENTIALS') throw err;
      // 앱 첫 실행 직후엔 내장 네트워크 서비스가 한 번 재시작되며 로그인이 실패할 수 있어 1회 재시도
      emit(`⚠ 로그인 재시도: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
      session = await openLoginWindow(s.email, s.password, (m) => emit(`▸ ${m}`), { show: !!s.showBrowser });
    }
    const client = createClient({ getToken: session.getToken, refreshToken: session.refreshToken });
    const failed = [];
    let out;
    for (const date of dates) {
      const from = buf.length;
      if (dates.length > 1) emit(`── ${date} ──`);
      try {
        out = await runDaily(client, {
          say: (l, detail) => emit(l, detail),
          setStatus: (m) => emit(`▸ ${m}`),
          truncate: (t, n) => (t.length > n ? t.slice(0, n) + '…' : t),
          date,
        });
        emit(out.result === 'already_done' ? `✅ 이미 완료됨 (${out.dateLabel})` : `✅ 계획+회고 완료 (${out.dateLabel})`);
        if (date === todayKST()) saveSettings({ lastRun: { date: out.dateLabel, result: out.result, at: new Date().toISOString() } });
        record({ date, result: out.result }, from);
      } catch (err) {
        if (dates.length === 1) throw err;
        emit(`❌ ${date}: ${err.message}`);
        failed.push(date);
        record({ date, result: 'error', message: err.message }, from);
      }
    }
    if (dates.length === 1) return out;
    emit(failed.length ? `⚠ ${dates.length}일 중 ${failed.length}일 실패: ${failed.join(', ')}` : `✅ ${dates.length}일 처리 완료`);
    return { result: failed.length ? 'error' : 'done', failed };
  } catch (err) {
    if (dates[0] === todayKST()) saveSettings({ lastRun: { date: todayKST(), result: 'error', at: new Date().toISOString(), message: err.message } });
    record({ date: dates[0], result: 'error', message: err.message });
    throw err;
  } finally {
    session?.close();
    running = false;
    send('status', { running: false });
  }
}

// 자동 실행(기준 시각, +4시간, +12시간) 중 지금이 마지막 시도인지 — 가장 가까운 시각 기준
function isLastAttempt() {
  const [h, m] = String(loadSettings().dailyTime || '08:30').split(':').map(Number);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let best = null;
  for (const off of DAILY_OFFSETS_H) {
    const d = Math.abs(nowMin - (((h + off) % 24) * 60 + m));
    const dist = Math.min(d, 1440 - d);
    if (!best || dist < best.dist) best = { dist, off };
  }
  return best.off === Math.max(...DAILY_OFFSETS_H);
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
      if (SELFTEST && process.env.SELFTEST_EMAIL) saveSettings({ email: process.env.SELFTEST_EMAIL, password: process.env.SELFTEST_PASSWORD, geminiKey: process.env.SELFTEST_GEMINI, showBrowser: process.env.SELFTEST_SHOW === '1' });
      console.log(`[${new Date().toISOString()}] 자동 계획+회고 시작`);
      const out = await runJob((l) => console.log(l));
      if (AUTO && out.result !== 'already_done') notify('Auto Newrrow', '오늘 계획·회고를 완료했어요');
    } catch (err) {
      console.error('❌ 자동 실행 실패:', err.message);
      // 하루 3번 시도 중 마지막 시도까지 실패했을 때만 알림 (앞선 시도는 다음 시도가 이어서 처리)
      if (AUTO && isLastAttempt()) notify('Auto Newrrow 오늘 자동 실행 실패', err.message);
      code = 1;
    }
    setTimeout(() => app.exit(code), AUTO ? 1500 : 0);
  });
} else {
  if (!app.requestSingleInstanceLock()) app.quit();
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  ipcMain.handle('history:get', () => loadSettings().history ?? []);
  ipcMain.handle('settings:get', () => {
    const s = loadSettings();
    return { email: s.email, hasPassword: !!s.password, hasGeminiKey: !!s.geminiKey, hasOpenaiKey: !!s.openaiKey, hasClaudeKey: !!s.claudeKey, aiProvider: s.aiProvider, school: s.school, schoolUrl: s.schoolUrl, showBrowser: !!s.showBrowser, dailyTime: s.dailyTime, lastRun: s.lastRun ?? null };
  });
  ipcMain.handle('settings:save', (_e, patch) => {
    const clean = {};
    for (const k of ['email', 'password', 'geminiKey', 'openaiKey', 'claudeKey', 'schoolUrl', 'dailyTime']) if (typeof patch[k] === 'string' && patch[k].trim() !== '') clean[k] = patch[k].trim();
    if (['gemini', 'openai', 'claude'].includes(patch.aiProvider)) clean.aiProvider = patch.aiProvider;
    if (patch.school === 'dgsm' || patch.school === 'custom') clean.school = patch.school;
    if (clean.schoolUrl) parseSchool(clean.schoolUrl); // 형식이 틀리면 저장 전에 오류
    if (typeof patch.showBrowser === 'boolean') clean.showBrowser = patch.showBrowser;
    saveSettings(clean);
    return true;
  });
  ipcMain.handle('job:range', async (_e, from, to, skipWeekend) => {
    try {
      const ok = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
      if (!ok(from) || !ok(to) || from > to) throw new Error('기간이 올바르지 않아요 (시작일이 종료일보다 늦어요)');
      const dates = [];
      for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 864e5) {
        const d = new Date(t);
        if (skipWeekend && [0, 6].includes(d.getUTCDay())) continue;
        dates.push(d.toISOString().slice(0, 10));
      }
      if (!dates.length) throw new Error('처리할 날짜가 없어요');
      if (dates.length > 31) throw new Error('한 번에 최대 31일까지만 처리해요');
      const out = await runJob((l, detail) => send('log', { time: stamp(), text: l, detail }), dates);
      return { ok: out.result !== 'error', result: out.result };
    } catch (err) {
      send('log', { time: stamp(), text: `❌ ${err.message}` });
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('job:run', async (_e, date) => {
    try {
      if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('날짜 형식이 올바르지 않아요');
      const out = await runJob((l, detail) => send('log', { time: stamp(), text: l, detail }), [date || todayKST()]);
      return { ok: true, result: out.result };
    } catch (err) {
      send('log', { time: stamp(), text: `❌ ${err.message}` });
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('daily:get', () => ({ on: isDailyInstalled(), time: loadSettings().dailyTime }));
  ipcMain.handle('daily:set', (_e, on, time) => {
    try {
      // dmg 안(/Volumes)이나 임시 격리 경로(AppTranslocation)에서 실행 중이면 그 경로가 곧 사라져 자동 실행이 깨짐
      if (on && process.platform === 'darwin' && app.isPackaged && /^\/Volumes\/|\/AppTranslocation\//.test(process.execPath)) {
        return { ok: false, message: '앱을 Applications 폴더로 옮긴 뒤 다시 켜 주세요 (지금은 dmg 안에서 실행 중이에요)' };
      }
      if (on) { saveSettings({ dailyTime: time }); return { ok: true, message: installDaily(time, launchSpec()) }; }
      return { ok: true, message: uninstallDaily() };
    } catch (err) { return { ok: false, message: err.message }; }
  });

  // dmg 안(읽기 전용)이나 임시 격리 경로에서 실행 중인지 — 이 상태에선 스스로 업데이트/자동 실행 등록을 할 수 없음
  const FROM_DMG = process.platform === 'darwin' && app.isPackaged && /^\/Volumes\/|\/AppTranslocation\//.test(process.execPath);
  ipcMain.handle('env:info', () => ({ fromDmg: FROM_DMG }));
  ipcMain.handle('env:openApplications', () => shell.openPath('/Applications'));

  // 도움말의 외부 링크 — 허용된 주소만 열기
  const ALLOWED_LINKS = [/^https:\/\/aistudio\.google\.com\//, /^https:\/\/platform\.openai\.com\//, /^https:\/\/docs\.claude\.com\//, /^https:\/\/github\.com\/dowan2010\/auto-newrrow\//];
  ipcMain.handle('open:external', (_e, url) => {
    if (typeof url === 'string' && ALLOWED_LINKS.some((re) => re.test(url))) { shell.openExternal(url); return true; }
    return false;
  });

  // 업데이트 직후 첫 실행이면 이번 버전 변경 내용을 알려줌 (처음 설치한 경우는 제외)
  ipcMain.handle('whatsnew:get', async () => {
    const s = loadSettings();
    const version = app.getVersion();
    if (s.lastSeenVersion === version) return null;
    if (!s.lastSeenVersion && !s.email) { saveSettings({ lastSeenVersion: version }); return null; }
    const notes = await fetchReleaseNotes(version);
    if (notes === null) return null; // 오프라인 등 — 다음 실행 때 다시 시도
    saveSettings({ lastSeenVersion: version });
    return notes ? { version, notes } : null;
  });

  let lastUpdate = null;
  ipcMain.handle('update:check', async () => {
    lastUpdate = await checkForUpdate(app.getVersion());
    if (FROM_DMG) return { version: app.getVersion(), update: null };
    return { version: app.getVersion(), update: lastUpdate?.hasUpdate ? { latest: lastUpdate.latest, canInstall: !!lastUpdate.assetUrl, pageUrl: lastUpdate.pageUrl, notes: lastUpdate.notes } : null };
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
      const openErr = await shell.openPath(file);
      if (openErr) throw new Error(openErr);
      if (process.platform === 'win32') {
        // 설치 프로그램이 실행 중인 앱 파일을 교체할 수 있게 앱을 종료함 (설치가 끝나면 설치 프로그램이 다시 실행해 줌)
        send('update:progress', 'installing');
        setTimeout(() => app.quit(), 1500);
        return { ok: true, opened: 'replace' };
      }
      return { ok: true, opened: 'dmg', file };
    } catch (err) { return { ok: false, error: err.message }; }
  });

  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}
