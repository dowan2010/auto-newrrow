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

## 주의

- **본인 계정에만 사용.** 계정 정보(이메일/비밀번호)는 내 컴퓨터의 설정 파일에만 저장되고, 뉴로우 로그인과 Gemini API 호출 외엔 어디로도 전송되지 않음.
- 비공식 도구. 뉴로우 화면/API가 바뀌면 동작이 깨질 수 있음.
- 자동 생성된 회고도 본인 이름으로 제출됨. 내용은 직접 확인할 책임이 있음.
- 학교/기관의 이용 규정 확인 후 사용. 사용에 따른 책임은 사용자에게 있음 (GPL-3.0, 무보증).

## 참고

- 브라우저 창 보고 싶으면 `.env`에 `HEADLESS=false`
- 회고 초기화하면 같은 날 재작성 불가 (뉴로우 쪽 제한)
- GPL-3.0 License

## 문제 발생 시

1. `node -v` — Node 18 이상인지 확인
2. `npx playwright install chromium` 재실행
3. 로그 확인 후 [Issues](https://github.com/dowan2010/newrrowBot/issues) 등록
