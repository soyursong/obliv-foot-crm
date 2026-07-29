# T-20260729-foot-ACCESS-PERM-UNBLOCK-KJY-DIAG — READ-ONLY 진단 리포트

- 작성: dev-foot, 2026-07-30
- 성격: **prod READ-ONLY 진단** (service_role SELECT + 코드/마이그 정적분석). **DB/코드 변경 0건.** `db_change=false`.
- 요청자: 김주연 총괄 (U0ATDB587PV) — "권한 안막았다며... 권한 막지마 다 풀어줘" (foot 채널, 2026-07-29 15:59 KST)
- 결론(선요약): **총괄 계정에 하드닝 side-effect로 인한 과도 제한 = 미검출.** 계정이 이미 최대 권한(admin + exempt). 문자해석 "다 풀어줘"=blanket unlock=RED LINE. → **planner FOLLOWUP / 에스컬레이션.**

---

## 1. 총괄 계정 실측 (prod, service_role READ-ONLY)

`user_profiles` where id = `ee67fc6b-a7b5-487e-97ae-9d3fc8e70d12` (juyeon@medibuilder.com, 김주연):

| 필드 | 값 | 함의 |
|------|----|----|
| role | **admin** | 모든 FE 게이트 escape + 모든 RLS `is_admin_or_manager()` 포함 |
| active | true | 로그인/승인 게이트 통과 |
| approved | true | ProtectedRoute 승인대기 미해당 |
| clinic_id | `74967aea…` = **jongno-foot** (서울오리진점) | clinic-scoped RLS 정합 (주 클리닉) |
| access_tier | admin | — |
| **exempt_from_restrictions** | **true** | `canAccess()` 의 모든 '제한 토글' 단락 통과 |
| has_ops_authority | (컬럼 부재) | prod 미적용(DDL_DIFF_HOLD) — but admin escape 로 무관 |
| updated_at | 2026-07-25 | exempt 플래그 landing 시점 추정 |

→ 총괄은 **admin + exempt_from_restrictions=true** = 앱-role 레이어에서 **최대 권한**. 구조적으로 막힐 수 있는 게이트가 없음.

## 2. FE 게이트 정적분석 (admin escape 전수 확인)

- `PERM_MATRIX` (src/lib/permissions.ts): admin 은 `ALL_STAFF_ROLES` 및 전 PermKey 배열 포함 → `canAccess(admin, *)`=true.
- `canAccess()`: `isExemptFromRestrictions(s)` → exempt=true 면 무조건 true 단락. 총괄은 이 단락으로도 통과.
- `RoleGuard`: admin 은 모든 라우트 roles 배열 포함.
- `requireOpsAuthority` 가드(ProtectedRoute L49): `role==='director' && !hasOpsAuthority` 만 차단 → **admin 영향 0** (director 한정 가드).
- 결론: **FE role 가드가 총괄(admin)을 막는 경로 = 부재** (원인분류 (c) 기각).

## 3. 최근 접근 하드닝 3건 정적분석 (conflict_source)

| 하드닝 | 대상 | authenticated/admin 영향 |
|--------|------|--------------------------|
| xcrm-RLS-PERMISSIVE-FORKINHERIT-SWEEP | fork-상속 과대개방 조이기 | clinic-isolation 계열 = `is_admin_or_manager() AND clinic_id=current_user_clinic_id()` → admin 은 **본인 clinic 전권 유지** |
| foot-AICC-ANON-PII-LEAK (`20260720230000`) | `aicc_crm_phone_match` view | `REVOKE ALL … FROM anon` — **anon 전용** |
| foot-AICC-PHONEMATCH-SECINVOKER (`20260720230000_…_revoke_anon`) | phonematch | `FROM anon` 전용 |
| (부수) customers_anon_select_lockdown / anon_write_sweep / vdailyrev_anon_revoke | anon | 전부 `FROM anon`. vdailyrev 는 명시적으로 "**authenticated GRANT 는 유지**" |

- 실측 RLS: `customers_admin_all` = `is_admin_or_manager() AND clinic_id = current_user_clinic_id()` (FOR ALL). admin=full CRUD on 본인 clinic.
- **모든 하드닝 = anon-only REVOKE + cross-clinic 격리**. 인증 admin 제한 신규 도입 = **0건** (원인분류 (a)(b) 기각).

## 4. cross-clinic 가설 검증 (GM 이 양지점 보다가 막힘?)

- customers 실측: **총 895행, 전량 jongno-foot. songdo-foot = 0행.**
- 총괄 clinic=jongno-foot → clinic-scoped RLS 로도 **895행 전부 조회 가능**. 격리로 잃는 실데이터 = 없음.
- (songdo 데이터가 향후 유입되면 jongno-scoped 총괄은 songdo 미조회 — 그러나 그 복원 = **cross-clinic 확대 = RED LINE §4**, 본 티켓 out-of-scope.)

## 5. 원인 분류 결론

| 분류 | 판정 |
|------|------|
| (a) 하드닝 RLS 가 총괄 role 의도치 않게 제한 | **기각** — 하드닝 anon-only, admin RLS 무변경 |
| (b) 신규 정책 allow 목록에서 총괄 role 누락 | **기각** — admin 전 정책 포함/escape |
| (c) FE 가드 role 판정 오류 | **기각** — admin 전 게이트 escape, exempt=true 추가보호 |
| (d) 의도된 정당 동작 / 복원 대상 없음 | **채택** — 총괄 계정 최대권한, 과도 제한 미검출 |

## 6. RED LINE 판정 → FOLLOWUP 사유

- (A) in-scope("총괄 정당 접근 복원") 을 만족할 **복원 대상이 총괄 계정에 존재하지 않음** (이미 최대권한).
- (B) 문자해석 "다 풀어줘/RLS 다 해제" = blanket unlock = **PHI 격리 founding + 진행 중 하드닝과 파괴적 충돌** = RED LINE (AC3, §4).
- 현장은 세부 질의를 명시 거부("특별히 권한 부여 요청 아님") → dev 단독으로 특정 차단면 확정 불가.
- ∴ 티켓 §36(B)+§43+§8 경로대로 **dev FOLLOWUP → planner 에스컬레이션**. dev 임의 DB/코드 변경 없음(추정 패치 금지).

## 7. planner 에 넘기는 후속 옵션 (비-blanket, 택1 필요)

1. **특정 차단면 1건 확보**: 총괄이 "막혔다"고 느끼는 **정확한 화면/버튼/데이터 1개**를 (responder 통해 비-전문용어로) 확인 → 그 surface 한정 진단·복원(scoped 티켓). ← 가장 정확.
2. **재로그인 선행**: exempt/role 갱신(7-25) 이후 총괄 세션(JWT)이 stale 이면 RLS 판정이 구 claim 으로 갈 수 있음 → 완전 로그아웃 후 재로그인 1회 시도로 자연 해소 가능성.
3. **staff-scope 재해석**: 총괄은 과거 다수 "직원 권한 풀어줘" 티켓(6MENU/PHRASE-STAFF 등)의 reporter. 이번도 **본인 계정이 아닌 직원 role 제한**을 지칭할 개연 高 → 그 경우 대상 role/메뉴 특정 후 별 scoped 티켓(여전히 PHI/RRN/의사publish 는 게이트 유지).

## 8. 검증 시나리오 대응(티켓 §46)

- 시나리오1(총괄 접근 복원): **복원할 차단면 미특정 → 실행 불가**(계정 이미 최대권한). 차단면 확보 후 재진입.
- 시나리오2(격리 회귀 0): dev 변경 0건 → 하드닝 그대로 유지, 회귀 0 (자동 충족).
