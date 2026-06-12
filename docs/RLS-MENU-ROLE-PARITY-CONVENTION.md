# RLS 메뉴-역할 패리티 컨벤션 (open-all-except-3) — Phase 3 초안

- 티켓: T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY (Phase 3)
- 작성: agent-fdd-dev-foot (초안 / DRAFT)
- 권위: 김주연 총괄(U0ATDB587PV) escalation — "건바이건 중단, 권한 풀린 메뉴는 관리자=직원 동일"
- ★ codify 소유자 = **data-architect** (cross_crm_data_contract / foot CRM 컨벤션 문서 등재는 dev-foot 단독 권한 밖).
  본 문서는 **핸드오프용 초안**. dev-foot 는 초안까지, 확정·SSOT 등재는 data-architect.

> 목적: "메뉴 X 를 직원도 보이게" 류 단건 요청을 더 이상 건바이건으로 처리하지 않도록,
> 신규 메뉴/테이블 추가 시 **처음부터** manager·staff 접근을 동시에 정의하는 규칙을 고정한다.

---

## 1. 핵심 모델 — open-all-except-3

**기본값 = parity(직원=관리자 동일 접근).** 아래 **3개 제외 카테고리**만 직원 잠금, 나머지 모든 메뉴/테이블은 개방.

| # | 제외 카테고리 | 의미 | 대표 테이블/뷰 | 대표 메뉴(route) |
|---|---|---|---|---|
| 1 | **통계** | 집계 통계 화면·뷰 | stats view 10종 | `/admin/stats` |
| 2 | **매출집계** | 실장별·치료사별 **성과 집계 보기** | payments·package_payments·package_sessions 직접 쿼리(Sales.tsx) | `/admin/sales` |
| 3 | **계정관리** | 직원/사용자 계정 CRUD·권한설정·감사로그 | accounts, medical_chart_signer_audit, payment_audit_logs, insurance_sync_runs | `/admin/accounts` |

> ⚠ **'매출집계' ≠ '일마감'** (정책 정정 jnz7, 2026-06-11): 일마감(daily_closings/closing_manual,
> `/admin/closing`)은 **직원 업무 workflow = OPEN**. 매출집계(성과 집계 뷰, Sales.tsx)만 EXCL.
> 회수 대상은 "실장별·치료사별 성과 집계 보기"로 한정한다.

---

## 2. 불변(INVARIANT) — 개방하더라도 절대 준수

개방(OPEN)은 다음 3개를 깨지 않는 한에서만 한다. 하나라도 위반하면 PHI 사고/회귀.

1. **READ-only 확대**: staff 는 **SELECT 만** manager 와 동일. INSERT/UPDATE/DELETE 정책은 **불변**.
2. **clinic_id 스코프 유지**: `clinic_id = current_user_clinic_id()` — 타 clinic row 조회 불가(PHI 비확장).
3. **승인 게이트 유지**: `is_approved_user()` — 미승인 authenticated 차단.

---

## 3. 표준 RLS 술어 쌍 (canonical predicate)

OPEN 테이블의 staff read 는 앱 전역 표준쌍을 사용한다(anomaly 술어 금지).

```sql
-- OPEN(개방) 테이블의 staff SELECT 표준
USING ( is_approved_user() AND clinic_id = current_user_clinic_id() )
```

- ❌ `USING (true)` — over-open(미승인/타 clinic 누수). 발견 시 위 canonical 로 교체.
- ❌ `staff.id = auth.uid()` 기반 비정규 신원 — 앱 신원이 user_profiles 면 전원 deny(기능 파손). canonical 로 교체.
- ✅ 본 컨벤션 적용 선례: `clinic_events_select`(G2), `check_in_room_logs`(G1 canonical), `daily_closings_read`/`closing_manual_read`(jnz7), `health_q_results`(SURVEY-ITEM-VISIBILITY).

EXCL 테이블은 staff SELECT 정책을 **추가하지 않는다**(admin/manager 한정 정책 유지).

---

## 4. FE 3-게이트 패리티 (NAV-BOUNCE 방지)

메뉴 가시성은 **3곳을 동일 집합으로** 정렬한다. 한쪽만 바꾸면 "메뉴 보이는데 클릭하면 튕김"(NAV-BOUNCE).

| 게이트 | 위치 | 역할 |
|---|---|---|
| ① PERM_MATRIX | `src/lib/permissions.ts` | 권한 SSOT(canAccess) |
| ② route guard | `src/App.tsx` RoleGuard | 라우트 진입 차단 |
| ③ nav item roles | `src/components/AdminLayout.tsx` NAV_ITEMS | 사이드바 노출 |

- OPEN 메뉴 → 3게이트 모두 해당 role 포함.
- EXCL 메뉴(통계/매출집계/계정관리) → 3게이트 모두 직원 미포함(숨김).
- ⚠ tm 은 최소권한(STAFF-ROLE-TM-ADD, 박민지 팀장 C안: dashboard/reservations/customers/stats 4메뉴). `ALL_STAFF_ROLES` 에 tm 미포함 — OPEN 확대 시 `[...ALL_STAFF_ROLES]` 재사용으로 구조적 보장, tm 은 명시적으로만 추가.

---

## 5. 신규 메뉴/테이블 추가 시 체크리스트 (★컨벤션 본체★)

신규 메뉴/테이블을 추가하는 모든 PR 은 다음을 **동시에** 수행한다(나중에 건바이건 금지).

- [ ] **분류**: 신규 메뉴가 제외 3카테고리(통계/매출집계/계정관리)인가? → EXCL / 아니면 OPEN.
- [ ] **RLS(OPEN)**: 뒤 테이블에 manager·staff SELECT 를 §3 canonical 술어로 **동시** 생성. (staff 누락 = 직원 화면 빈값 버그)
- [ ] **RLS(EXCL)**: admin/manager 한정 정책만. staff SELECT 추가 금지.
- [ ] **INVARIANT**: §2 (READ-only + clinic 스코프 + 승인게이트) 확인.
- [ ] **FE 3게이트**: §4 PERM_MATRIX + route + nav 동일 집합.
- [ ] **경계 의심**(환자 결제내역=일반진료 vs 매출집계 등) → 추정 금지, reporter/planner 확정.

---

## 6. 정책 라우팅 (ping-pong 종결)

이후 "메뉴 X 직원 안 보임 / 직원도 보이게" 류 **단건 요청**은 개별 point-fix 를 발번하지 않고
본 컨벤션으로 흡수 라우팅한다(`policy_superseded`). 분류만 확인하면 위 체크리스트로 자동 적용.

---

## 7. data-architect 핸드오프 (codify 경로)

- 본 초안을 cross_crm_data_contract(staff role 8종 표준 인접) 또는 foot CRM 컨벤션 문서에 등재.
- 4 CRM(롱레/풋/도수/피부) 공통 적용 가능 여부 검토(풋 선례를 횡전개).
- 제외 3카테고리의 cross-CRM 정의(특히 '매출집계' vs '일마감' 경계) 표준화.

> 상태: DRAFT — data-architect 확정 시 본 파일에 `codified_by` / SSOT 링크 추가.
