---
id: T-20260615-foot-GALAXYTAB-LOGIN-SLOW
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-ok: true
db-change: false
regression-risk: low
qa_result: pass
deploy_commit: fa6dbc0
deployed_at: 2026-06-15T19:19:05+09:00
bundle_hash: vendor-utils-BcCOj9p0
deploy_verified_note: "FIX MSG-20260615-185858-2yx6: supervisor 18:58 검증 시 deploy-lag 윈도우(fa6dbc0 push 18:51 직후 Vercel 빌드 in-flight)로 prod alias 가 직전 빌드(4dc15f9) 서빙 중이었음. 19:19 배포(dpl_48agRX7WrzG6T6DK29p3tvCJewjF, Ready) 완료로 prod alias 갱신. 현 prod 번들 검증: vendor-utils-BcCOj9p0.js modulepreload 존재 + vendor-charts critical-path 0건 = 로컬 빌드 출력 동일 해시. 코드 무변경(순수 배포 lag)."
e2e-spec: tests/e2e/T-20260615-foot-GALAXYTAB-LOGIN-SLOW.spec.ts
e2e_spec_exempt_reason: null
db-gate-handoff: null
created: 2026-06-15
assignee: dev-foot
reporter: planner (DASH-CROSSACCT-REALTIME-LAG (B) 분리)
source_msg: MSG-20260615-181852-ak9z
needs_field_confirm: true
---

# T-20260615-foot-GALAXYTAB-LOGIN-SLOW — 갤럭시탭 로그인→대시보드 진입 지연

갤탭(Android) 로그인 → 대시보드 진입까지 30s+ → 목표 ≤10s.

## 진단 (계측 우선, 추측 금지)

5개 의심 항목 중 **suspect #1 (초기 번들 로드 — Android Chrome 파싱·실행)** 에서 가장 큰 단일 비용을 계측으로 확정.

**근본 원인**: `cn()` 유틸이 쓰는 `clsx` + `tailwind-merge` + `use-sync-external-store-shim`(앱 전역 = entry static graph, 모든 화면의 Button/Badge 등)이 recharts/d3 와 **같은 `vendor-charts` 청크(≈397KB)** 에 묶여 있었다. 엔트리가 이 tiny 유틸 3개를 정적으로 쓰기 때문에, **로그인 화면조차 recharts 397KB 청크 전체를 critical path 에 정적 modulepreload** → 갤탭 약한 CPU 가 차트 번들 파싱·실행에 시간을 낭비.

증거:
- `dist/index.html` modulepreload 목록에 `vendor-charts-*.js`(397KB) 포함.
- entry 청크가 `import {…} from "./vendor-charts-*.js"` 정적 import (가져오는 심볼 = clsx merge / use-sync-external-store / clsx exports, recharts 컴포넌트 아님).

## 수정

`vite.config.ts` `manualChunks` 에 `vendor-utils` 규칙 추가:
```js
if (/[\\/](clsx|tailwind-merge|use-sync-external-store)[\\/]/.test(id)) return 'vendor-utils';
```
recharts 규칙보다 앞에 두어 tiny 유틸을 독립 청크(≈23KB)로 분리. `vendor-charts`(recharts+d3)는 Stats 진입 시에만 lazy 로드.

**인증·권한 로직 무변경. 순수 청킹 설정. 스키마/인덱스 변경 없음 → db_change=false.**

## 측정값 (AC2, before/after)

| | critical-path JS (raw) | vendor-charts on critical path |
|---|---|---|
| BEFORE | 1063.6 KB | YES (397KB) |
| AFTER | 679.1 KB | NO (lazy) |

→ **-384.5 KB (-36%)**, gzip 기준 약 -107KB. recharts 파싱이 로그인 경로에서 완전히 제거됨(갤탭 CPU 파싱 비용 절감).

## AC 검증

- **AC1 (≤10s 목표)**: 번들 critical path 397KB 제거 — 실기기 체감 단축은 현장 confirm 필요(needs_field_confirm).
- **AC2 (before/after 1줄)**: critical-path JS 1063.6KB → 679.1KB (-36%). ✅
- **AC3 (PC 회귀 0)**: critical-flow E2E 13/13 PASS, 신규 spec 4/4 PASS. ✅

## 회귀 가드 spec

`tests/e2e/T-20260615-foot-GALAXYTAB-LOGIN-SLOW.spec.ts`:
1. 빌드 산출물 critical path 에 vendor-charts 재진입 0 (재발 차단).
2. vendor-charts lazy 청크 + vendor-utils 청크 별도 존재.
3. 로그인→대시보드 경로에서 차트 청크 네트워크 요청 0 + 대시보드 정상 렌더.

## 후속 (이 티켓 밖, 추측 아닌 다음 probe 후보)

실기기 측정이 여전히 >10s 이면 다음 순서로 계측: ① suspect #3 — Login 경로 `user_profiles` 조회 3중복(signInWithPassword 후 + refresh() + onAuthStateChange) 정리(단, 인증 로직 무변경 제약 검토 필요). ② suspect #2 — Edge Function cold start. Dashboard 데이터 fetch/realtime lag(suspect #4)는 자매 티켓 DASH-CROSSACCT-REALTIME-LAG 소관.
