---
id: T-20260610-foot-SMS-DISPLAYNAME-SPLIT
domain: foot
priority: P1
status: deploy-ready
deploy_ready: true
db_changed: true
db_migration: 20260610090000_sms_display_name.sql
db_migration_applied: true
db_migration_applied_at: 2026-06-11
db_migration_applied_by: agent-fdd-dev-foot
db_migration_applied_note: "운영 DB 적용 완료(컬럼 sms_display_name VARCHAR(100) NULL + RPC admin_set_sms_display_name). EF select 시뮬 무에러 확인. scripts/apply_20260610090000_sms_display_name.mjs"
hotfix: false
created: 2026-06-10
reporter: 김주연 총괄
reporter_msg: 2026-06-10 옵션B 확정
source_msg: MSG-20260610-143954-e7jm
author: agent-fdd-dev-foot
e2e_spec: tests/e2e/T-20260610-foot-SMS-DISPLAYNAME-SPLIT.spec.ts
data_arch_consult: "clinic_messaging_capability.sms_display_name 신규 컬럼(additive·nullable·fallback) — supervisor DB Gate APPROVED. clinics.name(법정서식 SSOT) 무변경. cross-CRM core 엔티티 아님(per-CRM messaging config)."
deploy_target: "Vercel(FE: AdminSettings/SendSmsDialog) + Edge Function(send-notification) + Supabase 마이그(supervisor 적용)"
qa_gate: "GO_WARN — SMS 자동발송 핵심경로. 미리보기==자동발송 정합 수동 검증 필요(sms_display_name 설정→3경로 치환 확인)."
---

# T-20260610-foot-SMS-DISPLAYNAME-SPLIT — 문자 발송용 지점 표시명 분리 (옵션B)

## 배경
`clinics.name` = 17종 법정 의료서식(진단서·처방전·진료비영수증·납입증명서 등) 전용 **불변** 컬럼.
SMS 템플릿 `{지점명}` 치환에 그대로 쓰면 `[오블리브 오블리브의원 서울 오리진점점]`처럼 깨짐.
→ 문자 전용 표시명을 별도 컬럼(`clinic_messaging_capability.sms_display_name`)으로 분리.
NULL이면 `clinics.name` fallback → 미설정 지점은 현행 동작 유지.

## Acceptance Criteria
- **AC-0** (DB Gate APPROVED): `clinic_messaging_capability.sms_display_name VARCHAR(100) NULL` 컬럼 + `admin_set_sms_display_name(uuid, text)` admin 전용 RPC. → `20260610090000_sms_display_name.sql` / `.rollback.sql`
- **AC-1** (HEAD 커밋됨 616f1ff 동선): 수동 SMS 모달(SendSmsDialog) `{지점명}` → `sms_display_name` 우선·NULL이면 `clinics.name` fallback.
- **AC-2**: AdminSettings ③ 템플릿 미리보기 `{지점명}` → 동일 우선순위 (sms_display_name → clinics.name).
- **AC-3**: send-notification EF 자동발송 `{지점명}` → 동일 우선순위. **미리보기==자동발송 정합 보장.**
- **AC-4**: ⓪ 연결 설정에 "문자용 지점명" 입력 필드(`sms-display-name-input`) + 빈값=기관 정식명칭 fallback 안내 + `admin_set_sms_display_name` 저장.
- **AC-5** (회귀가드): 법정 의료서식 17종은 `clinics.name` 불변. → `sms_display_name`은 AdminSettings·SendSmsDialog 2개 SMS 표면에만 존재, 법정서식 컴포넌트(DocumentPrintPanel/InsuranceDocPanel/ReceiptUpload 등) 미참조 확인.

## 3경로 치환 정합 (핵심)
| 경로 | 파일 | 우선순위 |
|------|------|----------|
| 수동 SMS 모달 | SendSmsDialog.tsx:282 | `capData?.sms_display_name \|\| clinicName` |
| 템플릿 미리보기 | AdminSettings.tsx (preview useEffect) | `capData?.sms_display_name \|\| clinicLegalName` |
| 자동발송 EF | send-notification/index.ts (renderTemplate) | `capTyped.sms_display_name \|\| clinicLegalName` |

## 빌드
`npm run build` ✓ (vite 3.73s). EF는 Deno — supervisor 배포 시 검증.

## DB 변경
있음 — `20260610090000_sms_display_name.sql` (DB Gate APPROVED). nullable+fallback → 배포-마이그 순서 레이스 안전(컬럼 미적용 시 select('*') 누락 필드 undefined → fallback).

### ✅ 운영 DB 적용 완료 (2026-06-11, FIX-REQUEST MSG-20260611-044905-e5jb)
- 적용 전 상태: 컬럼/RPC 모두 **없음** 확인 → QA phase1 db_migration_pending 원인 일치.
- 적용: `scripts/apply_20260610090000_sms_display_name.mjs` (BEGIN/COMMIT, 멱등 IF NOT EXISTS + CREATE OR REPLACE).
- 검증 결과:
  - `clinic_messaging_capability.sms_display_name` = `character varying(100)`, nullable=YES ✓
  - RPC `admin_set_sms_display_name(p_clinic_id uuid, p_sms_display_name text)` 존재 ✓
  - EF select 시뮬(`SELECT clinic_id, sms_display_name FROM clinic_messaging_capability`) 무에러, 기존 행 sms_display_name=NULL(fallback) ✓ → **send-notification EF line 681 명시 select 런타임 500 위험 해소.**
- send-notification/index.ts:681 select 목록에 `sms_display_name` 포함 / :869 `capTyped.sms_display_name || clinicLegalName` fallback 로직 확인.

### ✅ 재검증 완료 (2026-06-11, FIX-REQUEST MSG-20260611-051248-rue1 / phase2 spec_fail_new)
- supervisor 지적: `/admin` "문자용 지점명" 필드 렌더·UI 텍스트 노출 보장 + 라벨/selector 일치 확인.
- 코드 진단: 필드는 `AdminSettings.tsx` ⓪ 연결 설정 섹션 line 610-622에 존재 (라벨 "문자용 지점명", `data-testid="sms-display-name-input"`, 안내문 "...비워두면 기관 정식명칭(법정 의료서식용)..."). **라벨/텍스트 변경 없음 — selector와 정확히 일치.**
- 라이브 spec 재실행: `T-20260610-foot-SMS-DISPLAYNAME-SPLIT.spec.ts` **4/4 PASS** (desktop-chrome, auth=admin). AC-4 필드 렌더+편집+안내문 노출 confirm, AC-2 미리보기 치환 confirm, 회귀 pass.
- 하드닝: AC-4 spec에 라벨 "문자용 지점명" 텍스트 노출 명시 assert 추가 + 안내문 assert를 `.first()` scope(placeholder "예: 오리진 (비우면 기관 정식명칭 사용)"와 strict-mode 충돌 방지).
- 주의: 필드는 `/admin/settings` 기본 진입 섹션(① 채널 가능 여부)이 아니라 **⓪ 연결 설정(admin 전용) 클릭 후** 노출 — 수동 QA 시 ⓪ 섹션 진입 필요(설계상 Solapi 자격증명과 동일 admin 전용 섹션).
- 빌드 `npm run build` ✓ (vite 4.10s).
