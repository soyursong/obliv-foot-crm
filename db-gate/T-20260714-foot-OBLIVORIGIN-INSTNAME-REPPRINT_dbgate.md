# T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT — DB-write 게이트 + axis B audit

- **환경**: prod Supabase `rxlomoozakkjesdqjtvd`
- **by**: agent-fdd-dev-foot
- **권위 근거**: CEO DECISION swc6 (MSG-20260714-165134-swc6) Q-C/Q2 · DA z2af (hira_institution_name ADDITIVE nullable canonical, §3.1 CEO게이트 면제·supervisor DDL-diff만)
- **db_change**: 있음 — ADDITIVE nullable `clinics.hira_institution_name` 신설 + jongno-foot 단일행 populate. DDL 파괴 0, 롤백 = DROP COLUMN 무손실.

## axis A — 요양기관명 축 신설·populate·재배선

### 마이그 파일 (멱등 가드 + 롤백)
- UP: `supabase/migrations/20260714180000_clinics_hira_institution_name_axis.sql`
  - `ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS hira_institution_name text;` (멱등)
  - `UPDATE ... SET hira_institution_name='오블리브의원 서울오리진점' WHERE slug='jongno-foot';` (slug 게이트)
- ROLLBACK: `..._clinics_hira_institution_name_axis.rollback.sql` → `DROP COLUMN IF EXISTS` (무손실)

### prod 실측 (READ-ONLY probe `scripts/..._probe.mjs`, 2026-07-16)
```json
{
  "column": [{ "column_name": "hira_institution_name", "data_type": "text", "is_nullable": "YES" }],
  "rows": [
    { "slug": "jongno-foot",  "name": "오블리브의원 서울오리진점", "hira_institution_name": "오블리브의원 서울오리진점", "nhis_code": "13328581" },
    { "slug": "songdo-foot",  "name": "오블리브 풋센터 송도",     "hira_institution_name": null,                      "nhis_code": null }
  ],
  "ledger": [{ "version": "20260714180000" }]
}
```
- **AC-1**: 요양기관명 = '오블리브의원 서울오리진점' (affirmative populate, silent 폴백 아님) ✅
- **AC-2**: 요양기관번호 13328581 페어 정합 ✅
- **AC-5**: jongno-foot 단일행만 populate, songdo-foot=null (오염 0) ✅
- ledger 20260714180000 등재 — prod 실재와 마이그 파일 정합 (forward-doc 멱등) ✅

### 셀 재배선 (affirmative, `{{clinic_name}}` → `{{hira_institution_name}}`)
`src/lib/htmlFormTemplates.ts` 5종 요양기관명-bearing 셀:
| form_key | 셀 | 재배선 |
|----------|-----|--------|
| diagnosis (진단서) | 의료기관 | `{{hira_institution_name}}` |
| bill_detail (세부산정내역) | 요양기관 명칭 | `{{hira_institution_name}}` |
| rx_standard (처방전) | 의료기관 명칭 | `{{hira_institution_name}}` |
| bill_receipt (영수증) | 요양기관 명칭 + 청구서명란 | `{{hira_institution_name}}` |
| ins_claim_form (공단 보험청구서) | 의료기관명 | `{{hira_institution_name}}` |

- `src/hooks/useEdiExport.ts`: 공단·EDI export `clinic_name` ← `clinic?.hira_institution_name` 재배선 (affirmative, NULL 폴백 금지).
- `src/lib/autoBindContext.ts`: `hira_institution_name` 전용 바인딩 슬롯 신설(`ctx.clinic?.hira_institution_name ?? ''` — NULL 시 공란, name silent 폴백 금지) + clinics select에 컬럼 추가.
- **AC-4**: 사업자명/상호·표시명(`{{clinic_name}}`) 셀은 무변경 — 요양기관명 셀만 축 분리. `payment_cert`(진료비납입증명서)의 사업자등록번호/소재지·병원장 셀 무접촉.

## axis B — 대표자 print 분리 audit (CEO Q2)

- **audit 결과**: foot 요양기관명-bearing 출력서류(diagnosis/bill_detail/rx_standard/bill_receipt/ins_claim_form)에 **별도 '사업자/개설자/기관 대표자' 렌더 필드 없음.** 대표자 성격 셀은 전부 진료의(`{{doctor_name}}`) / 병원장(`{{doctor_name}}`) 슬롯.
- **처리**: CEO Q2 규칙 = doctor 셀 진료의 보존, 박영진 미주입. 별도 기관 대표자 필드 부재 → `representative_name`(박영진) 바인딩 대상 없음 → **무변경** (진료의 보존이 곧 CEO 규칙 준수).
- **AC-3**: bill_detail 대표자 셀 = `{{doctor_name}}` 보존 (E2E `..._INSTNAME-REPPRINT.spec.ts` L75). 5종 서류에 `{{representative_name}}` 렌더 슬롯 부재 단언 (spec L86) ✅
- **AC-6 / leaf 무접촉**: 원장 개인직인 `clinic_doctors.seal_image_url` (`{{doctor_seal_html}}`) 무변경 — 회귀 0 ✅
- 데이터원(`representative_name`)은 buildAutoBindValues에 준비(4SET에서 신설·유지)되나 print 셀에 미주입 (spec L122).

## E2E
- 신규: `tests/e2e/T-20260714-foot-OBLIVORIGIN-INSTNAME-REPPRINT.spec.ts` — 31 passed (축 분리·affirmative·진료의 보존·audit)
- 회귀: `tests/e2e/T-20260714-foot-OBLIVORIGIN-IDENTITY-4SET.spec.ts` — 16 passed (요양기관명 축 델타 반영, 표시명 축 무변경 서류 유지)

## screenshot_gate (WARN-A)
- 요양기관명-bearing 전 출력서류 실기기 렌더 실측 스크린샷 = supervisor 렌더 실측 게이트. 본 dev 단계는 순수 함수(bindHtmlTemplate) 계층 단언 + prod 데이터 실측까지.
