# F-4445 Identity Resolution — READ-ONLY census (AC-1)

carrier ticket: T-20260810-foot-TESTACCT-CLEANUP-8ACCT
cross-ref: T-20260810-foot-ARCHE-BABSENT34-VOID-CONFIRMGATE
mode: READ-ONLY (WRITE 0 · DDL 0 · void 0 · DELETE 0). Management API SELECT introspection only.
DB: rxlomoozakkjesdqjtvd (foot prod). run date: 2026-08-11.
PHI note: 실명·phone 마스킹(phi_redaction_standard §4.3 UUID-PK-only). customer_id/chart_number = 비-PHI 식별자.

## 1. F-4445 resolved table/PK
- "F-4445" = `public.customers.chart_number = 'F-4445'` (F-NNNN = chart_number 컨벤션; cf. F-4857/F-4695/F-4872/F-4790).
- **customer_id (PK) = `66c08e48-c708-4e50-963d-aaa56b27d9ea`**
- name=[NAME-REDACTED, 마스킹 전 = 정리대상 후보와 동명], phone=[dummy placeholder 형식(반복숫자)], clinic_id=74967aea…, is_test=false, created_at=2026-07-01 06:42Z.

## 2. 박민석(roster) UUID 매핑 여부 → **NO (별 레코드)**
- roster 고객 = customer_id `1c61bad2-ad49-4e7d-92ae-2d132aae95cb`, chart **F-4790**, phone=[정상형식], created 2026-07-15.
- F-4445 = `66c08e48…` (chart F-4445, phone=[dummy형식], created 2026-07-01) = **동명이인/별개 customers 행**.
- 두 행 모두 동일 성명 but 서로 다른 customer_id·chart_number·phone. F-4445 ≠ roster 1c61bad2.
- roster가 인용한 3 cis_pk(333132e9/78a9c656/ea0bb2ec)는 전부 1c61bad2(F-4790) 소속 — F-4445와 무관.

## 3. F-4445 (66c08e48) 엮인 원장 census → **NOT clean (엮임)**
- reservations: 5 (no_show 3, checked_in 2)
- check_ins: 2 (both status=done)
- payments: 2 — ₩3,000 payment(card,active) + ₩3,000 refund(card,active), 동일 check_in, 자기상쇄쌍(net ₩0). 08-07.
- check_in_services: 1 — **"진료의뢰서"** ₩3,000 (is_package_session=false, non-void) = 발행서류/의료법 보존 후보 접점
- packages: 3 — 24회권(₩6M)/12회권(₩2.96M)/(+1), 전건 paid_amount=0 · status=cancelled (수납 0·회차소진 0)
- notification_logs: 8
- package_payments / service_charges / medical_charts / consent_forms / consultation_notes / clinical_images / treatment_photos / prescriptions / insurance_* / leads / tm_call_logs / package_credit_ledger : 전부 0

## 4. BABSENT34 population 포함 여부 → **NO**
- BABSENT34 정의(check_in_services is_package_session=true ∩ package_session_id NULL ∩ voided_at NULL) 총 = **34행** (재확인 OK).
- F-4445(66c08e48) orphan rows = **0** → BABSENT34 **미포함**.
- roster 고객(1c61bad2/F-4790) orphan rows = **3** → 이 3행이 BABSENT34에 포함(= MQ 인용 3 cis_pk).

## 5. KEEP↔정리 상충 (dev 판정 금지 — 사실만)
- 총괄 12:41/12:49 "박민석=KEEP(버그확인용)"의 대상 레코드가 (a)roster 1c61bad2(F-4790)만인지 (b)동일성명 전체(F-4445 포함)인지 **본 census로 확정 불가** → planner가 총괄 재확인 필요.
- F-4445=66c08e48은 KEEP 인용된 roster 3행(1c61bad2)과 물리적으로 별개 레코드. 다만 동일성명 + F-4445의 dummy phone·전건 cancelled package·net0 payment 프로파일은 test-account 성격 신호(판정 아님, 참고).

## 게이트
void/처리방식 = 총괄 재확인 + DA void-method CONSULT(MSG-20260810-124934-rfgl) + supervisor DB-GATE GO-token 선행. 본 태스크는 정체확정 census only.
