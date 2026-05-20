---
ticket_id: T-20260520-foot-SELFCHECKIN-FORM-DRIFT
domain: foot
type: investigation
priority: P2
status: closed
deploy_ready: false
commit_sha: 26cd69f
db_changed: false
created: 2026-05-20
closed: 2026-05-20
summary: 셀프 접수 화면 양식 변경 경위 조사 — 타센터 요청 혼입 여부 확인
---

# T-20260520-foot-SELFCHECKIN-FORM-DRIFT

셀프 접수 화면 양식 예상 외 변경 — 타센터 요청 혼입 여부 조사

## 판정: 타센터 혼입 **NO** — 정상 풋 도메인 변경

## AC-1. git log — SelfCheckIn 컴포넌트 5/10 이후 변경 전량 + 티켓 매핑

| 커밋 | 날짜 | 티켓 | 내용 |
|------|------|------|------|
| `40930a8` | 5/10 20:18 | SELFCHECKIN-NO-PREFILL | batch 7건 포함, 자동완성 제거 |
| `7b3bb41` | 5/11 12:44 | SELFCHECKIN-NO-PREFILL + SELFCHECKIN-ADDR-REMOVE | 자동 입력 제거 + 주소 입력란 삭제 |
| `4797d83` | 5/13 09:56 | SELFCHECKIN-FONT | 폰트 Pretendard 교체 |
| `9515fea` | 5/13 00:39 | VISITTYPE-SIMPLIFY | 방문유형 '체험' 전면 삭제 + 딱지 2종 한정 |
| `5aabeea` | 5/13 08:16 | VISITTYPE-ROLLBACK | 선체험 슬롯 복구 + 배지 미표시 유지 |
| `0b03425` | 5/15 23:25 | SELFCHECKIN-PRIVACY-LOCK | Logic Lock L-001 — 고객정보 노출 금지 |
| `ff4ca98` | 5/18 15:56 | CHECKIN-2STEP | **주요 변경** — 방문유형·유입경로 2단계 구조 개편 |
| `8efed90` | 5/20 18:50 | SELFCHECKIN-LEADSRC-COND | 예약 경로에서 유입경로 선택 숨김 |

모든 커밋 티켓 prefix: `T-2026xxxx-foot-xxx` — 풋 도메인 전용

## AC-2. 타센터(body/derm) 요청 혼입 YES/NO + 근거

**판정: NO (혼입 없음)**

| 검사 항목 | 결과 |
|-----------|------|
| `consultation_notes` 테이블 참조 | 0건 (comment에서 "풋은 check_ins 사용"이라는 명시적 구분 1건) |
| `happy_flow` 참조 | 0건 |
| `obliv-body` / `obliv-derm` 참조 | 0건 |
| 커밋 메시지 body/derm 혼입 | 0건 |
| DB 마이그레이션 타센터 테이블 참조 | 0건 (70건 전수) |
| LOGIC-LOCK L-001/002/004 준수 | 전원 준수 확인 |

`formTemplates.ts` 내 `도수센터` 참조(10건)은 T-20260423-foot-DOSU-FORMS-SPEC (4/23) 풋 도메인 내 도수센터 서류 스펙 작업으로, 타 CRM과 무관한 풋 내부 서류 관리 기능.

## AC-3. 현재 prod 양식 필드 vs 5/10 diff

### 5/10 시점 필드
- 성함 (name) ✅
- 연락처 (phone) ✅
- 방문유형: 초진/재진/예약없이 방문 (3버튼 평면)
- 추천인 (referrer) — **5/11 ADDR-REMOVE에서 삭제됨**
- 주소 (address) step — **5/11 ADDR-REMOVE에서 삭제됨**

### 현재 prod 필드 (2026-05-20)
- 성함 (name) ✅
- 연락처 (phone, NumPad 방식) ✅
- 방문유형 2단계:
  - Step 1: 예약하고왔어요 / 예약없이방문했어요
  - Step 2(예약): 초진 / 재진
  - Step 3(예약없이 방문): 안내 팝업 → 초진 자동 처리
- 유입경로 (워크인만): SNS/검색/지인소개/제휴/기타 → SNS 소분류

### 변경 경위 (정당한 현장 요청)
- 주소/추천인 삭제: T-20260510-foot-SELFCHECKIN-ADDR-REMOVE (현장 "불필요한 입력 줄여달라" 요청)
- 2단계 구조: T-20260517-foot-CHECKIN-2STEP (현장 "예약여부 먼저 확인 필요" 요청)
- 유입경로 추가: T-20260517-foot-CHECKIN-2STEP (마케팅 트래킹 요청)
- 소개자 이름+전화번호 제거: CHECKIN-2STEP 시 "불필요 필드" 정리

## AC-4. spec 드리프트 수정 (부수 작업)

CHECKIN-2STEP 배포 이후 2개 레거시 spec 파일이 구식 평면 3버튼 플로우를 참조하는 드리프트 발견 → 수정 (commit `26cd69f`):
- `tests/self-checkin.spec.ts` — 2단계 플로우 반영
- `tests/functional/self-checkin.spec.ts` — 2단계 + NumPad 방식 반영

## 결론

셀프 접수 화면의 양식 변경은 **풋센터 현장의 정당한 요청에 의한 것**이며, 타센터(body/derm) 코드 혼입은 전혀 없음.
변경 내용: 불필요 필드 제거(주소/추천인/소개자) + UX 개선(2단계 방문유형 + 유입경로 트래킹).

현장 안내 문구: "셀프 접수 화면 변경은 기존 현장 요청(주소입력 삭제, 예약여부 먼저 확인)을 반영한 것입니다. 타센터 코드 혼입은 없음을 확인했습니다."
