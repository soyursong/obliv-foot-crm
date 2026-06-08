# Dry-run report — T-20260608-foot-DX-BUNDLE-SET (묶음상병)

- author: agent-fdd-dev-foot
- date: 2026-06-08
- migration: `supabase/migrations/20260608120000_diagnosis_sets.sql`
- rollback:  `supabase/migrations/20260608120000_diagnosis_sets.rollback.sql`
- db_change: **YES** (신규 테이블 2개, additive)
- backfill: **불필요** (신규 빈 테이블 — 기존 데이터 이관 없음)

## 변경 요약
| 객체 | 종류 | 비고 |
|------|------|------|
| `diagnosis_sets` | 신규 테이블 | clinic 격리, TEXT polyfolder, is_active/sort_order |
| `diagnosis_set_items` | 신규 테이블 | set_id FK, service_id FK(→services 상병정본), diagnosis_type CHECK, sort_order |
| 인덱스 4종 | 신규 | clinic / set / service / (set,service) UNIQUE |
| RLS 정책 4종 | 신규 | authenticated read-all + write (처방세트 동일 톤) |

## 무손실/안전성 점검
1. **ADDITIVE only** — 기존 테이블(services/chart_diagnoses/prescription_sets) 무변경. ALTER/DROP 없음.
2. **IF NOT EXISTS** (table/index) + `DROP POLICY IF EXISTS` 선행 → 재실행 안전(idempotent).
3. **FK 무손실** — service_id → services.id(ON DELETE CASCADE: 상병 삭제 시 세트항목만 정리, 상병 마스터 무영향).
4. **SSOT 보존** — 상병 정본은 services.category_label='상병' 단일 유지. diagnosis_sets 는 '묶음'일 뿐 상병 마스터 신설 아님.
5. **rollback** — 자식→부모 역순 DROP. 신규 빈 테이블이므로 적용 직후 롤백 시 데이터 손실 0.

## dry-run (대상 0건)
- 신규 테이블이므로 백필/대량 UPDATE 없음 → dry-run 대상 행 0건.
- 적용 후 검증 쿼리(예):
  ```sql
  SELECT to_regclass('public.diagnosis_sets')      AS sets_tbl,
         to_regclass('public.diagnosis_set_items') AS items_tbl;
  -- 둘 다 non-null 이면 적용 성공.
  ```

## 적용 순서 (supervisor)
1. `20260608120000_diagnosis_sets.sql` 적용 (dev → 검증 → prod).
2. 검증 쿼리로 테이블 2개 생성 확인 회신.
3. GO 회신 후 dev-foot 가 FE(AC-1 묶음상병 관리 UI / AC-2 진료차트 일괄 적용) 착수.

## 의존/주의
- ⚠️ depends_on `T-20260607-foot-DXTOOL-MENU-REORG`(blocked) — **네이밍만** flux. 본 마이그는 구조 패턴만
  차용했고 네이밍 결정에 결합하지 않음 → DXTOOL 결정과 무관하게 적용 가능.
- FE 미착수 상태로 마이그만 선행 적용 가능(스키마 준비). 빈 테이블이라 미사용 위험 없음.
