---
id: T-20260611-foot-MSGSETTINGS-STAFF-ACCESS
domain: foot
type: rbac-open
priority: P1
status: deploy-ready
db_change: false
gate: GO
owner: agent-fdd-dev-foot
created: 2026-06-11
parent: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY
parent_ref: open-all-except-3 OPEN 케이스
data_architect_consult: not-required (FE-only, no new column/table/enum)
deploy_ready_marked_by: agent-fdd-dev-foot
deploy_ready_at: 2026-06-11
build_status: pass
spec_added: tests/e2e/T-20260611-foot-MSGSETTINGS-STAFF-ACCESS.spec.ts
db_migration_pending: false
---

# T-20260611-foot-MSGSETTINGS-STAFF-ACCESS — 메시지 설정 직원(staff/part_lead) 개방

## 정책 (planner MSG-20260611-185335-wcvk ②)
부모 RLS-MENU-ROLE-PARITY-POLICY `open-all-except-3` 의 OPEN 케이스 집행. 메시지 설정은 계정관리·통계·매출(3 except)에 해당하지 않으므로 전직원 개방.

## RC
- `App.tsx:230` settings RoleGuard + `permissions.ts:43` PERM_MATRIX.messaging 가 staff/part_lead 미포함 → 직원 클릭 시 대시보드 리다이렉트.
- (★dev 추가 발견) `AdminLayout.tsx:108` '메시지 설정' nav 도 staff/part_lead 미포함 → route 만 열면 메뉴 미노출로 무력화. 메뉴=라우트 패리티 위해 함께 수정.

## 수정 (FE-only, DB무접촉)
동일 집합 SSOT 3곳을 전직원(8역할, **tm 제외**)으로 정렬:
1. `src/lib/permissions.ts` — PERM_MATRIX.messaging = `[...ALL_STAFF_ROLES]` (= 8역할, tm 미포함). STALE 주석 갱신.
2. `src/App.tsx` settings RoleGuard roles = 8역할 명시.
3. `src/components/AdminLayout.tsx` '메시지 설정' nav roles = 8역할 명시 (패리티).

## tm 제외 보존 (★qa-fail 조건★)
박민지 팀장 C안(AC6, STAFF-ROLE-TM-ADD) tm=4메뉴 최소권한 고정 → messaging/settings 추가 금지. tm 접근 가능해지면 qa-fail. ALL_STAFF_ROLES(tm 미포함) 재사용으로 구조적 보장.

## 누수 0 검증 (planner 검증 + dev 재확인)
- AdminSettings ⓪연결설정(Solapi 자격증명) = `adminOnly:true` 내부게이팅(섹션 필터 line 271 + 렌더 line 315 이중) → staff 차단.
- ⑦QR = mgrPlus. 그 외 섹션(채널/규칙/템플릿/수동발송/이력/수신거부) = 메시지 기능.
- 계정관리/통계/매출 = 별도 라우트 → staff route 개방해도 누수 0. 깨끗한 OPEN.

## AC
- AC1 PERM_MATRIX.messaging 에 staff/part_lead 포함 + tm 미포함
- AC2 App.tsx settings RoleGuard 에 staff/part_lead 포함 + tm 미포함
- AC3 AdminLayout '메시지 설정' nav roles 패리티 (메뉴=라우트)
- AC4 3곳 동일 집합 SSOT 정합
- AC5 누수 0 — ⓪연결설정 adminOnly 게이팅 보존

## 검증
- build: pass (3.73s)
- E2E: tests/e2e/T-20260611-foot-MSGSETTINGS-STAFF-ACCESS.spec.ts 6/6 pass
- 회귀: STAFF-ROLE-TM-ADD / MESSAGING-V1 / ALL_STAFF_ROLES tm 미포함 불변식 pass

## 비고
- ① 일마감 메뉴 fold (부모 Phase2-B fold #1) = 본 티켓 범위 밖. staff 수행자 reconcile 미확정 → planner FOLLOWUP 발행(silent 숨김 금지).
