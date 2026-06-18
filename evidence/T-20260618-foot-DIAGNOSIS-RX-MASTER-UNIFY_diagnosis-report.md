# 진단 리포트 — T-20260618-foot-DIAGNOSIS-RX-MASTER-UNIFY

**작성:** agent-fdd-dev-foot · 2026-06-18
**단계:** AC-0 (read-only 현황 진단 · 선행 · 필수)
**원칙 준수:** 임의 마이그·DDL·데이터변경 0건. 코드/마이그레이션 SELECT-only 조사.

---

## 0. 결론 (TL;DR)

| 마스터 | 이중관리 상태 | 권고 |
|--------|--------------|------|
| **상병(진단명)** | **이미 단일 SSOT — 이중관리 없음** | A안(ADDITIVE) = 사실상 완료. 검증·무회귀 E2E만 |
| **처방약(입력 선택 소스)** | **이미 단일 SSOT — 이중관리 없음** | A안 = 사실상 완료. 검증·무회귀 E2E만 |
| **처방약 보조 카탈로그(prescription_codes)** | services 처방약과 **별도**(FK 0% 매핑) — 단 데이터 축이 다름(급여/금기/폴더 메타) | 정본으로 끌어들이지 말 것(B안=DESTRUCTIVE 비권고). 클러스터 충돌 |

**핵심:** 본 티켓이 요구하는 "상병·처방약이 서비스관리/진료관리 양뷰에서 동일 원본 참조"는 **이미 코드상 구현 완료** 상태다. 둘 다 `services` 테이블을 단일 정본으로 쓴다. 이전 티켓들(상병=T-20260606/07 DIAGNOSIS-MASTER-MGMT, 처방약=T-20260606 RX-DRUG-WHITELIST + T-20260615 RXSET-DRUGSOURCE-SVCRX)에서 점진적으로 통합이 끝났다. **잔여 작업 = (1) 양뷰 연동 무회귀 E2E 검증 (2) 보조 카탈로그 관계 명문화.** 물리 병합·DDL·데이터 마이그 불요. §6 planner 간소화 방향과 정확히 일치.

---

## A. 상병(진단명) 백킹 식별

### A-1. 정본 테이블 = `services` (category_label='상병')

세 화면이 **모두 동일 테이블**을 참조한다:

| 화면(뷰) | 파일 | 쿼리 | 동작 |
|----------|------|------|------|
| 서비스관리 '상병' 탭 | `src/pages/Services.tsx:78` | `services` (CATEGORY_LABEL_OPTIONS에 '상병') | CRUD |
| 진료관리 '상병명 관리' 탭 | `src/components/admin/DiagnosisNamesTab.tsx:142,179` | `services` `.eq('category_label','상병')` | **read+write** (insert 시 category_label='상병', 단가 0) |
| 진료차트 진단 입력 | `src/components/medical/DiagnosisFolderPicker.tsx:117-120` | `services` `.eq('category_label','상병')` | read(선택) |
| 묶음상병 빌더 | `src/components/admin/DiagnosisSetsTab.tsx:117-120` | `services` `.eq('category_label','상병')` | read |

`src/pages/ClinicManagement.tsx:27,108` 주석이 명시: **"상병명 관리 — services.category_label='상병' 단일 SSOT (서비스관리와 동기화)"**.

→ **상병은 별도 마스터 테이블이 존재하지 않음. 이중관리 없음.** "두 곳에서 따로 관리" 인식은 (a) UI가 서비스관리·진료관리 두 메뉴에 보이는 표면 + (b) 통합 이전(2026-06-06 이전) 기억으로 추정.

### A-2. 분류 보조 테이블 (마스터 아님)
- `diagnosis_folders` (자기참조 트리, `20260607200000_diagnosis_folders_fk.sql`) — 상병 **분류 폴더**. `services.diagnosis_folder_id` FK(이동 시맨틱). 상병 항목 자체가 아니라 진열 도구.
- `diagnosis_sets`/`diagnosis_set_items` (`20260608120000`) — 묶음상병(여러 상병을 세트로). items가 `services.id` 참조.
- `doctor_diagnosis_favorites` (`20260606160000`) — 원장별 즐겨찾기(auth.uid 격리).

### A-3. 차트 진단 입력 FK 참조처
- `medical_charts.diagnosis` (TEXT) — 선택 상병을 `"코드 상병명\n코드 상병명"` 줄바꿈 직렬화(`DiagnosisFolderPicker.fmtDx`). **schema-on-read, FK 없음.** 통합과 무관(무회귀 안전).
- `chart_diagnoses` 테이블(`20260606140000`) 존재 — 구조화 진단 보조 저장(영향 작음, 통합 대상 아님).
- 보험 청구: `claim_diagnoses`/`insurance_claim_diagnoses` — KCD 코드 텍스트 저장(별개 청구 도메인).

---

## B. 처방약 백킹 식별

### B-1. 입력 선택 소스 = `services` (category_label='처방약') — **이미 통합됨**

| 화면(뷰) | 파일 | 약 출처 |
|----------|------|---------|
| 서비스관리 '처방약' 탭 | `src/pages/Services.tsx:82` | `services` category_label='처방약' (16건, service_code=EDI 청구코드) CRUD |
| 처방세트 빌더(묶음처방) | `src/components/admin/PrescriptionSetsTab.tsx:76` → `searchServiceRxDrugs()` | `services` 처방약 (T-20260615 RXSET-DRUGSOURCE-SVCRX) |
| **진료차트 런타임 처방 검색** | `src/components/MedicalChartPanel.tsx:1587-1608` → `searchServiceRxDrugs()` | `services` 처방약 (T-20260606 RX-DRUG-WHITELIST) |

단일 재바인딩 캡슐: `src/lib/prescribableDrugs.ts:45 searchServiceRxDrugs()` = `services.eq('category_label','처방약').eq('active',true)`.

→ **처방약 입력/선택도 이미 services category_label='처방약' 단일 SSOT.** 서비스관리 등록 → 진료차트 즉시 선택 가능. AC-2/AC-3 충족.

### B-2. 보조 카탈로그 `prescription_codes` — services 처방약과 **별도**(FK 미연결)

`prescription_codes`(`20260422000000`)는 표준약제 카탈로그로 **다른 데이터 축**이다:
- 컬럼: claim_code, name_ko, classification, insurance_status, ingredient_code, code_source(official/custom)
- 사용처: 처방세트 폴더(`DrugFoldersTab.tsx:182`), 급여여부(`InsuranceStatusPanel.tsx:90` → drug_folders 흡수), 금기증(`ContraindicationsTab.tsx`/`prescription_contraindications`), 성분중복(`prescribableDrugs.findSameIngredientRegistered`).
- **services 처방약 ↔ prescription_codes 매핑 = 0%** (코드 주석 명시: `MedicalChartPanel.tsx:1592` "AC-0 실측 0% 매핑"). services 처방약 선택 시 `prescription_code_id=null` → 금기/급여 게이트는 자유텍스트와 동일 skip. 실제 청구(rx_standard)는 `services.service_code` 사용 → 청구 무손실(`prescribableDrugs.ts:28-31`).

→ prescription_codes는 본 티켓의 "서비스관리↔진료관리 입력 이중관리"와 **다른 축**(급여·금기·HIRA 메타데이터). 입력 소스 통합은 이미 services로 끝났으므로 prescription_codes를 정본으로 끌어들일 필요 없음.

### B-3. 처방세트/묶음처방
- `prescription_sets`(`20260504`) — items JSONB 배열(name, prescription_code_id?, dosage…). 진료차트 처방 적용 소스.
- `medical_charts.prescription_items` (JSONB) — 차트 처방 저장(FK 없음, schema-on-read).

---

## C. 처방코드 클러스터 경계 (동시 DDL 충돌 회피)

`prescription_codes`를 건드리는 진행/대기 티켓:

| 티켓 | 상태 | prescription_codes 작업 |
|------|------|------------------------|
| RXCODES-WRITE-RLS-CANONICAL | in_progress | write RLS (`20260617150000`) |
| RXCODES-READ-TIGHTEN | approved | read RLS |
| RXSET-CUSTOM-DRUG-HIRA-MAP | approved | HIRA 매핑/custom 약 |
| RXFOLDER-INSURANCE-INLINE-MERGE | (방금 배포 5da972f9) | insurance_status 인라인 |
| PROCMENU-RX-UNIFY | **staged 미적용** | `20260617121000_rx_unify_stage1_backfill.sql` — prescription_sets 약 → prescription_codes ADDITIVE backfill |

**판정:** 본 티켓의 통합 축(입력 소스 = services 처방약)은 이 클러스터와 **데이터 축이 달라 비충돌**. prescription_codes를 안 건드림. 단 만약 B안(services 처방약 ↔ prescription_codes 물리 통일)을 택하면 **동일 테이블 정면 충돌** → 직렬화·DDL 타이밍 조율 의무 발생. → B안 배제로 충돌 원천 차단.

---

## D. 통합 방향 2안

### A안 (ADDITIVE) — **권고**
- **현 상태:** 상병·처방약 입력 소스 모두 `services` 단일 SSOT로 이미 통합 완료. 서비스관리(등록)·진료관리/진료차트(조회·선택) 양뷰 동일 원본 참조.
- **잔여 작업:** (1) 양뷰 연동 무회귀 E2E(`tests/e2e/T-20260618-foot-DIAGNOSIS-RX-MASTER-UNIFY.spec.ts` — 서비스관리 추가→진료차트 노출, 진료관리 수정→서비스관리 반영, 처방약 동일, 기존 차트 무회귀, 권한) (2) prescription_codes 보조 카탈로그 관계 명문화(LOGIC-LOCK-REGISTRY 1줄).
- **위험:** 데이터 유실 0, DDL 0, 데이터변경 0. 롤백 trivial(E2E·문서뿐).
- **차트 FK 영향:** 없음(diagnosis/prescription_items = schema-on-read).
- **클러스터 충돌:** 없음.

### B안 (DESTRUCTIVE) — **비권고**
- services 처방약 ↔ prescription_codes 물리 병합/단일 약 마스터 통일, 중복 DROP, 차트 prescription_code_id 재매핑.
- **위험:** 클러스터 5티켓과 동일 테이블 정면 충돌 / 차트 FK·청구코드(service_code) 매핑 깨질 위험 / 데이터 유실 가능. 대표 게이트+롤백SQL 의무(autonomy §3.1).
- PROCMENU-RX-UNIFY가 이미 ADDITIVE 점진 경로로 prescription_codes backfill을 진행 중 → 별도 DESTRUCTIVE 불필요·중복.

### 권고
**A안 채택.** §6 planner 간소화(서비스관리=정본, 병합 아님, 진료관리=read-only 참조)와 정확히 일치하며, 실측 결과 이미 그 상태로 구현돼 있다. DESTRUCTIVE 경로 배제 → AC-1 대표 DESTRUCTIVE 게이트 불요. data-architect CONSULT는 "prescription_codes 보조 카탈로그를 정본으로 통일하지 않는다"는 경계 확인 + cross_crm_data_contract 영향 없음 확인 수준이면 충분.

---

## E. planner에게 요청(다음 게이트)

1. 본 진단(상병·처방약 입력 모두 이미 services 단일 SSOT, 이중관리 없음)을 reporter(문지은 대표원장)에게 responder 경유 확인 — "이미 양뷰 동일 원본입니다. 추가 통합 마이그 불요, 검증만 진행" 현장 confirm.
2. data-architect CONSULT: prescription_codes를 정본으로 끌어들이지 않는 A안 경계 + contract 무영향 확인.
3. risk_verdict 재평가: DESTRUCTIVE 위험 제거됨 → 잔여 본질 리스크 = AC-4 차트 무회귀(이미 schema-on-read라 낮음). 잔여 작업이 E2E 검증·문서화뿐이면 supervisor DDL-diff 불요(DDL 0).
4. AC-5(타지점 1차 적재 상병 데이터 풋센터 기준 클렌징)는 본건 범위 밖 — 별도 sub-ticket 필요 여부 현장 confirm.
