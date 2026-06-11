# T-20260612-foot-SMS-SCHEDULE-SEND-OPTION — DB 스키마 설계 1-pager

원천: 김주연 총괄 (#project-doai-crm-풋확장, 채널 C0ATE5P6JTH)
작성: dev-foot / 2026-06-12
상태: **GO_WARN — supervisor db-gate 검토·적용 대기** (dev-foot prod 직접 적용 안 함)

## 1. 요구

문자 발송에 **즉시 / 예약** 구분 옵션 추가. 예약 시 날짜+시간 지정 → **지정 시각에 자동 발송(누락 금지)**.
진입점 2곳: (A) 대시보드 우클릭 [문자], (B) 메시지 설정 ④ 수동 발송.

## 2. 2안 비교

### 안1) scheduled_messages 신규 테이블  ✅ 채택
미래 발송 의도를 담는 독립 큐. `pending→processing→sent/failed`, `cancelled`. pg_cron 1분 주기 디스패처가 도래분을 점유(SKIP LOCKED)해 EF로 발송.

| 항목 | 평가 |
|---|---|
| 상태머신 | 명확(전용 status). claim/processing 으로 중복발송 차단 |
| 무손실 | stuck-reaper(processing>10분 회수)로 EF 호출 유실 복구 → **누락 금지 충족** |
| 회귀 위험 | 낮음 — notification_logs(감사로그) 무변경. §13.1.A 경고(notifications 코드 겹침)와 정합 |
| 발송이력 | 발송 성공 시 notification_logs 에 event_type='scheduled_send' 적재(기존 ⑤ 이력 호환) |
| 취소 | status='cancelled' soft 전이 — 단순 |
| 비용 | 신규 테이블+RLS+cron 1개 |

### 안2) notification_logs 스케줄 컬럼 확장 (scheduled_for + status='scheduled')
| 항목 | 평가 |
|---|---|
| 재사용 | 기존 테이블/인프라 재활용 |
| 회귀 위험 | **높음** — append-only 감사로그에 미래-의도 행 혼입. retry 48h 윈도우·발송이력 필터·status CHECK 가 미래 행을 오인 처리. recipient_phone/body_rendered 는 발송-후 필드 의미 충돌 |
| 가드 비용 | 기존 모든 쿼리(notify_retry_failed, SectionHistory 등)에 scheduled 제외 가드 추가 필요 → 광범위 수정·검증 |

**결론: 안1 채택.** 회귀 격리 + 무손실 보장이 핵심. notification_logs 의미 오염 회피.

## 3. 스키마 (요지)

`public.scheduled_messages`
- id, clinic_id(FK), customer_id(FK nullable), recipient_phone, body, image_path(MMS), channel
- **scheduled_at TIMESTAMPTZ** (UTC 저장; FE 가 현장 KST 입력 → +09:00 변환)
- status CHECK(pending|processing|sent|failed|cancelled), source, created_by(auth.uid)
- claimed_at, attempts, sent_at, notification_log_id, error_message, created/updated_at
- 인덱스: due 부분(status=pending, scheduled_at) / processing 부분(claimed_at) / (clinic,status,scheduled_at)
- RLS: SELECT 지점격리 / INSERT 전직원8 본인명의 / UPDATE 전직원8(취소) / DELETE 불허
- service_role(디스패처·EF) RLS 우회

## 4. 발송 트리거 경로 (누락 방지)

```
pg_cron '* * * * *' → dispatch_scheduled_messages()
  (a) reaper: processing & claimed_at<now-10m → attempts<5 pending 회수 / >=5 failed 확정
  (b) claim : pending & scheduled_at<=now  → FOR UPDATE SKIP LOCKED, processing+claimed_at+attempts++
  (c) POST  : send-notification EF (_action='scheduled_send', scheduled_message_id)
                 → EF 발송 + scheduled_messages.status=sent/failed 기록 + notification_logs 적재
```
중복발송 차단 = processing 점유. 유실 복구 = reaper. 지연 ≤ 1분.

## 5. supervisor 적용 순서 (배포-마이그 레이스)

1. **마이그 먼저** `20260612120000_scheduled_messages.sql` 적용 (롤백: `*.rollback.sql`)
2. EF `send-notification` 재배포 (scheduled_send 핸들러 포함)
3. FE 배포 (Vercel) — FE 는 `scheduled_messages` 존재 probe 로 예약옵션 토글하므로 1·2 이전 배포돼도 즉시발송만 노출(안전). 다만 권장 순서는 1→2→3.
4. POST-DEPLOY CHECKLIST(마이그 하단) 5항목 확인.

## 6. data-architect CONSULT

신규 테이블 → §S2.4 데이터 정책 자문 게이트. CONSULT 발행(naming/RLS/cross-CRM 계약 정합 확인). deploy-ready 는 CONSULT 회신 + supervisor 마이그 적용 후.
