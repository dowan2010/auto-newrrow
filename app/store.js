import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const file = () => join(app.getPath('userData'), 'settings.json');
const SECRET = ['password', 'geminiKey', 'openaiKey'];

const enc = (v) => (v && safeStorage.isEncryptionAvailable() ? { enc: safeStorage.encryptString(v).toString('base64') } : v);
const dec = (v) => (v && typeof v === 'object' && v.enc ? safeStorage.decryptString(Buffer.from(v.enc, 'base64')) : v);

export function loadSettings() {
  const raw = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf-8')) : {};
  const out = { email: '', password: '', geminiKey: '', openaiKey: '', aiProvider: 'gemini', dailyTime: '08:30', ...raw };
  for (const k of SECRET) out[k] = dec(raw[k]) ?? '';
  return out;
}

export function saveSettings(patch) {
  const cur = loadSettings();
  const next = { ...cur, ...patch };
  const raw = { ...next };
  for (const k of SECRET) raw[k] = enc(next[k]);
  writeFileSync(file(), JSON.stringify(raw, null, 2), { mode: 0o600 });
  return next;
}
