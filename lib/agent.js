import { chromium } from 'playwright';
import { login, resetReflection } from '../automation.js';
import { generateInterviewReply } from './ai.js';

const API_ROOT = 'https://api-agw.newrrow.com/main/api/v2/nrow/agent';
const HOME_URL = 'https://dgsm.newrrow.com/csr-platform/agent-home?mode=reflection';
const MAX_TURNS = 10;

const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().split('T')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 뉴로우 에이전트(챗봇) API 세션 — 브라우저는 로그인/토큰 확보에만 쓰고 이후는 전부 API 호출
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

    const memberId = Number(JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub);

    const call = async (method, path, data, accept = 'application/json') => {
      const res = await context.request.fetch(API_ROOT + path, {
        method,
        headers: { Authorization: `Bearer ${token}`, Tenant: 'dgsm', Accept: accept, 'Content-Type': 'application/json' },
        data: data === undefined ? undefined : JSON.stringify(data),
        timeout: 180000,
      });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      return { status: res.status(), json, text };
    };

    const waitIdle = async (chatId) => {
      await sleep(2000);
      let idle = 0;
      for (let i = 0; i < 90; i++) {
        const r = await call('GET', `/chats/${chatId}/interaction`);
        if (r.json?.contents?.processing === false) { if (++idle >= 2) return; } else idle = 0;
        await sleep(2000);
      }
      throw new Error('에이전트 응답 대기 시간 초과');
    };

    const answerForm = async (chatId, form) => {
      const answers = [];
      for (const step of form.steps ?? []) {
        for (const field of step.fields ?? []) {
          const opt = field.options?.[0];
          answers.push({ stepId: step.stepId, fieldId: field.fieldId, selectedOptionIds: opt ? [opt.optionId] : [], text: opt ? null : '네' });
        }
      }
      const r = await call('POST', `/chats/${chatId}/components/${form.componentId}/answer`, { answers });
      if (r.status !== 200) throw new Error(`선택 폼 응답 실패 (${r.status}): ${r.text.slice(0, 120)}`);
    };

    const converse = async (kind, { firstMessage, context: ctxText, panelOk, completePath, onDuplicate }) => {
      const date = todayKST();
      const created = await call('POST', '/chats', { memberId, sessionKind: kind });
      const chatId = created.json?.contents?.id;
      if (!chatId) throw new Error(`${kind} 세션 생성 실패 (${created.status}): ${created.text.slice(0, 120)}`);
      const comp = await call('GET', `/sessions/completion?date=${date}`);
      if (comp.json?.contents?.[kind.toLowerCase()]?.completed) {
        // 초기화로 서버 회고를 지워도 에이전트 세션은 "완료" 상태로 남아 같은 날 재작성이 불가능함
        if (kind === 'REFLECTION') {
          const exists = await context.request.get(`https://api-agw.newrrow.com/main/api/v1/daily-reflections?date=${date}`, {
            headers: { Authorization: `Bearer ${token}`, Tenant: 'dgsm', Accept: 'application/json' },
          });
          if (exists.status() === 400) throw new Error('오늘 회고가 초기화되어 새 방식으로는 다시 작성할 수 없어요 (내일부터 가능)');
        }
        return 'already_done';
      }

      const send = async (text) => {
        const r = await call('POST', `/chats/${chatId}/messages/stream`, {
          sessionId: String(chatId), input: text, period: 'TODAY', screenContext: {}, clientTimezone: 'Asia/Seoul',
        }, 'text/event-stream');
        if (r.status !== 200) throw new Error(`메시지 전송 실패 (${r.status}): ${r.text.slice(0, 120)}`);
        await waitIdle(chatId);
      };

      const initial = (await call('GET', `/chats/${chatId}/messages`)).json?.contents?.messages ?? [];
      if (!initial.some((m) => m.role === 'USER')) {
        await onProgress('내용 전송 중...');
        await send(firstMessage);
      }

      let duplicateRetried = false;
      for (let turn = 1; turn <= MAX_TURNS; turn++) {
        await waitIdle(chatId);
        const msgs = (await call('GET', `/chats/${chatId}/messages`)).json?.contents?.messages ?? [];
        const last = [...msgs].reverse().find((m) => m.role === 'AGENT');
        const forms = (last?.components ?? []).filter((c) => c.status === 'PENDING' && c.component?.componentType === 'FORM');
        if (forms.length) {
          await onProgress('선택 질문 응답 중...');
          for (const f of forms) await answerForm(chatId, f.component);
          continue;
        }

        const panel = (await call('GET', `/chats/${chatId}/panels/latest`)).json?.contents;
        if (panel && panelOk(panel)) {
          await onProgress('저장 중...');
          let r = await call('POST', `/chats/${chatId}${completePath}`);
          if (r.status === 400 && r.json?.code?.includes('duplicate') && onDuplicate && !duplicateRetried) {
            duplicateRetried = true;
            await onProgress('기존 회고 기록 초기화 중...');
            await onDuplicate();
            r = await call('POST', `/chats/${chatId}${completePath}`);
          }
          if (r.status === 200) return 'done';
          if (!r.text.includes('산출물')) throw new Error(`완료 처리 실패 (${r.status}): ${r.text.slice(0, 160)}`);
        }

        await onProgress(`에이전트와 대화 중... (${turn}/${MAX_TURNS})`);
        const history = msgs.slice(-6).map((m) => `${m.role === 'AGENT' ? '코치' : '나'}: ${m.content}`).join('\n');
        await send(await generateInterviewReply({ kind, context: ctxText, history }));
      }
      throw new Error(`${MAX_TURNS}턴 안에 ${kind === 'PLAN' ? '계획' : '회고'}이 확정되지 않음`);
    };

    return {
      reflect: (text) => converse('REFLECTION', {
        firstMessage: text,
        context: text,
        panelOk: (p) => p.panelType === 'REFLECTION',
        completePath: '/reflection-completion',
        onDuplicate: () => resetReflection(email, password, null, true),
      }),
      plan: (tasks) => {
        const lines = tasks.map((t, i) => `${i + 1}. ${t.name} (${t.start}부터 ${t.end}까지)`);
        const text = `오늘 할 일이에요.\n${lines.join('\n')}`;
        return converse('PLAN', {
          firstMessage: text,
          context: text,
          panelOk: (p) => p.panelType !== 'SCHEDULE',
          completePath: '/plan-completion',
        });
      },
      close: () => browser.close(),
    };
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
