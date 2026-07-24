# T-20260724-foot-KIMJUYEON-DIRECTOR-ROLE-TEMP-1WK — 착수 전 조사 evidence (NO-WRITE)

- 처리: dev-foot
- 일시: 2026-07-25 KST
- 판정: **DUPLICATE / ALREADY-SATISFIED — DB write 미실행**
- DB 변경: **없음** (read-only 조사만)

## 1. 대상 계정 식별 + id↔email 재검증 (AC2, Cross-CRM Auth Identity Resolution)

| 항목 | 값 |
|------|----|
| CRM 계정 id | `ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12` |
| email | `juyeon@medibuilder.com` |
| name | 김주연 |
| clinic | `74967aea-a60b-4da3-a0e7-9c997a930bc8` (jongno-foot / 오블리브의원 서울오리진점) |
| last_sign_in | 2026-07-22 (실사용 계정) |

- `user_profiles.id` ↔ `auth.users.id/email` **일치 확인** (`?email=` 단독 아님, id·email 양방 대조). AC2 충족.
- user_profiles 내 name='김주연' 계정은 **1건 유일**.

## 2. 현재 role 상태 (AC1 스냅샷)

```
role = 'director' (원장)   ← 이미 목표 상태
access_tier = 'admin'
exempt_from_restrictions = true
active = true, approved = true
```

- `user_profiles_role_check` = 8-role enum {admin,manager,director,part_lead,consultant,coordinator,therapist,technician,tm,staff}. '원장' 정본값 = `director` (신규 role 아님, AC3).
- **★현재 role이 이미 'director'.** 요청한 "원장 상향"의 목표 상태가 이미 충족됨.

## 3. 원인 — 선행 티켓이 이미 동일 부여를 완료·배포

**T-20260724-foot-JUYEON-DOCWRITE-1WK-TEMPACCESS (P1)** 가 본 티켓과 동일 작업을 이미 집행:
- commit `a7120e6f` (prod apply + POSTCHECK PASS + ledger 20260724210000), merge `386833ac`
- 동일 계정(id ee67fc6b) role **admin → director** 임시부여, 창=2026-07-25~08-01 KST (본 티켓과 완전 동일)
- 문지은 대표원장 Option A 컨펌 + supervisor DDL-diff GO
- 현재 role='director'는 **이 선행 티켓 grant의 결과**임.

### 자동 원복 이미 설치됨 (live)
- pg_cron job 20 `foot-juyeon-tempgrant-lifecycle` (active, `*/15 * * * *`) → `public.foot_juyeon_tempgrant_tick()`
- 함수 상수: `v_orig_role='admin'` (진짜 부여-전 baseline / 원복 대상), `v_temp_role='director'`,
  grant_at `2026-07-24 15:00+00`(=7/25 00:00 KST), revert_at `2026-07-31 15:00+00`(=8/1 00:00 KST)
- 8/1 도래 시 director→admin 자동원복 + 잡 자기해지. idempotent(role-match WHERE 가드).

## 4. 왜 본 티켓을 집행하지 않았는가

1. **목표 상태 이미 충족** — 김주연 = director(원장), 창 7/25~8/1, 자동원복까지 완비.
2. **AC1 스냅샷 오염 위험** — 지금 스냅샷하면 original='director'로 기록됨. 그러나 **진짜 부여-전 원래 role은 'admin'**(선행 티켓·cron 함수 v_orig_role 근거). 본 티켓 계획("원복=별도 수동 티켓")대로 진행하면 미래 원복이 director로 복원 → **영구 director 고착** + live pg_cron 자동원복(→admin)과 **충돌**.
3. **서류(문서) 의도 상충** — 본 티켓 AC5는 "서류 제외" 가능성을 언급하나, 선행 배포 티켓(DOCWRITE)의 목적은 정반대로 **진료 서류 write 활성화**(director=doctor-role). 현장 의도 재확인은 planner/현장 소관.

## 5. 실효 상태 (AC5 참고)

- 진료 메뉴(clinic-management·doctor-tools·treatment-table·services 등): RoleGuard에 'director' 포함(requireOpsAuthority 無) → **열림**.
- 운영최고권한 라우트(accounts·stats·sales, requireOpsAuthority): `hasOpsAuthority` = has_ops_authority===true || role∈{admin,manager}. bare director는 미통과 → 단, `has_ops_authority` 컬럼 prod 부재(DDL_DIFF_HOLD) + 김주연 access_tier=admin/exempt=true. 서류 write는 선행 티켓 DB is_doctor_role(role∈{director,doctor}) 게이트로 이미 열림.

## 6. 권고

- 본 티켓 = 선행 배포 티켓의 **중복** → planner에 **already-satisfied(dup) 종결** 권고 (FOLLOWUP 발행).
- 별도 원복 티켓 **생성 금지** — 자동원복(pg_cron) 이미 존재. 수동 원복 티켓은 baseline 혼선·충돌 유발.
- 서류 포함/제외 의도 상충은 현장(문지은 대표원장/responder) 재확인 필요 시 planner 판단.
