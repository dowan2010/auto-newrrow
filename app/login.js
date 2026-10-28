import { BrowserWindow, session } from 'electron';

const HOME_URL = 'https://dgsm.newrrow.com/csr-platform/agent-home?mode=reflection';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 보이지 않는 창으로 로그인해서 API 토큰을 확보 (Playwright 없이 Electron 내장 Chromium 사용)
export async function openLoginWindow(email, password, onProgress = () => {}, { show = false } = {}) {
  const ses = session.fromPartition(`login-${Date.now()}`);
  let token = null;
  let loginPosted = false;
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://api-agw.newrrow.com/*'] }, (details, cb) => {
    const a = details.requestHeaders.Authorization ?? details.requestHeaders.authorization;
    if (a?.startsWith('Bearer ')) token = a.slice(7);
    cb({ requestHeaders: details.requestHeaders });
  });
  ses.webRequest.onBeforeRequest({ urls: ['https://auth.inhrplus.com/api/v1/universal-login/login*'] }, (details, cb) => {
    if (details.method === 'POST') loginPosted = true;
    cb({});
  });

  const win = new BrowserWindow({
    show, width: 1280, height: 800, title: 'Auto Newrrow — 뉴로우 로그인',
    webPreferences: { session: ses, backgroundThrottling: false, contextIsolation: true },
  });
  const close = () => { if (!win.isDestroyed()) win.destroy(); };
  const url = () => (win.isDestroyed() ? '' : win.webContents.getURL());
  const run = (code) => win.webContents.executeJavaScript(code, true);

  try {
    onProgress('뉴로우 접속 중...');
    win.loadURL(HOME_URL).catch(() => {});
    let logins = 0;
    const deadline = Date.now() + 90000;
    while (!token && Date.now() < deadline) {
      await sleep(700);
      if (url().includes('inhrplus.com') && logins < 3) {
        const hasForm = await run(`!!document.getElementById('accountId') && document.readyState === 'complete'`).catch(() => false);
        if (!hasForm) continue;
        logins++;
        onProgress('로그인 중...');
        await sleep(1500); // 로그인 스크립트가 붙기 전에 누르면 아무 일도 안 일어남
        loginPosted = false;
        for (let attempt = 0; attempt < 3 && !loginPosted; attempt++) {
          await run(`(() => {
            const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
            set(document.getElementById('accountId'), ${JSON.stringify(email)});
            set(document.getElementById('accountPassword'), ${JSON.stringify(password)});
            document.getElementById('loginSubmit').click();
          })()`).catch(() => {});
          for (let i = 0; i < 12 && !loginPosted; i++) await sleep(250);
        }
        await sleep(2500);
        if (!token) win.loadURL(HOME_URL).catch(() => {});
      }
    }
    if (!token) throw new Error('로그인 실패 — 이메일/비밀번호를 확인해 주세요');
    onProgress('로그인 성공');

    // 토큰 수명이 짧아(약 9분) 401이면 새로고침해서 새 토큰을 받아옴
    const refreshToken = async () => {
      const old = token;
      win.webContents.reload();
      for (let i = 0; i < 40 && token === old; i++) await sleep(500);
    };
    return { getToken: () => token, refreshToken, close };
  } catch (err) {
    close();
    throw err;
  }
}
