# 새 GitHub 저장소로 분리하고 Cloudflare 재연결하기

## 1. 왜 따로 분리하나요?

기존 `veldyofficial-cloud/AFFINITY`의 루트 `index.html`은 **인트라넷**입니다. 이번 프로젝트의 루트 `public/index.html`이 **안내메시지 자동 생성기**입니다. 기존 프로젝트의 `main`을 변경하지 않습니다.

## 2. GitHub: 사용자 최초 1회 작업

1. https://github.com/new 를 엽니다.
2. Owner `veldyofficial-cloud`, Repository name `affinity-message-automation`, Visibility **Private**.
3. `Add a README file` 체크를 켜고 `Create repository`를 누릅니다. 이 초기 README는 후속 푸시로 교체합니다.
4. 저장소가 만들어지면 `https://github.com/veldyofficial-cloud/affinity-message-automation` 주소를 ChatGPT에 전달해 주세요. 현재 연결된 GitHub 도구는 **기존 저장소의 파일 추가/커밋은 가능하지만 신규 저장소 생성은 지원하지 않습니다.**

## 3. Cloudflare: 기존 실패 Worker 재사용

현재 실패 화면에 보이는 Worker: `infohub-approval-cloudflare`.

1. Cloudflare 대시보드 → Workers & Pages → `infohub-approval-cloudflare`.
2. Settings → Builds → Git Repository → **Disconnect** (기존 인트라넷 저장소 연결만 해제; 배포된 코드 삭제는 아님).
3. **Connect** 버튼에서 `veldyofficial-cloud/affinity-message-automation` 선택.
4. Production branch `main`.
5. **Path** `/` (프로젝트가 새 저장소의 루트에 들어있기 때문).
6. Build command 비워두기 / Deploy command `npx wrangler deploy` / Preview builds OFF.
7. Worker `infohub-approval-cloudflare`와 `wrangler.jsonc`의 `name`이 일치하는지 확인하고 배포를 시작합니다.

Cloudflare 공식 절차: https://developers.cloudflare.com/workers/ci-cd/builds/ (기존 Worker 저장소 변경 시 Disconnect 후 Connect).

## 4. 직원 계정 접근

- Cloudflare Access: Scope = **All traffic**.
- 기존 `Cloudflare account` 정책은 Cloudflare 관리 계정 구성원만 허용합니다. 개인 Gmail 팀원들이 자유롭게 쓰려면 **Cloudflare Zero Trust의 Access Allow → Emails 정책**을 추가하고 OTP 또는 사용 가능한 IdP로 로그인하게 해야 합니다.
- 코드에도 `ACCESS_ALLOWED_EMAILS` 서버 변수의 이메일 목록에 포함되어야 사용됩니다. 예: `veldy.official@gmail.com,affinityuniverse.flow@gmail.com`.
- **모든 개인 계정을 사전 등록 없이 허용하려면** 별도의 Monday OAuth 사용자 인증/Infohub 권한 검증 구현이 필요합니다. 현 코드에서는 지원되지 않습니다. 모든 방문자에게 서비스를 공개하지 마세요.

## 5. 서버 환경 변수 / 실제 DB 쓰기 활성화

Workers & Pages → Worker → Settings → Variables and Secrets.

| 이름 | 유형 | 사용처 |
| --- | --- | --- |
| `MONDAY_API_TOKEN` | **Secret** | monday API GraphQL 호출 |
| `TEAM_DOMAIN` | Text | Cloudflare Access 조직 도메인 예 `https://xxxxx.cloudflareaccess.com` |
| `POLICY_AUD` | Text | Cloudflare Access Application AUD JWT 검증 |
| `ACCESS_ALLOWED_EMAILS` | Text | 콤마로 구분한 직원 메일 목록 |

`MONDAY_API_TOKEN`은 Cloudflare 자체 Build API token(`affinity-infohub-builds`)과 **전혀 다른 값**입니다. API 키를 절대로 GitHub 저장소나 채팅에 붙여 넣지 마세요.

설정 전에도 사용자 본문 데이터는 자동으로 업로드되지 않습니다. 승인 요청은 인증과 설정이 모두 충족되는 경우에만 진행됩니다.

## 6. 운영 전 테스트

- `https://<your-worker>.workers.dev/api/health` 를 로그인된 브라우저로 열었을 때 `ok/access/registry/monday` 확인.
- 프런트엔드 안내문이 `[BRANDING] PERSONAL COURSE`를 표시하고 별도 링크가 없는지 확인.
- 테스트 보드에만 `LESSON`과 `휴강` 하위아이템이 생기는지 확인. 현재 서버 코드가 **운영 Infohub ID에 고정**되어 있으므로 그대로 승인하는 것은 금지.
- 수업 회차, 요일 그룹, 날짜, 강사, 학생, 메시지 업데이트를 실데이터와 대조.
- 승인 실패나 부분등록 시 자동 재시도를 하지 말고 기록을 확인.

## 7. 초기 설정 이후

프로덕션 브랜치 `main`으로 코드를 Push하면 Cloudflare Workers Builds가 `npx wrangler deploy`를 실행하여 자동 배포합니다. API 토큰은 클라우드 서버에 계속 저장되므로 직원이 매번 입력할 필요는 없습니다.
