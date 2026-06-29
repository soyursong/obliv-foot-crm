# AC3-positive 실 write 증빙 — T-20260629-foot-INGEST-EF-401-VERIFYJWT
검증일: 2026-06-29 ~09:41 UTC (18:41 KST)
방법: 시나리오1 cross-service 실 production 경로 — 배포된 도파민 `foot-reservation-push` EF → 배포된 풋 `reservation-ingest-from-dopamine` EF (실 평문 공유 secret, secret-holder=dev-dopamine 실행). dev-foot 가 풋 prod DB row 검증·스윕.

## 1) 도파민 push EF (root-cause 502 소거)
- Invoke #1 HTTP 200 (이전 502): {"ok":true,"applied":true,"cue_card_id":"e2e0a3c3-0000-4000-8000-00000000c301","reservation_id":"daa57dcf-9a52-41ef-b2a4-2d5ef5f9f379","clinic_slug":"jongno-foot"}
- Invoke #2 (멱등) HTTP 200: {"ok":true,"applied":false,...,"reservation_id":"daa57dcf-...","reason":"duplicate"}
- function_edge_logs: /functions/v1/foot-reservation-push 두 POST 모두 status 200 (1782726092/1782726102), 502 부재.
- secret digest 양측 일치 d2f0a6a2… (rotate 없음).

## 2) 풋 ingest EF 결과 (AC3-positive)
- 풋 응답: {ok:true, reservation_id:"daa57dcf-9a52-41ef-b2a4-2d5ef5f9f379", applied:true} (2xx)
- 멱등 재호출: applied:false, reason:duplicate, 동일 reservation_id

## 3) 풋 prod DB reservations row 실측 (dev-foot, service_role 조회)
{
  "id": "daa57dcf-9a52-41ef-b2a4-2d5ef5f9f379",
  "external_id": "e2e0a3c3-0000-4000-8000-00000000c301",
  "clinic_id": "74967aea-a60b-4da3-a0e7-9c997a930bc8",   // jongno-foot 해석
  "customer_id": "27110a71-b70c-4b43-82c2-05ebb589d865", // 연결됨
  "source_system": "dopamine", "created_via": "dopamine",
  "reservation_date": "2026-12-31", "reservation_time": "23:00:00",
  "status": "confirmed", "visit_type": "new", "memo": "[QA-FIXTURE]",
  "created_at": "2026-06-29T09:41:31.994032+00:00"  // 도파민 edge-log 시각 일치
}

## 결론
AC3-positive PASS — 실 평문 secret 으로 배포된 도파민→풋 end-to-end 실 write 성립(2xx + reservations 1행 + 도파민 cue_card stage=reserved/crm_sync_status=synced 반영). 게이트웨이 401 root-cause 해소 end-to-end 확인. 픽스처 스윕 후 잔존 0.
