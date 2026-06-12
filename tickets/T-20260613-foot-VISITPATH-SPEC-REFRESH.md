---
id: T-20260613-foot-VISITPATH-SPEC-REFRESH
domain: foot
priority: P2
status: deploy-ready
deploy_ready_at: 2026-06-13 08:30
commit_sha: 95bba86
db_changed: false
db_migration: null
db_migration_note: null
e2e_spec: tests/e2e/T-20260609-foot-SELFCHECKIN-LEADSRC-UI-VISITPATH.spec.ts
e2e_spec_exempt_reason: null
e2e_result: "갱신 spec 6TC(AC-1 4대그룹2×2/AC-2 SNS·검색 세부/AC-2b 제휴·기타 즉시완성/AC-3 지인소개 성함칸/AC-4 SNS 완성게이트/AC-5 예약동선 회귀) 전건 PASS (auth setup 포함 7 passed, 23.9s, route-mock 결정론)."
hotfix: false
created: 2026-06-13
deadline: null
slack_channel: C0ATE5P6JTH
reporter: ops-planner
risk_verdict: GO
deploy_dependency: "spec only — 프로덕션/DB 무변경, 배포 의존 없음(테스트 부채 해소). 동일 레포 REFIX 파이프라인 복구와 무관하게 main에 반영됨."
---

# T-20260613-foot-VISITPATH-SPEC-REFRESH — VISITPATH E2E spec 노후 갱신

## 요청 (planner NEW-TASK MSG-20260613-082332-yd7y)
VISITPATH E2E spec 6건 사전실패 갱신.
- (1) deprecated `jongno-foot` slug → 현행 유효 slug 교체
- (2) walk-in 모달 assertion 텍스트를 현행 렌더 문구와 동기화
- spec only (프로덕션/DB 무변경). DoD: 6건 GREEN + 회귀 없음.

## 원인
기존 spec 은 deprecated slug `/checkin/jongno-foot` 로 진입 → CheckinRoute 가
canonical 리다이렉트 처리 → native SelfCheckIn 미렌더 → VISITPATH 6건 사전 실패.

## 해소
- 비-deprecated slug `/checkin/e2e-foot` + clinics route mock(공유 DB 비의존)으로 native 렌더 복구.
- walk-in 동선 selector 를 `btn-walkin`/`btn-reserved`/`btn-visit-new` testid 로 견고화.
- AC-3 은 REVAMP 신설 personal_info 단계를 거쳐 confirm 도달하도록 흐름 동기화.

## 결과
- commit 95bba86 (main, pushed).
- `npx playwright test` → 7 passed (6 TC + auth setup), 23.9s. 회귀 없음.
- 프로덕션 코드·DB 무변경.
