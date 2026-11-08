// 학교 설정: 뉴로우 주소(https://<학교>.newrrow.com)의 첫 부분이 곧 학교 구분값(Tenant)
// NEWRROW_SCHOOL_URL이 비어 있으면 대구소마고(dgsm)
const DEFAULT = { tenant: 'dgsm', who: '대구 소프트웨어 마이스터고등학교 학생' };

export function parseSchool(input) {
  const raw = String(input ?? '').trim();
  if (!raw) return { ...DEFAULT, host: 'dgsm.newrrow.com' };
  let url;
  try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`); } catch { url = null; }
  const m = url && /^([a-z0-9-]+)\.newrrow\.com$/i.exec(url.hostname);
  if (!m) throw new Error('학교 주소가 올바르지 않아요 (예: https://학교이름.newrrow.com)');
  const tenant = m[1].toLowerCase();
  return tenant === DEFAULT.tenant ? { ...DEFAULT, host: url.hostname.toLowerCase() } : { tenant, who: '고등학교 학생', host: url.hostname.toLowerCase() };
}

export const school = () => parseSchool(process.env.NEWRROW_SCHOOL_URL);
export const homeUrl = () => `https://${school().host}/csr-platform/agent-home?mode=reflection`;
