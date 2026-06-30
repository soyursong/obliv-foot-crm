# T-20260630-foot-DOCCONFIRM-PRICEBRANCH-RELABEL — deploy-ready 검증 evidence

**slice**: 진료확인서 2 SKU relabel-only (category_label 기본→제증명). bridge 카브아웃(FORMPANEL-SPLIT). 가격 mutate 0.
**reporter**: 김주연 총괄 B안 (두 SKU 유지·가격 변경 0, MSG-20260630-110054-unrn)
**DA gate**: data-architect CONSULT-REPLY DA-…-DOCCONFIRM-PRICEBRANCH-RELABEL (MSG-20260630-123516-vsyz) → **relabel = GO**
  - 대표 게이트 면제 동의 (autonomy §3.1: 가격0·DDL0·relabel-only ADDITIVE)
  - supervisor DDL-diff 불요 동의 (UPDATE-only 데이터 슬라이스, DDL 0)
  - bridge = (α) defer → T-20260630-foot-DOCCONFIRM-FORMPANEL-SPLIT 이관
  - C5900004(out-of-scope 진료확인서 3000) = 무접촉

## migration

- `supabase/migrations/20260630150000_foot_docconfirm_pricebranch_relabel.sql` (relabel-only UPDATE)
- `…rollback.sql` (제증명→기본 복원)
- `scripts/apply_20260630150000_foot_docconfirm_pricebranch_relabel.mjs` (preflight 실측대조 + 멱등 no-op + postverify)
- commit `84c316e4` — origin/main ancestor 확인 (merge-base --is-ancestor = YES). EF 무. db_only.

## PROD apply 검증 (2026-07-01, Management API · rxlomoozakkjesdqjtvd)

apply 스크립트 재실행 = **멱등 no-op** (이미 제증명). live 실측:

| service_code | name | price | category_label | active | is_insurance_covered |
|---|---|---|---|---|---|
| 진료확인서1 | 진료확인서(코드,진단명 포함) | 10000 | **제증명** | true | false |
| 진료확인서2 | 진료확인서(코드,진단명 불포함) | 3000 | **제증명** | true | false |

- ✅ relabel 적용 완료 (2행 모두 category_label='제증명')
- ✅ 가격 mutate 0 (10,000 / 3,000 보존) — B안 정합
- ✅ name·active 불변, UNIQUE(clinic_id,name) 충돌 0
- ✅ D1 forward-only: service_charges/payments 소급 mutate 0 (마스터 행 메타만 변경)
- ✅ D3: 비급여 축 유지 (is_insurance_covered=false)
- ✅ deactivate 0 (두 SKU active 유지)
- ✅ out-of-scope C5900004 '진료확인서'@3,000 무접촉

## build

`npm run build` (host 직렬 큐) → ✓ built (vite). 코드 변경 무(데이터 슬라이스) → 기존 번들 동일.

## E2E

§4 = `e2e_spec_exempt_reason: db_only` — UI 신규 동선 무(서비스관리 데이터 분류 라벨 이동). 서류 설정/출력 팝업 진료확인서 2종 가격·HTML variant 매핑은 부모 Phase 2 공통 팝업 E2E 커버.

## AC

- 서류 목록 진료확인서(코드포함 10,000)·진료확인서(코드불포함 3,000) 2종 노출, '제증명' 그룹 분류 — 데이터 정합 충족.
- 가격 변경 0 확인.
