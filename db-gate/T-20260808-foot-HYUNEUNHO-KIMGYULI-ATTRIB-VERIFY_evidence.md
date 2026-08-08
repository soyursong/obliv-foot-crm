# T-20260808-foot-HYUNEUNHO-KIMGYULI-ATTRIB-VERIFY — 진단 evidence (READ-ONLY)

- 실행: `node scripts/T-20260808-foot-HYUNEUNHO-KIMGYULI-ATTRIB-VERIFY_diag.mjs` (SELECT only, write 0)
- DB: obliv-foot-crm PROD (rxlomoozakkjesdqjtvd)
- 재진단 계기: FIX-REQUEST(MSG-20260808-214445-j9rb) — 1차 결론 "현은호 CTB 0건=판매없음"이 오답. payment-side 축 미확인이 원인.

## 핵심 구조 (SalesStaffTab 화장품 집계 축)
- 화장품 매출/팝업 = `check_in_services`(cis) 판매라인 기준. 버킷 = `COALESCE(cis.seller_staff_id, check_ins.therapist_id)`. 날짜축 = `check_ins.checked_in_at`.
- **`payments` 테이블에는 `seller_staff_id` 컬럼이 아예 없음**(확인: `column payments.seller_staff_id does not exist`). → payment-only 레코드는 seller 축 자체가 없어 화장품 집계·팝업에 구조적으로 미표시.

## A. 현은호 (F-4717, id 6412fbf7)
- payment **2e8f7aa5** 실재: CTB(케어토어밴드) 15,000 card, `check_in_id=c33dfc76`, status active, created 2026-07-28T03:00Z(=7/28 12:00 KST), external/manual·pg 미결속·package_id=NULL. (T-20260806 payment-only INSERT분)
- check_in **c33dfc76** = 7/28 재진, `therapist_id=3a0c6774(김규리)`, done. → **방문·결제는 김규리에 결속됨**.
- 현은호 `check_in_services` 화장품 라인 = **0건** (전체 서비스라인 26건 중 풋화장품 0). → CTB 15,000의 **cis 판매라인 부재**.
- 결론: 판매는 실재(payment)하나 cis 화장품 라인이 없어 SalesStaffTab '담당치료사별 화장품 매출(김규리)'에 미표시. 원인=귀속-NULL 아님, **cis 라인 부재(payment-only)**. 집계쿼리 필터버그 아님(payments를 보지 않음).
- SALESLIST backfill(T-20260725, F-4550/5016/4906)에 현은호(F-4717) **미포함** → 그 backfill이 현은호를 커버 안 함.

## B. 화장품 팝업 (김규리 데이터원)
- 김규리 seller 화장품 cis 라인 = **18건 / 391,000** (6/27~8/8). → 팝업 데이터원 건강, 인프라 정상.
- 현은호 CTB·김병완 화장품은 cis 라인이 없어 어떤 드릴다운에도 안 뜸 = 데이터 부재(렌더버그 아님).

## C. 김병완 (F-4741, id 259abd32) — ★별도 티켓 T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI 로 분리됨 (본 티켓 gap 아님, 참고 READ-ONLY)
- payment **b7ab6496-9efc-429c-9d5c-60a248eabc15** 실재: 73,000 status active, created 2026-08-01T01:59Z(=8/1 10:59 KST), customer 김병완.
- 김병완 8월 `check_in_services`: 7건(재진진찰료/레이저/백선/크림) — **화장품 라인 없음, 전부 seller_staff_id=NULL**.
- 결론: 8/1 화장품 73,000은 payment(b7ab6496)로만 존재, cis 화장품 판매라인·seller=김규리 귀속 없음 → 김규리 8월 화장품 매출 미반영. 별도 CIS-REINSERT 티켓 전제 확인됨.

## 통합 근본원인
payment-only 레코드(현은호 2e8f7aa5, 김병완 b7ab6496)는 cis 화장품 판매라인이 없어 seller=김규리 화장품 집계·팝업에 구조적으로 미표시. 정정 경로 = 코드 수정 아님, **cis 화장품 판매라인 데이터 정정/재삽입**(seller=김규리) 별건 backfill (Data-Correction Backfill SOP).

READ-ONLY 준수: prod write / DDL / 배포 0.
