---
id: T-20260727-foot-CHROME-SAFEBROWSING-BLOCK
domain: foot
priority: P0
type: hotfix-infra
status: blocked-human-gate
db_change: false
ui_change: false
mig_gate: N/A
e2e_scenario: N/A
code_change: false
deploy_ready: false
blocker: appeal-submit-needs-google-account-human-gate
rc: shared-domain(*.pages.dev) safe-browsing flag — NOT foot code
owner: dev-foot
opened: 2026-07-27
---

# T-20260727-foot-CHROME-SAFEBROWSING-BLOCK

**Chrome 위험사이트 차단 → 문지은 대표원장(U0ALGAAAJAV) obliv-foot-crm.pages.dev 접속 불가.**

## 진단 결과 (증거 기반, 추정 없음)

### AC1 — 플래그 정밀확인 ✅ 확정: 플래그됨
Google Transparency Report v3 API 원문 (raw, `)]}'` prefix 제거):
```
obliv-foot-crm.pages.dev  → ["sb.ssr",2,false,false,true,false,false,1785135232889,"obliv-foot-crm.pages.dev"]
```
- status code = **2** (= 플래그/경고). 관측시각 ts1785135232889 = 2026-07-27 15:53:52 KST.

캘리브레이션(경험적 코드 검증):
| 사이트 | status | 판정 |
|--------|--------|------|
| google.com / github.com / wikipedia.org | 4 | clean (No unsafe content found) |
| pages.dev (apex) | 4 | clean |
| obliv-foot-crm.pages.dev | **2** | **플래그** |
| obliv-derm-crm.pages.dev (피부과, 별개 코드베이스) | **1** | **플래그** |
| happy-flow-queue.pages.dev (롱레, 별개 코드베이스) | **1** | **플래그** |
→ status 4 = clean, 1/2 = 플래그로 확정.

### AC2 — 원인규명 ✅ 확정: foot 코드 아님 = 공유도메인 차원 플래그
1. **코드 clean**: index.html = jsdelivr Pretendard 폰트만. 악성 스크립트/삽입/불량 리다이렉트 0건. `document.write`는 전부 영수증·서류 인쇄용 팝업 생성(정상). 외부도메인 참조 = api.qrserver.com(QR)·medicare.nhis.or.kr(건보공단)만(정상).
2. **최근 배포 무관**: 차단 관측시각(15:53) 전후 커밋 전부 정상 foot 기능/버그픽스(외부 콘텐츠 삽입 없음). 사이트 HTTP 200, redirects 0.
3. **결정적**: 코드베이스가 완전히 다른 형제 CRM(피부과 fork·롱레) subdomain이 **동시에** 플래그됨 → 특정 코드 원인 불가능. `*.pages.dev` 공유 호스팅 도메인 차원 Safe Browsing 플래그(Cloudflare Pages 공지 subdomain에 자주 발생하는 알려진 패턴).
   - 단, pages.dev apex 자체는 status 4(clean) — host-level 개별 플래그.

### AC3 — 이의신청 ⛔ BLOCKED (사람 게이트)
safebrowsing.google.com/safebrowsing/report_error 및 Search Console Security Issues 재검토는 **Google 계정 로그인·submit 필요** → dev 무단 제출 금지(무단 오답 제출 방지). → planner FOLLOWUP로 사람 게이트 요청(responder 경유).

### AC4 — 정상화 확인 후 보고
이의신청 접수 후 진행. 접수완료 시점·실제 해제확인 시점 분리 보고 예정.

## 가드 판정
- 공유도메인 차원 플래그 = **코드로 해소 불가** → **커스텀 도메인 이전 별건 P1 승격 제안**(형제 CRM 다수 동시 재발 리스크 상존).
- db_change=false / UI 무변경 / code 무변경 → MIG-GATE·E2E 시나리오 게이트 N/A. deploy-ready 대상 아님.
- 리스크: 개별 subdomain 이의신청이 통과해도 공유도메인 특성상 재플래그 가능 → 커스텀 도메인이 근본 해소.

## 임시 우회 (현장 이미 안내됨)
Safari/웨일 사용, 또는 Chrome 경고화면 → 세부정보 → "안전하지 않은 사이트로 이동".
