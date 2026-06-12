# T-20260611-foot-FORM-TEMPLATES-WRITE-RLS-OUTLIER — form_templates write RLS OUTLIER 정렬 (WS-1) DB-gate 제출 (dev-foot)

- prod: rxlomoozakkjesdqjtvd
- 작성: dev-foot, 2026-06-12
- 출처: 부모 `T-20260611-foot-RLS-MENU-ROLE-PARITY-POLICY` Phase 1 전수감사(commit 8f0bf0b) 부수발견 WS-1
- 마이그: `supabase/migrations/20260612000000_form_templates_write_rls_canonical.sql`
- 롤백:  `supabase/migrations/20260612000000_form_templates_write_rls_canonical.rollback.sql`
- dry-run: `scripts/T-20260611-foot-FORM-TEMPLATES-WRITE-RLS_dryrun.mjs` (트랜잭션 적용→검증→ROLLBACK)
- 감사 근거: `scripts/audit_out/T-20260611-RLS-PARITY_phase1_audit.txt` L109 + 라이브 pg_policies 재확인
- ★ form_templates 단일 테이블, write 정책만. blanket ALTER 아님 ★

## AC-1 — OUTLIER 현재 정책 vs canonical 차이 (근거: audit 매트릭스 + 라이브 dump)

라이브 정책 2개 (2026-06-12 pg_policies 직접 확인):
```
form_templates_manage [ALL]  roles={public}
  USING (clinic_id IN (SELECT staff.clinic_id FROM staff WHERE staff.user_id = auth.uid()))
form_templates_read   [SELECT] roles={public}  USING (true)
```
audit L109: `form_templates  true  OPEN  form_templates_manage[ALL]:OUTLIER | form_templates_read[SELECT]:OPEN`

→ write(INSERT/UPDATE/DELETE)는 `form_templates_manage` 단일 [ALL] 정책으로 통제됨. canonical 대비 차이:

| 축 | OUTLIER (현재) | canonical (의도, 20260426 E.26) |
|----|----------------|----------------------------------|
| 신원 소스 | `staff.user_id = auth.uid()` (비정규/희소) | `is_admin_or_manager()` = user_profiles role |
| 역할 범위 | clinic staff **전원**(역할 무필터) | admin/manager/director 만 |
| roles | `{public}` | `{authenticated}` |
| WITH CHECK | 없음(USING 대체) | `is_admin_or_manager()` |

라이브 staff 48행 중 user_id 채워짐 **20행** → staff.user_id 희소. health_q / clinic_events OUTLIER 와 동일 staff-신원 RC 패밀리.

## 방향 판정 (처리 노트: 넓음/좁음 먼저 판정)
- **혼합 OUTLIER**: 역할상 **과대**(코디·테라피스트·테크니션 누구든 템플릿 INSERT/UPDATE/DELETE 가능) + 신원상 **깨짐**(staff.user_id 미보유 admin/manager 는 write deny, 28/48 staff 도 write 불가).
- **지배적 방향 = 과대(over-broad) 보안 정리.** 의도(canonical)는 20260426000000 E.26 에 `form_templates_admin_all FOR ALL TO authenticated USING is_admin_or_manager() WITH CHECK is_admin_or_manager()` 로 **문서화**되어 있음(추정 아님). 구 OUTLIER `form_templates_manage` 가 drop 되지 않아 잔존 → 정렬.
- **reporter 에스컬레이션 불요**: 의도가 20260426 에 명시 + FE write 경로 부재(아래)로 운영 영향 0.

## AC-2 — canonical 정렬 (SQL + 롤백)
```
DROP POLICY IF EXISTS form_templates_manage ON form_templates;      -- OUTLIER 제거
DROP POLICY IF EXISTS form_templates_admin_all ON form_templates;   -- 멱등
CREATE POLICY form_templates_admin_all ON form_templates
  FOR ALL TO authenticated
  USING (is_admin_or_manager()) WITH CHECK (is_admin_or_manager());
```
- READ 미접촉: `form_templates_read [SELECT] USING(true)` 그대로(읽기 parity = 부모 티켓 도메인).
- 롤백: `...rollback.sql` (form_templates_manage 원형 복원).

## AC-4 회귀 — 양식 템플릿 생성/수정 정당 권한 정상
- FE 의 form_templates 접근 전수: **전부 `.select(...)` 읽기** — `PenChartTab.tsx:929`, `DocumentPrintPanel.tsx:401`, `PaymentMiniWindow.tsx:717`.
- **UI 상 INSERT/UPDATE/DELETE 경로 없음** → 일반 직원 write 회귀 0. 템플릿 관리는 admin 레벨(마이그/시드, 향후 관리자 UI)에서만 → is_admin_or_manager() 제한으로 정당 동선 영향 없음. 잠복 과대권한만 정리.
- SELECT: `form_templates_read(true)` OR `admin_all` = true → 전원 읽기 불변(회귀 0).

## dry-run 결과 (트랜잭션 적용→검증→ROLLBACK, prod 영속 변경 없음)
```
BEFORE: form_templates_manage [ALL] {public} USING(clinic_id IN (SELECT staff.clinic_id FROM staff WHERE staff.user_id=auth.uid()))
        form_templates_read   [SELECT] {public} USING(true)
AFTER : form_templates_admin_all [ALL] {authenticated} USING(is_admin_or_manager()) WITH CHECK(is_admin_or_manager())
        form_templates_read     [SELECT] {public} USING(true)   ← 불변

회귀가드 자동 점검:
  AC-2 write canonical(is_admin_or_manager, authenticated, WITH CHECK) : ✅
  OUTLIER form_templates_manage 제거                                  : ✅
  write 경로 비정규 staff 신원 잔존 없음                              : ✅
  AC-4 READ(form_templates_read SELECT true) 불변                     : ✅
→ DRY-RUN PASS
```

## 적용 절차 (supervisor)
1. `supabase/migrations/20260612000000_form_templates_write_rls_canonical.sql` 적용 (Management API query 또는 db push)
2. 사후 검증: `pg_policies` 에서 form_templates_admin_all [ALL] {authenticated} USING/WITH CHECK = is_admin_or_manager(), form_templates_manage 부재, form_templates_read [SELECT] true 존재 확인
3. 회귀 시 rollback SQL 적용 (단, 적용 시 write OUTLIER 재발 — 긴급용)

## db_gate_status = (supervisor 판정 대기)
- write RLS 정책 1개 교체(OUTLIER→canonical). READ 불변. 데이터 무손실. 백필 없음. 신규 컬럼/테이블/enum 없음(data-architect CONSULT 불요). E2E 면제: db_only.
