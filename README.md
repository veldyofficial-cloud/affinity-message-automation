# AFFINITY UNIVERSE · 안내메시지 자동화

> Optional no-login shared-link mode: see [SHARED_LINK_SETUP_KO.md](SHARED_LINK_SETUP_KO.md). Student lookup and Monday writes require a separate 256-bit key carried in the shared URL; this does not expose the Monday API token. Current Cloudflare Access login remains the default until explicitly switched.


밸디의 별도 GitHub 저장소 `veldyofficial-cloud/affinity-message-automation`에서 Cloudflare Workers로 배포하는 내부 도구입니다. 기존 인트라넷 저장소는 변경하지 않습니다.

## 기능

- `public/index.html`: 클래스 안내문 생성 (영문 Poppins, 국문 Noto Sans KR), Infohub 승인 및 먼데이 DB 등록
- `src/`: Cloudflare Access JWT 서명 검증, 안전한 강사 초대 등록, Monday API, 중복 등록 방지
- `public/onboarding.html`: 개인 Gmail 등 **본인 이메일 로그인 + 최초 1회 강사용 초대코드** 등록
- `/admin`: 배포 관리자 이메일에서만 열리는 강사 등록 현황 및 개별 차단/복구
- `tests/`: 모의 Access JWT 및 Monday API 테스트. 실제 운영 보드에 테스트 데이터 생성하지 않음

## 강사 로그인 방식

Cloudflare 관리자로 강사들을 초대할 필요가 없습니다. 대신 Access의 One-time PIN 로그인(유효 이메일 인증)을 활성화하고, 강사들에게 별도 **강사용 초대코드**를 안전한 채널로 전달합니다. 인증된 이메일과 유효한 초대코드가 일치한 경우에만 Durable Object에 강사 이용 권한이 저장됩니다. 이후에는 초대코드 재입력 없이 본인 이메일로 이용하며, 관리자가 `/admin`에서 즉시 차단할 수 있습니다.

중요: 강사용 초대코드는 **먼데이 API 토큰과 다른 값**이며, 강사 전원에게 같은 권한으로 Infohub 학생 조회 및 새 클래스 생성을 허용합니다. 유출 시 재발급하고 기존 등록 계정을 확인해야 합니다. 강사의 먼데이 계정 보유 여부를 검사하지 않습니다. 이는 사용자별 먼데이 OAuth 구현과는 다른 방식입니다.

## 설정 체크리스트

1. Cloudflare Access 보호 범위 `All traffic` 유지. `One-time PIN` 로그인 활성화. Access 정책은 `Allow → Include → Login Methods: One-time PIN`으로 설정하여 **인증된 이메일에만** 토큰을 발급하게 합니다. `Bypass` 또는 공개 접근은 금지합니다.
2. Worker `Settings → Variables and Secrets`: `TEAM_DOMAIN`, `POLICY_AUD` (Text), `ACCESS_ALLOWED_EMAILS` (관리자 이메일 목록, Text), `INSTRUCTOR_INVITE_CODE` (길고 무작위한 24자 이상 코드, **Secret**), `MONDAY_API_TOKEN` (**Secret**).
3. `https://<your-worker>.workers.dev/` 로그인 후 관리자는 바로 안내문 생성기를 이용하고, 처음 접속한 강사는 초대코드 화면이 표시되는지 확인합니다.
4. 관리자는 `/admin`에서 등록 강사 목록을 확인하고 차단/복구할 수 있습니다.
5. `/api/health`에서 `access`, `registry`, `monday` 상태 확인. 이 응답은 API 토큰의 유효성까지 검증하지 않습니다.
6. **반드시 별도 테스트 보드에서 쓰기 검증을 마친 뒤 운영용 승인을 사용하세요.** 현재 `src/monday.js`의 보드 ID는 **운영 Infohub**로 고정되어 있습니다.

관리자 이메일로 등록할 주소는 `ACCESS_ALLOWED_EMAILS`에 포함되어 있어야 합니다. 모든 직원 주소를 여기에 넣을 필요는 없습니다. 초대코드 설정이 없으면 초대 등록은 자동으로 비활성화되며, 기존 관리자만 접근할 수 있습니다.

Cloudflare Zero Trust Access 무료 플랜은 일반적으로 50명 이하 조직 규모에 맞춰 제공됩니다. 사용자 수가 이를 초과하면 요금제를 검토해야 합니다.

상세 가이드: [DEPLOY_KO.md](DEPLOY_KO.md)

## 안내문·강사·결석 (2026-10-31 업데이트)

- 클래스 커리큘럼은 `[DRAWING] BASIC`, `[PICTURE BOOK] DIPLOMA`, `[ART BOOK DESIGN] LV.4`, `[MARKETING] MANAGEMENT`, `[BRANDING] PERSONAL COURSE` 등 **영문 코드형 이름**으로 표시합니다. 기존 온라인 커리큘럼 URL 슬러그는 유지하며 `[BRANDING] PERSONAL COURSE`에 별도 URL은 붙이지 않습니다.
- Infohub 강사 선택은 확인된 13명 `OLIVIA, ONYU, AYEONG, DOORI, HANNAH, JIMIN, JUNWON, RARA, SEONYE, SHU, SION, SYEON, ZOEY`만 허용합니다. 사용자 ID 화이트리스트는 서버 `src/teachers.js`에 있으며 실제 Monday API 조회로 계정명까지 검증합니다.
- **그룹 전체 수강생 요청 휴강**: 휴강 날짜의 하위아이템 이름 `수강생 요청 휴강`, `DATE` 해당 날짜, `MIN=휴강`, `출석=0`. 수업 회차는 건너뛰며 필요하면 예상 종강일이 늘어납니다.
- **그룹의 일부 수강생 요청 결석**: 먼저 해당 그룹 **모든 수강생**을 STUDENT DB에서 선택하고, 결석할 수강생만 체크합니다. 해당 날짜의 기존 `LESSON NN` 하위아이템은 유지하고 `DATE`·`MIN=60m` 그대로 두며, **결석인원** 컬럼에 선택한 STUDENT DB 학생을 연결하고 **출석**은 그룹 전체 인원에서 결석 인원을 제외한 수로 기록합니다. 수업 회차와 예상 종강일을 밀지 않습니다.
- 서버는 전체 휴강과 개별 결석이 같은 날짜로 겹치는 상황, 대상 학생이 그룹 외의 학생인 경우, 모든 학생을 개별 결석 처리하려는 경우, 정규 요일 밖의 날짜 및 미승인 강사 ID를 **쓰기 전에** 거절합니다.

**주의:** 서버 등록 대상은 여전히 실제 Infohub 보드이므로 실제 `승인하고 먼데이에 등록` 버튼으로 테스트하지 마세요. 별도 테스트 보드에 컬럼·그룹 ID를 맞춘 후 먼저 검증해야 합니다.
## Infohub 기기 라벨 직접 선택 (2026-11-02)

상단 `클래스 구분`에서 PC / IPAD / GALAXY를 직접 필수 선택합니다. 중복된 하단 선택창을 제거했으며 커리큘럼 변경으로 기기 선택을 덮어쓰지 않습니다. 서버는 상단 값을 Monday Infohub `기기` 상태 라벨에 그대로 기록하며 그 외 값은 DB 변경 전에 차단합니다. 정규·보강·보충·트라이얼 전체에 적용됩니다. 실제 운영 데이터 쓰기는 별도 테스트 보드에서 검증해야 합니다.
