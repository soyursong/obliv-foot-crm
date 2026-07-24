---
id: T-20260724-foot-REDPAY-1805PLUS-DOSU-CONTAM-DIAG
domain: foot
status: diagnosed
priority: P2
type: DIAG
parent: T-20260724-foot-REDPAY-457-COUNT-RECONCILE (done, Branch B)
reporter: 최필경 총괄 (U05L6HE7QF6) — finding ②③
db_change: false
read_only: true
mutation_count: 0
e2e_spec_exempt: true (READ-ONLY 진단 — mutation·코드변경 0. probe 스크립트만 산출)
da_consult_required: false (본 티켓 진단만. fix spinoff 이 게이트 승계)
auth_context: service_role (RLS bypass, 전건 관측 — 진단 인증컨텍스트 표준)
phi_hygiene: count/금액/시각/TID/merchant_id/approval_no/단말라벨/소스경로만. name/phone/RRN·member_name 제외.
evidence: scripts/T-20260724-foot-REDPAY-1805PLUS-DOSU-CONTAM-DIAG_RC-REPORT.md
probe: scripts/T-20260724-foot-REDPAY-1805PLUS-DOSU-CONTAM-DIAG_probe.mjs (+_probe2.mjs)
relay_target: responder (thread 1784708681.507149, 최필경)
---

# T-20260724-foot-REDPAY-1805PLUS-DOSU-CONTAM-DIAG — 18:05+ divergence 진단

## 결론 (routing)
1. **[AC1 취소 over-count +1] 도수 오염 확정 = 예.** approval_no 62071914 / merchant 1777276003(BODY "도수(무선)") /
   tid 1047479115 / ±1,004 페어(18:05:43·18:05:59). **오염경로 층 = (c)** 도수 단말 457-biz 리포트→poller merchant-drop 부재→
   필터해제 count 스코프분리 없음. (a)whitelist 오등록 아님·(b)뷰 정상배제. → **DOSU-CONTAM-FIX** 로 커버(동일 freeze-set 재확증).
2. **[AC2 승인 under-count] cause(a) VIEW-PAYLOAD-SHAPE 확정.** webhook envelope-shape 5행(8.7M/250K/260K/10K/20K)이
   `raw_payload->merchant->>id`=NULL ∧ tid=NULL 로 뷰 드롭 → 탭 승인 1건만 표면. cause(b) whitelist gap = 18:05+ 해당無.
   → **VIEW-PAYLOAD-SHAPE-FIX**.
3. **[AC3] 잔여델타**: 취소 축 0(완전설명). 승인 축 필터해제 raw 실풋6 vs 현장9 = **-3(도수보정 전 net -2) 미설명** —
   현장 approval 원장 필요(후보 webhook capture gap). 17:00~18:05 raw=0 → 경계오차 아님.

## 핵심 발견
총괄이 본 "장첸 DB 승인7/취소2" = **필터 해제 raw count**. 정상 필터 뷰는 승인1/취소1. divergence 는
"필터해제 raw(7/2)"와 "필터 뷰(1/1)" 두 숫자를 하나로 본 데서 증폭됨.

## 상세
→ `scripts/T-20260724-foot-REDPAY-1805PLUS-DOSU-CONTAM-DIAG_RC-REPORT.md`

## 범위 경계
- 본 티켓 = 진단(READ-ONLY)만. fix = DOSU-CONTAM-FIX(도수 raw 정정) + VIEW-PAYLOAD-SHAPE-FIX(뷰 shape).
- pre-18:05 백필 = DAILYFULL-0723-BACKFILL(별개 축). 잔여 -3 webhook capture gap spinoff = planner 판단.
