# 그라운딩 리포트 — T-20260618-foot-CODEMGMT-MENU-SVCKEEP-RXIMPORT

**작성:** agent-fdd-dev-foot · 2026-06-18
**단계:** AC-6 (진료관리 코드·처방약 입력 화면 식별 · 선행 · read-only 조사)
**원칙 준수:** 코드 변경 0건, DB 변경 0건. 코드 SELECT-only 그라운딩.

---

## 0. 결론 (TL;DR)

AC-6 정확 화면 식별 결과 = **모호(material ambiguity).** 신규 화면 임의 신설 금지 조건 발동 → planner 경유 reporter 재확인 요청.

핵심 모순:
- 처방약/상병 SET 빌더(**묶음처방·묶음상병**)는 **이미** 서비스관리(services) 단일 SSOT를 read-only 불러오기·선택 중 → AC-1~3 사실상 충족.
- 티켓이 예시로 든 "약품폴더/처방세트/퀵처방"(**DrugFoldersTab·QuickRxButtonsTab**)은 (a) 별도 `prescription_codes` 카탈로그 사용 또는 (b) 약 자유입력 자체 부재 → services 불러오기를 **read-only로 끼워넣을 깨끗한 지점이 없음.**

---

## 1. 진료관리 서브탭 코드/처방약 입력 지점 매트릭스

| 서브탭(value/testid) | 입력 대상 | 현재 소스 | 서비스관리(services) read-only 불러오기 상태 |
|----------------------|-----------|-----------|----------------------------------------------|
| 묶음처방 (`prescriptions` / tab-prescription-sets-legacy) — PrescriptionSetsTab | 처방약 | `services` category_label='처방약' (`searchServiceRxDrugs`, prescribableDrugs.ts:45) | **이미 read-only 검색·선택 구현됨** (T-20260615 RXSET-DRUGSOURCE-SVCRX). AC-1~3 충족 |
| 묶음상병 (`diagnosis_sets` / tab-diagnosis-sets) — DiagnosisSetsTab | 상병(코드) | `services` category_label='상병' (picker, DiagnosisSetsTab:117) | **이미 services 정본 picker 선택 구현됨** |
| 상병명 관리 (`diagnosis_names`) — DiagnosisNamesTab | 상병 코드 | KCD 공식번들 검색 (services 상병 master 자체) | 정본 자체 — '불러오기' 대상 아님(자기 자신) |
| 처방세트 (`drug_folders` / tab-drug-folders) — DrugFoldersTab | 처방약 | **`prescription_codes` 카탈로그** (DrugFoldersTab:182, services와 FK 0%) | **불러오기 없음 + read-only 불가 충돌** (아래 §2) |
| 빠른처방 (`quick_rx`) — QuickRxButtonsTab | 처방세트 선택 | `prescription_sets` 선택(PrescriptionSetTreePicker) | 약 자유입력 부재 — 대상 아님 |

## 2. DrugFoldersTab(처방세트) read-only 불러오기 불가 — FK 키 충돌

`DrugFoldersTab.handleAssign` (DrugFoldersTab.tsx:274-285)는 폴더 배정을 **`prescription_code_id` FK**(→ `prescription_codes.id`)로 저장한다.

- services 처방약(=`services.id`)을 이 폴더 트리에 read-only로 "불러와 선택"하려면 → 대응하는 `prescription_codes` row가 필요(services↔prescription_codes 매핑 = **0%**, DIAGNOSIS-RX-MASTER-UNIFY §B-2 실측).
- 즉 services 처방약을 처방세트에 끼워넣으면 **prescription_codes write(데이터 생성) 발생** → **AC-5(서비스관리 데이터 read-only)·AC-0(신규 테이블 데이터 무생성) 위반** + DIAGNOSIS-RX-MASTER-UNIFY B안(DESTRUCTIVE) 비권고 경계 침범 + RXCODES 클러스터 5티켓과 동일 테이블 충돌.

→ DrugFoldersTab은 "services 품목 read-only 불러오기"의 **깨끗한 additive 지점이 아님.**

## 3. 권장 선택지 (reporter 확정 필요)

- **Option A (저위험·즉시):** 대상 화면 = 묶음처방·묶음상병. → services 단일 SSOT read-only 불러오기·선택이 **이미 구현됨.** 잔여 = (1) §6 시나리오 무회귀 E2E 작성 (2) '불러오기/선택' 진입점 문구 명확화(현장 인지 개선). DDL/데이터 0.
- **Option B (데이터 정책 결정 필요):** 대상 화면 = 처방세트(DrugFoldersTab)에 services 처방약을 폴더 트리로 불러오기. → §2 FK 충돌로 read-only 불가, prescription_codes write 동반 → data-architect CONSULT + reporter DESTRUCTIVE 게이트 필요. AC-5와 정면 충돌.
- **Option C:** 위 매트릭스에 없는 특정 화면/입력필드 지정.

## 4. 참조
- DIAGNOSIS-RX-MASTER-UNIFY 진단(동일일·동일 에이전트): `evidence/T-20260618-foot-DIAGNOSIS-RX-MASTER-UNIFY_diagnosis-report.md`
- 단일 재바인딩 캡슐: `src/lib/prescribableDrugs.ts:45 searchServiceRxDrugs()`
- nav 구조: `src/pages/Services.tsx`(서브탭 편입) · `src/pages/ClinicManagement.tsx`(진료관리 서브탭 트리)
