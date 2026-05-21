---
id: T-20260522-foot-TRIAL-PKG-ADD
domain: foot
priority: P2
status: deploy-ready
hotfix: false
created: 2026-05-22 00:37
deadline: 2026-05-27
deploy_ready_at: 2026-05-22
deploy_ready_by: dev-foot
build_ok: true
db_changed: true
db_migration: 20260522010000_pkg_trial_sessions.sql
e2e_spec: tests/e2e/T-20260522-foot-TRIAL-PKG-ADD.spec.ts
slack_channel: C0ATE5P6JTH
slack_thread_ts: null
reporter: 김주연 총괄
reporter_slack_id: null
attachments: []
e2e_spec_exempt_reason: null
risk_verdict: GO_WARN
risk_reason: "구입 티켓 추가 화면에 체험권 카테고리 추가. 기존 4종(가열/비가열/포돌로게/수액)과 동일 기능. DB pkg_sessions 또는 treatment_type enum/CHECK 확장 가능성(1/5). TRIAL-DROP-ADD(8d44690, deployed)에서 금일치료 드롭 체험권 추가 완료 — 본 티켓은 구매 동선 짝 맞춤."
---

# T-20260522-foot-TRIAL-PKG-ADD — 구입 티켓 추가에 [체험권] 카테고리 신규 추가

## 배경

T-20260521-foot-TRIAL-DROP-ADD(deployed, 8d44690)에서 회차 차감 "금일치료" 드롭다운에 [체험권] 항목이 추가되었으나, **구입 티켓 추가** 화면(패키지 구매)에는 체험권 카테고리가 없어 구매→차감 쌍이 성립하지 않음. 기존 4종(가열/비가열/포돌로게/수액)과 동일한 기능으로 체험권을 5번째 카테고리로 추가하는 요청.

현장 원문: "구입 티켓 추가에서 가열/비가열/포돌로게/수액/체험권 -> 항목 하나만 추가해줘 기능도 다 동일해야해! / 금일치료 드롭에 [체험권]이랑 짝이 없네"

## 수용 기준 (AC) — 구현 결과

- **AC-1** ✅: 구입 티켓 추가 화면(PackagePurchaseFromTemplateDialog)에 체험권 섹션 추가 — 회수/수가 입력
- **AC-2** ✅: 체험권 선택 시 기존 4종과 동일 기능 (회차·금액·저장) — submit/submitWithTemplate 모두 trial_sessions/trial_unit_price 포함
- **AC-3** ✅: 등록된 체험권 패키지 → 고객 차트 패키지 목록에 trial 잔여 표시 (trial > 0 && rem.trial > 0 조건부)
- **AC-4** ✅: 체험권 패키지 회차 차감 → get_package_remaining RPC trial 차감 추적 (20260522010000_pkg_trial_sessions.sql)
- **AC-5** ✅: 기존 4종 동작 영향 없음 — computedTotal/totalSessions 기존 로직 유지

## 구현 내역

### DB 마이그레이션 (적용 완료)
- `supabase/migrations/20260522010000_pkg_trial_sessions.sql`
  - `packages.trial_sessions INT DEFAULT 0` 컬럼 추가
  - `packages.trial_unit_price INT DEFAULT 0` 컬럼 추가
  - `package_templates.trial_sessions INT DEFAULT 0` 컬럼 추가
  - `package_templates.trial_unit_price INT DEFAULT 0` 컬럼 추가
  - `get_package_remaining` RPC 갱신 — trial 차감 추적 추가
- `scripts/apply_20260522010000_pkg_trial_sessions.mjs` — 마이그레이션 적용 스크립트 (실행 완료 확인)

### FE 변경
- `src/lib/types.ts`: Package / PackageRemaining / PackageTemplate 인터페이스에 trial 필드 추가
- `src/pages/CustomerChartPage.tsx`:
  - PackagePurchaseFromTemplateDialog — trial state/computedTotal/totalSessions/submit/submitWithTemplate/UI 섹션 추가
  - 패키지 목록 잔여 표시에 체험권 행 추가
  - 패키지 상세 카드에 체험권 항목 표시
  - `TREAT_KO` 맵에 trial: '체험권' 포함
- `src/pages/Packages.tsx`:
  - PackageTemplateDialog — trial state/computedTotal/저장로직/UI 섹션 추가
  - PackageCreateDialog — trial UI 섹션/저장로직 추가
  - 템플릿 목록 카드에 체험권 회수 표시

### E2E 스펙
- `tests/e2e/T-20260522-foot-TRIAL-PKG-ADD.spec.ts` — 5개 테스트
  - AC-1: 구입 티켓 추가 화면에 체험권 섹션 표시
  - AC-1 packages-page: 패키지 관리 템플릿 에디터 체험권 섹션
  - AC-5: 기존 4종 섹션 그대로 표시
  - AC-4: 차감 드롭다운 체험권 연동 확인
  - AC-2: 체험권 회수/수가 입력 가능 + disabled 검증

## 빌드 결과
- `npm run build` ✅ (0 errors, 0 warnings)
- DB 마이그레이션 적용 ✅ (packages/package_templates trial 컬럼 + RPC 갱신 확인)
