---
id: T-20260520-foot-PRINT-FORM-BIND
title: "출력 서류 고객정보 바인딩 전면 강화 + items_html raw 렌더링 버그 수정"
domain: foot
priority: P1
status: deploy-ready
hotfix: false
created: 2026-05-20
deadline: 2026-05-21
assignee: dev-foot
deploy_ready: true
commit_sha: ""
build_ok: true
db_change: true
db_rollback_sql: supabase/migrations/20260520120000_clinics_nhis_fax.down.sql
e2e_spec: tests/e2e/T-20260520-foot-PRINT-FORM-BIND.spec.ts
---

# T-20260520-foot-PRINT-FORM-BIND — 출력 서류 고객정보 바인딩 전면 강화

## 배경

- 서류 발행 양식에서 고객 정보(주민번호·차트번호·성별·생년월일·주소) 및 의료기관 정보(요양기관번호·팩스)가 연동되지 않는 문제.
- `items_html` / `rx_items_html` 테이블 행 HTML이 이스케이프 처리되어 `<tr>` 등 태그가 텍스트로 노출되는 렌더링 버그.

## 변경 범위

### 1. `src/lib/htmlFormTemplates.ts`

- **bindHtmlTemplate() 수정**: `_html` 접미사 키 raw 통과 (items_html, rx_items_html 등 내부 생성 HTML은 이스케이프 생략). 그 외 필드는 기존 HTML 이스케이프 유지.
- **diag_opinion 성별 필드**: 하드코딩 `☑ 남` → `{{patient_gender}}` 동적 플레이스홀더.
- **rx_standard 팩스 필드**: 빈 칸 → `{{clinic_fax}}` 동적 플레이스홀더.

### 2. `src/lib/formTemplates.ts`

- `AUTO_BIND_KEYS` 확장 — 신규 11개:
  `patient_address`, `patient_gender`, `patient_birthdate`, `patient_age`,
  `record_no`, `diag_code_1`, `diag_name_1`, `diag_code_2`, `diag_name_2`,
  `clinic_nhis_code`, `clinic_fax`

### 3. `src/lib/types.ts`

- `Clinic` 인터페이스에 `nhis_code`, `fax` 필드 추가.

### 4. `src/components/DocumentPrintPanel.tsx`

- `CustomerBindInfo` 인터페이스: `rrn`, `address`, `address_detail`, `birth_date`, `chart_number`, `gender` 필드 추가.
- `AutoBindContext.clinic`: `nhis_code`, `fax` 필드 추가.
- `AutoBindContext.diagCodes`: `code1`, `name1`, `code2`, `name2` 신규.
- `buildAutoBindValues()`: 신규 바인딩 필드 11개 추가.
- `loadAutoBindContext()`: `customers` 쿼리 확장 + `rrn_decrypt` RPC 병렬 호출. `clinics` 쿼리 확장 (nhis_code, fax). `medical_charts` 진단명 조회 신규.
- 헬퍼 함수 신규: `formatBirthDate()`, `calcAge()`, `formatGenderCheckbox()`, `parseIcdFromText()`.

### 5. `supabase/migrations/20260520120000_clinics_nhis_fax.sql`

- `clinics` 테이블에 `nhis_code TEXT` (요양기관번호) + `fax TEXT` (팩스) 컬럼 추가. NULL 허용 — 기존 데이터 무영향.
- 롤백: `20260520120000_clinics_nhis_fax.down.sql`

## 수용 기준 (AC)

| # | AC | 확인 방법 |
|---|----|---------|
| 1 | bindHtmlTemplate _html 접미사 raw 통과 | E2E AC-1 |
| 2 | 일반 필드 HTML 이스케이프 (XSS 방지) | E2E AC-2 |
| 3 | AUTO_BIND_KEYS 신규 11개 키 포함 | E2E AC-3 |
| 4 | patient_gender 동적 바인딩 (diag_opinion) | E2E AC-4 |
| 5 | clinic_fax 동적 바인딩 (rx_standard) | E2E AC-5 |
| 6 | null/미입력 엣지 케이스 — 플레이스홀더 노출 없음 | E2E AC-6 |
| 7 | buildBillDetailItemsHtml / buildRxItemsHtml 정상 | E2E AC-7 |

## QA 출력양식 실물 대조 필수 기준

> 대표 지시 2026-05-20 — supervisor QA에서 미충족 시 qa-fail 처리

1. **5종 양식 미리보기 스크린샷**: bill_detail·bill_receipt·rx_standard·diag_opinion·diagnosis 각각 실제 환자 데이터로 미리보기 확인 후 스크린샷 확보
2. **DB 값 vs 출력 값 일치**: 주민번호·차트번호·면허번호·요양기관번호·전화번호·주소·성별·생년월일 DB 원본과 출력 일치 확인
3. **HTML raw 태그 노출 0건**: items_html/rx_items_html 이외 필드에서 `<`, `>`, `&` raw 노출 없음 자체 확인
4. **미입력 환자 엣지 케이스**: chart_number·rrn·nhis_code 미입력 환자 대상 서류 출력 시 빈 칸(태그 아님) 확인
5. **기존 서류 regression**: 진단서·진료확인서·통원확인서 등 기존 정상 서류 출력 동작 유지 확인

## 리스크

| # | 항목 | 판정 |
|---|------|------|
| 1 | DB 스키마 변경 | WARN — clinics 테이블 컬럼 추가 (NULL 허용, 안전) |
| 2 | rrn_decrypt RPC | PASS — 기존 RPC 재사용 |
| 3 | 서류 렌더링 regression | WARN — 11종 HTML 양식 동시 영향. items_html 버그 수정이 기존 bill_detail 렌더링 개선 |
| 4 | XSS | PASS — _html 외 필드 이스케이프 유지 |

## 참조

- T-20260514-foot-FORM-CLARITY-REWORK (HTML 양식 5종)
- T-20260515-foot-FORM-ONELINE-RX (rx_standard HTML)
- T-20260517-foot-FORM-SCREENSHOT-FIX (bill_receipt HTML)
- T-20260520-foot-DOC-PRINT-LINKAGE (후속: 4종 서류 고객정보 전면 수정)
- rrn_encrypt/rrn_decrypt RPC — RRN-ENC 배포 완료
