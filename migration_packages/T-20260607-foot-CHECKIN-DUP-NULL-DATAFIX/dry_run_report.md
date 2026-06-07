# AC3 정비 패키지 + AC2 행별 판정 — T-20260607-foot-CHECKIN-DUP-NULL-DATAFIX

> 산출: dev-foot · 2026-06-07 · **supervisor DB 게이트(AC4) 대기. 실행 전 무변경.**
> 근거: `evidence/T-20260607-CHECKIN-DUP-NULL_ac1_inventory.{md,json}` (READ-ONLY dry-run)

## TL;DR (supervisor 판단 요청)
- check_ins 642건 중 **실명·실데이터 운영자오류 중복은 단 1건** → Tier 1으로 자동정비 GO 가능.
- NULL 고아 14건은 **전부 더미/테스트패밀리**(김N번·길동이·시뮬테스트 등). 티켓의
  "더미/테스트명 범위 외 — 건드리지 말 것" 규칙과 충돌 → **기본 SKIP** 권고(Tier 2 HOLD).
- 동명 customer 중복(김규리·김민경·김승현 test-phone)은 **check_in 정비 범위 밖** → 대표원장 확인(Tier 3).

## AC2 — 행별 판정

### Tier 1 · 실행대상 (clear GO, 연결 전무)
| check_in id | 고객 | KST일 | 판정 | 처리 |
|---|---|---|---|---|
| `6425a5c8-8fb7-46d6-a762-93d9922eeb48` | 김민경 (cid 83ab4fe1) | 2026-06-01 | 운영자오류 중복 (차트·결제·서비스·패키지 無) | **DELETE** |
| `207bf234-8851-4a38-8c56-c0191bea96b8` | 김민경 (cid 83ab4fe1) | 2026-06-01 | 정본(최초 04:57Z) | **KEEP** |

판정근거: 둘 다 연결 전무 → 최초 생성 선점 룰로 정본 결정. 가드(cid+name+연결無)로 타행 보호.

### Tier 2 · HOLD 기본 SKIP (NULL 고아 6건 = 테스트패밀리)
| check_in id | 이름/전화 | 비고 |
|---|---|---|
| `7dd25828…` | 길동이 / +821099634666 | resv만 연결, 결제·서비스 無 |
| `61c83e50…` | 김사번 / 010-4444-4444 | 연결 無 |
| `a8a74db4…` | 김십번 / 01010101010 | 연결 無 |
| `258fd605…` | 김오번 / 01055555555 | 연결 無 |
| `46824c34…` | 김삼번 / 01033333333 | 연결 無 |
| `5545fe03…` | 김이번 / 01022222222 | 연결 無 |

→ AC1은 "고아삭제후보(연결無)"로 잡았으나 **이름/전화가 전형적 테스트패밀리**.
   티켓 비범위 규칙과 충돌하므로 dev-foot는 **자동 삭제하지 않음**.
   supervisor/planner가 "고아 hygiene 정비"로 재분류 시에만 datafix.sql Tier 2 블록 주석 해제.

### Tier 3 · HOLD (대표원장 확인)
- `6d1350e6…` 김이번(010-2222-2222) — NULL 고아지만 **서비스 3건 연결有** → 삭제 불가.
  올바른 customer_id 매핑 확정 후 UPDATE 복원 검토 대상.
- 동명 customer 중복 3건(김규리 7fa5dff1↔7cef3be8 / 김민경 83ab4fe1↔김구번 오연결 10f10231 / 김승현 fcdcd44f↔53661ce0):
  중복 customer_id가 모두 test-phone(010-1234-5679 / 010-9999-9999 / 010-1111-1111).
  check-in 재귀속 vs customer master 병합은 동일인 확인 후 결정 → **본 티켓 범위 밖**.

## AC3 산출물
- `datafix.sql` — STEP0 백업 → Tier1 DELETE(BEGIN/COMMIT, 가드 포함). Tier2 주석, Tier3 미포함.
- `rollback.sql` — 백업 테이블에서 재INSERT (ON CONFLICT DO NOTHING).

## AC5 실행 후 검증 (supervisor GO 후)
1. `SELECT count(*) FROM check_ins WHERE customer_id='83ab4fe1…' AND (checked_in_at AT TIME ZONE 'Asia/Seoul')::date='2026-06-01' AND visit_type='new';` → 기대 **1**.
2. 부모 UX(우측 초진차트 목록)에서 김민경 중복 노출 1건으로 감소 확인.
3. 백업 테이블 1행 보존 확인 후, 안정화 뒤 DROP.

## 게이트 요청
- **supervisor**: Tier 1 자동정비 GO/NO-GO 판정 + DB 실행.
- **planner→문지은 대표원장**: Tier 2(테스트패밀리 고아 정리 여부) · Tier 3(동명 customer 병합) 확인.
