---
id: T-20260728-foot-REDPAY-VALUECHECK-EF-AUTH-LEDGER-SPINOFF
domain: foot
priority: P1
status: deploy-ready
deploy-ready: true
build-passed: true
db_change: false
e2e-spec: "ef_only 면제 — introspection GET 라우트 auth 게이트를 실 EF 핸들러(supabase/functions/redpay-webhook/index.ts) localhost 전용 기동(deno run, 공개배포 아님) + curl 6-case 로 실증(T1 noauth→401 / T2 wrongbearer→401 / T3 service_role→200+fingerprint / T4 no-introspect→405 / T5 cross-tenant foot-scope leak=0 / T6 POST 결제경로 격리). FE E2E 무관(EF-side only). evidence/T-20260728-foot-REDPAY-VALUECHECK-EF-AUTH-LEDGER-SPINOFF_EVIDENCE.md + _raw/*.json"
summary: "부모 RUNTIME-VALUECHECK(a9904286, deployed/Green, poller↔watchdog NO_ENV_SHADOW)와 직교한 EF-side 잔여 caveat 3건 실증. AC-1(a)★ redpay-webhook introspection GET(?introspect=whitelist, whitelistFingerprintEf +50줄) auth 게이트 실증거: 실 핸들러 로컬기동+curl → 미인증/오인증 401(unauthorized_introspection)·service_role Bearer 정확일치만 200+fingerprint·결제 POST 경로 top early-return 양방향 격리·cross-tenant foot-scope 무붕괴(응답 merchant27 전부 foot, body 대역 1777274/275/276 leak=0. EF 는 FOOT_MERCHANT_SET 단일 정적모듈만 read, BODY_MERCHANT_SET 미참조=설계상 유출 불가). ★fail-safe 준수: auth 실증 前 공개 functions deploy 0건(로컬 localhost 기동만). AC-2(b) 현 배포본 introspection 미반영 실증(라이브 GET→405 method_not_allowed=구빌드, 반영본이면 401 여야) + 배포경로(supabase functions deploy redpay-webhook) 명시 + 결정=HOLD(미배포 유지): poller↔watchdog 이미 충분·EF 는 정적모듈 read 라 배포해도 새정보 0·공개 introspection 노출 최소화 → 배포결정 supervisor code-gate 이관. AC-3(c) commit/원장 3자정합: a9904286 ⊆ origin/main YES(merge-base --is-ancestor, HEAD 2e2f9f2b 기준 16 commit 이전) → VALUECHECK deployed status 정합. db_change=false → a9904286 migration 파일 무접촉(scripts/EF/tickets/evidence only) → schema_migrations 무접점. bonus: EF merchant_sha256 cc86c311…5601 == poller == watchdog 완전일치(3방 런타임 정합)."
created: 2026-07-28
reporter: planner
parent_ticket: T-20260728-foot-REDPAY-ENVSHADOW-RUNTIME-VALUECHECK (a9904286, deployed/Green)
spinoff_of: supervisor FIX-REQUEST §3 (planner MSG-20260728-233640-n8oa)
commit: PENDING_SUPERVISOR_MERGE
deploy_decision: "HOLD (introspection GET 라우트 prod 미배포 유지). fail-safe 충족(AC-1 auth 실증)으로 배포 unblock 가능하나, poller↔watchdog(부모 deployed/Green)로 env-shadow 확인 충분 + EF 정적모듈 read 라 배포 이득 0 → 공개노출 최소화. 실 functions deploy 여부는 supervisor code-gate 판정에 이관, dev-foot 미배포."
risk_verdict: GO
risk_reason: "변경 격리 = evidence/*.md·_raw/*.json + tickets/*.md 만 (코드 무수정 — introspection 코드는 부모 a9904286 旣존재, 본 건은 순수 evidence·검증·배포결정). db_change=false: 마이그레이션·컬럼·테이블·enum 0. read-only: EF introspection 은 no-DB·no-mutation, 결제 POST 경로 무접촉(양방향 격리 실증). cross-tenant 무붕괴(foot-scope, body leak=0). 신규 npm 0. 대표게이트 면제(autonomy §3.1: db_change=false + no-DDL + read-only). supervisor code-gate 만(auth 게이트·foot-scope·read-only 리뷰). ★미인증 공개노출·cross-tenant 실노출 판명 없음 → P0 승격 미해당."
consult_ref: n/a (db_change=false·no-DDL·no new column/table/enum → 데이터 정책 자문 게이트 미해당)
---

# T-20260728-foot-REDPAY-VALUECHECK-EF-AUTH-LEDGER-SPINOFF

부모 RUNTIME-VALUECHECK(deployed/Green, poller↔watchdog 대조 완결)와 직교한 EF-side 잔여 caveat 3항목 실증.
AUTOSEED(c6a968db, code-gate 대기)와 완전 분리.

전체 실증거: `evidence/T-20260728-foot-REDPAY-VALUECHECK-EF-AUTH-LEDGER-SPINOFF_EVIDENCE.md`
raw curl 출력: `evidence/T-20260728-foot-REDPAY-VALUECHECK-EF-AUTH-LEDGER-SPINOFF_raw/*.json`

## 게이트
dev-foot 3건 evidence(AC-1/2/3) → **supervisor code-gate** (auth 게이트·foot-scope·read-only 리뷰).
대표게이트 면제(autonomy §3.1). E2E ef_only 면제.
