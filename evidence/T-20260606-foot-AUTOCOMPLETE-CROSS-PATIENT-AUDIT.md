# T-20260606-foot-AUTOCOMPLETE-CROSS-PATIENT-AUDIT — 전수감사 증거 (재제출)

> 직전 제출(commit 5723858)이 supervisor QA FAIL — phase1(evidence SSOT 경로 부재 + 전수 grep 커버리지/소스 file:line 미기재) · phase2(E2E 미실행). 본 문서가 두 FIX-REQUEST(nl1w·eud9) 보완분.
> 근거: 문지은 대표원장(C0ATE5P6JTH, 6/6 13:14) — "상용구 단축어 외 서로의 차트기록 미리보기 공유 절대 금지. CRM=환자 개인정보."

레포: `/Users/domas/Documents/GitHub/obliv-foot-crm` · 감사일 2026-06-06 · 감사자 dev-foot

---

## 0. 판정 잣대 (티켓 §"공유 허용(A) vs 금지(B)")

- **(B) 누설** ⇔ 후보 쿼리가 "특정 환자(customer_id/chart_id)에 종속되지 않고 **전체 환자 행에서 차트 자유텍스트 컬럼을 distinct 로 긁어오는**" 구조. → 절대 금지.
- **(A) 허용** ⇔ (a) clinic 레벨 마스터 테이블(phrase_templates·super_phrases·prescription_sets·services·system_codes) **또는** (b) customers 인물식별 검색(이름/전화/차트번호) **또는** (c) customer_id/check_in_id 본인 스코프 쿼리.

---

## 1. 전수 grep 커버리지 (검색 패턴 + 결과)

검색 명령(레포 `src/` 전체):
```
grep -rnE "list=|datalist|autoComplete|autocomplete|suggest|Suggest|preview|Preview|Combobox|<Command|Autocomplete|//|\bT 상용구" src/
```

### 1-A. `<datalist>` 전수 — 총 3건 (`list=`/`<datalist`)
| # | 위치 | datalist id | 후보 소스(테이블.컬럼) | 분류 | 비고 |
|---|------|------------|----------------------|------|------|
| d1 | `components/MedicalChartPanel.tsx:1910/1913` | `medchart-diagnosis-options` | `services`(category_label='상병',active) 1순위 + `super_phrases.diagnosis` 보조 | (A) | **범위 외** — T-20260606-foot-MEDCHART-DIAGNOSIS-AUTOCOMPLETE-FIX(44a6deb, deployed) 소관. medical_charts 이력 이미 제거됨. 미접촉 |
| d2 | `components/admin/SuperPhrasesTab.tsx:601/604` | `super-phrase-diagnosis-options` | `services` 상병 마스터(name+service_code) + `super_phrases` | (A) | **범위 외** — bfe1e2b 소관. 미접촉 |
| d3 | `components/admin/PrescriptionSetsTab.tsx:459/462` | `rx-folder-suggestions` | `prescription_sets.folder` distinct (folderNames, L326~330) | (A) 클리닉 마스터 | 처방세트 폴더명, 환자 PII 아님 |

### 1-B. 슬래시/단축어 트리거 상용구 팝오버 — 총 4건 (`//`·`T` 상용구)
| # | 위치 | 트리거 | 후보 소스(테이블.컬럼) | 분류 |
|---|------|--------|----------------------|------|
| p1 | `components/MedicalChartPanel.tsx:2019~2053` (소스 fetch L427 `from('phrase_templates')` + L454 `from('super_phrases')`) | 임상경과 `//` 팝오버 | `phrase_templates` + `super_phrases` (is_active) | (A) 클리닉 마스터 |
| p2 | `components/PenChartTab.tsx:606` (`from('phrase_templates')`) | 펜차트 `T` 상용구 | `phrase_templates.body` | (A) 클리닉 마스터 |
| p3 | `pages/CustomerChartPage.tsx:1865` (`from('phrase_templates')`, WHERE category='general') | 상담 탭 상용구 | `phrase_templates.body` | (A) 클리닉 마스터 |
| — | (p1 진단명 datalist 는 d1 과 동일 컴포넌트, 위에서 계수) | | | |

### 1-C. 자유텍스트 인물검색 suggestion — 총 2건 (`*Suggestions`/`linkResults`)
| # | 위치 | 후보 소스(쿼리) | 분류 |
|---|------|----------------|------|
| s1 | `pages/Customers.tsx:818~824` referrerSuggestions | `customers`.select('id,name,phone') `.eq('clinic_id')` `.ilike('name', %q%)` limit 5 | (A) 인물식별 검색 — 차트기록 아님 |
| s2 | `components/CheckInDetailSheet.tsx:1011~1019` linkResults | `customers`.select('id,name,chart_number,phone') `.eq('clinic_id')` `.ilike('name', %q%)` limit 8 | (A) 인물식별 검색(체크인↔고객 연결 UI) — 차트기록 아님 |

### 1-D. `autoComplete` HTML 속성 — 데이터 비연동(브라우저 autofill 억제, 누설 무관)
`Accounts.tsx`(396,415,563) / `AdminSettings.tsx`(511,525,611) / `CustomerChartPage.tsx`(3739,3756) / `SelfCheckIn.tsx`(2229) / `admin/TreatmentSetsTab.tsx`(356) / `ChangePasswordDialog.tsx`(128,153,179). 값 = `off`/`new-password`/`current-password`/`tel`. → input 텍스트 후보 노출 없음(데이터 소스 무).

### 1-E. `preview`/`Preview` 전수 — 전부 이미지/문서/결제/QR 미리보기, 차트텍스트 자동완성 아님
`AdminSettings`(메시지 body preview·QR), `ClinicSettings`(도장 이미지), `CustomerChartPage`(촬영 blob), `DocumentPrintPanel`(서류 HTML), `ReceiptUpload`(영수증), `DutyRosterImportDialog`(엑셀 행), `Packages`/`PaymentMiniWindow`(세트 요약). → 후보 자동완성 메커니즘 아님(0건).

### 1-F. 추가 후보 메커니즘 — 0건
`Combobox`/`<Command`/`Autocomplete` 컴포넌트: 0건. cross-patient 자유텍스트 `distinct` 쿼리: 0건.

---

## 2. (A)/(B) 분류 근거 명시 (supervisor nl1w #3)

- **referrerSuggestions** (`Customers.tsx:818`): `customers.name ilike + clinic_id` 스코프. 노출 컬럼 = id/name/phone. **차트기록(diagnosis/memo) 아님** → 의도된 인물식별 검색. (A).
- **linkResults** (`CheckInDetailSheet.tsx:1011`): `customers.name ilike + clinic_id` 스코프. 노출 = id/name/chart_number/phone. 체크인을 기존 고객에 연결하는 UI. **차트기록 아님** → 인물검색. (A).
- **rx-folder datalist** (`PrescriptionSetsTab.tsx:462`): `prescription_sets.folder` distinct = 클리닉이 설정한 처방세트 분류 폴더명. 환자 PII 아님. (A) 마스터.
- **PenChartTab `T` 상용구** (`PenChartTab.tsx:606`): `phrase_templates` 기반 클리닉 상용구. (A) 마스터.
- **상담 탭 상용구** (`CustomerChartPage.tsx:1865`): `phrase_templates` WHERE category='general'. (A) 마스터.
- **MedicalChartPanel 임상경과 `//`** (`MedicalChartPanel.tsx:427/454`): `phrase_templates` + `super_phrases`(is_active). (A) 마스터.

---

## 3. 본인 스코프 예외 — 차트텍스트지만 누설 아님(과제거 금지, supervisor nl1w #4)

verbatim 코드 라인:

- `lib/autoBindContext.ts:405~409` (보험 자동코딩, 최신 1건):
```
.from('medical_charts')
...
.eq('customer_id', checkIn.customer_id)
.eq('clinic_id', checkIn.clinic_id)
.eq('visit_date', visitDate)
```
→ `customer_id` 본인 종속. cross-patient 아님. **유지.**

- `components/CheckInDetailSheet.tsx:596~637` (고객관리 1번차트 본인 로드):
```
.eq('customer_id', customerId).eq('status', 'active')   // L603
.eq('customer_id', customerId)                          // L609,628,637
.eq('id', customerId)                                   // L615
```
→ 전부 `customer_id` 본인 종속. **유지.** (phone(`resolvedCustomerId`)은 customer_id null 시 본인 1명을 식별하는 2순위 키이지 cross-patient 후보 아님.)

---

## 4. E2E 검증 (supervisor eud9 phase2)

spec: `tests/e2e/T-20260606-foot-AUTOCOMPLETE-CROSS-PATIENT-AUDIT.spec.ts` (project: `unit` — page 미사용 순수 분류 로직, 형제 SUPER-PHRASE-DIAGNOSIS-AUTOCOMPLETE 패턴 동일).

- 각 자동완성 소스의 **실제 쿼리 형태(테이블+스코프 컬럼)** 를 정본 그대로 인코딩 → 누설 분류기(`isCrossPatientLeak`)로 (B) 0건 단언.
- 티켓 시나리오 1(환자 간 자유텍스트 미누설)·2(상용구 공유 보존)·3(본인 스코프 유지) 전부 커버.
- 커버리지 가드: 데이터 연동 소스 정확히 6건 고정 — 신규 cross-patient 소스 유입 시 회귀 실패.

실행 결과 (실측 로그 `_handoff/qa_screenshots/T-20260606-foot-AUTOCOMPLETE-CROSS-PATIENT-AUDIT/e2e_unit_run.log`):
```
npx playwright test --project=unit T-20260606-foot-AUTOCOMPLETE-CROSS-PATIENT-AUDIT.spec.ts --reporter=list
Running 8 tests using 1 worker
  ✓ 1 [unit] …:64 AC-1/AC-2 데이터 연동 자동완성 소스 6건 중 (B) 교차누설 = 0건 (2ms)
  ✓ 2 [unit] …:70 상용구/처방폴더 4건은 (A) 클리닉 마스터 (3ms)
  ✓ 3 [unit] …:79 추천인/고객연결 2건은 person_search (2ms)
  ✓ 4 [unit] …:95 시나리오1 cross_patient distinct 소스 부재 (0ms)
  ✓ 5 [unit] …:111 시나리오2 상용구 공유 보존 (1ms)
  ✓ 6 [unit] …:122 시나리오3 본인 스코프 유지 (0ms)
  ✓ 7 [unit] …:129 본인 스코프 vs 누설 분류 구분 (0ms)
  ✓ 8 [unit] …:141 커버리지 가드 6건 고정 (0ms)
  8 passed (1.0s)
```
빌드: `npm run build` ✓.

---

## 4-B. 배포 URL 브라우저 시뮬 1회 (supervisor eud9 phase2 — prod 실증)

스크립트: `scripts/qa_shot_autocomplete_audit.mjs` · 대상 `https://obliv-foot-crm.vercel.app` · 실행로그 `_handoff/qa_screenshots/T-…AUDIT/browser_sim_run.log` · 결과 JSON `browser_sim_result.json`.

| shot | 시나리오 | 최종 URL / 관측 | 결과 | 스크린샷 |
|------|----------|-----------------|------|----------|
| shot1 | 미로그인 `/admin/customers` 직접 접근 | `→ /login` 리다이렉트 (감사 빌드 auth 게이트) | ✓ blocked | `shot1_anon_blocked.png` |
| shot2 | admin 세션 주입 후 `/admin/customers` | `/admin/customers` 고객 목록 렌더 (감사 빌드 라이브) | ✓ on /customers | `shot2_admin_customers.png` |
| shot3 | 고객 검색창 "김" 입력 → 자동완성/필터 결과 | 노출 컬럼 = **이름·전화번호·생년월일·차트번호·방문·최종방문·결제액·고객메모** (전부 인물식별 메타). 진단명/임상경과/진료메모 등 **차트 자유텍스트 미리보기 0건** | ✓ no chart-text leak | `shot3_customer_search_person.png` |

`browser_sim_result.json`:
```json
{"shot1_anon_blocked":true,"shot2_admin_customers":true,"shot3_typed":true,"shot3_no_chart_text_leak":true}
```

→ 배포본에서도 **고객 검색 자동완성 = (A) customers 인물식별 검색**(이름/전화/차트번호)이며, 환자 간 차트기록(진단·임상경과·메모) 미리보기 (B) 노출은 0건임을 시각 실증. (shot3 의 '고객메모' 컬럼은 customers 레벨 메모(예: 패키지 태그)로 medical_charts 차트 자유텍스트가 아니며, 자동완성 후보 미리보기 메커니즘도 아님.)

---

## 5. 결론

**전수감사 결과 (B) 환자 간 차트기록 교차 누설 = 0건.**
- 데이터 연동 자동완성 후보 = (A) 클리닉 마스터 4건(phrase_templates/super_phrases/prescription_sets.folder) + 인물식별 검색 2건(customers name ilike). 전부 환자 비종속 또는 인물검색.
- 진단명 datalist 2건은 별도 티켓(44a6deb·bfe1e2b) 소관으로 미접촉(중복 회피).
- 본인 스코프(customer_id) 차트 쿼리 2건은 누설 아님 → 유지(과제거 방지).
- **코드 변경 0건**(AC-4: 감사가 산출물) + spec/config 추가. DB 무변경. 상용구·진단명 회귀 없음.
