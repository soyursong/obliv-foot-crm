# DOCPRINT-EDIT-BTN — 서류 종류별 현행 필드 분석 + 편집가능 항목 목록화 (분석 선행 보고)

- 티켓: **T-20260629-foot-DOCPRINT-EDIT-BTN** (서류 [출력] 옆 [수정] 버튼 + 용도·세부내용 편집)
- 부모: T-20260617-foot-DOCFORM-POPUP-OVERHAUL (done/deployed)
- 작성: dev-foot, 2026-07-01
- 목적: folded refinement (b) "서류 종류별 현행 필드 분석 → 편집 가능 항목 목록화 보고 선행" 이행. 임의 편집필드 노출 전 목록 확정용.

---

## 0. ★ 선행 블로커 (FOLLOWUP 동반) — 부모 §2#4 공통 '서류 설정/편집 팝업' 미구현

AC2 = "[수정] 클릭 → DOCFORM §2#4 공통 '서류 설정/편집 팝업' 오픈(별도 신규 에디터 신설 금지 — **부모 팝업 재사용**)".
그러나 부모 done 산출물에 **재사용할 §2#4 공통 팝업이 존재하지 않음**.

부모(T-20260617)가 실제 배포한 산출물(git log 실측):
| commit | 산출물 |
|--------|--------|
| 07fddcb6 | Phase 1 — 진료대시보드 서류발급 허브 `DoctorDocsHubDialog` (얇은 진입 컨테이너, 기존 surface 3종 재사용만) |
| 21c4d986 | Phase 1 G4/G6 — 진료의뢰서 검사결과·투약 자동pull + 진단서 치료기간 분리 |
| 005f8af0 / ac0a5358 / c8eeb930 / 34597713 | Phase 2 — 가격 SSOT 브리지(services SKU 등재·Migration A/B), 서류 내용 편집 무관 |

`DoctorDocsHubDialog` 헤더 주석 명시: *"본 파일은 위 3개 surface를 '진입'만 시키는 얇은 컨테이너. 발행/출력/불변 로직은 각 컴포넌트 내부에 그대로 둠."* → **편집/설정 팝업 아님.**
`FormModal.tsx`/`FormEditLockBanner.tsx` = 펜차트 양식(동의서·체크리스트) 전용, 서류 출력 용도/세부내용 편집과 무관.
`grep -ri "용도|purpose|설정 팝업|field_data 편집 UI"` 결과 = 편집 진입 UI 0건.

**결론**: §2#4 "서류별 설정 팝업화"는 부모 Phase 2 surface 작업 중 **게이트 잔존으로 미구현**된 채 부모가 done(Phase1+가격슬라이스 범위) 처리됨. AC2의 "부모 팝업 재사용"은 충족 불가. 신규 구축 시 AC2 "별도 신규 에디터 신설 금지" 정면 위반 + 부모 Phase 2 범위 흡수(P2 슬라이스 초과). → 티켓 block_detail 사전분기대로 **planner FOLLOWUP**.

---

## 1. 서류 종류별 현행 필드 (formTemplates.ts 실측)

직원 편집 대상 = **소견서(diag_opinion)·진단서(diagnosis) 2종 EXCLUDE**(staff_edit_scope_2026-06-30, 원장 전용). 아래는 직원 편집 후보 서류.

| form_key | 서류명 | 현행 필드(주요) | 편집후보(현장 변경 의미 있는 값) |
|----------|--------|------------------|----------------------------------|
| `bill_receipt` | 진료비 영수증 | patient_name, patient_rrn, visit_date, clinic_*, insurance_covered, non_covered | (집계값 위주 — 편집 비권장. 발행일만) |
| `bill_detail` | 세부산정내역서 | patient_name, record_no, visit_date, **issue_date**, total_amount, clinic_* | **발행일** |
| `payment_cert` | 진료비납입증명서 | patient_*, clinic_*, issue_date | **발행일** |
| `treat_confirm` | 진료확인서 | patient_*, visit_date, issue_date, clinic_*, **{{purpose}}(용도)** | **용도, 발행일** |
| `visit_confirm` | 통원확인서 | patient_*, visit_date, issue_date, clinic_*, **{{purpose}}(용도)** | **용도, 발행일** |
| `referral_letter` | 진료의뢰서 | patient_*, **request_purpose(신청목적/용도)**, **remarks(참고사항/비고)**, issue_date | **용도(신청목적), 비고, 발행일** |
| `medical_record_*` | 진료기록사본 | patient_*, 기록범위, issue_date | **발행일** |
| `koh_result` | 균검사 결과지(KOH) | 검사값(published) | (검사 데이터 — 편집 비권장. 발행일만) |

`{{purpose}}` placeholder 실재: htmlFormTemplates.ts L267/411/612/761(treat_confirm·visit_confirm 등) + L1210 `{{request_purpose}}`(referral_letter). **용도 필드는 양식에 이미 슬롯이 있음** → 편집 UI만 없음.

## 2. 편집 가능 항목 목록 (확정 권고)

현장 요청 "서류 용도 + 세부 내용 일부" → 안전 편집 후보(전부 form_submissions.field_data JSON, **NO DDL**):

1. **서류 용도(purpose)** — 드롭다운. 후보값: `보험청구용 / 개인보관용 / 진료의뢰용 / 관공서제출용 / 회사제출용 / 기타(직접입력)`.
   적용 서류: 진료확인서·통원확인서(`purpose`), 진료의뢰서(`request_purpose`).
2. **발행일(issue_date)** — date. 전 서류 공통(소급/지정 발행일).
3. **비고/참고사항(remarks)** — multiline. 진료의뢰서 등 remarks 슬롯 보유 서류.

**제외**(편집 비노출): 집계금액(insurance_covered/non_covered/total_amount), 검사데이터(koh), 환자식별정보(rrn/주민번호 — PII 정합), 소견/진단(소견서·진단서 = 원장 전용).

## 3. published 불변 (의료법§22 / DOCFORM AC6 상속)

- 편집·재발행은 **신규 form_submissions 행 생성**, 기존 published 행 불변.
- 현행 발행 경로(DocumentPrintPanel L672/994/2283 등)는 발행 시점 `field_data` 스냅샷 저장 → 편집본은 새 발행 = 새 행. 기존 published 행 UPDATE 금지(SSOT 보존).

## 4. 권고 (planner 판정용)

§2#4 공통 팝업이 부재하므로 택1:
- **(A) 재스코프**: 본 티켓이 §2#4 공통 편집 팝업의 **최초 구현 인스턴스**를 함께 짓도록 AC2 완화 승인(= "재사용" → "최초 1개 구현"). 범위는 §2 목록(용도·발행일·비고)·직원 scope·NO-DDL로 한정 → P2 유지 가능. 본 분석이 그 spec 기반.
- **(B) 부모 재오픈**: 부모 Phase 2 §2#4 공통 팝업을 별도 티켓으로 먼저 구현 후, 본 티켓을 그 위 진입점 슬라이스로 재차단.

dev-foot 권고 = **(A)** — 편집 항목이 단순(JSON·NO-DDL), 직원 scope 명확, DA CONSULT 면제(risk_verdict GO_WARN 상속) → 독립 소형 편집 다이얼로그를 [출력] 영역에서 진입시키는 것이 최소침습. 단 AC2 "신규 에디터 금지" 명시 위반이므로 **planner 명시 승인 없이 착수 불가** → 본 FOLLOWUP.
