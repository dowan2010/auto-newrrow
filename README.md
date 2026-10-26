# auto-newrrow

뉴로우(dgsm.newrrow.com) 일일 계획·회고 자동화 CLI.

## 설치

```bash
npm i -g auto-newrrow
```

설치 중 Playwright(chromium)도 같이 받아짐. 끝, 이제 어디서든 `newrrow`.

소스로 쓰려면:

```bash
git clone https://github.com/dowan2010/newrrowBot.git
cd newrrowBot
npm install
npm link
```

## 시작

```bash
newrrow
```

첫 실행 → 메뉴 **설정 (API 키 / 계정)** → 입력 → 저장됨.

- `GEMINI_API_KEY` — Google AI Studio 발급
- `EMAIL` / `PASSWORD` — 뉴로우 계정

설정은 전역 설치면 `~/.auto-newrrow/`, 소스 실행이면 프로젝트 폴더에 저장됨.

## 매일 자동 실행 (macOS)

```bash
newrrow --install-daily 08:30   # 매일 08:30 등록 (시간 생략하면 08:30)
newrrow --uninstall-daily       # 해제
```

로그: `~/Library/Logs/daymark-auto.log`. Mac이 그 시간에 잠자기면 밀릴 수 있음.
다른 OS는 cron / 작업 스케줄러에서 `newrrow --auto`를 매일 실행.

## 메뉴

| 번호 | 기능 |
|---|---|
| 1 | 오늘 회고 하기 (AI 자동) |
| 2 | 오늘 계획+회고 자동 완성 |
| 3 | 회고 초기화 |
| 4 | 할일 목록 보기 |
| 5 | 할일 추가 |
| 6 | 일정 등록 |
| 7 | 주제 추천만 보기 |
| 8 | 설정 (API 키 / 계정) |
| 0 | 종료 |

## 참고

- 브라우저 창 보고 싶으면 `.env`에 `HEADLESS=false`
- 회고 초기화하면 같은 날 재작성 불가 (뉴로우 쪽 제한)
- GPL-3.0 License

## 문제 발생 시

1. `node -v` — Node 18 이상인지 확인
2. `npx playwright install chromium` 재실행
3. 로그 확인 후 [Issues](https://github.com/dowan2010/newrrowBot/issues) 등록
