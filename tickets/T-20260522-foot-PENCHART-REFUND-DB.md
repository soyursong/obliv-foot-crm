---
id: T-20260522-foot-PENCHART-REFUND-DB
title: "펜차트 refund_consent form_templates DB 등록 (정합성)"
domain: foot
priority: P2
status: deployed
deploy_ready_at: 2026-05-22
deploy_ready_commit: dfb59f2
deploy_ready_build: "npm run build — 3.19s exit 0"
deploy_ready_db_change: "있음 (form_templates 1행 INSERT — refund_consent, sort_order=93, png, requires_signature=true)"
deploy_ready_e2e: "db_only exempt (e2e_spec_exempt_reason)"
hotfix: false
created: 2026-05-22 11:16
deadline: 2026-05-29
assignee: dev-foot
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
slack_channel: C0ATE5P6JTH
slack_thread_ts: 1779414645.335609
source_msg: MSG-20260522-111320-df2d
attachments: []
related_tickets:
  - T-20260522-foot-PENCHART-ERASER-CLARITY  # parent — AC-6 검토에서 발견
  - T-20260520-foot-PENCHART-REFUND-FORM     # deployed (79a8118) — 환불/비급여동의서 패턴
e2e_spec_exempt_reason: db_only
risk_verdict: GO
risk_reason: "form_templates 1행 INSERT. 코드는 이미 BUILTIN_REFUND_CONSENT 폴백으로 정상 동작 중. DB 정합성 보정 목적. 운영 영향 없음."
qa_result: pass
qa_grade: Green
deployed_at: 2026-05-22T11:35:05+09:00
deploy_commit: 2d54451
bundle_hash: index-CDr3iSO-
---

# 펜차트 refund_consent form_templates DB 등록 (정합성)

## 배경

T-20260522-foot-PENCHART-ERASER-CLARITY AC-6 form_templates 전수 검토 결과에서 발견. clinic jongno-foot(74967aea) 조회 대상 4종 중 refund_consent 1건이 DB에 미등록.

현재 코드는 `BUILTIN_REFUND_CONSENT` 폴백(`/forms/refund_consent.png`)으로 정상 동작하므로 **운영상 문제 없음**. 다만 DB 정합성 측면에서 form_templates 테이블에 등록 권장.

나머지 23건은 PenChartTab `.in(form_key)` 필터로 무해. personal_checklist_general/senior는 active=false로 정상 비활성화됨.

## 요구사항

- form_templates 테이블에 refund_consent 행 INSERT
- 기존 BUILTIN_REFUND_CONSENT 폴백 코드와 정합 (category, template_format, form_key, image_path 등)
- clinic_id: jongno-foot (74967aea) 기준. 다른 클리닉 필요 여부 확인

## 수용 기준 (AC)

- [x] AC-1: form_templates에 refund_consent 행 존재 (DB 정합) — sort_order=93, png, requires_signature=true ✅
- [x] AC-2: PenChartTab에서 refund_consent 양식이 기존과 동일하게 동작 (폴백→DB 전환 시 렌더링 일치) — isPdfOverlayFormKey form_key 기반, template_path 동일 ✅
- [x] AC-3: DB 우선 조회 후 폴백 유지 방식 채택 (기존 코드 패턴 유지) ✅

## 리스크 5항목

| # | 항목 | 판정 | 비고 |
|---|------|------|------|
| 1 | DB 스키마 변경 | GO | INSERT only, 스키마 변경 없음 |
| 2 | 외부 서비스 의존 | GO | 없음 |
| 3 | 비즈니스 로직 변경 | GO | 폴백→DB 전환. 기존 동작 동일 |
| 4 | 대량 데이터 변경 | GO | 1행 INSERT |
| 5 | 신규 npm 패키지 | GO | 없음 |

**종합: GO (0/5)** — 1행 INSERT. 운영 영향 없음.

## QA 결과 (supervisor, 2026-05-22T11:35+09:00)

**판정: GO (Green)** — 전 항목 PASS

| Phase | 항목 | 결과 | 근거 |
|-------|------|------|------|
| 1 | 빌드 | ✅ PASS | `npm run build` 3.31s exit 0 |
| 1 | src/ 변경 | ✅ PASS | db_only — scripts/apply_*.mjs만 추가, src/ 무변경 |
| 1 | 폴백 로직 | ✅ PASS | PenChartTab.tsx L334: `refundConsent ?? BUILTIN_REFUND_CONSENT` |
| 1 | Migration 멱등 | ✅ PASS | `ON CONFLICT (clinic_id, form_key) DO NOTHING` |
| 1 | 롤백 SQL | ✅ PASS | 20260522060000_form_templates_audit_fix.down.sql 존재 |
| 1 | RLS | ✅ PASS | form_templates_admin_all + form_templates_approved_read 기존 정책 적용 |
| 1.5 | Env 매트릭스 | ✅ PASS | VITE_SUPABASE_URL 운영 bundle 확인 (rxlomoozakkjesdqjtvd.supabase) |
| §7.5 | Runtime null safety | ✅ PASS | REFUND_AUTOFILL_POS 정적 상수, `if (data){}` 가드, `??` 폴백 |
| 2 | 브라우저 | ✅ PASS | obliv-foot-crm.vercel.app 홈 로드 정상. 화이트스크린 없음 |

**비고:** DB 실제 적용은 FORM-AUDIT(a557a04) 에서 완료됨. dfb59f2는 apply script 형식화 커밋 (멱등 확인 — CRIT-1 SKIP). 운영 영향 없음.

## 진행 이력
- 2026-05-22 11:16 — planner 티켓 생성. PENCHART-ERASER-CLARITY AC-6 검토 결과에서 분리. optional P2.
- 2026-05-22 11:28 — dev-foot 구현 완료. apply_20260522060000_form_templates_audit_fix.mjs 작성 + 실행. DB 검증 AC-1/2/3 전건 PASS. 빌드 3.19s OK. commit dfb59f2. deploy-ready 마킹.
- 2026-05-22 11:32 — planner: FORM-AUDIT(a557a04)에서 refund_consent INSERT 이미 완료 확인. closed-superseded 처리.
- 2026-05-22 11:35 — supervisor QA PASS (Green). 빌드/env/브라우저/runtime-safety 전 항목. origin/main 2d54451. deployed 마킹.
