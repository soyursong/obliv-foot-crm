# CONSULT 요청 — T-20260808-foot-HEO4717-2E8F7AA5-CIS-CREATE-KIMGYURI (파괴 write 1차 게이트·이중계상 dispositive)

**from**: dev-foot · **to**: data-architect · **domain**: foot · **change_class**: DATA_CORRECTION_BACKFILL · **db_change**: true · **artifact_class**: db_only
**ball**: dev-foot(DA CONSULT 요청부터). 본 CONSULT-REPLY의 **이중계상 판정(GO/NO-GO/대안)** 수신 전 파괴 write(cis CREATE/UPDATE/dry-run apply) 착수 금지. ★DA GO ≠ apply 허가(apply 는 별도 supervisor DB-GATE GO-token 후).

## 요청 취지
현은호(F-4717) 7/28 케어토어밴드(CTB) 15,000 결제 `2e8f7aa5`가 SalesStaffTab **김규리 화장품 매출에 미표시**. 부모 진단(T-20260808-foot-HYUNEUNHO-KIMGYULI-ATTRIB-VERIFY, done, 40459026)이 근본원인 = **cis 화장품 판매라인 부재**로 확정. 정정 = 부재 cis 화장품 라인 **신규 CREATE**(무→유) + seller_staff_id=김규리 귀속.

## ★핵심 차이 (자매 F4741 REINSERT 와 구조 상이)
- **김병완 F4741 (자매 REINSERT)**: cis 존재 → 08-03 차트 재저장으로 wipe(유→무) → 복구=**원상**, 이중계상無.
- **현은호 F4717 (본건 CREATE)**: cis 애초 미생성 — `2e8f7aa5`는 선행 done `T-20260806-foot-HEO4717-CBAND-15K-MISSPAY-ADD`에서 **이중계상 가드로 의도적 payment-only INSERT(cis 미생성)**. → cis **신규 CREATE**(무→유)라 기존 payment 가 다른 매출축에서 이미 계상 중이면 **이중계상 재유입 위험** = 본 CONSULT dispositive.

## ★DISPOSITIVE 질문 (Q1) — cis 신규 CREATE 가 이중계상을 유발하는가?
dev-foot READ-ONLY prod census(commit 예정, `scripts/…_census.mjs` / `db-gate/…_census-evidence.json`) 실측 결과를 근거로 제시. **DA 가 이 topology 로 GO/NO-GO 확정 요청:**

1. **`v_daily_revenue` 뷰 정의(실측 [7])**: 소스 = `payments`(single CTE) + `package_payments`(pkg CTE) **오직 2개**. `WHERE status='active' AND clinic_id IS NOT NULL`. → **check_in_services 미참조.**
2. **check_in_services 를 참조하는 뷰(실측 [8]) = `[]` (0건).** cis 는 총매출/일마감/수납/명세 **어느 뷰에도 소스로 안 들어감.** SalesStaffTab 화장품칸은 cis 를 **FE 에서 직접 조회**(부모 진단 L406~424, payments/뷰 미경유).
3. **payments 참조 뷰(실측 [9])**: `v_daily_revenue`, `v_daily_avg_spend`, `v_monthly_consultant_perf`, `v_monthly_therapist_perf`, `v_receipt_settlement_daily`, `v_redpay_reconciliation_daily/_body` — 전부 payments 축. **어느 것도 cis 미참조.**
4. **2e8f7aa5 계상 실측 [10]**: `counted_predicate=true`, `revenue_dt=2026-07-28`, `amount=15000` → **이미 v_daily_revenue(총매출/일마감) 07-28 에 15,000 계상 중**(T-20260806 apply 로).

**∴ dev-foot 소견(판정은 DA)**: 총매출/일마감축(payments-기반)과 SalesStaffTab 화장품-판매자귀속축(cis-기반)은 **동일 total 로 합산되는 뷰가 0** = **직교(orthogonal)**. cis 1라인 CREATE 시 15,000 은 (i)총매출에 이미 있는 payment 계상엔 **무영향**(어떤 뷰도 cis 를 payment 와 합산 안 함), (ii)화장품-판매자-슬라이스에만 신규 표시. 즉 **T-20260806 가드가 막으려던 "동일 15,000 이 두 축에서 total 이중계상" 은 현 topology 상 재유입되지 않음.** → **GO 가능성 높음.** 단 아래 잔여 검토가 dispositive:
   - (검토 A) `v_monthly_therapist_perf` 등 **치료사 실적 뷰가 payments 로 CTB 15,000 을 이미 김규리 실적에 귀속**하고 있다면, SalesStaffTab 화장품칸(cis)과 **"김규리 매출" 인식이 화면상 중복**될 여지가 있는가? (동일 total 합산은 아니나 총괄 인식축 관점) — DA 판정 요청.
   - (검토 B) cis CREATE 가 **하류 트리거/도파민 outbox/service_charges 자동생성** 등 side-effect 로 매출축을 건드리는가? (실측 [11]: c33dfc76 의 service_charges 는 재진 진찰료 1건(base 4,693)만 존재 — CTB 대응 명세 부재. cis INSERT 가 service_charges 를 자동파생하는 경로 존재 여부 DA 확인.)

**요청 판정 형식**: (a) cis 신규 CREATE 안전(축 분리로 total 이중계상無) → GO / (b) 대안(seller 귀속만·뷰 단 정정·정정 불가) / (c) NO-GO(파괴 write 금지, 대안 권고·close). T-20260806 가드 근거(cis 생성 시 어디서 이중계상되는지) 역추적 판정 포함.

## Q2 — SOP 봉투 선택
본건은 파괴적 delete 가 아니라 **부재 행 신규 INSERT**(무→유) + seller 설정.
- `Cross-CRM Data-Correction Backfill SOP`(mutable UPDATE 표준, §0 파괴삭제/원장정정 배제) 와 자매 F4741 REINSERT 봉투 선례(za0g CONSULT 진행) 중 어느 것이 governing? 혼합(INSERT=Backfill 계열 + 안전장치=archive-first freeze/순소실0/판정근거 스냅샷 차용)이 자매와 동일 적용 가능한가?

## Q3 — 값 provenance (창작 금지, dev 실측 근거)
임의 창작 0 — 아래 prod 실측값으로 write target 확정:
- **품목/금액**: service `e17ba3a3` = "Care Toe Band (CTB)", price **15,000**, category=기타/category_label=**풋화장품** (실측 [4]). payment 2e8f7aa5.amount=15,000 과 일치.
- **부모 check_in**: `c33dfc76`(현은호 F-4717, checked_in_at **2026-07-28** 10:19 KST, therapist=김규리, status=done) (실측 [2]). → cis 를 이 check_in 에 붙이면 **화장품 표시월=7월(07-28)** = 총괄 원 프레이밍(7/28) 정합. **08월 check_in 신설로 8월 표시 = 데이터왜곡·비권장.**
- **cis write target 컬럼**(실측 [6]): check_in_id, service_id=e17ba3a3, service_name, price=15000, original_price=15000, is_package_session=false, package_session_id=NULL, seller_staff_id=<김규리>. (cis 에 amount/quantity 컬럼 없음 — price 사용.)
- 이 provenance floor(payment amount + service master + 부모 check_in) 를 acceptable 로 볼 수 있는가? (자매와 달리 본건은 소멸 前 원본 지문 자체가 부재 = 애초 미생성 → 결제·품목 마스터 지문이 유일 근거) — DA 판정.

## Q4 — seller 귀속축 + ⚠ 동명이인
- ⚠ **김규리 staff row 2개 실측 [3]**: (i) `3a0c6774` role=therapist (= check_in c33dfc76 의 therapist_id, **방문에 결속된 김규리**), (ii) `d26717cb` role=admin. → seller_staff_id 에 **어느 김규리를 쓸지 dispositive**.
  - dev-foot 소견: 부모 진단·자매 트랙이 김규리=**3a0c6774**(therapist) 로 일관. SalesStaffTab 버킷 = `COALESCE(seller_staff_id, therapist_id)` 이고 therapist_id=3a0c6774 → **seller_staff_id=3a0c6774 로 설정하면 방문결속 김규리 단일 버킷 정합.** (참고: seller_staff_id=NULL 로 두면 COALESCE fallback 으로도 therapist_id=3a0c6774 김규리 버킷에 표시되나, 티켓은 seller 명시 귀속 지시.)
  - DA 확인 요청: seller_staff_id = **3a0c6774**(therapist 김규리) 가 판매귀속 정합인가? admin d26717cb 는 배제 맞는가?
- seller_staff_id(판매귀속)가 §416 `created_by`(방화벽)/registrar 축과 **직교**한 mutable 판매귀속 필드임을 확인(방화벽 물리 write 아님).

## Q5 — SOP 기계 게이트 체크리스트
cis CREATE 에 요구하는 안전장치 확인: archive-first(mutation 前 c33dfc76 cis 현상태 스냅샷=롤백원본), 대상셋 freeze(부모 c33dfc76 + service e17ba3a3 + 15,000), No-Persistence dry-run(txn-control strip + exception-handler + post-probe 무영속), per-row 판정근거 스냅샷, rows-affected=1 검증, 순소실0, 롤백 SQL(신규 cis DELETE by id). blanket UPDATE 금지 준수.

## 참고 (게이트 순서, risk_reason 4단계)
(1) **본 DA CONSULT-REPLY[이중계상 GO 판정]** → (2) archive-first + dry-run 무영속(No-Persistence Protocol) + 판정근거 스냅샷 → (3) 박민지/총괄 per-row comp-gate(seller 귀속=인센티브 영향, T-20260804 '표=참고용' waive 선례) → (4) supervisor DB-GATE GO-token(db_apply_guard.sh lane) → prod apply → applied_at → deployed. **★GO-token 前 prod DDL/DML 선집행 금지(apply_before_go 클래스). gate-미배선 ad-hoc 러너 금지.**
**DA NO-GO(이중계상) 시**: 파괴 write 없이 대안 권고 또는 close + 총괄 relay. (blocked 아님 — approved, 첫 액션=본 CONSULT.)

## AC (참고)
AC1 DA 이중계상 판정(GO/NO-GO/대안) 선결 / AC2 부재 cis 화장품 라인 CREATE(값 창작0) + seller=김규리(실 staff row) / AC3 SOP 게이트 전건(archive-first·dry-run 무영속·판정근거 스냅샷·comp-gate·supervisor DB-GATE GO-token) / AC4 SalesStaffTab 김규리 화장품 15,000 반영(이중계상 재유입0 재검증, 표시월=7월 07-28) / AC5 순소실0·freeze 재검증 abort 준수.
