---
id: T-20260728-foot-REDPAY-VERIFY-METHOD-HARDEN
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 2964e654
deployed_at: 2026-07-29T03:17:00+09:00
bundle_hash: ef_only — FE 번들 무변경(scripts/docs/evidence only)
deploy-ready: true
build-passed: true
db-change: false
e2e-spec: "ef_only — 순수함수 self-test 대체. redpay_tid_bidir_reconcile.mjs --self-test 24/24 PASS(금액+DB-flow 추가) · redpay_envshadow_valuecheck.mjs --union-convergence-proof PASS(exit 0). FE 렌더 변경 0 → E2E 면제."
e2e_spec_exempt: ef_only
summary: "총괄 최필경 검증방법 강화(FULL-INTAKE — 원문 tail 수신, 4축 확정). 신규 기능 아님 — 부모/자매 verification deliverable 로 fold(중복 배포물 0). [확인순서=Axis C] Axis B(목록 diff) 먼저 → Axis A(env-shadow) 다음(근거='지금 매출 빠지는 중인지 먼저'). [Axis B 선착수→TID27-RECONCILE] redpay_tid_bidir_reconcile.mjs 를 양방향+실목록+★금액으로 격상: '우리' 기준을 registry active→**DB 실거래 TID**(redpay_raw_transactions)로 재정의(registry-vs-API 로 은폐되던 미적재 침묵-드롭을 DB-vs-API flow 로 포착) + 금액(건수·부호보존 net) 산출. self-test 24/24. 라이브 census(14일=7/15~28): 정방향 forward-db-only=0(₩0) + 역방향 foot-silent-drop=1(net ₩0, TID 1047479158 풋무선/1777289012 = DB 캡처 갭, 매출액 0) + cross-center 24종 ₩74.3M(타센터 정상부재) → **매출 silent-drop 금액 0 = 지금 매출 빠지는 중 아님** 확정, foot-silent-drop 1건 planner FOLLOWUP 통지. [Axis A 후속→REGUNION-FIX] 허용목록 런타임 판독 지점 전수(4)+미계측 표면 D 발견 + valuecheck poller·watchdog count+SHA256+정렬목록 1:1 대조 + union 前(3)/後(0) 결정적 증명(PARTIAL 유지). [Axis D 비대상] item4 웹훅 EOD 리포트=WEBHOOK-LATENCY-REMEASURE owner, 본 티켓 착수·배포 금지. db_change=false·no-DDL·no-data-mutation·registry SSOT/admit/매출split/Axis D 무접촉."
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

## 확인 순서 (Axis C — 총괄 명시): Axis B(목록 diff) 먼저 → Axis A(env-shadow) 다음
근거 = "지금 매출이 빠지는 중인지가 먼저". 아래 순서도 B→A.

## Axis B (★선착수) → 자매 TID27-REGISTRY-RECONCILE (census 양방향+금액 격상)
- **"우리" 기준 = DB 실거래 TID**(7/15~28 거래 있던 TID, `redpay_raw_transactions`). registry-vs-API 로는 은폐되던
  "RedPay 처리됐는데 우리 DB 미적재" 침묵-드롭을 DB-vs-API 축(flow)으로 포착 + **금액(건수·net) 산출**.
- `scripts/redpay_tid_bidir_reconcile.mjs` — 양방향 5-status + DB-flow(captured/reverse-api-only/forward-db-only/no-txn)
  + merchant 렌즈(foot-silent-drop vs cross-center) + 금액. self-test **24/24**.
- 라이브 census(14일=7/15~28): **정방향 forward-db-only=0(₩0)** + **역방향 foot-silent-drop=1(net ₩0, TID 1047479158
  풋무선/1777289012, DB 캡처 갭)** + cross-center 24종 ₩74.3M(타센터). → **매출 silent-drop 금액 0 = 지금 매출 빠지는 중 아님**.

## Axis A (후속) → 부모 REGUNION-FIX (verification AC 강화)
1. `docs/REDPAY-ALLOWLIST-RUNTIME-LOCI.md` — 용어 매핑 + 허용목록 런타임 판독 지점 전수(4). ★신규발견: reconcile EF(D) env TID 미계측 표면.
2. `scripts/redpay_envshadow_valuecheck.mjs --union-convergence-proof` — poller·watchdog 런타임 실 로드값(count+SHA256+정렬목록) 1:1 대조 + union 前(divergence=3)/後(0) 결정적 증명. UNION_CONVERGENCE_PROVEN.

## Axis D — ★본 티켓 비대상
item4 웹훅 EOD 리포트 = owner T-20260728-foot-REDPAY-WEBHOOK-LATENCY-REMEASURE(in_progress) 전량 커버. 본 티켓 착수·배포 금지(중복 방지).

## 게이트
dev-foot → deploy-ready(본) → **supervisor**:
1. 코드리뷰 read-only·no-DDL·no-data-mutation·SSOT/admit/매출split/Axis D 무접촉 확인.
2. self-test 재현: `node scripts/redpay_tid_bidir_reconcile.mjs --self-test` (24/24) · `node scripts/redpay_envshadow_valuecheck.mjs --union-convergence-proof` (exit 0).
3. (선택) 라이브 census 재현: `--census --days 14` (env 필요) → forward-db-only=0 · foot-silent-drop net ₩0 재확인.
4. 부모/자매 티켓 evidence 링크 fold 확인(중복 배포물 0).
