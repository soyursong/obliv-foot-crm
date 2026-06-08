# Dry-run report — T-20260607-foot-PROCMENU-RX-UNIFY (Stage 1 backfill)

- author: agent-fdd-dev-foot
- date: 2026-06-08
- forward:  `stage1_rx_unify_backfill.sql`
- rollback: `stage1_rx_unify_backfill.rollback.sql`
- db_change: **YES** (INSERT only — additive backfill). DROP/파괴 ALTER **0건**.
- backfill: **YES** (자유텍스트 약 → custom 코드, 세트 약 → 랜딩 폴더)
- ⚠️ STAGED — supervisor GO 전 미적용. 적용 시 supabase/migrations/ 승격.

## 변경 요약
| 객체 | 작업 | 종류 |
|------|------|------|
| `prescription_folders` | "처방세트 이관" 루트 폴더 1행 insert | additive |
| `prescription_codes` | 자유텍스트 약명 distinct → `code_source='custom'`, `claim_code='LEGACY-*'` insert | additive |
| `prescription_code_folders` | 세트 참조 약 전부 → 랜딩 폴더 배정(미배정만) | additive |
| `prescription_sets` | **무변경** (보존 — posology 유일 집 + quick_rx FK) | — |

## 무손실/안전성 점검
1. **ADDITIVE only** — INSERT 3종. ALTER/DROP/UPDATE/DELETE 0건. `prescription_sets.items` 비파괴.
2. **Idempotent** — STEP1 NOT EXISTS, STEP2 NOT EXISTS(claim_code), STEP3 `ON CONFLICT(prescription_code_id) DO NOTHING`. 재실행 시 추가 변경 0.
3. **현장 기배정 보존** — STEP3 ON CONFLICT DO NOTHING → 현장이 이미 다른 폴더에 둔 약 무이동.
4. **orphan 가드** — STEP3 `EXISTS(prescription_codes)` 로 stale code_id skip.
5. **무회귀** — QuickRxBar/prescriptionGate/getPrescribableCodeIds 전부 prescription_sets·items 의존 → 무변경이라 영향 0.
6. **rollback 무손실** — 랜딩폴더 매핑 + 무참조 LEGACY 코드 + 빈 랜딩폴더만 제거. 참조 생긴 코드는 보존(손실 우선 차단).

## Dry-run — 건수 대조 (적용 전 PRE / 적용 후 POST / 불변식 INVARIANT)

### PRE (적용 직전 측정·기록)
```sql
-- P1) 전체 세트/항목 규모
SELECT count(*) AS sets,
       coalesce(sum(jsonb_array_length(items)),0) AS total_items
FROM prescription_sets;

-- P2) Type A: code_id 보유 distinct 약 수
SELECT count(DISTINCT (item->>'prescription_code_id')) AS distinct_code_ids
FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) item
WHERE NULLIF(trim(coalesce(item->>'prescription_code_id','')),'') IS NOT NULL;

-- P3) Type B: 자유텍스트 distinct 약명 수 (= insert 예상 custom 코드 상한)
SELECT count(DISTINCT lower(trim(item->>'name'))) AS distinct_freetext_names
FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) item
WHERE NULLIF(trim(item->>'name'),'') IS NOT NULL
  AND NULLIF(trim(coalesce(item->>'prescription_code_id','')),'') IS NULL;

-- P4) 이미 존재하는 LEGACY 코드(재실행 판별용)
SELECT count(*) AS pre_legacy FROM prescription_codes
WHERE code_source='custom' AND claim_code LIKE 'LEGACY-%';

-- P5) Type A 중 마스터에 실재하지 않는 orphan code_id (skip 예정 → 보고)
SELECT count(*) AS orphan_code_ids FROM (
  SELECT DISTINCT (item->>'prescription_code_id')::uuid AS cid
  FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) item
  WHERE NULLIF(trim(coalesce(item->>'prescription_code_id','')),'') IS NOT NULL
) t WHERE NOT EXISTS (SELECT 1 FROM prescription_codes pc WHERE pc.id=t.cid);

-- P6) 세트 참조 약 중 이미 폴더에 배정된 수(이동 안 함 예정)
SELECT count(*) AS pre_foldered FROM prescription_code_folders;
```

### POST (적용 직후 측정)
```sql
-- Q1) 새로 생긴 custom LEGACY 코드 수
SELECT count(*) AS post_legacy FROM prescription_codes
WHERE code_source='custom' AND claim_code LIKE 'LEGACY-%';

-- Q2) 랜딩 폴더 배정 수
SELECT count(*) AS landing_assigned
FROM prescription_code_folders f JOIN prescription_folders pf ON pf.id=f.folder_id
WHERE pf.name='처방세트 이관' AND pf.parent_id IS NULL;
```

### INVARIANT (GO 판정 — 전부 통과해야 적용 GO)
| # | 불변식 | 식 |
|---|--------|-----|
| I1 | 신규 custom 코드 = 자유텍스트 distinct 약명(미존재분) | `Q1 - P4 == P3 - (재실행분)` (최초 적용: `Q1 - P4 == P3`) |
| I2 | 세트의 모든 자유텍스트 약이 코드를 획득 | 적용 후 `distinct_freetext_names 중 LEGACY 코드 미존재 = 0` |
| I3 | 캐노니컬 홈 노출 = 세트 참조 약 전부 폴더에 존재 | 적용 후 아래 Z1 = 0 |
| I4 | prescription_sets 무변경 | `P1.sets/total_items` 적용 전후 동일 |
| I5 | orphan code_id 외 손실 0 | skip 건수 == P5 (보고만, 차단 아님) |

```sql
-- Z1) 세트 참조 약 중 어떤 폴더에도 없는 약(=홈에서 안 보이는 약) → 0 이어야 함
WITH ref AS (
  SELECT DISTINCT (item->>'prescription_code_id')::uuid cid
  FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) item
  WHERE NULLIF(trim(coalesce(item->>'prescription_code_id','')),'') IS NOT NULL
  UNION
  SELECT pc.id FROM prescription_sets ps, LATERAL jsonb_array_elements(ps.items) item
  JOIN prescription_codes pc ON pc.claim_code='LEGACY-'||left(md5(lower(trim(item->>'name'))),12)
  WHERE NULLIF(trim(item->>'name'),'') IS NOT NULL
    AND NULLIF(trim(coalesce(item->>'prescription_code_id','')),'') IS NULL
)
SELECT count(*) AS unshown FROM ref r
WHERE r.cid IS NOT NULL
  AND EXISTS (SELECT 1 FROM prescription_codes pc WHERE pc.id=r.cid)
  AND NOT EXISTS (SELECT 1 FROM prescription_code_folders f WHERE f.prescription_code_id=r.cid);
```

## 적용 순서 (supervisor)
1. PRE 쿼리(P1~P6) 실행·기록 + capture CSV 산출(롤백 정밀화용).
2. `stage1_rx_unify_backfill.sql` dev 적용 → POST(Q1,Q2) + INVARIANT(I1~I5, Z1) 검증.
3. 롤백 리허설: `*.rollback.sql` 적용 → 3검증 쿼리 0 확인 → 다시 forward 적용(idempotent 확인).
4. GO 회신 시 supabase/migrations/ 승격(파일명 `2026XXXX_rx_unify_stage1_backfill.sql`) + prod 적용.

## 의존/주의 (Stage 경계)
- ⚠️ **이번 = Stage 1(identity backfill)까지만.** posology 무손실 이관 + prescription_sets→묶음처방 전환은 **Stage 2**(신규 묶음처방 테이블, supervisor GO 후 별도). Stage 1은 prescription_sets 보존이 무손실 전제.
- E4: custom 코드 `classification` 기본값('내복약') — 외용약 오분류 가능. 현장 재분류 권고(비차단, FE 어드민에서).
- 메뉴 순서(Stage 3)는 SERVICES-NAV-RESTRUCTURE 랜딩 후 — 본 패키지 밖.
