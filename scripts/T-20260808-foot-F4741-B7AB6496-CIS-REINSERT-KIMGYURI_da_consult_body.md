# CONSULT 요청 — T-20260808-foot-F4741-B7AB6496-CIS-REINSERT-KIMGYURI (파괴 write 1차 게이트)

**from**: dev-foot · **to**: data-architect · **domain**: foot · **change_class**: DATA_CORRECTION_BACKFILL · **db_change**: true · **artifact_class**: db_only
**ball**: dev-foot(DA CONSULT 요청부터). 본 CONSULT-REPLY GO 전 파괴 write(reinsert/UPDATE/dry-run apply) 착수 금지.

## 요청 취지
김병완(F-4741) 8/1 재결제 `b7ab6496`(73,000, 화장품 3종=풋샴푸200ml 42,000 + Care Toe Band 15,000 + 리페어핸드크림30ml 16,000)의 **08-03 차트 재저장(cis delete-all→reinsert)으로 소멸된 화장품 `check_in_services` 3라인 복구(reinsert) + seller_staff_id=김규리 귀속** → SalesStaffTab 김규리 8월 매출 73,000 반영.

이 티켓은 부모 DIAG `T-20260805-foot-CHARTRESAVE-COSMETIC-CIS-WIPE-PAYUNLINK-DIAG`(deployed)가 예고한 **"소급 backfill 격상"의 실행체**이며, `PRESERVE-FIX`(deployed)는 forward-only라 기존 소멸분 미복구.

## 전제 SSOT (창작 아님, 기확정 근거)
- `T-20260804-foot-KIMBB-COSMETIC-REMOVE`(closed) read-only 재대조 판정: **73,000 = 8/1 `b7ab6496` 유지단건**, 7/25 화장품행=0(중복 아님). → 이번은 **삭제 아니라 복구**.
- 근본원인·규모 census = 부모 DIAG(deployed) 참조.
- `b7ab6496` payment(73,000, active) prod 실재, 부모 check_in = `dec7e6c4`. 현재 cis line-item 부재 = 결제-서비스라인 unlink.

## 판정 요청 항목 (Q1~Q5)

### Q1 — SOP 봉투 선택 (핵심)
본건은 파괴적 **delete**가 아니라 소멸된 line-item의 **restore(reinsert)** + seller UPDATE다.
- `Cross-CRM Data-Correction Backfill SOP`는 mutable 필드 오염을 UPDATE로 되돌리는 표준이나 §0에서 "파괴적 삭제/원장 정정"을 배제.
- `Orphan Archive-First Cleanup + FK Integrity Guard SOP`는 파괴적 delete/orphan 정리 표준.
- **reinsert(소멸 행 재삽입)** 는 둘 중 어느 봉투가 governing인가? 혼합(reinsert=Backfill 계열 INSERT + 안전장치는 Archive-First의 freeze/순소실0/판정근거 스냅샷 차용)이 타당한가? 명시 요청.

### Q2 — reinsert 매출·원장 정합 (이중계상 방지)
- payment `b7ab6496`.amount(73,000) grain은 이미 alive. cis line-item 복구가 **매출총액을 이중계상하지 않음**을 어느 grain에서 보장해야 하나? (payments 수납 grain vs check_in_services/service_charges 명세 grain의 권위 경계 확인)
- SalesStaffTab 김규리 8월 73,000 표시가 **집계 grain=cis(seller_staff_id)** 를 소스로 하는지, payments를 소스로 하는지 — reinsert만으로 화면 반영되는지 seller UPDATE까지 필요한지 정합축 확인.
- 도파민/cross-CRM outbox 등 하류 역전파 영향 여부(cis INSERT가 이벤트 emit을 트리거하는지).

### Q3 — seller 귀속축 (방화벽 저촉 여부)
- seller_staff_id(판매자 귀속)가 §416 `created_by`(방화벽) / registrar 축과 **직교**한 mutable 판매귀속 필드임을 확인 요청. 즉 seller=김규리 설정이 방화벽 축을 물리 write 하지 않음.
- 김규리 = 실 staff row(동명이인 방지) 매핑은 dev-foot이 prod에서 확정 예정. 귀속 저장 위치(cis.seller_staff_id 컬럼 존재 여부/대안)에 대한 계약 확인.

### Q4 — 값 provenance / "창작 금지" 판정 (fingerprint 소싱)
- AC "임의 신규 값 창작 금지 — 소멸 前 원본 지문 근거로만 복구". 08-03 wipe가 delete-all→reinsert였다면 소멸 前 cis 원본이 **archive/audit 테이블에 물리 보존되어 있지 않을 가능성**이 있음.
- 허용 provenance 계층 판정 요청: ① cis archive/audit 실물 지문 존재 시 그것으로 (최상), ② 부재 시 `b7ab6496` payment_items/service_charges 등 결제-라인 지문 + KIMBB-REMOVE 확정 3품목·금액을 acceptable fingerprint로 볼 수 있는가? 증거 바닥선(evidentiary floor) 명시 요청. (Gate 2에서 dev-foot이 실물 census 예정 — 봉투 판정에 이 결과를 어떻게 반영할지)

### Q5 — SOP 기계적 게이트 체크리스트
reinsert에 대해 요구하는 구체 안전장치 확인: archive-first(mutation 前 현상태 스냅샷=롤백원본), 대상셋 freeze(부모 dec7e6c4 + 3품목), No-Persistence dry-run(txn-control strip + exception-handler + post-probe 무영속), per-row 판정근거 스냅샷, rows-affected 검증, 순소실0. blanket single-count UPDATE 금지 준수.

## 참고 (게이트 순서, risk_reason 4단계)
(1) **본 DA CONSULT-REPLY GO** → (2) archive-first + dry-run 무영속 evidence → (3) 박민지 per-row comp-gate(seller 귀속=인센티브 영향, T-20260804 '표=참고용' waive 선례 있음, planner 소관) → (4) supervisor DB-GATE GO-token → prod apply → applied_at → deployed.

## AC (참고)
AC1 cis 3라인 복구(합계 73,000, 품목·금액 원본 정합) / AC2 seller=김규리(실 staff row 검증) / AC3 SalesStaffTab 김규리 8월 73,000 표시 / AC4 원장 zero-sum·이중계상 없음·롤백 검증 / AC5 순소실0·freeze 재검증 abort 준수.
