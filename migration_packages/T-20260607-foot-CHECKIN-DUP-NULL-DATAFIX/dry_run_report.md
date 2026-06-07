# AC3 정비 패키지 + AC2 행별 판정 — T-20260607-foot-CHECKIN-DUP-NULL-DATAFIX

> 산출: dev-foot · 2026-06-07 · **supervisor DB 게이트(AC4) 대기. 실행 전 무변경.**
> 근거: `evidence/T-20260607-CHECKIN-DUP-NULL_ac1_inventory.{md,json}` (READ-ONLY dry-run)

## TL;DR (supervisor DB 게이트 요청)
- check_ins 642건 중 **실 mutation = 단 1건** → 김민경 중복 6425a5c8 **논리 cancel(status='cancelled')**.
  planner AC2 지시로 **물리 DELETE 금지**(역연산 가능한 status 취소).
- NULL 고아 14건은 **전부 더미/테스트패밀리**(김N번·길동이·시뮬테스트 등) → planner AC2 **no-op 확정**
  (티켓 "더미/테스트명 범위 외" 적용, 실명 실데이터 0건). 본 패키지에서 SQL 미작성.
- 동명 customer 중복(김규리·김민경·김승현 test-phone)은 **범위 밖** → spinoff 티켓
  `T-20260607-foot-CUSTOMER-MASTER-DUP-TRIAGE`(대표원장 확인).

## AC2 — 행별 판정

### Tier 1 · 실행대상 (clear GO · 논리 cancel, 연결 전무)
| check_in id | 고객 | KST일 | 판정 | 처리 |
|---|---|---|---|---|
| `6425a5c8-8fb7-46d6-a762-93d9922eeb48` | 김민경 (cid 83ab4fe1) | 2026-06-02 | 운영자오류 중복 (차트·결제·서비스·패키지 無) | **status→cancelled (논리 취소)** |
| `207bf234-8851-4a38-8c56-c0191bea96b8` | 김민경 (cid 83ab4fe1) | 2026-06-02 | 정본(최초 04:57Z) | **KEEP** |

판정근거: 둘 다 연결 전무 → 최초 생성 선점 룰로 정본 결정. 가드(cid+name+status='done'+연결無)로 타행 보호.
**물리삭제 금지**(planner AC2) — status='cancelled' 논리 취소로 역연산 가능. KST 방문일은 06-02(원 보고 06-01 보정).

### Tier 2 · NO-OP (NULL 고아 14건 = 전부 테스트/더미) — 정비 안 함
planner AC2 확정: NULL 고아 실명 실데이터 0건(명시더미 7 + 김N번 테스트패밀리·길동이 7).
티켓 §비범위 적용 → **본 패키지에서 어떤 UPDATE/DELETE 도 수행하지 않음**. 참고 행:
`7dd25828`(길동이) `61c83e50`(김사번) `a8a74db4`(김십번) `258fd605`(김오번) `46824c34`(김삼번)
`5545fe03`(김이번) + 서비스연결 1건 `6d1350e6`(김이번, 동일 테스트패밀리). 소크 중 자연정리.

### Tier 3 · 범위 밖 (spinoff 분리)
- 동명 customer 중복 3건(김규리 7fa5dff1↔7cef3be8 / 김민경 83ab4fe1↔김구번 오연결 10f10231 / 김승현 fcdcd44f↔53661ce0):
  중복 customer_id가 모두 test-phone(010-1234-5679 / 010-9999-9999 / 010-1111-1111).
  check-in 재귀속 vs customer master 병합은 동일인 확인 후 결정 → spinoff
  `T-20260607-foot-CUSTOMER-MASTER-DUP-TRIAGE`(dry-run 트리아지, 병합은 대표원장 확인 후).

## AC3 산출물
- `datafix.sql` — STEP0 백업 → Tier1 **UPDATE status='cancelled'**(BEGIN/COMMIT, 가드 포함). Tier2 no-op, Tier3 범위 밖.
- `rollback.sql` — 백업 원본 status 로 UPDATE 복원(물리삭제 아님 → 재INSERT 아닌 status 원복).

## AC5 실행 후 검증 (supervisor GO 후)
1. `SELECT count(*) FROM check_ins WHERE customer_id='83ab4fe1…' AND (checked_in_at AT TIME ZONE 'Asia/Seoul')::date='2026-06-02' AND visit_type='new' AND status<>'cancelled';` → 기대 **1**.
2. 부모 UX(우측 초진차트 목록)에서 김민경 중복 노출 1건으로 감소 확인.
3. 백업 테이블 1행 보존 확인 후, 안정화 뒤 DROP.

## 게이트 요청
- **supervisor**: Tier 1 논리 cancel GO/NO-GO 판정 + DB 실행(AC4/AC5).
- Tier 2 = no-op(정비 없음), Tier 3 = spinoff 티켓에서 대표원장 확인 → 본 티켓 게이트는 Tier 1 단건.
