# T-20260615-foot-HEALER-INTENT-MIGRATE-APPLY — DB-gate evidence
- prod: rxlomoozakkjesdqjtvd | 2026-06-16T19:22:35.214Z | mode: AUDIT+APPLY

## [A] read-only audit (pre)
```
is_healer_intent 컬럼(적용 전): 없음(PGRST204 원인)
reservations 총 1367행 | healer_flag=true 1행 (backfill 대상 상한)
```

## [B] ADD COLUMN apply (20260614130000)
✅ ADD COLUMN IF NOT EXISTS is_healer_intent boolean NOT NULL DEFAULT false (+COMMENT) 적용 완료

## [C] backfill datafix (20260615T)
✅ backfill UPDATE 적용 완료 — 1행 갱신 (대상상한 1행 / IS DISTINCT FROM 가드)

## [D] NOTIFY pgrst 'reload schema' 전송 (PGRST204 해소)

## [E] post-verify
```
컬럼 메타(적용 후): {"column_name":"is_healer_intent","data_type":"boolean","is_nullable":"NO","column_default":"false"}
is_healer_intent=true: 1행
healer_flag=true AND is_healer_intent=true (승계 확인): 1행
healer_flag=true AND is_healer_intent != true (미승계 잔여): 0행 (0 기대)
```

## [결과] PASS ✅
- 컬럼 메타 boolean/NO/false: OK
- backfill 승계 완료(잔여 0, 승계 1=1): OK
- FE 내성화(a2ff8f5 isHealerIntentColMissing 재시도)는 잔존(no-op) — 정상 경로 1회 성공.
- 롤백: ALTER TABLE public.reservations DROP COLUMN IF EXISTS is_healer_intent;
