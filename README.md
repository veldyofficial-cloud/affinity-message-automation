# Affinity Universe · 안내메시지 자동화

**독립 GitHub 저장소** `veldyofficial-cloud/affinity-message-automation`로 배포하는 Cloudflare Worker 프로젝트입니다. 기존 인트라넷 저장소 `veldyofficial-cloud/AFFINITY`를 사용하지 않습니다.

- 프런트엔드: `public/index.html` (블루 테마, 영문 Poppins / 국문 Noto Sans KR, 클래스 안내 메시지 생성 및 승인)
- 백엔드: `src/` (Cloudflare Access JWT 검증, Monday GraphQL API, Infohub 생성)
- 중복 등록 방지: SQLite-backed Durable Object
- 검증: `npm test`, `python3 tests/ui_check.py` (모의 API; 운영 DB에 쓰지 않음)

## 배포 설정

**권장 방식: 현재 실패한 Cloudflare Worker `infohub-approval-cloudflare`를 재사용하고 Git 연결만 변경**합니다. 신규 Cloudflare 프로젝트를 만드는 경우에는 `wrangler.jsonc`의 `name`과 Cloudflare Worker 프로젝트명을 동일하게 맞춰야 합니다.

1. **GitHub**: `veldyofficial-cloud` 사용자에서 **Private** 저장소 `affinity-message-automation`를 만듭니다. 기본 브랜치는 `main`을 사용합니다.
2. **GitHub 업로드**: 이 저장소의 루트에 `wrangler.jsonc`, `package.json`, `public/`, `src/`, `tests/` 등을 넣습니다. (`applications/...` 하위 폴더를 만들지 않습니다.)
3. **Cloudflare**: Workers & Pages → `infohub-approval-cloudflare` → Settings → Builds → 기존 `AFFINITY` 연결 **Disconnect** → 새 저장소 `affinity-message-automation`으로 **Connect**.
4. **Build 설정**: Production branch `main`, Path `/` (또는 기본값), Build command 비워두기, Deploy command `npx wrangler deploy`, Preview builds OFF.
5. **보안 유지**: Cloudflare Access `All traffic`을 유지하고 이메일 기반 Allow 정책을 적용합니다. 개인 계정을 자동 허용하는 OAuth 방식은 아직 구현되어 있지 않습니다.
6. **서버 변수**: `Settings → Variables and Secrets`에서 `MONDAY_API_TOKEN` (Secret), `TEAM_DOMAIN`, `POLICY_AUD`, `ACCESS_ALLOWED_EMAILS` (Text)를 런타임 변수로 구성합니다. API 토큰을 GitHub, 채팅, Build variables에 입력하지 마세요.
7. **검증**: Cloudflare 빌드 로그 확인 → Access 로그인 후 `/api/health` 응답의 `access`, `registry`, `monday`가 모두 true인지 확인 → 별도 테스트 보드에서 기록 검증 후 운영 사용.

배포 전에는 실제 `🌐 AF CLASS INFO HUB` (1888467610), `🌐 AF STUDENT DB` (1879266175)의 ID와 컬럼을 확인해야 합니다. 본 프로젝트는 API 토큰만 설정한 채 승인 버튼을 클릭하면 실제 운영 보드를 변경할 수 있습니다. 반드시 테스트 보드로 먼저 검증하세요.

상세 안내: [DEPLOY_KO.md](DEPLOY_KO.md)
