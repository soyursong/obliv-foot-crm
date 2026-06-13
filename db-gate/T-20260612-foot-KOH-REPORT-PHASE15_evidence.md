# T-20260612-foot-KOH-REPORT-PHASE15 — DB-gate evidence (prod apply)
# at: 2026-06-13T18:40:07.807Z

## 1. 마이그레이션 적용
  ✓ 20260612160000_koh_nail_sites.sql 적용 완료

## 2. 컬럼 probe
  ✓ koh_nail_sites 컬럼 존재
  ✓ 타입 jsonb (got jsonb)
  ✓ NOT NULL
  ✓ default '[]' (got '[]'::jsonb)

## 3. RPC probe
  ✓ set_koh_nail_sites RPC 존재
  ✓ SECURITY DEFINER
  ✓ authenticated EXECUTE 권한

## 4. 저장 테스트 (multi-select, TX rollback / prod 무변경)
  ✓ 정상 저장 → 구조만 정규화 (got [{"toe":2,"side":"Rt"}])
  ✓ 표시문자열/잡필드 제거 (got [{"toe":4,"side":"Lt"}])
  ✓ 빈 배열(선택 해제) 허용
  ✓ closed-enum 위반 입력 거부
  ✓ 미승인 사용자 거부 (42501)

## 결과: PASS ✓
