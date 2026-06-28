# 재감사 리포트 — T-20260629-foot-DIAG-SVC-DB-UNIFY

**작성:** agent-fdd-dev-foot · 2026-06-29
**단계:** AC-0 재감사 (read-only · 旣진단 9018d8a8 재검증 · 임의 DDL/마이그/데이터변경 0건)
**계기:** 문지은 대표원장 11일 만에 재지적 — "우리 CRM에서 쓰는 상병명과 약품은 디비가 동일해야함 / 화면마다 다른 곳에서 불러온다"
**대조 기준:** 旣진단 commit `9018d8a8` (T-20260618-foot-DIAGNOSIS-RX-MASTER-UNIFY AC-0) — "상병=services(category_label='상병') 단일 SSOT, 별도 상병테이블 없음"

---

## 0. 결론 (TL;DR)

| 항목 | 판정 |
|------|------|
| **상병명 정본** | **services (category_label='상병') 단일 SSOT — 旣진단 HOLDS. 잔존 분산 소스 0건.** |
| **별도 상병 마스터 테이블** | **여전히 미존재** (06-24 `84b7398c` 마이그 주석 재확인: "diagnosis_names ★table 미존재★") |
| **신규 분산 소스(11일간)** | **0건.** 06-18 이후 상병 정본 소스를 바꾸는 마이그/코드 없음 |
| **차트 신규 FK 경로** | **신규 없음.** chart_diagnoses.service_id → services(id) (旣존, 06-06). medical_charts.diagnosis = TEXT 스냅샷(FK 없음) |
| **reporter 재지적 원인(추정)** | 자매 **약품** 통합(RXSET-PRESCRX-SVC-DB-UNIFY)이 **코드 merge 완료·FE 미배포(deployed_at=null)** 상태 → 약품 분산 잔상이 상병 인식에 전이된 것으로 분리 판단 |

**핵심:** 본 티켓이 요구하는 "상병명을 한 곳(services)에서 불러오게"는 **이미 코드상 구현·배포 완료**다. 상병을 표시·검색·선택·저장하는 모든 화면이 단일 `services` `category_label='상병'`을 참조한다. **코드 변경 불요 — reporter field-confirm 회신 권고.**

---

## 1. 상병명 사용 화면 전수 (grep/코드추적)

| # | 화면(뷰) | 파일 | 동작 |
|---|----------|------|------|
| 1 | 진료차트 진단 입력 | `src/components/medical/DiagnosisFolderPicker.tsx` | read(선택) |
| 2 | 진료관리 '상병명 관리' 탭 | `src/components/admin/DiagnosisNamesTab.tsx` | CRUD |
| 3 | 서비스관리 '상병' 탭 | `src/pages/Services.tsx` | CRUD |
| 4 | 묶음상병 빌더 | `src/components/admin/DiagnosisSetsTab.tsx` | read |
| 5 | 묶음상병 '상병 추가' picker | `src/components/admin/DxFolderMultiSelect.tsx` | read(폴더트리) |
| 6 | 서류 상용구 관리 | `src/components/admin/SuperPhrasesTab.tsx` | read(선택, 코드동반) |
| 7 | 시술세트 상병코드 | `src/components/admin/TreatmentSetsTab.tsx` | read(필터) |
| 8 | 결제·서류 상병코드 삽입 | `src/components/PaymentMiniWindow.tsx` | read(필터) |
| 9 | 매출 환자 상병코드 표시 | `src/components/sales/SalesPatientTab.tsx` | read(청구 스냅샷 — 별도 축) |

---

## 2. 화면별 참조 소스 (旣진단 대비 변동·잔존 분산 유무)

| # | 화면 | 상병 목록 출처 | 旣진단(9018d8a8) 대비 |
|---|------|---------------|----------------------|
| 1 | DiagnosisFolderPicker | `.from('services').eq('category_label','상병')` (117–128) | **동일 · 변동없음** |
| 2 | DiagnosisNamesTab | `.from('services').eq('category_label','상병')` (146,153) / 등록 insert도 category_label='상병'(192–196) | **동일 · 변동없음** |
| 3 | Services.tsx | services CRUD, category_label 분류(99,432) | **동일(정본 출처)** |
| 4 | DiagnosisSetsTab | `.from('services').eq('category_label','상병')` (119–131), 주석 "DiagnosisNamesTab 와 동일 소스" | **동일 · 변동없음** |
| 5 | DxFolderMultiSelect | diagnosis_folders + services.diagnosis_folder_id (부모로부터 services 목록 수령) | **동일 · 변동없음** |
| 6 | SuperPhrasesTab | **DiagnosisFolderPicker로 일원화**(153 주석: "진료차트와 동일한 DiagnosisFolderPicker = services category_label='상병' 자체조회") | **旣진단 후 오히려 더 일원화** |
| 7 | TreatmentSetsTab | `.from('services').select(...category_label)` (116) → `category_label==='상병'` 필터(432–433) | **동일 · 변동없음** |
| 8 | PaymentMiniWindow | `.from('services')` (756) → `category_label==='상병'` 필터(282) | **동일 · 변동없음** |
| 9 | SalesPatientTab | `claim_diagnoses.disease_code` (청구 정규화, T-20260515 SALES-COMMON-DB) — **마스터 아님, 청구 트랜잭션 스냅샷** | **별도 축(旣진단 §A-3에 청구도메인으로 이미 분류). 비충돌** |

### 비-정본(보조/입력어휘) 소스 — 마스터 아님, 충돌 아님
- **KCD 표준코드 카탈로그** `src/lib/kcd/kcdData.ts` (dynamic import 정적 번들, 신규 의존성 0). DiagnosisNamesTab이 **신규 상병 등록 시 고를 표준어휘 picklist**로만 사용 → 선택값을 services 행으로 insert. 처방약의 `prescription_codes`와 동일한 "입력 어휘 카탈로그" 축. **런타임 상병 저장소 아님.**
- **diagnosis_folders / diagnosis_sets / doctor_diagnosis_favorites** — 분류·묶음·즐겨찾기 보조(모두 service_id로 services 참조). 旣진단과 동일.

**→ 잔존 분산 소스 = 0건. 9개 화면 전부 단일 services category_label='상병' 참조(또는 그로부터 파생). 11일간 신규 분산 소스 유입 없음.**

---

## 3. 차트 저장경로 (신규 FK 경로 유무)

| 저장처 | 형태 | 변동 |
|--------|------|------|
| `medical_charts.diagnosis` | TEXT, "코드 상병명" 줄바꿈 직렬화(`DiagnosisFolderPicker.fmtDx`), FK 없음(schema-on-read) | **旣존 · 변동없음** |
| `chart_diagnoses.service_id` | → `references services(id) on delete set null` (06-06 `20260606140000`), 코드/이름 스냅샷 컬럼 동반 | **旣존 FK · 신규 아님. 정본=services** |
| `claim_diagnoses.disease_code` | 보험청구 KCD 텍스트(별개 청구 도메인) | **旣존 · 별도 축** |

**→ 06-18 이후 상병을 FK로 묶는 신규 경로 0건.** 구조화 저장(chart_diagnoses)조차 services를 정본으로 FK 링크. 정합 무결.

---

## 4. 판정: **HOLDS (이미 단일 SSOT)**

- **잔존 분산 소스 0건** → 旣진단(9018d8a8) "상병=services 단일 SSOT" **그대로 유효(holds)**.
- 06-24 `84b7398c`(SERVICES-DIRECTOR-RLS-CHECK) 마이그 주석이 최근까지 재확인: **별도 상병 테이블 미존재, '상병명 관리' backing = services(category_label='상병')**.
- **코드 변경 불요.** ADDITIVE 소스스왑 대상 화면 없음(이미 전부 services 참조).

### reporter 재지적 분리 진단 (약품 미배포 전이)
- 자매 티켓 **RXSET-PRESCRX-SVC-DB-UNIFY**(약품, commit `cac14abe`/`6bcc2daa`) = deploy-ready이나 **deployed_at=null (FE 11일 미배포 + 백필 사람확인 대기)**.
- 상병 통합은 그 이전에 코드·배포 완료 / 약품 통합은 merge되었으나 현장 화면 미반영 상태 → **현장에서 약품이 여전히 분산돼 보이는 잔상이 "상병도 화면마다 따로"라는 인식으로 전이**된 것으로 분리 판단.
- 즉 reporter 체감의 실체 트리거는 **상병 코드 결함이 아니라 약품 FE 미배포**일 가능성이 높음.

---

## 5. planner에게 (다음 게이트)

1. **상병 = HOLDS, 코드변경 0** → reporter(문지은 대표원장) responder 경유 field-confirm: "상병명은 이미 한 곳(서비스관리=진료관리=진료차트 동일 원본)에서 불러오고 있습니다. 추가 작업 불요." (현장어 — '디비/테이블/FK' 등 개발용어 비노출, field_lang_dict §2 템플릿 사용 요망)
2. **약품 분리 처리 권고**: 현장이 체감하는 분산은 RXSET-PRESCRX-SVC-DB-UNIFY **FE 미배포(deployed_at=null) + 백필 대기** 때문일 개연 큼. 해당 배포/백필 진행이 reporter 체감 해소의 실질 액션 → supervisor 배포 게이트로 라우팅 권고.
3. **DDL/마이그/구현 발생 0건** → DA CONSULT·supervisor DDL-diff 게이트 해당 없음(상병 측). (약품 측 백필은 별도 티켓 게이트 유지)
4. §11 진료대시보드/진료관리 컨펌게이트: 본 건은 read-only 재감사로 의료화면 코드 미수정 → 게이트 미발동. 만약 차후 상병 관련 코드 수정이 발생하면 medical_confirm_gate 확인 후 착수.
