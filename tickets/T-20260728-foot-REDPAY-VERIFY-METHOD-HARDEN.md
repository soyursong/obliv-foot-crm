---
id: T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: d2c4de3d
deployed_at: 2026-07-29T02:45:00+09:00
bundle_hash: ef_only — FE 번들 무변경(scripts/docs/evidence only)
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: "ef_only — 순수함수 self-test 대체. redpay_tid_bidir_reconcile.mjs --self-test 15/15 PASS · redpay_envshadow_valuecheck.mjs --union-convergence-proof PASS(exit 0). FE 렌더 변경 0 → E2E 면제."
e2e_spec_exempt: ef_only
summary: "총괄 최필경 검증방법 강화(PARTIAL-INTAKE). 신규 기능 아님 — 부모 티켓 evidence-AC additive 상향, verification deliverable 로 fold(중복 배포물 0). [Axis A→REGUNION-FIX] (1) 허용목록 런타임 판독 지점 전수 지도 docs/REDPAY-ALLOWLIST-RUNTIME-LOCI.md: 용어확정(수집=poller.mjs·워치독=watchdog.mjs, EF 아님) + 4지점(poller/watchdog/webhook-EF/★reconcile-EF) 열거 + 신규발견=reconcile EF가 env REDPAY_TID_WHITELIST 읽는 미계측 표면(DRY_RUN inert 추정, folded follow-up 권고). (2) valuecheck.mjs --union-convergence-proof 신규모드: 구 shadow-early-return vs 신 env∪registry-union 을 동일 fixture 결정적 재현 → 前 divergence=3(silent-drop)/後=0(봉인) 증명. [Axis B→TID27-RECONCILE] redpay_tid_bidir_reconcile.mjs 신규: 양방향(정방향 registry→API / 역방향 API→registry) 5-status 목록표(active/superseded/absent/DB-only/API-only) + merchant-center 렌즈로 API-only 정밀화. 라이브 census: TID27 정방향 absent=0/27 + 역방향 foot-silent-miss=0(API-only 18종 전부 타센터 정상부재) → 매출 silent-drop 후보 0 재확증. [Axis C] MQ body 잘림 → planner FOLLOWUP 발행됨, 원문 수신 후 별도. db_change=false·no-DDL·no-data·registry SSOT/admit/매출split 무접촉."
created: 2026-07-28
reporter: planner
parent: T-20260728-foot-REDPAY-POLLER-ENVSHADOW-REGUNION-FIX
sibling: T-20260728-foot-REDPAY-TID27-REGISTRY-RECONCILE
mq_id: MSG-20260728-173721-p0bt
risk_verdict: GO
risk_reason: "read-only 계측·대조·문서 전용. 변경 = scripts 2파일(valuecheck 모드 추가 + bidir 신규) + docs 1 + evidence 3. FE·DB·EF·admit·registry SSOT·매출 split 전부 무접촉(코드/데이터 회귀 0). union-proof=순수함수 결정적 재현(prod 무접촉·no-revert). bidir 대사=registry·API read-only 조회(편입/변경 0). 신규 npm 0(SHA256/fetch 내장). db_change=false → DA CONSULT 불요. build ✅ · self-test 전건 PASS. supervisor 게이트만."
option_decision: "부모 티켓 verification deliverable 로 fold(별도 배포물 미생성, 중복 금지 규약 준수). reconcile EF(D) introspect 라우트 추가는 admit 무접촉이나 EF 코드변경 → 본 P2 범위 밖 folded follow-up 으로 분리(별도 supervisor 게이트)."
---

# T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN

총괄 최필경 검증방법 강화 요청(MSG-20260728-173721-p0bt). 기존 approved 티켓의 evidence-AC 를 additive 상향.
상세 evidence = `evidence/T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN_EVIDENCE.md`.

## Axis A → 부모 REGUNION-FIX (verification AC 강화)
1. `docs/REDPAY-ALLOWLIST-RUNTIME-LOCI.md` — 용어 매핑 + 허용목록 런타임 판독 지점 전수(4). ★신규발견: reconcile EF(D) env TID 미계측 표면.
2. `scripts/redpay_envshadow_valuecheck.mjs --union-convergence-proof` — union 前(divergence=3)/後(0) 결정적 증명. UNION_CONVERGENCE_PROVEN.

## Axis B → 자매 TID27-REGISTRY-RECONCILE (census 양방향 격상)
- `scripts/redpay_tid_bidir_reconcile.mjs` — 양방향 5-status 목록표 + merchant-center 렌즈. self-test 15/15.
- 라이브 census: 정방향 absent=0/27 + 역방향 foot-silent-miss=0(API-only 18=타센터 정상부재) → 매출 silent-drop 후보 0 재확증.

## Axis C — MQ body 잘림(미착수)
planner FOLLOWUP(responder 원문 요청) 발행됨. 회신 수신 후 별도 처리(본 커밋 미포함).

## 게이트
dev-foot → deploy-ready(본) → **supervisor**:
1. 코드리뷰 read-only·no-DDL·no-data·SSOT/admit 무접촉 확인.
2. self-test 재현: `node scripts/redpay_tid_bidir_reconcile.mjs --self-test` (15/15) · `node scripts/redpay_envshadow_valuecheck.mjs --union-convergence-proof` (exit 0).
3. (선택) 라이브 census 재현: `--census --days 7` (env 필요) → foot-silent-miss=0 재확인.
4. 부모/자매 티켓 evidence 링크 fold 확인(중복 배포물 0).
