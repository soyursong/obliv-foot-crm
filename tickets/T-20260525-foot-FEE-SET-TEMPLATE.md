---
id: T-20260525-foot-FEE-SET-TEMPLATE
domain: foot
priority: P2
status: deploy-ready
deploy_ready: true
hotfix: false
created: 2026-05-25 14:35
deadline: 2026-05-28
slack_channel: C0ATE5P6JTH
slack_thread_ts: 1779621062.631239
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
build_status: ok
db_changed: true
e2e_spec: tests/e2e/T-20260525-foot-FEE-SET-TEMPLATE.spec.ts
e2e_result: pass
rollback_sql: supabase/migrations/20260525020000_fee_set_templates_seed.down.sql
---

# T-20260525-foot-FEE-SET-TEMPLATE: 결제 미니창 수가항목 세트코드 템플릿

## 구현 요약

| AC | 내용 | 상태 |
|----|------|------|
| AC-1 | fee_set_templates 테이블 설계 + RLS | ✅ Done (migration 20260525010000) |
| AC-2 | 결제 미니창 [세트코드] 드롭다운 → 일괄 추가 | ✅ Done (PaymentMiniWindow.tsx) |
| AC-3 | 기본 시드 3건 DB 삽입 | ✅ Done (초진/무좀 4항목 · 초진/내성 3항목 · 재진/내성 4항목) |
| AC-R1 | 진료도구 메뉴 연동 현황 조사 리포트 | ✅ Done (signals.md + responder 전달) |

## 변경 파일

- `src/components/admin/FeeSetTemplatesTab.tsx` — 수가세트 CRUD (신규)
- `src/components/PaymentMiniWindow.tsx` — 세트코드 드롭다운 + append 로직
- `src/pages/DoctorTools.tsx` — 수가세트 탭 추가
- `supabase/migrations/20260525010000_fee_set_templates.sql` — 테이블 생성
- `supabase/migrations/20260525010000_fee_set_templates.down.sql` — 롤백
- `supabase/migrations/20260525020000_fee_set_templates_seed.sql` — 시드 3건
- `supabase/migrations/20260525020000_fee_set_templates_seed.down.sql` — 시드 롤백
- `scripts/apply_20260525020000_fee_set_templates_seed.mjs` — 시드 apply 스크립트
- `tests/e2e/T-20260525-foot-FEE-SET-TEMPLATE.spec.ts` — E2E spec

## DB 변경 내역

| 항목 | 내용 |
|------|------|
| 테이블 신규 | `fee_set_templates` (clinic_id FK + RLS) |
| 인덱스 신규 | `idx_fee_set_templates_clinic_name` (UNIQUE partial) · `idx_fee_set_templates_clinic_active` |
| 시드 | 초진/무좀 (4항목) · 초진/내성 (3항목) · 재진/내성 (4항목) |
| 롤백 | `20260525020000_fee_set_templates_seed.down.sql` |

## 현장 테스트 포인트

1. 진료도구 → 수가세트 탭 진입 (admin/manager)
2. 기본 세트 3건 표시 확인 (초진/무좀 · 초진/내성 · 재진/내성)
3. 결제 미니창 → [세트코드] 드롭다운 클릭 → 프리셋 선택 → 항목 일괄 추가
4. 중복 항목 방지 (같은 항목 있으면 qty+1)
