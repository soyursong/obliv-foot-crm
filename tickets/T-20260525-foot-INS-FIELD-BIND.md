---
ticket_id: T-20260525-foot-INS-FIELD-BIND
title: 보험청구서 field_map 바인딩 누락 수정 (상병코드·주민등록번호·주소)
status: deploy-ready
priority: P2
domain: foot
created: 2026-05-25
deploy_ready: true
deploy_ready_at: 2026-05-26T09:00:00+09:00
build_ok: true
db_change: false
spec_file: tests/e2e/T-20260525-foot-INS-FIELD-BIND.spec.ts
fix_commit: d869480
e2e_result: 43/43 PASS (unit + desktop-chrome)
---

## 개요

보험청구서(ins_claim_form) field_map에 상병코드(diag_code_N / diag_name_N), 주민등록번호(patient_rrn), 주소(patient_address) 바인딩이 누락된 문제 수정.

---

## AC별 결과

### AC-1: ins_claim_form field_map — disease_code/disease_name 바인딩 (DOC-CODE-INSERT 동일 메커니즘)
- `diag_code_1`, `diag_name_1`, `diag_code_2`, `diag_name_2` → INSURANCE_FALLBACK_TEMPLATES ins_claim_form field_map 추가 ✅
- `INS_CLAIM_HTML` 에 `{{diag_code_1}}`, `{{diag_name_1}}`, `{{diag_code_2}}`, `{{diag_name_2}}` 플레이스홀더 ✅
- 상병코드 2건 렌더링 + 1건(주상병만) 시나리오 ✅

### AC-2: ins_claim_form field_map — patient_rrn + patient_address
- `patient_rrn`, `patient_address` → field_map 추가 ✅
- HTML 템플릿 플레이스홀더 추가 ✅
- `AUTO_BIND_KEYS` 추가 ✅

### AC-3: 전수 감사 (기존 12종 + ins_claim_form)
- JPG 이미지 양식(med_record_short/long, treat_confirm_code/nocode) → JPG_ONLY_FORM_KEYS로 제외 ✅  
- `diag_opinion_v2` HTML에 `{{diag_code_1}}<br>{{diag_code_2}}` 추가 (병명 셀) ✅
- `diag_opinion_v2` field_map: disease_name → diag_code_1(주) + diag_code_2(부) 동기화 ✅
- 상병코드 플레이스홀더 전수 (7종) + 렌더링 시뮬레이션 전종 PASS ✅

### AC-4: 빌드 통과
- `npm run build` OK ✅
- E2E 43/43 PASS (unit + desktop-chrome) ✅

---

## FIX-REQUEST 이력

| 시각 | 내용 |
|------|------|
| 2026-05-25T20:55 | deploy-ready 초기 마킹 (AC-1~AC-3 서비스차지 상병코드 바인딩) |
| 2026-05-26T08:19 | supervisor FIX-REQUEST (MSG-20260526-081905-evn1) — spec 8건 실패 |
| 2026-05-26T08:33 | fix commit d869480: spec JPG_ONLY_FORM_KEYS + diag_opinion_v2 HTML 수정 |
| 2026-05-26T09:00 | 재검증 43/43 PASS → deploy-ready 재갱신 |
