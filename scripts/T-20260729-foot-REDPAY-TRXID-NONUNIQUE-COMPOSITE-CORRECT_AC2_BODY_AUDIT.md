# AC-2 커버리지 확장 (center='body') — read-only 감사 결과

ticket: T-20260729-foot-REDPAY-TRXID-NONUNIQUE-COMPOSITE-CORRECT
지시: planner FOLLOWUP MSG-20260729-165546-jho2 (§[PLANNER-RESOLUTION] ★AC-2 커버리지 확장)
scope: obliv-foot-crm (Supabase rxlomoozakkjesdqjtvd). mutation 0 / SELECT only. 라이브 read-only probe.
date: 2026-07-29 / by: dev-foot
probe: scripts/..._AC2_BODY_probe.mjs · evidence: evidence/..._AC2_BODY_probe.out.txt
인증컨텍스트: service_role(RLS bypass, 진단 완전성). PHI 위생: trxid/status/amount/count/시각만.

---

## 배경 — 지시 vs 실측 (테이블명 정합 확인 선행)
planner 지시 = "총괄 6,770 송도 / 8자형 승인·취소 공유 trxid = `payment_reconciliation_log` center='body' 행(같은 물리테이블) → AC-2 probe 를 center='body' 로 확장". 착수 전 **추정 금지** — 물리테이블 2종을 실측 분리:
- `redpay_raw_transactions` = raw VAN 소스(직전 AC-2 가 merchant band 로 분리한 그 테이블). 총 440행.
- `payment_reconciliation_log` = reconcile **출력 이벤트로그**. `center` 컬럼 보유({'foot','body'}). 총 574,705행.

## 실측 요약 (라이브)
| 축 | 값 |
|----|----|
| payment_reconciliation_log 총행 | **574,705** (center=foot 553,720 / center=body **20,985** / null 0) |
| redpay_raw_transactions center 파생 | 440 (foot 413 / body **27** / unclassified 0) |
| ★8자형(순수 8-char) trxid — **전 테이블·전 center** | **0** (ledger 574,705 + raw 440 전수 스캔) |
| body ledger trxLen 분포 | **전량 12자** (0725C8xxxxxx 날짜프리픽스 형식) |
| body ledger 승인/취소(±) 공유 trxid | **0** (전량 +부호, match_rule=tier4_manual/null) |
| body raw(27) 승인/취소 공유 / dup / 8자형 | 0 / 0 / 0 |
| payments.external_trxid populated | 200 (그중 reconciled_at IS null = **0** → Tier0 매칭풀 진입 RISK 0, 現 inert) |

## AC-2(a) 8자형 dup 지문 — center='body'
**부재(0).** 순수 8-char trxid 는 foot Supabase 물리테이블(raw 440 + ledger 574,705) **어디에도 없음**. body ledger 20,985행 전량 12자·전량 +부호. 승인/취소 공유 페어 0.
→ ★총괄 6,770 송도(8자 112·6자 11·9자 53·14자 199·12자 6,395)/8자형 승인·취소 census 는 **foot 의 물리테이블에 적재되어 있지 않다.** = RedPay 포털/VAN 원천에서 총괄이 직접 감사한 모집단이며, body 폴러가 아직 그 형식을 CRM 으로 인입하지 않았거나 다른 원천. **"center='body' 행이 8자형 census 다"는 planner 전제는 실측 반증.**

## AC-2(b) undercount/false-merge 현행 위험 — center='body'
- **trxid∧부호∧amount composite collision 25건**이 관측되나, 이는 승인/취소 페어가 **아님** — 동일 (trxid, +부호, 동일 amount) 가 수백~수천 회 반복. 예: `0725C8257089|pos|30400 × 1718행`. → AC-3 composite(trxid∧status∧amount)로 **분리되지 않는다**(3키 전부 동일). composite 축과 **직교**.
- dup trxid 내 payment_id 불일치·부분링크(false-merge) = **0** (전량 payment_id=null, match_failed/missing).
- ★실 원인 = **RECONLOG-IDEMPOTENCY 무력화(body)**. `0725C8257089`(1718행) 심층: **raw_transaction_id 단일**(`0a022f3f…`, raw 테이블 실재), event_type = match_failed 684 + missing_in_crm 1034 **양상태 진동**, 4일(07-25·27·28·29) 약 540행/일 = 폴 주기당 1행. RECONLOG-IDEMPOTENCY(T-20260725, planReconLogInserts) 는 raw별 **직전 event_type 과 동일할 때만** 억제 → match_failed↔missing_in_crm **왕복은 매 사이클 '상태전이'로 판정되어 억제 미발화** → 로그 무한증식. body ledger 20,985행 상당수가 소수 진동 raw 의 산물(count 인플레). ← forensic816(1 raw→816행)과 동류이나 **2-상태 진동 케이스는 現 idempotency 게이트가 커버하지 못함**.
  → 본 티켓(trxid composite) **스코프 밖**. 별개 correctness 이슈(body reconcile 진동 + idempotency 2-상태 확장). planner 판단(별도 발번 여부) 대상 — dev-foot 임의 발번 안 함.

## AC-2(c) Plan B 직수집 활성화 노출 경로
payments.external_trxid populated = 200, 그중 reconciled_at IS null = **0**. → foot 과 동일하게 Tier0 매칭풀 진입 후보 0 = 現 inert. Plan B(PAYPAGE-BUILD) 가 external_trxid 를 채우면 활성화되는 게이트 구조는 body 도 동일(같은 matcher). 단 8자형 body 데이터가 물리테이블에 없어, 활성화 시에도 **현 적재분 기준으론** 8자형 false-merge 노출 없음(미래 인입분은 AC-3 composite 로 봉인).

## AC-3 자동보호 정합 (planner fold 검증)
- planner: "foot AC-3 composite 봉인이 center 무관 全 행 처리 → center='body' 자동보호". → **구조적으로 사실**(같은 물리테이블·같은 EF matcher, findTier0Direct 는 center 필터 없음). body 별도 matcher 부재(dev-body census MSG-kyqb) 도 정합.
- 단서: 現 적재 body 데이터에는 8자형/승인·취소 공유가 **없어** AC-3 이 today 보호할 body 대상이 실재하지 않음. AC-3 은 **미래 인입분 방어**로 유효.

## AC-4 fixture 지침 (실측 반영 — planner 확인 필요)
planner: "AC-4 fixture 가 실제 songdo body 데이터를 반영". → 실측상 **실제 songdo body 데이터(물리테이블 center='body')는 8자형 승인/취소 공유를 포함하지 않음**(전량 12자·+부호). 따라서 8자형 승인/취소 공유 fixture 는 **총괄 외부 census 기반 방어적/합성 fixture** 로 표기해야 정확(= "적재된 body 데이터의 재현"이 아님). fixture 는 유지하되 라벨을 '방어(총괄 census)'로 명확화 권고.

## 판정
- **AC-2 body 커버리지 clear** (read-only, mutation 0). trxid composite 축 기준: body 물리행에 8자형/승인·취소 공유/false-merge = 0.
- **AC-3 게이트 = DA GO 대기** 유지(변동 없음). AC-3 은 미래 인입분 방어로 center 무관 유효.
- **신규 관측(스코프 밖) = body ledger count 인플레(RECONLOG-IDEMPOTENCY 2-상태 진동 미커버)** → planner FOLLOWUP 로 통지. dev-foot 임의 발번 안 함.
