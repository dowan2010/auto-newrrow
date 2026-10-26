import { chromium } from 'playwright';
import { login } from '../automation.js';
import { createClient, todayKST } from './client.js';

const HOME_URL = 'https://dgsm.newrrow.com/csr-platform/agent-home?mode=reflection';

// Playwright로 로그인해 토큰을 확보하고, 이후는 API 클라이언트로 처리 (CLI용)
export async function openAgentSession(email, password, { silent = true, onProgress = async () => {} } = {}) {
  const isHeadless = process.env.HEADLESS !== 'false';
  const browser = await chromium.launch({
    headless: isHeadless,
    args: isHeadless ? ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] : [],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    let token = null;
    page.on('request', (r) => {
      const a = r.headers()['authorization'];
      if (a?.startsWith('Bearer ')) token = a.slice(7);
    });

    await onProgress('뉴로우 접속 중...');
    await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    let logins = 0;
    const deadline = Date.now() + 90000;
    while (!token && Date.now() < deadline) {
      await page.waitForTimeout(500);
      if (page.url().includes('inhrplus.com') && logins < 3) {
        logins++;
        await onProgress('로그인 중...');
        await login(page, email, password, silent);
        await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      }
    }
    if (!token) throw new Error('로그인 후 토큰을 얻지 못함');
    await onProgress('로그인 성공');

    // 토큰 수명이 짧아(약 9분) 401이면 페이지를 새로고침해서 새 토큰을 받아옴
    const refreshToken = async () => {
      const old = token;
      await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
      for (let i = 0; i < 40 && token === old; i++) await page.waitForTimeout(500);
    };

    const client = createClient({ getToken: () => token, refreshToken, onProgress });
    return { ...client, close: () => browser.close() };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

export async function submitReflection(text, email, password, topic, date, onProgress = async () => {}, onWarning = async () => {}, thankConfig, silent = true) {
  if (date && date !== todayKST()) throw new Error('날짜 지정 회고는 새 뉴로우 방식에서 지원 안 됨 (오늘만 가능)');
  const session = await openAgentSession(email, password, { silent, onProgress });
  try {
    return await session.reflect(text);
  } finally {
    await session.close();
  }
}
