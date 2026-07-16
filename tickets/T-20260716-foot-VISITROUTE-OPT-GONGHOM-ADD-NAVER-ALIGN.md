---
id: T-20260716-foot-VISITROUTE-OPT-GONGHOM-ADD-NAVER-ALIGN
domain: foot
priority: P2
status: deploy-ready
qa_result: pass
deploy_commit: 192c0df2
deployed_at: n/a (NOT yet deployed — supervisor DDL-diff 게이트 + PROD apply 대기)
db_change: true
mig_files: [supabase/migrations/20260716160000_foot_visit_route_gonghom_add.sql, supabase/migrations/20260716160000_foot_visit_route_gonghom_add.rollback.sql]
mig_dryrun: pass
mig_ledger_check: clean
mig_rollback: supabase/migrations/20260716160000_foot_visit_route_gonghom_add.rollback.sql
mig_dryrun_postprobe: absent
applied_at: n/a (PROD DDL 미적용 — supervisor DDL-diff 게이트 통과 후 apply·POSTCHECK 예정)
deploy-ready-by: agent-fdd-dev-foot
deploy-ready-at: 2026-07-16
deadline: 2026-07-21
created: 2026-07-16
summary: 방문경로/예약경로 옵션 '공홈'(공식 홈페이지) 순수 ADDITIVE 추가 + '네이버' 표기 통일(no-rename)
---

# T-20260716-foot-VISITROUTE-OPT-GONGHOM-ADD-NAVER-ALIGN

방문경로/예약경로 옵션 **'공홈'(공식 홈페이지) 신규 추가 [순수 ADDITIVE]** + '네이버' 표기 통일.
DA CONSULT-REPLY GO(MSG-20260716-004703-pvs0) 수신 완료 → 대표 게이트 면제(autonomy §3.1), supervisor DDL-diff만.

⚠ **'네이버야' rename 아님** — 기존 '네이버' 항목명·저장값 불변. net 추가 = **'공홈' 1개뿐**.

## 구현 요약

### FE (단일 SSOT)
- `VISIT_ROUTE_OPTIONS`(src/lib/types.ts)에 `'공홈'` 1개 append → `['TM','네이버','인바운드','워크인','지인소개','공홈']`.
- 3 surface 전부 이 단일 SSOT(`visitRouteOptionsFor()` / `VISIT_ROUTE_OPTIONS`) 경유 → **하드코딩 이원화 0**, '공홈' 자동 동시 노출:
  1. 예약생성/예약상세 [예약경로] — `src/pages/Reservations.tsx`(visitRouteOptionsFor) · `src/components/ReservationDetailPopup.tsx`(VISIT_ROUTE_OPTIONS + visitRouteOptionsFor)
  2. 2번차트 [방문경로] — `src/pages/CustomerChartPage.tsx`(visitRouteOptionsFor)
  3. **CheckInDetailSheet [방문경로]** — `src/components/CheckInDetailSheet.tsx`(visitRouteOptionsFor ×2, customerMode/checkin) — 이미 SSOT 경유 확인(별도 하드코딩 없음).

### DB (AC-A2 — customers + reservations CHECK 동시 갱신)
- `20260716160000_foot_visit_route_gonghom_add.sql`: `DROP CONSTRAINT IF EXISTS + ADD`(멱등) — customers/reservations `visit_route_check` 에 `'공홈'` 동시 ADD.
- 기존 6값(TM/워크인/인바운드/지인소개/네이버/인콜) 전부 존치. DROP 값 0. 기존행 물리 UPDATE 0.
- rollback: 직전 6값 복원(`.rollback.sql`).
- prod baseline 실측(2026-07-16): 양 CHECK 모두 6값 형태 = 마이그 base 와 정합, rollback 이 정확히 복원.

### AC-A3 / AC-A4 (DA 확정 — dev 무접촉 소관 명시)
- silver `route_std` `'공홈'→homepage`(신규 canonical, owned homepage=organic). **★ silver 등록이 FE+CHECK 배포에 선행/동시**여야 orphan 0. 안전망=unmapped visit_route→other 흡수+count 알람. (silver transform = DA/silver 소관, foot 마이그 외.)
- `system_codes` 갱신 불요/지연(AC-A4) — dev 는 system_codes **무접촉**.

### AC-B / AC-B5 (no-rename + 표기 통일)
- '네이버' 저장값·항목명 불변, 물리 UPDATE 0. '네이버'는 이미 CHECK 6값에 존재 → 노출 확인만.
- 예약경로 vs 방문경로 드롭다운 모두 **동일 SSOT 경유** → '네이버' 동일 문자열 자동 충족('네이버예약/네이버야' 변형 부재 spec 검증).

## 검증 (셀프 QA = pass)
- `npm run build` ✓ (green, 5.7s)
- 무영속 dry-run(canonical no-persistence 러너 `dryrun_lib.mjs`): **PASS**
  - txn-control strip(BEGIN/COMMIT) + plpgsql exception-rollback + post-probe.
  - post-probe: customers_visit_route_check `'공홈'` prod 부재=true / reservations_visit_route_check `'공홈'` prod 부재=true → **무영속 확정**(prod 무변경).
- E2E: `tests/e2e/T-20260716-foot-VISITROUTE-OPT-GONGHOM-ADD-NAVER-ALIGN.spec.ts`
  - SSOT 코드 단(3 surface 단일소스 보증) + DB CHECK(customers/reservations 공홈 허용) + AC-B(네이버 존치/네이버야 부재) + 2번차트 UI(공홈+네이버 노출).

## supervisor 인계
- **db_change=true → supervisor DDL-diff 게이트 후 PROD apply** 필요(`supabase db push --file supabase/migrations/20260716160000_foot_visit_route_gonghom_add.sql`).
- ★ **배포순서 의존성**: silver route_std '공홈'→homepage 등록이 본 CHECK+FE 배포에 **선행/동시**여야 orphan 0 — merge/apply 전 DA·silver 준비 확인 권장(안전망=unmapped→other).
- deployed 전환 시 `applied_at` 에 실적용 시각 + POSTCHECK(공홈 CHECK 실재) 요약 기입.
