# T-20260611-foot-PROGRESSPLAN-PKGTYPE-DB-BIND — DB GATE 증거 (supervisor 이관)

> dev-foot / 2026-06-12 · db_change=true · GO_WARN
> 근거: 김주연 총괄 confirm (Option C, MSG-20260612-060410-4qcv) + dry-run 실측

## 1. 변경 개요
경과분석 플랜 매칭키를 `package_type`(string) → `session_count_tier`(int, = packages.total_sessions)로 재설계.
패키지명·FK 무관, 회차수 tier(6의 배수 6/12/18/24/30/36/42/48)로 전수 커버.

- forward: `supabase/migrations/20260612000000_progress_plans_tier_model.sql`
- rollback: `supabase/migrations/20260612000000_progress_plans_tier_model.rollback.sql`
- dry-run script: `scripts/T-20260611-foot-PROGRESSPLAN-TIER_dryrun.mjs` (READ-ONLY + TX ROLLBACK)

## 2. 마이그 내용 (요약)
1. `ADD COLUMN session_count_tier INTEGER`
2. 레거시 이관 (confirm 확정): `package1`→tier 12 (package_type='tier_12'), `blelabel`→tier 36 (package_type='tier_36'), `special`→DELETE(폐기)
3. 6의 배수 tier 전체 시드 (6~48), milestone=6의배수≤tier, milestone==tier → "최종". 이관된 12/36은 ON CONFLICT DO NOTHING으로 보존.
4. 무결성: `session_count_tier` NOT NULL + CHECK(>0) + UNIQUE(clinic_id, session_count_tier, session_milestone) + 부분 인덱스. 기존 unique(clinic_id, package_type, session_milestone)는 package_type='tier_N'로 유지(무해).

## 3. dry-run 실측 (prod READ-ONLY, 2026-06-11, ROLLBACK)
### tier 모델 전제 검증 — packages.total_sessions 분포 (active)
| total_sessions | active 패키지 | tier eligible |
|---|---|---|
| 12 | **387** (preset_12 359 + 12회권 27 + 1) | ✅ |
| 24 | 11 | ✅ |
| 36 | 8 | ✅ |
| 6 | 6 | ✅ |
| 48 | 4 | ✅ |
| 1(체험권 등) | 17 | ✗ (6배수 아님 → 자연 배제) |
| 기타 비6배수(10,20,2,7,…) | — | ✗ |

→ **preset_12 다수가 실제 total_sessions=12 보유 확인** → Option C 전수 커버 성립 (Option A FK는 template_id 미보유 80%로 미해결이었음).

### before/after
- **BEFORE: progress_check_required=TRUE 예약 = 0건** (구조적 미작동 재확인)
- **AFTER eligible 모집단: tier 6→6, 12→387, 24→11, 36→8, 48→4 = active 416 패키지**
- 발동 방식: **신규 예약 생성 시점 건별 계산** (대량 일괄 발동 없음). 기존 예약 retroactive flip 없음.
- 제외 가드: total_sessions=0 active=0건. 체험권(ts=1)·비6배수는 tier 미존재로 자연 배제 + 코드 `total_sessions > 0` 가드.

### 마이그 시뮬(TX ROLLBACK) 결과 plan 행
| tier | milestones |
|---|---|
| 6 | [6] |
| 12 | [6,12] |
| 18 | [6,12,18] |
| 24 | [6,12,18,24] |
| 30 | [6,12,18,24,30] |
| 36 | [6,12,18,24,30,36] |
| 42 | [6,...,42] |
| 48 | [6,...,48] |
| null tier 잔존 | **0** |

## 4. 코드 변경 (배포 동반)
- `src/pages/Reservations.tsx`: ProgressPlanEntry(session_count_tier), 로드 select, 매칭 로직 tier 기준 + total_sessions>0 가드.
- `src/components/admin/ProgressPlansTab.tsx` (AC-1): PACKAGE_TYPE_OPTIONS 하드코딩 제거 → TIER_OPTIONS(6배수) UI, tier 그룹/뱃지, milestone>tier 방어.
- 빌드: `npm run build` ✅ PASS.

## 5. E2E
- 신규: `tests/e2e/T-20260611-foot-PROGRESSPLAN-PKGTYPE-DB-BIND.spec.ts` (S1 tier UI/하드코딩제거, S2 tier 추가, S3 milestone>tier 방어)
- 회귀: `tests/e2e/T-20260526-foot-PROGRESS-CHECKPOINT.spec.ts` 구 testid(pkg-type-btn-package1/group-package1) → tier-btn/group-12로 갱신.

## 6. 적용 순서 (supervisor)
1. forward migration apply (dev-foot 직접 실행 정책 — 단 GO_WARN로 supervisor GO 후).
2. apply 후 검증: tier별 plan 행 = §3 표와 일치, null tier 0.
3. FE 배포(main merge → Vercel) — 마이그와 동일 릴리스. (FE-DB 정합: 컬럼 추가는 backward-compatible, 단 FE 구버전이 session_count_tier 미선택 INSERT 시 NOT NULL 위반 → 마이그→FE 순서 또는 동시 배포 권장)
4. E2E 38 spec 회귀 GREEN 확인.
5. 이상 시 rollback SQL 적용 → 레거시 10건 복원 + 컬럼 드랍.

## 7. 롤백 안전성
- rollback SQL: tier 행 DELETE + 레거시 10건 재시드 + 컬럼 드랍. 데이터 무손실 복귀.
- 주의: forward 후 UI로 신규 추가된 tier 행도 rollback 시 삭제(의도된 복귀).

## 8. data-architect CONSULT — GO (§S2.4 데이터 정책 게이트 clear)
> CONSULT-REPLY: MSG-20260612-062511-33rs (2026-06-12) · 판정 **GO, 이의 없음**

- **계약 영향 0**: `package_progress_plans`는 foot 로컬 운영 테이블 — cross_crm_data_contract.md 부재 grep 확인. `session_count_tier` 신규 컬럼은 타 CRM/도파민 push 영향 0. cue_card_policy 무관(임상 운영). schema_registry 등재 불요(foot 내부 전용).
- **명명·제약 적정**: `session_count_tier INTEGER` snake_case 표준 부합 + 소스(`packages.total_sessions`) 매칭키 OK. `CHECK(>0)` = total_sessions=0(체험권·Re:Born) tier 매칭 배제를 구조적 강제(AC §130 가드와 정합). `UNIQUE(clinic_id, session_count_tier, session_milestone)` 그레인 정합.
- **비차단 관찰(이미 해소)**: 비6배수 변칙 total_sessions(예 18·10·20·2·7) 매칭 누락 가능 → **본 dbgate §3 dry-run에서 이미 확인됨**: `1(체험권 ts=1) 17건 ✗ / 기타 비6배수(10,20,2,7) ✗ 자연배제`. 김주연 총괄 confirm "6의 배수 tier" 모델 전제와 정합 → 의도된 배제, 코드 변경 불요.
- **결론**: 계약 측 차단 없음. supervisor DB 게이트 GO와 **병행 진행 무방**.
