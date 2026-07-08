# T-20260630-foot-COMPANION-RESV-INSERT-FAIL — 수신부 ready 확인 + 동행 저장 E2E (prod)

날짜: 2026-07-08 (dev-foot) · trigger: planner MSG-20260708-144055-j8tm (INFO·P0)
목적: 풋 동행 저장 제품 GO 수신 → ingest EF 동행 수용부 최종 확인 + child 좀비티켓 E2E 협조.

## A. 수신부 prod-ACTIVE 정적 검증 (비파괴)
- (A) reservations.external_id = **TEXT** — composite `{cue}#companion-N` 텍스트 필터 22P02 없이 통과. PASS
- (B) reservations.customer_real_name 컬럼 실재 (selectable). PASS
- (C) upsert_reservation_from_source **17-arg + p_is_companion 시그니처 resolve** — 실인자로 호출 시 clinic-guard(23503)까지 도달(8-arg only였다면 PGRST202). PASS
- (D) 중단 트랜잭션 누수 0행. PASS

## B. 동행 저장 E2E 왕복 (prod, jongno-foot, self-minted 테스트행 즉시 정리)
실 RPC 경로(EF가 호출하는 동일 17-arg) 사용, is_companion=true, 무폰.
- step1 INSERT: PASS (rid 발급, composite TEXT external_id + 무폰 수용)
- step2 착지 시맨틱: PASS — **customer_id=NULL** + **customer_real_name='E2E동행루루'** + external_id composite TEXT
- step3 멱등 재push: PASS — 동일 rid, 1행(중복 0)
- step4 cleanup: PASS — 테스트행 제거, 잔여 0

evidence snapshot:
```json
{"customer_id":null,"customer_name":"E2E동행테스트","customer_phone":null,
 "customer_real_name":"E2E동행루루","external_id":"...e2e5#companion-1",
 "source_system":"dopamine","status":"confirmed","visit_type":"new"}
```

## 결론
- ingest EF `reservation-ingest-from-dopamine` + RPC17 = **동행 payload(companion_name→customer_real_name / 무폰 / scheduled_at / composite external_id) 수용 + 멱등 + sync-back(200 applied) 계약 READY.**
- **코드 변경 없음** (planner "수신부 이미 ready면 별도 코드 없음 — 확인만" 충족).
- dev-dopamine quick CONSULT 착수 안전 / supervisor DDL-diff 사인오프 + 동행 E2E 근거 = 본 파일.
- 원 22P02(INSERT-FAIL 근인) = external_id UUID→TEXT drift-correction으로 해소 실증.
