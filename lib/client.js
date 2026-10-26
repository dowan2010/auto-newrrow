import { generateInterviewReply } from './ai.js';

const API = 'https://api-agw.newrrow.com/main';
const AGENT = `${API}/api/v2/nrow/agent`;
const MAX_TURNS = 14;

export const todayKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().split('T')[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 뉴로우 API 클라이언트 — 로그인 방식(Playwright/Electron)과 무관하게 토큰만 있으면 동작
// getToken(): 현재 토큰, refreshToken(): 만료(401) 시 새 토큰을 받아오는 함수
export function createClient({ getToken, refreshToken, onProgress = async () => {} }) {
  const memberId = () => Number(JSON.parse(Buffer.from(getToken().split('.')[1], 'base64url').toString()).sub);

  const raw = async (method, url, data, accept = 'application/json') => {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${getToken()}`, Tenant: 'dgsm', Accept: accept, 'Content-Type': 'application/json' },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(180000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, json, text };
  };

  const rawFull = async (...args) => {
    let r = await raw(...args);
    if (r.status === 401 && refreshToken) { await refreshToken(); r = await raw(...args); }
    return r;
  };

  const call = (method, path, data, accept) => rawFull(method, AGENT + path, data, accept);

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
    const created = await call('POST', '/chats', { memberId: memberId(), sessionKind: kind });
    const chatId = created.json?.contents?.id;
    if (!chatId) throw new Error(`${kind} 세션 생성 실패 (${created.status}): ${created.text.slice(0, 120)}`);
    const comp = await call('GET', `/sessions/completion?date=${date}`);
    if (comp.json?.contents?.[kind.toLowerCase()]?.completed) {
      // 초기화로 서버 회고를 지워도 에이전트 세션은 "완료" 상태로 남아 같은 날 재작성이 불가능함
      if (kind === 'REFLECTION') {
        const exists = await rawFull('GET', `${API}/api/v1/daily-reflections?date=${date}`);
        if (exists.status === 400) throw new Error('오늘 회고가 초기화되어 새 방식으로는 다시 작성할 수 없어요 (내일부터 가능)');
      }
      return 'already_done';
    }

    const send = async (text) => {
      // 502/503/504는 서버 일시 장애라 잠시 후 재시도하면 대부분 통과함 (실제로 계획이 이 503 한 번에 통째로 스킵되던 날이 있었음)
      let r;
      for (let attempt = 0; attempt < 6; attempt++) {
        r = await call('POST', `/chats/${chatId}/messages/stream`, {
          sessionId: String(chatId), input: text, period: 'TODAY', screenContext: {}, clientTimezone: 'Asia/Seoul',
        }, 'text/event-stream');
        if ([502, 503, 504].includes(r.status)) { await sleep(5000 * (attempt + 1)); continue; }
        // 이전 응답이 아직 생성 중인데 processing 플래그가 잠깐 false로 보인 경우
        if (r.status === 400 && r.text.includes('답변 중')) { await sleep(8000); await waitIdle(chatId); continue; }
        break;
      }
      if (r.status !== 200) throw new Error(`메시지 전송 실패 (${r.status}): ${r.text.slice(0, 120)}`);
      await waitIdle(chatId);
    };

    const initial = (await call('GET', `/chats/${chatId}/messages`)).json?.contents?.messages ?? [];
    if (!initial.some((m) => m.role === 'USER')) {
      await onProgress('내용 전송 중...');
      await send(firstMessage);
    }

    let duplicateRetried = false;
    const tryComplete = async () => {
      const panel = (await call('GET', `/chats/${chatId}/panels/latest`)).json?.contents;
      if (!panel || !panelOk(panel)) return null;
      await onProgress('저장 중...');
      let r = await call('POST', `/chats/${chatId}${completePath}`);
      if (r.status === 400 && r.json?.code?.includes('duplicate') && onDuplicate && !duplicateRetried) {
        duplicateRetried = true;
        await onProgress('기존 회고 기록 초기화 중...');
        await onDuplicate();
        r = await call('POST', `/chats/${chatId}${completePath}`);
      }
      if (r.status === 200) return 'done';
      if (r.text.includes('산출물')) return null;
      throw new Error(`완료 처리 실패 (${r.status}): ${r.text.slice(0, 160)}`);
    };

    try {
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

      if ((await tryComplete()) === 'done') return 'done';

      await onProgress(`에이전트와 대화 중... (${turn}/${MAX_TURNS})`);
      const history = msgs.slice(-6).map((m) => `${m.role === 'AGENT' ? '코치' : '나'}: ${m.content}`).join('\n');
      await send(await generateInterviewReply({ kind, context: ctxText, history }));
    }
    if ((await tryComplete()) === 'done') return 'done';
    throw new Error(`${MAX_TURNS}턴 안에 ${kind === 'PLAN' ? '계획' : '회고'}이 확정되지 않음`);
    } catch (err) {
      // 대화 도중 오류가 나도 이미 만들어진 문서가 있으면 완료 버튼은 꼭 누름
      const done = await tryComplete().catch(() => null);
      if (done === 'done') return 'done';
      throw err;
    }
  };


  const listTasks = async () => {
    const r = await rawFull('GET', `${API}/api/v2/my-tasks/csr`);
    const raw = r.json?.contents?.tasks ?? r.json?.contents ?? [];
    return (Array.isArray(raw) ? raw : []).filter((t) => t.taskId != null || t.id != null);
  };

  const resetReflection = async (date = todayKST()) => {
    const found = await rawFull('GET', `${API}/api/v1/daily-reflections?date=${date}`);
    const id = found.json?.contents?.id;
    if (!id) throw new Error(`${date} 회고를 찾을 수 없음`);
    const res = await rawFull('DELETE', `${API}/api/v1/daily-reflections/${id}`);
    if (res.status < 200 || res.status >= 300) throw new Error(`DELETE 실패 (status=${res.status})`);
    return { reflectionId: String(id), date };
  };

  return {
    listTasks,
    resetReflection,
    reflect: (text) => converse('REFLECTION', {
      firstMessage: text,
      context: text,
      panelOk: (p) => p.panelType === 'REFLECTION',
      completePath: '/reflection-completion',
      onDuplicate: () => resetReflection(),
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
  };
}
