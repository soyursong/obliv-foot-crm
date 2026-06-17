# DB GATE — T-20260617-foot-CHECKIN-CHART-LINK-3KEY (AC-6 김사비 차트 데이터 정정)

- **요청**: dev-foot → supervisor DB 게이트
- **risk**: GO_WARN (의료 데이터 DML 정정 / 스키마 무변경 / 단건 타겟)
- **재확인 시각**: 2026-06-17 (KST) — Phase 1 read-only 재실행 결과 기준
- **긴급**: 총괄 김주연 "김사비 차트 좀 복구 시켜줘" (#foot C0ATE5P6JTH thread 1781660537.020219)

## Phase 1 — read-only 진단 결과 (DML 전 確認)

### 대상 고객
| 구분 | id | chart | name | phone | 판정 |
|------|----|-------|------|-------|------|
| 정답(실환자) | `2be865ff` | F-0087 | 김사비 | 010-9464-7501 | 실환자 (form 1·결제 6건 ₩1,382,520) |
| 오배정 대상 | `8ba2bbef` | F-1189 | 문자테스트 | 010-**9999**-9991 | SMS 테스트 레코드 (9999 테스트폰) |

### 오배정 체크인 (정정 대상, 단건)
- `4b091fa7-29c9-48c8-854b-42b53905351b` — 2026-06-17 00:49Z 생성, status=treatment_waiting
- denormalized: customer_name='김사비', customer_phone='+821094647501' (= 김사비 실폰)
- **현재 연결(오배정)**: customer_id=`8ba2bbef` (문자테스트 / F-1189) — NAME_MISMATCH=true, PHONE_MISMATCH=true
- 정상 연결됐어야 할 차트: `2be865ff` (김사비 / F-0087)

### 교차오염 점검 (AC-4 동일 트랜잭션) → **CLEAN (BLOCK 불요)**
- 오배정 체크인 `4b091fa7`에 직접 매달린 자식 레코드: `check_in_room_logs`(6), `status_transitions`(12) — **둘 다 check_in_id 귀속 운영 로그**로 체크인과 함께 이동(차트 내용 오염 아님).
- 문자테스트(F-1189) 차트 귀속 내용:
  - form_submissions: **0건**
  - payments: **1건** = ₩10,000 (check_in `29d4692c` = 문자테스트 *본인* 체크인 6/8 귀속, 김사비 것 아님)
  - check_in_services on 4b091fa7: 0 · medical_charts(문자테스트): 0
- **결론**: 문자테스트 차트에 김사비/타 환자의 의료기록(form/결제/처방/차트) 오기록 **無**. 단순 customer_id 재연결로 완결. (BLOCK+ESCALATE 불요)

## Phase 2 — 정정 SQL (dry-run 선행)

### dry-run SELECT (가드 WHERE) — matched rows = **1** (정확히 단건)
```
id=4b091fa7  clinic_id=74967aea  cur_wrong=8ba2bbef(문자테스트/F-1189)
  → new_correct=2be865ff(김사비/F-0087)  new_clinic=74967aea (clinic 스코프 동일·보존)
```

### 정정 SQL (멱등·가드)
```sql
BEGIN;
UPDATE check_ins
   SET customer_id = '2be865ff-6a9d-4666-892c-1cfd2d971199'  -- 김사비 / F-0087 (정답)
 WHERE id = '4b091fa7-29c9-48c8-854b-42b53905351b'
   AND customer_id = '8ba2bbef-018e-4207-b2ab-196e18322437'  -- 문자테스트 / F-1189 (오배정) 일 때만
   AND trim(customer_name) = '김사비';
COMMIT;
```
파일: `scripts/T-20260617-foot-CHECKIN-CHART-LINK-3KEY_datafix.sql`

### 롤백 SQL
```sql
BEGIN;
UPDATE check_ins
   SET customer_id = '8ba2bbef-018e-4207-b2ab-196e18322437'
 WHERE id = '4b091fa7-29c9-48c8-854b-42b53905351b'
   AND customer_id = '2be865ff-6a9d-4666-892c-1cfd2d971199';
COMMIT;
```
파일: `scripts/T-20260617-foot-CHECKIN-CHART-LINK-3KEY_datafix.rollback.sql`

### 안전성
- 단건 PK 타겟(WHERE id=…) + 가드(현재값=오배정 AND 성함=김사비) → 멱등, 오발사 0.
- clinic 스코프 보존 (74967aea 동일), cross-clinic 이동 없음.
- 스키마 무변경 (DML only).
- 적용 후 검증: `4b091fa7`의 linked_name='김사비', linked_chart='F-0087' 기대.

## 게이트 요청
supervisor GO 시 dev-foot가 운영 적용 → 검증 → responder(현장 보고) + planner 통지.
