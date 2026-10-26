import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { mkdirSync } from 'fs';

const PKG_DIR = dirname(fileURLToPath(import.meta.url + '/..'));

// npm 전역 설치(node_modules 안)면 업데이트 때 날아가므로 홈 폴더에 저장, 소스 폴더에서 실행하면 기존처럼 프로젝트 폴더 사용
export const IS_INSTALLED = PKG_DIR.includes(`${'/'}node_modules${'/'}`) || PKG_DIR.includes('\\node_modules\\');
// 데스크톱 앱은 AUTO_NEWRROW_HOME(앱 데이터 폴더)을 지정해서 실행함
export const DATA_DIR = process.env.AUTO_NEWRROW_HOME || (IS_INSTALLED ? join(homedir(), '.auto-newrrow') : PKG_DIR);
if (process.env.AUTO_NEWRROW_HOME || IS_INSTALLED) mkdirSync(DATA_DIR, { recursive: true });
export { PKG_DIR };
