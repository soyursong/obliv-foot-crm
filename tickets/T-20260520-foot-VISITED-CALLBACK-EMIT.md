---
id: T-20260520-foot-VISITED-CALLBACK-EMIT
domain: foot
status: deploy-ready
deploy-ready: true
commit_sha: 7aa4dcb
build_ok: true
db_changed: false
spec_file: tests/e2e/T-20260520-foot-VISITED-CALLBACK-EMIT.spec.ts
risk: GO
created_at: 2026-05-20
deploy_ready_at: 2026-05-20
completed_at: 2026-05-20
---

# T-20260520-foot-VISITED-CALLBACK-EMIT (TA3)

## 요약

풋센터 셀프QR 체크인 완료 시 도파민TM으로 visited 콜백을 발사하는 Edge Function + SelfCheckIn 연동.

## 구현 내용

### Edge Function: `supabase/functions/checkin-visited-fire/index.ts`
- anon JWT 허용 (SelfCheckIn = 비인증 사용자) + DB 검증으로 보안 대체
- reservation_id 기반 → 최신 check_in 조회 (event_id=check_in.id)
- source_system ≠ 'dopamine' → not_dopamine_source 스킵
- dopamine_outbound_log 멱등 INSERT (pending→sent/failed/duplicate)
- DOPAMINE_CALLBACK_URL 미설정 시 graceful skip
- §6-2 payload 준수 (type='visited', source_system='foot', clinic_slug='foot-jongno')

### `src/pages/SelfCheckIn.tsx`
- check_ins INSERT 완료 후 matchedReservationId 있을 때 checkin-visited-fire invoke
- .catch() fire-and-forget — 콜백 실패가 체크인 UX 블록하지 않음

## 빌드 이력

| 커밋 | 상태 | 비고 |
|------|------|------|
| f1cd196 | ❌ build_fail | PenChartTab.tsx TS6133 (79a8118 도입) |
| 7aa4dcb | ✅ build_ok | TS6133 수정 포함 (3.21s, 에러 없음) |

## 수용 기준

- AC-1~10: tests/e2e/T-20260520-foot-VISITED-CALLBACK-EMIT.spec.ts (정적 검증)

## 참고

- TA2 연계: T-20260520-foot-RESERVATION-INGEST-EF (도파민→풋 Forward 수신부)
- Supabase EF Secrets 필요: `DOPAMINE_CALLBACK_URL`, `DOPAMINE_CALLBACK_SECRET`
  - 미등록 시 graceful skip (서비스 블록 없음), 실제 콜백 발사를 위해서는 필수
