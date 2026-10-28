import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'fs';
import { join } from 'path';

const file = () => join(app.getPath('userData'), 'settings.json');
const SECRET = ['password', 'geminiKey', 'openaiKey'];

// macOS는 키체인을 쓰지 않음 — 서명 없는 앱은 업데이트마다 키체인 접근을 다시 물어서 자동 실행이 멈추는 문제가 있었음.
// 내 계정만 읽을 수 있는 파일(권한 600)에 저장함. Windows는 팝업 없는 OS 암호화(DPAPI)를 그대로 사용.
const USE_OS_CRYPTO = process.platform === 'win32';

const enc = (v) => (v && USE_OS_CRYPTO && safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(v).toString('base64') } : v);
const isEncrypted = (v) => v && typeof v === 'object' && v.enc;

function decrypt(v) {
  if (!isEncrypted(v)) return { value: v, ok: true };
  try { return { value: safeStorage.decryptString(Buffer.from(v.enc, 'base64')), ok: true }; } catch { return { value: '', ok: false }; }
}

function persist(obj) {
  const raw = { ...obj };
  for (const k of SECRET) raw[k] = enc(obj[k]);
  writeFileSync(file(), JSON.stringify(raw, null, 2), { mode: 0o600 });
  try { chmodSync(file(), 0o600); } catch {}
}

export function loadSettings() {
  const raw = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf-8')) : {};
  const out = { email: '', password: '', geminiKey: '', openaiKey: '', aiProvider: 'gemini', dailyTime: '08:30', showBrowser: false, ...raw };
  let allOk = true;
  let hadKeychainValues = false;
  for (const k of SECRET) {
    if (isEncrypted(raw[k])) hadKeychainValues = true;
    const d = decrypt(raw[k]);
    out[k] = d.value ?? '';
    if (!d.ok) allOk = false;
  }
  // 예전(키체인) 형식이면 한 번 읽어서 파일 형식으로 옮김 — 하나라도 못 읽으면 원본을 그대로 둠
  if (!USE_OS_CRYPTO && hadKeychainValues && allOk) persist(out);
  return out;
}

export function saveSettings(patch) {
  const next = { ...loadSettings(), ...patch };
  persist(next);
  return next;
}
