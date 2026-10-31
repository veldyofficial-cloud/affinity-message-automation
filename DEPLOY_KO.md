# Cloudflare 강사 이용 및 먼데이 Infohub 등록 배포 가이드

> Optional no-login shared-link mode: see [SHARED_LINK_SETUP_KO.md](SHARED_LINK_SETUP_KO.md). Student lookup and Monday writes require a separate 256-bit key carried in the shared URL; this does not expose the Monday API token. Current Cloudflare Access login remains the default until explicitly switched.


## 현재 구성

- 소스: `https://github.com/veldyofficial-cloud/affinity-message-automation` → `main`
- Worker: `infohub-approval-cloudflare`
- Root directory: `/` / Deploy command: `npx wrangler deploy`
- GitHub에 Push하면 Cloudflare Workers Builds 자동 배포. 기존 `AFFINITY` 인트라넷 저장소와 무관합니다.

## 1. Cloudflare Access 이메일 로그인 설정

Cloudflare Dashboard → Zero Trust → Integrations → Identity providers → Add new identity provider → **One-time PIN**.

Zero Trust → Access controls → Policies → 새 `Allow` 정책을 만들고, `Include → Login Methods → One-time PIN`을 선택합니다. 이 정책을 Workers & Pages의 `infohub-approval-cloudflare` Access 애플리케이션에 연결합니다. **Scope는 All traffic**입니다. 인증된 이메일을 요구하고, 사용자가 검증된 Cloudflare Access JWT를 받아야 합니다. `Bypass` 정책과 `Everyone` 직접 공개 접근을 사용하지 마세요. 권장 세션 시간 24시간~7일.

중요: 이 정책 자체는 유효 이메일 소유자에게 로그인 창을 보여줍니다. **실제 수강생 DB와 승인 기능은 서버의 강사용 초대코드 등록 여부를 다시 검사**합니다. 새 강사 등록 기능이 설정되지 않았다면 모든 비관리자 요청은 차단됩니다.

## 2. Worker 런타임 변수 (Build variables가 아님)

Workers & Pages → `infohub-approval-cloudflare` → Settings → Runtime variables and secrets → Add variable.

| 이름 | 유형 | 입력 |
| --- | --- | --- |
| `TEAM_DOMAIN` | Text | Access 팀 도메인 (예 `https://xxxxx.cloudflareaccess.com`) |
| `POLICY_AUD` | Text | Access Application Audience(AUD) Tag |
| `ACCESS_ALLOWED_EMAILS` | Text | 배포 관리자 이메일 목록 (예: `veldy.official@gmail.com`) |
| `INSTRUCTOR_INVITE_CODE` | **Secret** | 비밀번호 생성기로 만든 길고 무작위한 24자 이상 초대코드 |
| `MONDAY_API_TOKEN` | **Secret** | Infohub 읽기/쓰기 권한이 있는 먼데이 계정에서 발급한 API 토큰 |

`INSTRUCTOR_INVITE_CODE`는 먼데이 키가 아닙니다. API 키와 초대코드를 GitHub, 채팅, 공개 문서, Build variables에 올리지 마세요. 환경 변수 수정 후 새 버전을 배포하고 Access 보호가 작동하는지 확인하세요.

`TEAM_DOMAIN`은 Zero Trust 팀 설정에서, `POLICY_AUD`는 해당 Access 애플리케이션 설정에서 확인합니다. `ACCESS_ALLOWED_EMAILS`가 비어 있으면 모든 접근을 차단하도록 코드가 설계되어 있습니다.

## 3. 접속 주소 및 관리자 페이지

Workers & Pages → Worker → Domains에서 `workers.dev` 활성화. **All traffic Access 보호를 먼저 확인**하세요.

- 프로그램: `https://infohub-approval-cloudflare.veldy-official.workers.dev/` (배포 URL 활성화 필요)
- 관리자 강사 명단: 위 주소 뒤에 `/admin`
- 인증 상태: `/api/auth/status`
- 바인딩 상태: `/api/health`

관리자 이메일은 바로 프로그램 접근. 강사는 Cloudflare 이메일 1회용 PIN으로 로그인하고 처음 한 번만 강사용 초대코드를 입력합니다. 성공하면 그 이메일의 이용 권한을 저장합니다. 등록된 강사는 이후 세션 만료 시 이메일로 다시 로그인하지만 초대코드는 다시 입력하지 않습니다.

관리자는 `/admin`에서 강사별 이용 차단 및 복구를 할 수 있습니다. 차단 시 저장된 초대코드 인증 정보와 관계없이 다음 요청부터 학생 조회와 먼데이 등록이 중단됩니다. 별도 Monday OAuth나 개인별 API 토큰은 필요하지 않습니다.

**관리자가 초대코드를 한 번 안전한 채널로 전달하면 해당 코드를 가진 사람이 스스로 등록할 수 있다는 점을 인지해야 합니다.** 초대코드 유출이 의심되면 Secret을 교체하고 `/admin`에서 등록된 이메일을 점검합니다.

## 4. 안전한 운영 검증

1. Access 보호가 켜진 상태에서 관리자 로그인 성공 여부 확인.
2. 비등록 개인 이메일은 초대코드 화면만 나오고, `/api/lookup`, `/api/approve` 접근이 차단되는지 확인.
3. 강사 개인 이메일 로그인 및 초대코드 1회 등록 후 정상 화면 확인. 관리자 `/admin`에서 등록 계정 표시되는지 확인.
4. `/api/health`의 `access`, `registry`, `monday`가 true인지 확인. 이는 API 토큰의 실제 권한 검증을 뜻하지 않습니다.
5. 테스트용 별도 먼데이 보드에서 학생 연결, LESSON, 휴강, 날짜, 안내 메시지 업데이트가 정확한지 확인.
6. 현재 `src/monday.js`는 **운영 보드 IDs 1888467610 / 1879266175로 고정**되어 있습니다. 테스트 보드 ID/그룹/컬럼 ID로 변경하기 전에는 **승인 버튼을 클릭하지 마세요**.
7. 테스트가 통과한 뒤 운영 보드 설정을 되돌리고 직원들에게 주소와 초대코드를 각각 안전하게 전달합니다.

## 5. 무료 플랜 조건과 한계

Cloudflare Zero Trust Free는 일반적으로 50명 미만 팀을 위한 플랜입니다. 전 강사를 포함한 이용자가 50명을 넘으면 유료 플랜 검토가 필요합니다. 직원 수뿐 아니라 로그인한 사용자의 수를 확인하세요.

각 강사가 자신의 먼데이 계정을 가지지 않아도 서버의 밸디 먼데이 토큰으로 Infohub에 데이터를 등록할 수 있습니다. 다만 모든 승인된 강사가 동일한 서버 권한으로 접근하므로 수강생 데이터 접근 범위와 운영 절차를 함께 관리해야 합니다. 이는 정식 사용자별 Monday OAuth 권한 구조가 아닙니다.
