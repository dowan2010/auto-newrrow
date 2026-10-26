import { generateTopic, generateReflection, generateTaskTitle } from './ai.js';
import { addSubmissionHistory, addRecentTopic, getRecentTopics } from './data.js';
import { todayKST } from './client.js';

// 오늘 계획에 넣을 할일 (기존 할일 최대 5개를 09:00~10:00 사이에 균등 배분, 없으면 AI가 1개 생성)
export async function buildPlanTasks(client) {
  const tasks = await client.listTasks();
  if (!tasks.length) return [{ name: await generateTaskTitle(), start: '09:00', end: '10:00' }];
  const target = tasks.slice(0, 5);
  const slotMin = Math.max(30, Math.floor(60 / target.length));
  const fmt = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  return target.map((t, i) => ({
    name: t.title ?? t.taskTitle ?? t.name ?? `할일${i + 1}`,
    start: fmt(9 * 60 + slotMin * i),
    end: fmt(9 * 60 + slotMin * (i + 1)),
  }));
}

// 계획 → 회고. client는 이미 로그인된 상태여야 함. 계획이 실패해도 회고는 계속 진행함
export async function runDaily(client, { say = () => {}, setStatus = () => {}, truncate = (s) => s } = {}) {
  setStatus('할일 불러오는 중...');
  const planTasks = await buildPlanTasks(client);
  say(`📋 계획 ${planTasks.length}건: ${planTasks.map((t) => t.name).join(', ')}`);

  setStatus('AI가 주제 생성 중...');
  const topic = await generateTopic(getRecentTopics());
  say(`📌 ${topic}`);
  setStatus('AI가 내용 작성 중...');
  let text = await generateReflection(topic);
  for (let i = 0; i < 2 && text.length < 200; i++) text = await generateReflection(topic);
  say(`📝 (${text.length}자) ${truncate(text, 28)}`);

  try {
    setStatus('계획 정리 중...');
    const planResult = await client.plan(planTasks);
    say(planResult === 'already_done' ? '📅 계획 이미 완료됨' : '📅 계획 완료');
  } catch (err) {
    say(`⚠ 계획 실패 — 회고는 계속 진행: ${err.message}`);
  }

  setStatus('회고 정리 중...');
  let result;
  try {
    result = await client.reflect(text);
  } catch (err) {
    // 같은 날 채팅은 이어서 진행되므로 한 번 더 시도 (일시 오류로 완료를 못 누른 채 끝나는 것 방지)
    say(`⚠ 회고 1차 실패 — 재시도: ${err.message}`);
    await new Promise((r) => setTimeout(r, 10000));
    result = await client.reflect(text);
  }

  const dateLabel = todayKST();
  if (result !== 'already_done') {
    addSubmissionHistory(dateLabel, topic, text);
    addRecentTopic(topic);
  }
  return { result, topic, dateLabel };
}
