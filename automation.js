import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import 'dotenv/config';

const DATA_DIR = '.';

// Playwright 에러 → 간결한 한국어 메시지
function stepError(step, err) {
  const msg = err?.message ?? String(err);
  // Playwright timeout: "locator.waitFor: Timeout 20000ms exceeded.\nCall log:\n  - waiting for..."
  const timeoutMatch = msg.match(/Timeout (\d+)ms exceeded/);
  if (timeoutMatch) {
    const waitingFor = msg.match(/waiting for (.+?)(?:\n|$)/)?.[1] ?? '요소';
    return new Error(`[${step}] 시간 초과 — ${waitingFor}`);
  }
  return new Error(`[${step}] ${msg.split('\n')[0]}`);
}
mkdirSync(DATA_DIR, { recursive: true });


// 로그인 안내 팝업이 있으면 닫기 (portal 렌더링이라 page 전체에서 탐색)
export async function dismissLoginPopup(page, silent = false) {
  const log = silent ? () => {} : console.log.bind(console);
  try {
    const popup = await page.waitForSelector('[class*="loginHistoryPopup-module__popup"]', { timeout: 4000 });
    if (!popup) return;
    log('로그인 팝업 감지 — 닫는 중...');

    // 푸터 확인 버튼 클릭 시도 1: 클래스 선택자
    let clicked = false;
    try {
      const btn = page.locator('[class*="loginHistoryPopupFooter-module__footer"] button').last();
      await btn.waitFor({ state: 'visible', timeout: 2000 });
      await btn.click();
      clicked = true;
    } catch { /* 무시 */ }

    // 시도 2: popup 안의 마지막 버튼
    if (!clicked) {
      try {
        const btn = page.locator('[class*="loginHistoryPopup-module__popup"] button').last();
        await btn.waitFor({ state: 'visible', timeout: 2000 });
        await btn.click();
        clicked = true;
      } catch { /* 무시 */ }
    }

    // 시도 3: page.evaluate 로 직접
    if (!clicked) {
      await page.evaluate(() => {
        const popup = document.querySelector('[class*="loginHistoryPopup-module__popup"]');
        const btns = popup?.querySelectorAll('button');
        if (btns?.length) btns[btns.length - 1].click();
      });
    }

    log('로그인 팝업 닫힘 — aria-hidden 해제 대기 중...');
    // #root 의 aria-hidden 이 풀릴 때까지 대기
    await page.waitForFunction(
      () => !document.querySelector('#root')?.hasAttribute('aria-hidden'),
      { timeout: 6000 }
    );
    // 팝업 DOM 에서 완전히 제거될 때까지 대기
    await page.waitForFunction(
      () => !document.querySelector('[class*="loginHistoryPopup-module__popup"]'),
      { timeout: 2000 }
    ).catch(() => {});
    log('팝업 해제 완료');
  } catch {
    // 팝업 없으면 조용히 통과
  }
}

export async function login(page, email, password, silent = false, onDebug = async () => {}) {
  const log = silent ? () => {} : console.log.bind(console);
  log('로그인 중... 현재 URL:', page.url());

  const EMAIL_SEL = '#accountId, input[type="email"], input[name="username"], input[name="email"]';
  const PW_SEL = '#accountPassword, input[type="password"]';
  const SUBMIT_SEL = '#loginSubmit, button[type="submit"]';

  let frame = page.mainFrame();
  for (const f of page.frames()) {
    if (f === page.mainFrame()) continue;
    const cnt = await f.locator(EMAIL_SEL).count().catch(() => 0);
    if (cnt > 0) {
      frame = f;
      log('[login] 로그인 폼 iframe 내 발견:', f.url());
      break;
    }
  }

  const emailInput = frame.locator(EMAIL_SEL).first();
  const pwInput = frame.locator(PW_SEL).first();
  const submitBtn = frame.locator(SUBMIT_SEL).first();

  await emailInput.waitFor({ state: 'visible', timeout: 10000 }).catch(e => { throw stepError('로그인 폼 로딩', e); });
  log('[login] 로그인 폼 발견 — 입력 중...');
  // fill()은 React controlled input에 직접 값 주입 (keystroke 없음, 즉각)
  await emailInput.fill(email);
  await pwInput.fill(password);

  // 클릭 직전 실제 상태 확인 (값이 제대로 들어갔는지, 버튼이 비활성 상태는 아닌지)
  const preClickState = await frame.evaluate(() => {
    const e = document.getElementById('accountId');
    const p = document.getElementById('accountPassword');
    const b = document.getElementById('loginSubmit');
    return {
      emailLen: e?.value?.length ?? null,
      pwLen: p?.value?.length ?? null,
      btnDisabled: b?.disabled ?? null,
      btnVisible: b ? b.offsetParent !== null : null,
    };
  }).catch(() => null);
  log('[login] 클릭 직전 상태:', JSON.stringify(preClickState));
  await onDebug(`클릭 직전: email=${preClickState?.emailLen} pw=${preClickState?.pwLen} disabled=${preClickState?.btnDisabled} visible=${preClickState?.btnVisible}`);

  // 제출 버튼 셀렉터가 사이트 변경 등으로 안 맞을 경우 대비 — 버튼 클릭 실패해도
  // 비밀번호 입력창에서 Enter로 폼 제출 시도
  // 폼이 보여도 로그인 스크립트(jQuery 핸들러)가 아직 안 붙어 있으면 클릭해도 POST가 안 나가고
  // 아무 일도 안 일어남 — 로드 완료를 기다린 뒤 클릭하고, 로그인 POST가 안 나갔으면 다시 클릭
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  let loginPosted = false;
  const onReq = (r) => { if (r.method() === 'POST' && r.url().includes('/universal-login/login')) loginPosted = true; };
  page.on('request', onReq);
  let clicked = false;
  for (let attempt = 0; attempt < 3 && !loginPosted; attempt++) {
    clicked = await submitBtn.click({ timeout: 5000 }).then(() => true).catch(() => false);
    if (!clicked) break;
    for (let i = 0; i < 8 && !loginPosted; i++) await page.waitForTimeout(250);
  }
  page.off('request', onReq);
  log('[login] 버튼 클릭 성공 여부:', clicked, '/ 로그인 요청 전송:', loginPosted);
  if (!clicked) {
    log('[login] 제출 버튼 클릭 실패 — Enter로 재시도');
    await onDebug('버튼 클릭 실패 — Enter로 재시도');
    await pwInput.press('Enter').catch(() => {});
  }

  // 클릭 직후 URL이 실제로 바뀌기 시작했는지 짧게 확인 (제자리인지 진행 중인지)
  await page.waitForTimeout(300);
  log('[login] 클릭 직후 URL:', page.url());
  await onDebug(`클릭 직후 URL: ${new URL(page.url()).host}`);
  log('[login] 로그인 폼 제출 완료');

  // URL 폴링으로 로그인 결과 확인 (최대 60초)
  let result = 'timeout';
  for (let i = 0; i < 120; i++) {
    await page.waitForTimeout(500);
    const url = page.url();
    const body = await page.evaluate(() => document.body?.textContent ?? '').catch(() => '');
    if (url.includes('/csr-platform/') || url.includes('newrrow.com/csr')) {
      result = 'success';
      break;
    }
    if (body.includes('일치하지 않습니다')) {
      result = 'invalid_credentials';
      break;
    }
  }

  if (result === 'invalid_credentials') {
    const err = new Error('이메일 또는 비밀번호가 올바르지 않아요. `/변경` 으로 계정 정보를 수정해주세요.');
    err.code = 'INVALID_CREDENTIALS';
    throw err;
  }
  if (result === 'timeout') throw new Error('로그인 시간 초과');

  // OAuth 콜백 처리 후 React 앱이 localStorage/cookie에 세션 토큰을 쓸 때까지 대기
  // URL이 csr-platform에 도달한 직후 storageState를 저장하면 토큰이 아직 미기록 상태로
  // 저장되어 다음 goto에서 다시 로그인 페이지로 튕기는 문제가 발생함
  // React 앱이 세션 토큰을 localStorage/cookie에 쓸 때까지 대기
  // (#root 렌더링 완료로 충분 — networkidle은 SPA에서 너무 오래 걸림)
  await page.waitForFunction(() => {
    const root = document.querySelector('#root');
    return root && root.children.length > 0 && !root.hasAttribute('aria-hidden');
  }, { timeout: 10000 }).catch(() => {});
  log('로그인 성공');
}

export async function resetReflection(email, password, date = null, silent = false) {
  const targetDate = date ?? new Date(Date.now() + 9 * 3600e3).toISOString().split('T')[0];
  const { browser, page, token } = await _loginAndGetPage(email, password, silent);
  try {
    if (!token) throw new Error('토큰 캡처 실패');
    const headers = { Authorization: `Bearer ${token}`, Tenant: 'dgsm', Accept: 'application/json' };
    const found = await page.request.get(`https://api-agw.newrrow.com/main/api/v1/daily-reflections?date=${targetDate}`, { headers });
    const id = (await found.json().catch(() => null))?.contents?.id;
    if (!id) throw new Error(`${targetDate} 회고를 찾을 수 없음`);
    const res = await page.request.delete(`https://api-agw.newrrow.com/main/api/v1/daily-reflections/${id}`, { headers });
    if (!res.ok()) throw new Error(`DELETE 실패 (status=${res.status()})`);
    return { reflectionId: String(id), date: targetDate };
  } finally {
    await browser.close();
  }
}

export async function getTasksWithToken(email, password, silent = false) {
  const isHeadless = process.env.HEADLESS !== 'false';
  const browser = await chromium.launch({
    headless: isHeadless,
    args: isHeadless ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : [],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  let token = null;
  let tasksFromResponse = null;
  page.on('request', req => {
    if (!req.url().includes('api-agw')) return;
    const auth = req.headers()['authorization'];
    if (auth?.startsWith('Bearer ')) token = auth.slice(7);
  });
  page.on('response', async res => {
    if (!res.url().includes('my-tasks')) return;
    try { tasksFromResponse = await res.json(); } catch {}
  });

  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
  const tokenPage = 'https://dgsm.newrrow.com/csr-platform/agent-home?mode=reflection';

  try {
    await page.goto(tokenPage, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForURL(
      url => url.includes('inhrplus.com') || url.includes('/csr-platform/'),
      { timeout: 10000 }
    ).catch(() => {});
    if (page.url().includes('login') || page.url().includes('inhrplus.com')) {
      await login(page, email, password, silent);
      await page.goto(tokenPage, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForURL(url => url.includes('/csr-platform/'), { timeout: 10000 }).catch(() => {});
    }
    await dismissLoginPopup(page, silent);

    const deadline = Date.now() + 12000;
    while (!token && Date.now() < deadline) {
      await page.waitForTimeout(500);
      const curUrl = page.url();
      if (curUrl.includes('inhrplus.com') || curUrl.includes('/login')) {
        await login(page, email, password, silent);
        await page.goto(tokenPage, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForURL(url => url.includes('/csr-platform/'), { timeout: 10000 }).catch(() => {});
        await dismissLoginPopup(page, silent);
      }
    }

    if (!token) throw new Error('토큰 캡처 실패');

    // tasks 페이지로 이동해서 API 호출 유도 (response interceptor가 캡처)
    if (!tasksFromResponse) {
      await page.goto('https://dgsm.newrrow.com/csr-platform/my-task', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(4000);
    }

    // 그래도 없으면 브라우저 컨텍스트에서 직접 호출 (올바른 도메인: api-agw.newrrow.com)
    if (!tasksFromResponse) {
      tasksFromResponse = await page.evaluate(async (tok) => {
        const res = await fetch('https://api-agw.newrrow.com/main/api/v2/my-tasks/csr', {
          headers: {
            'Authorization': `Bearer ${tok}`,
            'Tenant': 'dgsm',
            'Accept': 'application/json, text/plain, */*',
          },
        });
        return res.json();
      }, token);
    }

    const rawTasks = tasksFromResponse?.contents?.tasks ?? tasksFromResponse?.contents ?? tasksFromResponse?.data?.tasks ?? tasksFromResponse?.tasks ?? [];
    const tasks = (Array.isArray(rawTasks) ? rawTasks : []).filter(t => t.taskId != null || t.id != null);

    const cookies = await context.cookies();
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    return { token, tasks, cookieHeader };
  } finally {
    await browser.close();
  }
}

async function _loginAndGetPage(email, password, silent = false) {
  const log = silent ? () => {} : console.log.bind(console);
  const isHeadless = process.env.HEADLESS !== 'false';
  const browser = await chromium.launch({
    headless: isHeadless,
    args: isHeadless ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : [],
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  let token = null;
  page.on('request', req => {
    const auth = req.headers()['authorization'];
    if (auth?.startsWith('Bearer ')) token = auth.slice(7);
  });

  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().split('T')[0];
  const tokenPage = 'https://dgsm.newrrow.com/csr-platform/agent-home?mode=reflection';

  await page.goto(tokenPage, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // 세션이 없으면 SPA가 늦게 로그인 페이지로 보내므로, 토큰이 잡힐 때까지 기다리며 필요 시 로그인
  let logins = 0;
  const loginDeadline = Date.now() + 90000;
  while (!token && Date.now() < loginDeadline) {
    await page.waitForTimeout(500);
    if (page.url().includes('inhrplus.com') && logins < 3) {
      logins++;
      await login(page, email, password, silent);
      await page.goto(tokenPage, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
  }
  await dismissLoginPopup(page, silent);

  // token 캡처 대기 (최대 8초)
  const deadline = Date.now() + 8000;
  while (!token && Date.now() < deadline) await page.waitForTimeout(500);

  // 그래도 없으면 my-task 페이지로 이동해 API 요청 유도
  if (!token) {
    await page.goto('https://dgsm.newrrow.com/csr-platform/my-task', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    const d2 = Date.now() + 8000;
    while (!token && Date.now() < d2) await page.waitForTimeout(500);
  }

  log(`[_loginAndGetPage] token ${token ? '캡처 성공 ('+token.slice(0,20)+'...)' : '캡처 실패(null)'}`);
  return { browser, page, token };
}

// 브라우저 컨텍스트 안에서 API 호출 (page.request — CORS 우회, 쿠키 포함)
async function _contextPost(page, token, url, body) {
  const res = await page.request.post(url, {
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Tenant': 'dgsm',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    },
    data: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status(), data };
}

export async function browserCreateTask(email, password, title, silent = false) {
  const { browser, page, token } = await _loginAndGetPage(email, password, silent);
  try {
    return await _contextPost(page, token, 'https://api-agw.newrrow.com/main/api/v1/tasks', { goalId: null, title });
  } finally {
    await browser.close();
  }
}

export async function browserCreateSchedule(email, password, taskId, startDateTime, endDateTime, silent = false) {
  const { browser, page, token } = await _loginAndGetPage(email, password, silent);
  try {
    return await _contextPost(page, token, 'https://api-agw.newrrow.com/main/api/v2/schedules', {
      taskId: Number(taskId), isAllDay: false, startDateTime, endDateTime,
      endType: 'NONE', repeatEnabled: false, repeatType: 'NONE',
    });
  } finally {
    await browser.close();
  }
}

