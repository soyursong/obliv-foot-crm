---
id: T-20260731-foot-CBAND-CAT-DIRECT-PAY-PLANA-BUILD
domain: foot
assignee: agent-fdd-dev-foot
status: in_progress
deploy_ready: false
db_change: true
mig_files: []
mig_dryrun: "PENDING — DA CONSULT-REPLY GO 후 마이그 작성"
mig_ledger_check: "PENDING"
mig_rollback: "PENDING"
applied_at: ""
blocked_on: "data-architect CONSULT-REPLY (payment_attempts 테이블 + payments 채널확장 ADDITIVE 확정)"
---

# 코밴 CAT 단말기 직결 결제(플랜A) — 빌드 경과

## 이번 커밋 범위 (FE/WS/전문조립/파싱/classify — DDL 미대기 병행 착수, planner 지시 §1)
DA CONSULT-REPLY 회신 대기 없이 병행 가능한 전부를 구현. **DDL·deploy-ready 는 게이트 유지.**

| 구분 | 파일 | 내용 |
|------|------|------|
| 전문 조립/파싱/분류(순수) | `src/lib/cband/protocol.ts` | buildMsg/makeTrace/safeParse/normalize/classify + 4대규칙 + 실측4 |
| WS 클라이언트 | `src/lib/cband/catClient.ts` | probeTerminal(열닫만)/send(동시1건 잠금·타임아웃=무응답) |
| ★D 상태머신 | `src/lib/cband/paymentFlow.ts` | insert-first → send → classify → 정지/수납기록 (자동재시도 금지) |
| 실 DB store(DDL 게이트) | `src/lib/cband/supabaseAttemptStore.ts` | payment_attempts + payments(pg_provider=cband) — 플래그 OFF 로 격리 |
| 로컬 단말 설정 | `src/lib/cband/config.ts` | TID/MERNO/CAT_PORT (localStorage>env), 테스트금액 1001~1006(1004 제외) |
| FE 진입 | `src/components/CbandPayEntryButton.tsx` | 3중 게이트(플래그+설정+단말감지) 버튼·다이얼로그·확인필요 정지 UX |
| 배선 | `src/components/CheckInDetailSheet.tsx` | 1줄 추가(플랜B 버튼 옆, OFF/미탐지 시 null) |
| unit | `tests/e2e/T-20260731-...spec.ts` | 22 case PASS (4대규칙·classify·insert-first·ATTENTION 정지·취소) |

## ★ 이중결제 방지(D) — 후순위 금지, 이번 커밋 포함
- insert-first: 송신 **전** 시도레코드 저장. insert 실패 시 송신 안함(추적불가 과금 0).
- ATTENTION(C011/8003/8555/무응답) → 자동 재시도 **없음** + '확인 필요' 정지 + MSG_TRACE 12자리 잔존.
- classify(null)=ATTENTION (무응답을 FAIL 오분류 시 이중결제 → 차단).

## 남은 게이트 (deploy-ready 전 필수)
1. **DA CONSULT-REPLY GO** — payment_attempts 스키마 + payments 채널확장 ADDITIVE 확정.
2. **MIG-GATE 4필드 evidence** — mig_files/mig_dryrun/mig_ledger_check/mig_rollback (DDL 확정 후).
3. **field-soak(총괄 최필경)** — 시나리오6 케이블뽑기 응답유실 실단말 재현.
4. supervisor DDL-diff + QA.

## 검증
- `npm run build` OK (tsc + vite).
- unit spec 22 PASS. 실 카드 승인/취소는 물리 단말 의존 → field-soak.
