# T-20260606-foot-CHART-DIAG-MULTI-PRIMARY-PRINT — DB 게이트 증적 (db_change=yes)

- **commit_sha**: 410861b1 (branch foot/T-20260606-chart-diag-multi-primary-print, pushed origin)
- **canonical_repo**: obliv-foot-crm (project rxlomoozakkjesdqjtvd)
- **artifact-class**: web_fe (primary, deploy-tolerant) + db_only leg (마이그 3종 prep·미실행, supervisor SQL/DDL-diff 게이트)
- **change-class**: ADDITIVE (신규 연결테이블 chart_diagnoses + index 2 + RLS policy 4). 기존 컬럼/테이블 무변경.

## db_change evidence 4필드

### mig_files (3종, committed dfd2766e)
- supabase/migrations/20260606140000_chart_diagnoses.sql (up, additive)
- supabase/migrations/20260606140000_chart_diagnoses.rollback.sql (down, 대칭)
- supabase/migrations/20260606140000_chart_diagnoses.backfill.sql (STEP1 dry-run→사람확인→STEP2 insert, idempotent·미실행)

### mig_dryrun (No-Persistence Protocol, Management API BEGIN…ROLLBACK)
러너: scripts/T-20260606-foot-CHART-DIAG-MULTI-PRIMARY-PRINT_dryrun.mjs → ✅ ALL PASS
- txn-control 문 없음(COMMIT sentinel-bypass 불가)
- PRE-PROBE 미존재 → 트랜잭션 내 up 적용 introspection → ROLLBACK → POST-PROBE 여전히 미존재(무영속 실증)
- 컬럼/CHECK(primary|secondary)/FK(chart_id→medical_charts CASCADE, service_id→services SET NULL)/index 3/RLS 4정책 전부 확인
```

=== T-20260606 chart_diagnoses DRY-RUN  (2026-08-08T06:36:13.343Z) ===

  ✅ 마이그 파일 내 txn-control 문 없음(COMMIT bypass 불가)
  ✅ PRE-PROBE — chart_diagnoses 미존재(신규·additive)

── DRY-RUN introspection (트랜잭션 내, 미커밋) ──
{
  "table": true,
  "columns": [
    {
      "name": "id",
      "type": "uuid",
      "nullable": "NO"
    },
    {
      "name": "chart_id",
      "type": "uuid",
      "nullable": "NO"
    },
    {
      "name": "service_id",
      "type": "uuid",
      "nullable": "YES"
    },
    {
      "name": "diagnosis_type",
      "type": "text",
      "nullable": "NO"
    },
    {
      "name": "diagnosis_code",
      "type": "text",
      "nullable": "YES"
    },
    {
      "name": "diagnosis_name",
      "type": "text",
      "nullable": "NO"
    },
    {
      "name": "seq",
      "type": "integer",
      "nullable": "NO"
    },
    {
      "name": "created_at",
      "type": "timestamp with time zone",
      "nullable": "NO"
    }
  ],
  "checks": [
    "(diagnosis_type = ANY (ARRAY['primary'::text, 'secondary'::text]))",
    "diagnosis_type IS NOT NULL"
  ],
  "fks": [
    {
      "col": "chart_id",
      "ref": "medical_charts",
      "del": "CASCADE"
    },
    {
      "col": "service_id",
      "ref": "services",
      "del": "SET NULL"
    }
  ],
  "indexes": [
    "chart_diagnoses_pkey",
    "idx_chart_diagnoses_chart",
    "idx_chart_diagnoses_service"
  ],
  "policies": [
    "DELETE",
    "INSERT",
    "SELECT",
    "UPDATE"
  ],
  "rls": true
}
  ✅ 테이블 생성됨
  ✅ 컬럼: chart_id/service_id/diagnosis_type/diagnosis_code/diagnosis_name/seq 존재
  ✅ diagnosis_name NOT NULL
  ✅ service_id nullable(legacy/미매칭 graceful)
  ✅ CHECK diagnosis_type in (primary,secondary)
  ✅ FK chart_id → medical_charts ON DELETE CASCADE
  ✅ FK service_id → services ON DELETE SET NULL
  ✅ 인덱스 chart/service 2종
  ✅ RLS 활성 + 정책 4종(SELECT/INSERT/UPDATE/DELETE)
  ✅ POST-PROBE — ROLLBACK 후 chart_diagnoses 여전히 미존재(무영속)
  ✅ rollback.sql 대칭 — up→down 후 테이블/인덱스/정책 전량 소거
  ✅ 최종 무영속 재확인 — 프로드 실재 미변경

=== 결과: ✅ ALL PASS (additive·롤백대칭·무영속) ===
```

### mig_ledger_check
- supabase_migrations.schema_migrations 에 '20260606140000' / 'chart_diagnoses' 클레임 **없음** (조회 결과 [])
- prod public.chart_diagnoses 실재 **부재** (to_regclass NULL)
- → 원장(paper)=none · prod(실재)=none · 파일선언=20260606140000(pending) — 3자 정합, OOB divergence 0.

### mig_rollback
- rollback.sql = up 의 정확한 역(정책 4 drop → index 2 drop → table drop). dry-run 대칭성 검증: up→down 후 to_regclass NULL 확인.
- additive 마이그였으므로 rollback 해도 medical_charts.diagnosis(원본 text 정본) 보존 → 데이터 유실 0.

## backfill 주의
- backfill.sql STEP1(count/샘플20) 은 chart_diagnoses 테이블 실재 후(=supervisor apply 후) 실행 가능 → 본 deploy-ready 시점엔 대상 테이블 미존재로 STEP1 미실행. apply 직후 STEP1 dry-run → 사람확인 → STEP2 insert 순서 유지(멱등).

## §S2.4 DA 게이트 (미충족 — deploy-ready 보류 사유)
- chart_diagnoses = **신규 테이블** → §S2.4 data-policy gate: data-architect CONSULT 선행 필수.
- 현재 da_consult_ref **부재**(ac0_resolution=dev-foot 자체 모델결정이며 DA sign-off 아님).
- → planner FOLLOWUP 발행(§S2.4/Q2 da_consult_ref 라우팅 요청). DA CONSULT GO 전까지 deploy-ready 마킹 보류.
