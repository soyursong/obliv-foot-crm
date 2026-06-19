# T-20260619-foot-CLINICMGMT-ACCESS-DUALROLE-FINAL — AC-1 착수 전 enumerate (read-only)

조사일: 2026-06-19 / dev-foot / prod DB rxlomoozakkjesdqjtvd (read-only) + 소스 정독.
판정: **코드 미변경 + planner 회신(narrow 재확인)**. 티켓 명시 escalation 게이트(★) 2조건 모두 발동.

## AC-1 ① 실제 라우트 (확정)

- 진료관리 canon = `/admin/clinic-management` → `<ClinicManagement>` (App.tsx L226). **존재 확정.**
- `/admin/doctor-tools` = **"진료 대시보드"**(DoctorTools, App.tsx L229 / AdminLayout L98). 현장초안 "doctor-tools"는 미검증 추정이 아니라 **실재**하며 의사영역 대시보드. → 티켓 "진료대시보드도 의사영역이면 동일 게이트" 대상.
- 진료관리 top-level 메뉴는 제거됨(AdminLayout L100-102) → Services.tsx 서브탭 + App.tsx 직접 라우트 2경로로 도달.

### 현재 게이트 5곳 (라이브 canon)
| # | 위치 | 현재 값 |
|---|------|---------|
| 1 | App.tsx L226 `/admin/clinic-management` RoleGuard | `['admin','manager','director','consultant','coordinator','therapist']` |
| 2 | App.tsx L229 `/admin/doctor-tools` RoleGuard | `['admin','manager','director','therapist','technician','part_lead','consultant','coordinator']` |
| 3 | Services.tsx L239 `canViewClinicMgmt` | `!!profile?.role` (전직원, STAFF-OPEN 7fed414) |
| 4 | AdminLayout L98 '진료 대시보드' 메뉴 roles | `['admin','manager','director','consultant','coordinator','therapist']` |
| 5 | ClinicManagement.tsx L44 `isAdmin`(금기증 편집) | `role==='admin'` |

## AC-1 ② role 스키마 (확정: single-role)

- `UserRole`(types.ts:78) = 단일 enum 10종: `admin·manager·director·part_lead·consultant·coordinator·therapist·technician·tm·staff`.
- `RoleGuard`(ProtectedRoute.tsx:34) = `roles.includes(profile.role)` — **profile.role은 단일 값**.
- `profile.role` 출처 = `user_profiles.role`(auth.tsx:32 `from('user_profiles')`). staff.role은 듀티로스터/autoAssign용으로 auth 무관.
- **결론: 'director(원장) AND admin(어드민) 동시보유'는 single-role 스키마상 한 유저로 표현 불가.**

## AC-1 ③ 현재 role 분포 (prod 실측, 41 profiles)

```
admin: 12,  manager: 1,  director: 0,  therapist: 12,
consultant: 4,  coordinator: 7,  tm: 3,  staff: 2
```

- **director 보유자 = 0명** (user_profiles 전체에 director 없음).
- **admin 보유자 = 12명**: 백승민·김다인·**김주연(총괄)**·정용현·이광현·정혜인·테스트관리자·dev-foot-test·오세빈·박민지·**김승현(대표)**·**문지은(mne@yonsei.ac.kr)**.
- **문지은 = role `admin`** (director 아님). access_tier=admin. user_profiles.id `d343769a-493a-49c9-b718-4c92c6f5db9a`.
- **총괄 김주연 = role `admin`** (manager 아님!). 유일한 manager = "QA테스트" 계정.

## 핵심 모순 (티켓 전제 vs 실측)

| 티켓 전제 | 실측 | 영향 |
|-----------|------|------|
| 문지은 = doctor AND admin 동시보유 | 문지은 = admin 단일(12인 중 1) / director 0명 | director 요구 predicate = **0명 매칭 → 문지은 본인 lock-out(AC-4 치명)** |
| 총괄 = manager → admin-gate로 차단 | 총괄 김주연 = **admin** | admin-gate로 총괄 **차단 불가**(차단 모호 ★) |
| 대상 = {문지은 1인} | admin = 12인(총괄·대표·devs·test 포함) | admin-only gate = 12인 over-grant, "그 외 전원 차단" 미충족 |

→ **single-role profile.role 위 어떤 predicate도 {문지은 1인}을 정확히 산출 불가.**
- `director && admin` → 항상 false → 전원(문지은 포함) lock-out.
- `director` → 0명 → 전원 lock-out.
- `admin` → 12명 → 총괄·대표·devs 포함 over-grant.

## MUNJIEUN-ROLE-DIRECTOR 의존성 (AC-4)

문지은을 director로 만드는 선행 티켓 `T-20260619-foot-STAFF-MOONJIEUN-ROLE-DIRECTOR` = **status: blocked**.
- publish_opinion_doc RPC prod 미배포 + admin→director 전환 시 8개 admin기능 회귀(직원등록·CSV·고객삭제·패키지·서비스·클리닉편집·설정·예약). → 단순 role 치환 금지 판정됨.
- 즉 "role 인식 안정화" 선행 미충족 → director 기반 게이트 적용 시 문지은 본인 lock-out 위험 현실.

## 판정 & 권고안 (planner 결정 요청)

티켓 ★게이트("스키마상 의도 안전 표현 불가 **또는** 총괄 admin 보유로 차단 모호") **2조건 모두 충족** → Phase A 즉시 적용 금지, narrow 재확인 회신.

- **A안 (FE-only, 즉시 가능 / 권고 — '1인' 의도 정확)**: `/admin/clinic-management`·`/admin/doctor-tools` 접근을 **유저 신원 allowlist**(user_profiles.id `d343769a-493a-49c9-b718-4c92c6f5db9a` 또는 email `mne@yonsei.ac.kr`)로 게이트. DB 미접촉, {문지은 1인} 정확 달성. 단 role 기반 아닌 신원 기반 — 인사이동 시 코드 수정 필요. 신원 canon 확정 필요.
- **B안 (role 정합, 무거움)**: MUNJIEUN-ROLE-DIRECTOR B안(마이그 배포 + admin 8게이트 director-parity + 문지은→director) 선행 후 director 게이트. blocked 티켓 해소·E2E·supervisor 게이트 필요 → P1 즉시 불가.
- **C안 (스키마 확장)**: is_doctor/is_admin 다중 플래그 도입 → data-architect CONSULT·DDL. P1 범위 초과.

**dev-foot 권고: A안(신원 allowlist) 또는 B안 중 planner 택1 + 문지은 canonical 신원 확정.** ★코드 미변경 상태 유지 — 추정 패치 시 문지은 lock-out 또는 12인 over-grant 둘 중 하나 확정 사고.
