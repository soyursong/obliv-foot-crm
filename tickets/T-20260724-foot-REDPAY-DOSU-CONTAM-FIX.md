---
id: T-20260724-foot-REDPAY-DOSU-CONTAM-FIX
domain: foot
status: consult-pending
priority: P1
parent: T-20260724-foot-REDPAY-DAY1-RECONCILE (done, SPINOFF)
da_consult_required: true
da_consult: REQUIRED (착수 게이트, 파트A/B build 前 필수) — CONSULT-REQUEST 발행 완료. DA GO(층·삭제방식·SSOT·cross-tenant ruling) 수신 후에만 파트A/B 착수. RAW 정정(파트B)은 DA GO 전 절대 금지 (autonomy §3.1 파괴적/원장정정).
db_change: true (파트B RAW 정정 — redpay_raw_transactions 도수 2행). DA GO 후 mig_* 5필드 기입 + rollback SQL + dry-run.
e2e_spec_exempt: false (poller 필터 parity 회귀 spec + 도수 유입 0 재현 spec 추가 예정)
mig_gate: 미기입 (deploy-ready 마킹 시 archive-first 백업 + 정정 마이그 + 롤백 5필드 기입)
forensic:
  leak_vector: poller (redpay-reconcile) — webhook EF drop 로직은 정상 확증(무조치)
  freeze_set: approval_no=62071914 / mid=1777276003 (BODY_MERCHANT_SET 확증) / 2행 (external_status Y/N)
  net_truth: 풋457 net=승인24 + 취소1 / net 10,779,980 (도수 제거 후 정합 대상값)
relay_target: responder (thread 1784708681.507149, 최필경)
---

# T-20260724-foot-REDPAY-DOSU-CONTAM-FIX — 도수(비풋) 신호 오염 정정 + poller 필터 parity

## 요약
7/24 REDPAY-DAY1-RECONCILE done 의 스핀오프. 도수(비풋) 결제 신호가 풋 `redpay_raw_transactions` 에
유입된 오염을 정정하고, 재유입을 막기 위해 poller(redpay-reconcile)에 webhook EF 와 동일한
풋 whitelist(merchant 26-set) parity 를 적용한다.

## 포렌식 확정 (MSG-090116-5ilf 회신)
- **누출 벡터 = poller(redpay-reconcile)**. webhook EF 는 ingest-time merchant_id drop(`centerForMerchant`)이
  정상 동작함을 확증 → **webhook 무조치**.
- **freeze-set = approval_no 62071914 / mid=1777276003 / 2행(Y/N)**. 1777276003 은 `BODY_MERCHANT_SET`(도수 14-band) 소속 확증.
- **RC**: poller 는 ingest 시 **merchant_id drop 이 없다**. 유일한 클라이언트-측 방어 `filterToFootScope()` 는
  **TID 화이트리스트** 기준이며, `REDPAY_TID_WHITELIST` 비어있으면 전량 pass-through(index.ts L1067).
  webhook 은 `centerForMerchant` 로 body/unknown 을 ingest 전 drop 하지만, poller 는 body merchant 를
  raw 에 적재한 뒤 `centerForRawRow` 로 로그 stamp 만 할 뿐 raw 행은 남는다 → 풋 count 오염.

## 진행 게이트 (엄수)
1. **[완료] DA CONSULT-REQUEST 발행** — 4질문(층/삭제방식/SSOT/cross-tenant). GO 수신 전 파트A/B build·RAW정정 금지.
2. **[대기] 파트A(근본)** — DA 확정 층에 whitelist 필터 적용 → poller 도수 재유입 0. 7/23 daily_full 재pull 멱등 재현.
3. **[대기] 파트B(정정)** — archive-first(원본 스냅샷 백업→정정), freeze-set=62071914 2행, 단일 count 기준 정정 금지,
   정정 직전 freeze-set 재검증(대상외 혼입 시 abort), 순소실0. 정정 후 풋457 net=현장 진실값(net 10,779,980) 정합.
4. **[대기] deploy-ready** — MIG-GATE 5필드(archive 백업 + 정정 마이그 + 롤백).
5. **[대기] responder relay** — thread 1784708681.507149 최필경.

## 범위 경계
- 본 티켓 = poller 필터 parity + 기유입 도수 2행 정정. webhook EF = 무조치(정상 확증).
- whitelist SSOT = WHITELIST-EXPAND-0723GAP 확장분과 단일정의 교차확인(divergence 시 재오염/재누락) — DA CONSULT Q3.
