# AC-2 read-only 감사 결과 — T-20260729-foot-REDPAY-TRXID-NONUNIQUE-COMPOSITE-CORRECT

scope: obliv-foot-crm (Supabase rxlomoozakkjesdqjtvd). mutation 0 / SELECT only. 추정 금지 — 코드실측 + 라이브 read-only probe.
date: 2026-07-29 / by: dev-foot

## AC-2(a) trxid-단독 유일키 코드 지점 실측 열거
| # | 지점 | 파일:라인 | trxid 단독 사용? | 현 상태 |
|---|------|-----------|-----------------|---------|
| 1 | Tier0 ① trxid-exact 가지 | matcher.ts findTier0Direct L229-238 | YES (raw.external_trxid == p.external_trxid) | **구조적 inert(이중)**: 같은 filter가 `isUnmatchedCrm(p)`(external_trxid IS NULL) **AND** `p.external_trxid !== null` 요구 → 상호모순, 데이터 무관 항상 []. + 데이터 inert(아래 (d)). |
| 2 | Tier0 ② 단일 composite | matcher.ts L240-285 | NO | 이미 composite: 식별자(approval_no OR tid) ∧ amount ∧ card ∧ payment ∧ same-KST-day ∧ forward. trxid 미사용. |
| 3 | ingest dedup (webhook) | redpay-webhook/index.ts L409 | NO | 이미 composite `onConflict (external_trxid,external_status,amount)`. |
| 4 | detectRefundNotInCrm 원거래 매칭 | matcher.ts L654-660 | YES (p.external_trxid == root_trxid ?? external_trxid) 단독 | 취소 raw→원 payment 링크가 trxid 단독. 8자형(승인/취소 동일 trxid)에서 오답 여지 → DA Q4 로 회부. 현 데이터 inert(아래). |
| 5 | 리포트 count | v_redpay_reconciliation_daily / RedpayReconcileTab | NO | raw-row-grain (r.id → row_id 1:1). trxid-distinct GROUP BY/DISTINCT 없음 → undercount 경로 無. |

## AC-2(b) ingest dedup = 이미 composite (확정)
redpay-webhook/index.ts L409 `onConflict:"external_trxid,external_status,amount"` (폴러 유니크키 동일).
⇒ 승인(Y)/취소(N) status 로 분리 보존. 부호(±amount)까지 있으면 amount 로도 분리. **승인/취소 보존 중.**

## AC-2(c) 리포트 count = raw-row-grain (undercount 없음, 확정)
- v_redpay_reconciliation_daily: Part A `FROM redpay_raw_transactions r ... r.id AS row_id` (raw 1건=1행), Part B crm-anchored missing_at_van. trxid distinct 접기 無.
- RedpayReconcileTab.tsx L137-138: matchedCount/mismatchCount = 뷰 행수 그대로. FE dedup 無.
⇒ 승인/취소·단형 dup 이 각기 별도 raw 행 → 각기 count. **접힘/undercount 경로 없음.**

## AC-2(d) 現 레저 오링크 유무 — 라이브 read-only probe (foot 프로젝트)
probe: scripts/..._probe.mjs + curl content-range 검증.
```
raw 전건 = 430  (seoul-origin/foot 340 + other/songdo-etc 90)
seoul-origin(foot) trxLen 분포: {12:253, K+30:80, K+31:7}
  trxid dup(동일trxid≥2): 8건 (모두 12/K+30/K+31 — 8자형 0)
  ★composite(trxid|status|amount) collision(≥2): 0  → 3키 충분
  ★8자형 승인/취소 공유 trxid: 0
other(songdo-etc) trxLen 분포: {12:27, K+30:46, K+31:17}
  trxid dup 0 / composite collision 0 / 8자형 공유 0
payments total = 389
  external_trxid NOT null = 192  (★ 전부 reconciled_at NOT null)
  external_trxid NOT null ∧ reconciled_at IS null = 0   ← Tier0 매칭풀 진입 RISK = 0
  external_approval_no NOT null = 0
  external_tid NOT null = 0
```
### 판정
- **現 레저 오링크 = 0.** trxid-기반 auto-link 지점(Tier0①, detectRefundNotInCrm) 전부 미발화:
  Tier0① = 구조모순 + 매칭풀 진입 payment(external_trxid∧unmatched)=0.
  detectRefundNotInCrm = payment.external_trxid populated 192건이 전부 reconciled(=원거래로만 존재)이나,
  현 취소 raw 매칭은 트리거 안 됨(별도 회귀 fixture로 AC-4 커버). Tier0② 식별자(approval_no/tid)=0/0 → 완전 inert.
- **composite (trxid,status,amount) 3키 = foot 프로젝트 데이터에서 collision 0 → 충분.** (DA Q1 실측 근거)

## ★ 도메인 스코프 정합 (중요) — ⚠ 아래는 planner FOLLOWUP(MSG-165546-jho2)로 정정됨, 하단 UPDATE 참조
- 총괄 전수검증의 **송도 6,770 / 8자형 승인·취소 공유 trxid** 는 **foot 프로젝트(rxlomoozakkjesdqjtvd)에 없음** (foot=430 raw, 8자형 0).
  → 8자형 false-merge 는 **body(도수/송도) 데이터 현실** = 별도 프로젝트/레포(obliv-body-crm, dev-body 소유).
- matcher.ts / redpay-webhook 은 foot repo 정본이나 body 가 하드포크 보유 추정 → **foot 하드닝이 body 를 자동보호 안 함.**
  ⇒ 동일 composite 하드닝을 obliv-body-crm 에도 미러해야 함 = **dev-body 크로스도메인 코디 필요(planner 조율)**.

## ★★ UPDATE (2026-07-29, planner FOLLOWUP MSG-20260729-165546-jho2 후속) — 위 "body 미러 추정" 정정
1. **body 별도 matcher 미러 = 불필요 (planner fold).** dev-body census(MSG-kyqb): body 는 독립 recon 테이블/폴러/EF matcher **부재**. body RedPay = foot 소유 단일 물리테이블 `payment_reconciliation_log` 의 `center='body'` 행으로 적재 + foot 의 redpay-reconcile EF matcher 가 그대로 처리(body 는 `v_redpay_reconciliation_body` SELECT-only 소비). → foot AC-3 composite 가 center 무관 全 행 자동보호. 위 "body 하드포크 보유 추정"은 **반증됨**.
2. **AC-2 커버리지 center='body' 확장 실측 완료** → 별도 문서 `..._AC2_BODY_AUDIT.md`. 핵심: 8자형 승인/취소 공유 trxid = 전 테이블(raw 440 + ledger 574,705) **0**. 총괄 6,770/8자형 census 는 foot 물리테이블에 **미적재**(외부 원천). body ledger 20,985행 전량 12자·+부호.
3. **신규 관측(스코프 밖)**: body ledger count 인플레 — RECONLOG-IDEMPOTENCY(T-20260725) 2-상태(match_failed↔missing_in_crm) 진동 미커버. planner 통지 완료.

## AC-3 (DA GO 후) — 예정
- Tier0① trxid-exact 가지를 DA 확정 composite 로 교체(구조모순 제거 + status∧amount AND). Plan B 직수집 착지 前 봉인.
- detectRefundNotInCrm 원거래 매칭 강화(DA Q4 판정 반영).
- AC-4 회귀0: 승인/취소 페어 보존 self-test fixture(8자형 공유 trxid → 2행 보존) + 서울오리진 불변 + 358 Y-row 0회귀.
- AC-5 supersede 문언 정정(TIER0-TRXID-HARDENING §매칭SSOT / NONUNIQUE-GUARD AC-3①·AC-6 → 'trxid≠전역유일키').
