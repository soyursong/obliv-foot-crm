# DB-Gate 이관 — T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY (Phase B)

> **to**: supervisor (DDL-diff 게이트) · **from**: dev-foot · **db_change**: ADDITIVE
> **priority**: P1 · **deadline**: 2026-06-25 · **risk_verdict**: GO_WARN
> **data-architect CONSULT**: GO_CONDITIONAL (MSG-20260620-234254-akuj) — 6단계 마이그 순서 + Bucket B 현장해소 게이트 + write-path 23505 처리 3조건. cross-product 영향 없음(foot 단일).
> **대표 게이트**: 면제 (autonomy §3.1: ADDITIVE + DA GO).
> **reporter**: 문지은 대표원장 (U0ALGAAAJAV) 직접요청 + 직접 confirm (slack ts 1781967350.283439).
> **FE 상태**: 완료·push (commit a3256a86) — 런타임 스키마 게이트 `softDeleteEnabled` 로 컬럼 미적용 환경에서 삭제 UI 전면 비노출(FE 선배포 안전).

## 무엇을 적용하나 (단계 1·2 = 본 마이그 파일)

`supabase/migrations/20260621003000_medical_charts_soft_delete_sameday_unique.sql.DDL_DIFF_HOLD`
(rollback: 동명 `.rollback.sql`)

1. **soft-delete 4컬럼 ADD** (`medical_charts`, ADDITIVE):
   - `is_deleted BOOLEAN NOT NULL DEFAULT false`
   - `deleted_at TIMESTAMPTZ NULL`
   - `deleted_by UUID NULL` (삭제 수행자 auth.uid() — 의료법 §22-3 '수행자'. 법적 진실원천=audit_log.changed_by)
   - `delete_reason TEXT NULL`
   - PG11+ 상수 DEFAULT → 테이블 rewrite 없이 즉시 반영(핫테이블 안전).
2. **audit_log operation CHECK superset 확장** (ADDITIVE-safe):
   - 현재: `CHECK (operation = 'UPDATE')` (제약명 `medical_charts_audit_log_operation_check`, 실측 확인)
   - 변경: DROP + ADD `CHECK (operation IN ('UPDATE','DELETE'))` (단일 txn).
   - superset이므로 기존행(operation='UPDATE') 전부 통과 = 무손실.
3. **감사 트리거 `medical_charts_body_audit()` 갱신** (NEW 무변형):
   - soft-delete 전이(`is_deleted` false→true) 감지 시 `operation='DELETE'` 라벨, 그 외 본문 수정은 `'UPDATE'` (현행 동작 유지).
   - `RETURN NEW` 무변형 → 저장 페이로드 회귀 0. SECURITY DEFINER + search_path=public 고정.
4. **RESTRICTIVE RLS `mc_deleted_rows_director_only`** (ADDITIVE):
   - `USING (is_deleted = false OR current_user_role() IN ('director','admin'))`.
   - 기존 permissive `mc_clinic_isolated_v3`(clinic 격리)는 **미변경** — RESTRICTIVE는 permissive와 AND 결합.
   - **비삭제행(is_deleted=false)은 종전과 100% 동일 노출(무회귀)**. 삭제행만 director/admin로 좁힘.

> **partial UNIQUE index는 본 마이그 미포함.** `CREATE UNIQUE INDEX CONCURRENTLY`는 txn 밖에서만 가능 + 동일일 중복행 dedup 선행 필수 → 별도 apply 스크립트(`scripts/T-20260620-foot-MEDCHART-DELETE-SAMEDAY_index_apply.mjs`)가 DDL-diff GO 후 dedup → CONCURRENTLY 생성 → VALID 검증을 수행.

## 왜 (근거)

- **의료법 §22-3** — 전자의무기록 수정·삭제 시 ①원본보존 ②수행자 ③일시 기록 의무 → **hard-delete 금지, soft-delete만**.
- **의료법 §40** — 진료기록 10년 보존.
- **같은날 정책 grounding** — 도수치료 급여기준(동일상병 1일1회) + 한국 EMR 실무(동일일 1차트 이어쓰기) → 현행 append 설계 유지 + 동일일 partial UNIQUE로 구조 차단(T-20260611 dup INSERT 재발 방지).

## ADDITIVE 검수 포인트 (파괴 변경 0)

1. **컬럼**: ADD COLUMN IF NOT EXISTS 4종 모두 nullable 또는 상수 DEFAULT — 기존행 무손실, rewrite 없음.
2. **CHECK**: superset 확장 — 기존 'UPDATE' 행 전부 통과.
3. **트리거**: append-only 감사 유지(기존 INSERT 형태 동일), `RETURN NEW` 무변형 — 저장 동작 회귀 0.
4. **RLS**: RESTRICTIVE 추가 = AND 제약. 비삭제행 무회귀(검증 DO 블록이 정책 존재 확인).
5. 마이그 파일 말미 검증 DO 블록: is_deleted 컬럼 / CHECK DELETE superset / RESTRICTIVE 정책 3종 존재 확인 → 실패 시 RAISE EXCEPTION으로 txn 롤백.

## dedup dry-run 결과 (단계 3·4 사전, READ-ONLY 재확인 2026-06-21)

- **총 활성 행 75, 동일일 surplus 3행 / 3그룹. Bucket B = 0** → 임상오너 현장 에스컬레이션 불요, 인덱스 생성 차단 없음.

| 그룹 | customer | visit_date | rows | 분류 | keep / drop | 판정 근거 |
|------|----------|-----------|------|------|-------------|-----------|
| 1 | 3f7b1572 | 2026-05-24 | 2 | **A** | keep 4ec7cf1b / drop 38ab3b9e | 양쪽 junk 테스트("ㄹㄹㄹ"/"ㅇㄹㄹ"), 실질내용 ≤1 |
| 2 | 8c0c157c | 2026-06-10 | 2 | **A** | keep ca4d1d7f / drop 2b47470d | 동일 진료의(문지은) 단문 재입력("말이너무 많으심"/"말이너뭄낳음") |
| 3 | de5436a5 | 2026-06-09 | 2 | **A** | keep cad6c886 / drop 029886ae | 실차트(dx 42자 KCD B351/B353/B354/L600 + 임상경과 395자 + 처방 1) vs junk "11" |

> ⚠ **keep-rule = 임상내용 non-null 최다 → 총길이 → created_at 최선두**. "무조건 latest 유지" 금지(DA 지시).
> **그룹 3이 그 정확성을 입증**: 실차트 cad6c886는 created 04:11, junk "11"(029886ae)은 created 13:41 — naive "latest 유지"면 실제 임상기록을 파괴했을 것. content-score 규칙이 실차트를 올바르게 보존. **실 임상내용 손실 0**.

## DDL-diff GO 후 dev-foot 잔여 절차 (현재 qa-pending, deploy-ready 아님)

1. `.DDL_DIFF_HOLD` 접미사 제거 → 마이그 단계1·2 적용(직접 실행, dev-foot DB 마이그 정책).
2. `node scripts/T-20260620-foot-MEDCHART-DELETE-SAMEDAY_index_apply.mjs --commit` → 단계3(dedup 재검증) → 단계4(Bucket A soft-delete, 트리거가 audit DELETE 자동 적재) → 단계5(`CREATE UNIQUE INDEX CONCURRENTLY uix_mc_customer_clinic_date ... WHERE is_deleted=false` + VALID 검증, INVALID 시 DROP 재시도). Bucket B 발견 시 스크립트가 ABORT(자동삭제 금지).
3. **L-009 실클릭 검증**(브라우저): director 로그인 → 차트 삭제 버튼/확인다이얼로그/목록 숨김/관리자 토글 + 같은날 2번째 INSERT 23505 graceful 안내 + 문지은 6/11 중복 INSERT 회귀 재검 → 스크린샷.
4. deploy-ready 마킹 + signals.md.

## 회귀 가드

- `medical_charts` 컬럼 스키마는 **추가만**(기존 컬럼 무변경).
- E2E 정책 로직 가드 3 PASS (`tests/e2e/T-20260620-foot-MEDCHART-DELETE-SAMEDAY-POLICY.spec.ts`) — 환경 무관 항상 실행.
- L-003(차트 전체고객 동일동작) / L-004(useChart 단일경로·createPortal 유지) / L-009(실클릭) 준수.
- write-path 23505: 마이그 미적용 환경엔 index 부재 → 23505 미발생(분기 무해 no-op). 적용 후 우발 중복만 차단, 현행 today-latch append 정상 동작.
