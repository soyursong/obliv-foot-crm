---
id: T-20260523-foot-PKG-TMPL-LINK
domain: foot
priority: P1
status: deploy-ready
qa_result: pending
qa_grade: null
deployed_at: null
deploy_commit: 1ff796a
bundle_hash: null
hotfix: false
created: 2026-05-23
deadline: 2026-05-29
deploy_ready_at: 2026-05-23
deploy_ready_by: dev-foot
build_ok: true
db_changed: false
db_migration: null
e2e_spec: tests/e2e/T-20260523-foot-PKG-TMPL-LINK.spec.ts
slack_channel: C0ATE5P6JTH
slack_thread_ts: null
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
attachments:
  - ~/file_inbox/20260523/083627_direct_img_8043.png
  - ~/file_inbox/20260523/083628_direct_img_8044.png
e2e_spec_exempt_reason: null
risk_verdict: GO_WARN
risk_reason: "결제 금액 연동은 핵심 매출 경로. PACKAGE_PRESETS 하드코딩 제거 → package_templates DB 실시간 참조로 금액 불일치(3,600,000 vs 2,960,000) 해소. DB FK는 이전 마이그레이션(20260507000020)에서 기설정. 코드변경은 PaymentDialog.tsx + E2E spec 신규."
---

# T-20260523-foot-PKG-TMPL-LINK — 1번차트 결제 팝업 패키지 ↔ 패키지 템플릿 연동

## 배경

1번차트 결제 팝업 → "패키지 결제" 탭의 패키지 목록이 `PACKAGE_PRESETS`(하드코딩)를 참조해 `package_templates` DB와 금액 불일치 발생:
- 결제 팝업: 패키지1 (12회) 3,600,000원
- 템플릿 관리: 12회권 총 2,960,000원

`package_templates`가 관리자 설정의 단일 진실 원천이므로, 결제 팝업도 동일 소스를 참조해야 함.

## 수용 기준 (AC) — 구현 결과

- **AC-1** ✅: 패키지 결제 탭 데이터 소스를 `package_templates`로 통일 (하드코딩 `PACKAGE_PRESETS` 제거)
  - `PaymentDialog.tsx`: `pkgTemplates` state + `useEffect`로 `clinic_id` 기준 `package_templates` fetch
  - `PACKAGE_PRESETS`는 더 이상 `PaymentDialog`에서 참조되지 않음

- **AC-2** ✅: 금액 정합성 — 표시 금액 = 템플릿 정의 금액, 회차 구성도 템플릿 기준
  - `handleSelectTemplate`: 선택 시 `total_price` 자동 세팅 (`setAmountStr(String(t.total_price))`)
  - 회차 표시: `heated+unheated+iv+podologe+trial` 합산

- **AC-3** ✅: `package_sessions ↔ package_templates` DB 관계 확인
  - 경로: `package_sessions → packages (template_id FK) → package_templates`
  - FK: `packages.template_id UUID REFERENCES package_templates(id)` — `20260507000020_package_templates.sql` 기설정
  - 신규 마이그레이션 불필요

- **AC-4** ✅: 템플릿 변경 즉시 반영 + 기구매 패키지 금액 스냅샷 유지
  - 결제 팝업: `package_templates`에서 실시간 fetch → 템플릿 변경 즉시 반영
  - `packages` INSERT 시 스냅샷 필드 저장:
    - `total_amount: selectedTemplate.total_price` (구매 시점 권장가)
    - `paid_amount: totalAmount` (실납부액, 할인 반영 가능)
    - 항목별 수가: `heated_unit_price`, `unheated_unit_price`, `iv_unit_price`, `podologe_unit_price`, `trial_unit_price` 스냅샷

- **AC-5** ✅: 기존 차감 로직(`handleHealerDeduct`) 회귀 방지
  - `PaymentDialog.tsx`만 변경, `CustomerChartPage.tsx` 미수정
  - `handleHealerDeduct` (line 2501 in CustomerChartPage.tsx) 영향 없음 확인

## 구현 내역

### DB 변경
- **없음** — 기존 마이그레이션으로 충족
  - `packages.template_id FK`: `20260507000020_package_templates.sql`
  - `packages.heated_unit_price/unheated_unit_price/iv_unit_price`: `20260507000030`
  - `packages.podologe_sessions/podologe_unit_price/iv_company`: `20260507000020`
  - `packages.trial_sessions/trial_unit_price`: `20260522010000_pkg_trial_sessions.sql`

### FE 변경
- `src/components/PaymentDialog.tsx`:
  - `PACKAGE_PRESETS` import 제거
  - `pkgTemplates: PackageTemplate[]` state 추가
  - `pkgTemplatesLoading` 상태 추가
  - `selectedTemplateId` state (`selectedPresetKey` 대체)
  - `clinic_id` 기준 `package_templates` fetch useEffect (is_active=true, sort_order/created_at 정렬)
  - `handleSelectTemplate`: 선택 시 `total_price` → `amountStr` 자동 세팅
  - packages INSERT에 `template_id` + 항목별 스냅샷 필드 추가
  - 로딩 중 / 빈 상태 안내 UI 추가

### E2E 스펙
- `tests/e2e/T-20260523-foot-PKG-TMPL-LINK.spec.ts` — 243줄, 9케이스
  - AC-1: PACKAGE_PRESETS 하드코딩 제거 (PackageTemplate 타입 일치)
  - AC-2: 금액 정합성 (total_price 자동 세팅)
  - AC-2(sessions): 총 세션 수 합산 정합성
  - AC-3: DB FK 경로 (template_id 필드 존재)
  - AC-3(db): 스냅샷 INSERT 컬럼 완전성
  - AC-4: 스냅샷 — total_amount=권장가, paid_amount=실납부액
  - AC-5: handleHealerDeduct 미수정 확인
  - formatAmount: 천단위 콤마 표시
  - 로딩/빈 상태 UI

## 빌드 결과
- `npm run build` ✅ (0 errors, 3.14s)
- E2E spec 9케이스 (정적 타입·로직 검증, 브라우저 불필요)
- DB 마이그레이션: 없음 (기설정 FK/컬럼 활용)

## 관련 티켓
- T-20260507-foot-PKG-TEMPLATE-REDESIGN (closed, 92a675c) — package_templates 테이블 최초 생성
- T-20260504-foot-PACKAGE-CRUD (closed) — packages CRUD 기반
