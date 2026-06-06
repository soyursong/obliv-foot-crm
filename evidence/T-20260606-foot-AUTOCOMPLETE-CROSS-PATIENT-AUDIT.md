# T-20260606-foot-AUTOCOMPLETE-CROSS-PATIENT-AUDIT — 전수감사 결과

자동완성/미리보기 환자 간 차트기록(PII) 교차누설 전수 감사.
근거: 문지은 대표원장(C0ATE5P6JTH) — "상용구 단축어 외 서로의 차트기록 미리보기 공유 절대 금지. CRM=환자 개인정보".

## 판정 잣대
- (A) 클리닉 레벨 마스터 = 공유 OK: super_phrases, phrase_templates(상용구/단축어), services(상병/시술/처방 마스터), prescription_sets.folder 등.
- (B) 환자별 차트기록 = 교차 공유 절대 금지: medical_charts.*, 진료메모, 고객메모, 처방 자유메모.
- 판정룰: 후보 쿼리가 "특정 환자(customer/chart_id) 종속 없이 전체 환자 행에서 자유텍스트를 distinct로 긁어오는" 구조면 (B) 누설. 환자 본인 스코프는 누설 아님.

## 범위 제외 (중복 회피)
- 진단명 자동완성 누설은 별도 처리 중 → 본 감사에서 손대지 않음:
  - `MedicalChartPanel.tsx` datalist `medchart-diagnosis-options` (L1910~1917) — T-20260606-foot-MEDCHART-DIAGNOSIS-AUTOCOMPLETE-FIX 소관
  - `SuperPhrasesTab.tsx` datalist `super-phrase-diagnosis-options` (L601~608) — bfe1e2b 소관

## 전수 식별 분류표 (진단명 외 전 입력란)

| # | 위치 | 후보 메커니즘 | 후보 소스 | 분류 | 판정 |
|---|------|--------------|-----------|------|------|
| 1 | MedicalChartPanel.tsx L1980~2053 | 임상경과 // 트리거 상용구 팝오버 | `phrase_templates`(is_active) + `super_phrases`(is_active) | A 마스터 | OK |
| 2 | PrescriptionSetsTab.tsx L459~466 datalist `rx-folder-suggestions` | 처방세트 폴더명 자동완성 | `prescription_sets.folder` distinct (클리닉 설정 마스터) | A 마스터 | OK |
| 3 | PenChartTab.tsx (L606,L1409~1413,L2076) | 펜차트 T상용구 메뉴/복수선택 | `phrase_templates`(DB 마스터) | A 마스터 | OK |
| 4 | Customers.tsx L777~954 `referrerSuggestions` | 추천인 자동완성 | `customers` name `ilike` → id/name/phone (인물 식별 검색) | 의도된 인물검색 | OK (차트기록 아님) |
| 5 | 다수 (`autoComplete="off"|"new-password"|"tel"|"current-password"`) | 브라우저 autofill 억제 HTML 속성 | 데이터 비연동 | 비대상 | OK |

### 데이터 비연동 `autoComplete` HTML 속성 (누설 무관) 발생처
CustomerChartPage(L3739,3756) / SelfCheckIn(L2229) / TreatmentSetsTab(L356) / AdminSettings(L511,525,611) / Accounts(L396,415,563) / ChangePasswordDialog(L128,153,179).

## 교차검증 (숨은 누설 점검)
- 전 datalist 3건만 존재(`list=` grep): 2건 진단명(범위 외), 1건 폴더명(마스터).
- `distinct`/`Combobox`/`<Command`: 추가 후보 메커니즘 0건.
- 차트 자유텍스트 컬럼 기반 cross-patient distinct 후보 쿼리: 0건.
- `CheckInDetailSheet.tsx` L712~770 `ilike(phone)` 쿼리는 **특정 환자 본인** chart_number/customer_memo 로드(접수자 phone 키) — cross-patient 후보 아님, 본인 스코프 유지.
- `recentlyUpdated`(Dashboard) = UI 낙관적 갱신 추적 Set(row id), 텍스트 후보 아님.

## 결론
**전수감사 결과 (B) 환자 차트기록 교차 누설 없음.**
범위 내 자동완성/미리보기 후보 소스는 전부 (A) 클리닉 레벨 마스터(phrase_templates/super_phrases/prescription_sets.folder) 또는 의도된 인물 식별 검색(추천인). 진단명 2건은 별도 티켓 소관으로 미접촉.
- 코드 변경: **0건** (AC-4에 따라 감사 자체가 산출물).
- DB 변경: 없음.
- 상용구·진단명(bfe1e2b) 회귀: 없음(미접촉).

감사자: dev-foot · 2026-06-06
