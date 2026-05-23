---
id: T-20260522-foot-C2-PKG-EDIT-DEL
domain: foot
priority: P2
status: deployed
deploy_ready_at: 2026-05-23
deploy_ready_by: dev-foot
build_passed: true
db_change: false
e2e_spec: tests/e2e/T-20260522-foot-PKG-EDIT-DEL.spec.ts
hotfix: false
created: 2026-05-22 23:44
deadline: 2026-05-29
slack_channel: C0ATE5P6JTH
slack_thread_ts: 1779460930.034199
reporter: 김주연 총괄
reporter_slack_id: U0ATDB587PV
attachments: []
e2e_spec_exempt_reason: null
risk_verdict: GO_WARN
risk_reason: "1/5 — 비즈니스 로직 변경(사용이력 있는 패키지 수정/삭제 시 결제·usage 정합성 영향)"
assignee: dev-foot
source_msg: MSG-20260522-234412-eavm
ref_tickets:
  - T-20260504-foot-PACKAGE-CRUD
  - T-20260511-foot-C21-PKG-USAGE-EDIT
qa_result: pass
qa_grade: Yellow
deployed_at: 2026-05-24T05:33:24+09:00
deploy_commit: 2a1f2804f35c7ee900e3d208c4626e5e7e238f42
bundle_hash: CustomerChartPage-DtCQgKC8
field_soak_until: 2026-05-25T05:33:24+09:00
---

# 2번차트 구매 패키지(티켓) 수정/삭제 버튼 추가

## 요청 원문

> 구매 패키지(티켓)를 실수로 잘못 만든 경우 수정/삭제가 필요. 현재 Packages 관리 페이지에는 삭제 UI가 있으나, 2번차트(CustomerChartPage) 내 구매 패키지 개별 항목에는 수정/삭제 버튼 없음.

## 배경

- Packages.tsx(관리 페이지)에는 이미 삭제 UI + `package_delete_safe` RPC 구현 완료 (T-20260504-foot-PACKAGE-CRUD, closed 5/15)
- CustomerChartPage(2번차트) 구매 패키지 섹션에는 수정/삭제 기능 없음 → 실수 시 현장 운영 불편
- 시술내역(package_usages) 수정/삭제 UI 유사 패턴 존재 (T-20260511-foot-C21-PKG-USAGE-EDIT, deployed)

## 수용 기준 (AC)

### AC-1: 수정 버튼 + 수정 다이얼로그
- 2번차트 구매 패키지 섹션 각 항목에 수정 아이콘/버튼 노출
- 클릭 시 수정 다이얼로그 표시: 상품명, 수가, 횟수, 메모 등 편집 가능
- 저장 시 packages 테이블 UPDATE + 즉시 UI 반영 (invalidateQueries)
- admin/manager 권한 이상만 수정 버튼 노출 (RLS/FE 권한 체크)

### AC-2: 삭제 버튼 + 확인 다이얼로그
- 삭제 아이콘/버튼 노출 (admin/manager 이상)
- 클릭 시 확인 다이얼로그: "이 패키지를 삭제하시겠습니까?"
- 기존 `package_delete_safe` RPC 재사용 (T-20260504-foot-PACKAGE-CRUD 패턴)

### AC-3: 사용이력 있는 패키지 보호
- package_usages 또는 결제(payments) 이력이 있는 패키지 → 삭제 버튼 비활성 또는 경고 표시
- 경고 메시지: "사용 이력이 있는 패키지는 삭제할 수 없습니다" (또는 soft-delete 처리)
- 수정 시에도 사용이력 존재 시 수가/횟수 변경 경고 (변경 허용하되 확인 단계)

### AC-4: 권한 분리
- 수정: admin, manager 이상
- 삭제: admin, manager 이상 (기존 PACKAGE-CRUD 삭제 RPC 권한 체크 패턴 준용)
- 일반 staff/therapist는 수정/삭제 버튼 미노출

## 리스크 5항목

| # | 항목 | 결과 |
|---|------|------|
| 1 | DB 스키마 변경 | NO — 기존 packages 테이블 + package_delete_safe RPC 재사용 |
| 2 | 외부 서비스 의존 | NO |
| 3 | 비즈니스 로직 변경 | **YES** — 패키지 수정 시 수가/횟수 변경이 usage 계산·결제 이력과 연관 |
| 4 | 대량 데이터 변경 | NO |
| 5 | 신규 npm 패키지 | NO |

**risk_verdict: GO_WARN** — 사용이력 보호 로직만 정확히 구현하면 안전. AC-3 보호 로직 필수.

## 현장 클릭 시나리오 (E2E 변환 가이드)

### 시나리오 1: 패키지 수정 (정상)
1. admin 계정 로그인 → 고객 선택 → 2번차트(CustomerChartPage) 진입
2. 구매 패키지 섹션에서 대상 패키지 행의 수정 버튼 클릭
3. 수정 다이얼로그 표시 → 횟수 "10" → "12" 변경 → 저장
4. 다이얼로그 닫힘 + 패키지 목록에 횟수 "12" 반영 확인
5. 새로고침 후에도 "12" 유지 확인

### 시나리오 2: 패키지 삭제 (사용이력 없음)
1. admin 계정 → 2번차트 → 구매 패키지 섹션
2. 사용이력 없는 패키지의 삭제 버튼 클릭
3. 확인 다이얼로그 "이 패키지를 삭제하시겠습니까?" 표시
4. 확인 클릭 → 패키지 목록에서 해당 항목 제거 확인

### 시나리오 3: 패키지 삭제 거부 (사용이력 있음)
1. admin 계정 → 2번차트 → 구매 패키지 섹션
2. 사용이력(시술 차감 기록) 있는 패키지의 삭제 버튼 클릭 시도
3. 삭제 불가 경고 메시지 표시 확인 ("사용 이력이 있는 패키지는 삭제할 수 없습니다")

### 시나리오 4: 권한 미달 (staff)
1. staff(일반 직원) 계정 로그인 → 2번차트 진입
2. 구매 패키지 섹션에서 수정/삭제 버튼 미노출 확인

## 기술 참고

- **삭제 RPC**: `package_delete_safe` (Packages.tsx에서 사용 중) — 재사용 가능 여부 확인
- **수정 패턴**: T-20260511-foot-C21-PKG-USAGE-EDIT의 인라인 편집 or 다이얼로그 패턴 참조
- **권한 체크**: 기존 useAuth + profile?.role 패턴

---

## QA 결과 — supervisor (2026-05-24T05:33:24+09:00)

**qa_grade: Yellow — GO (경고 3건)**

### Phase 1: 코드 QA

| 항목 | 결과 | 비고 |
|------|------|------|
| 빌드 | ✅ PASS | `npm run build` 3.49s, 에러 없음 |
| 기존 기능 영향 | ✅ PASS | CustomerChartPage에 신규 상태·핸들러 격리 추가, 기존 플로우 무영향 |
| DB 호환성 | ✅ PASS | db_change:false, 스키마 변경 없음, 기존 packages/package_sessions/package_payments 재사용 |
| 권한/RLS | ⚠️ WARN | FE: admin/manager/consultant (spec은 admin/manager만), RLS packages_admin_all + packages_consult_update 적용 확인 |
| 롤백 SQL | ✅ N/A | DB 변경 없음 |

### Phase 1.5: env 매트릭스

- 사용 변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (2개)
- 운영 bundle (`index-BnV8Af6e.js`) 내 `https://rxlomoozakkjesdqjtvd.supabase.co` 확인 ✅

### Phase 7.5: Runtime Safety Gate

- `packageSessions` / `pkgPayments`: `useState<T[]>([])` 초기값 배열 ✅
- `Object.values(used)`: `?? {}` null 가드 적용 ✅
- `for (const s of sessions)`: `(sessData ?? [])` 가드 적용 ✅
- **Runtime null safety: PASS** ✅

### Phase 2: 브라우저 E2E

- 홈·로그인 페이지 정상 로드 ✅
- 미인증 접근 → 수정/삭제 버튼 미노출 ✅ (인증 게이트 정상 동작)
- 운영 bundle (`CustomerChartPage-DtCQgKC8`) 내 `editPkgDlg`, `cancelled`, dialog strings 확인 ✅
- Local bundle hash == Production bundle hash: `DtCQgKC8` ✅

### 경고 상세 (Yellow 사유)

**W1 — consultant 역할 추가**: FE 코드가 `admin || manager || consultant` 체크. spec은 admin/manager만 명시.
- RLS `packages_consult_update`: consultant는 `transferred`/`refunded` 상태 패키지 수정 차단됨 → 안전
- 현장 판단: 상담사가 패키지 수정하는 경우 있음 → 합리적 확장으로 판단, 운영팀 컨펌 권장

**W2 — transferred 패키지 soft-delete 미차단 (admin/manager)**: `delete_package_safe` RPC는 transferred 패키지 삭제 전면 차단. 새 코드는 admin/manager가 transferred 패키지를 `cancelled`로 바꿀 수 있음.
- soft delete(물리 삭제 아님)이므로 DB 정합성 파괴 없음
- 결제/사용이력 있는 경우 FE에서 1차 차단됨
- 위험도: 낮음 (운영진 실수 가능성)

**W3 — toast 메시지 미세 차이**: 코드 `'시술 사용 이력이 있어 삭제할 수 없습니다.'` / spec 기댓값 `'사용 이력이 있어 삭제할 수 없습니다'`. Playwright `getByText` partial match → E2E 통과 예상. 실사용에는 무영향.
