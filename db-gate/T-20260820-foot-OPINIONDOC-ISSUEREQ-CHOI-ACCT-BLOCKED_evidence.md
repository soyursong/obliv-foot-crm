# T-20260820-foot-OPINIONDOC-ISSUEREQ-CHOI-ACCT-BLOCKED — 진단 + fix evidence

- **일시**: 2026-08-20 (KST)
- **담당**: dev-foot
- **유형**: 진단(READ-ONLY census) + 단일행 DATA 정정 (DDL/스키마/enum/권한 변경 0)
- **prod**: rxlomoozakkjesdqjtvd (foot) · auth=Management API postgres(무RLS)
- **증상 스크린샷**: /Users/domas/file_inbox/20260820/20260820_153713_F0BRC95PQ9K.png
  (소견서 & 진단서 요청 박스 '발행 요청' 클릭 → 진행 안 됨)

## RC (확정) — 계정설정 미완결, RLS/권한 문제 아님

최현희(7687choi@naver.com) staff 행(`9172beb7-1294-4153-b549-9eb45d337233`)의
`user_id`가 **NULL** = 그녀의 auth 계정(`44a73b6d-e7f5-4aa1-a4e6-a49d8853b21f`)과 미링크.

FE(`CustomerChartPage.tsx` L6043-6054)는 로그인 사용자의 staff.id 를
`staff.user_id = auth.uid()` 로 역조회해 `currentUserStaffId` 세팅 →
`OpinionRequestBox.issuedBy` 로 전달. user_id 미링크면 조회 0건 → `issuedBy=''` →
- 버튼 `disabled`(`!issuedBy`, OpinionRequestBox L322)
- `handleRequest` early-return: "직원 계정 정보를 확인할 수 없어 요청할 수 없습니다"(L165-168)
→ **INSERT 가 DB 에 도달조차 안 함 = RLS 42501 아님 (client-side 차단).**

## planner 확인요청 4항 답변

1. **7687choi user_profiles.clinic_id** = `74967aea…`(**jongno-foot**), `active=true`,
   `role=consultant`, last_sign_in 08-20 02:20 → **계정/프로필 정상**. (RC후보4 = 프로필 clinic_id 문제 **아님**)
2. **form_submissions INSERT RLS 가 consultant 허용?** → **YES**. 정책 술어 =
   `clinic_id IN (SELECT clinic_id FROM user_profiles WHERE id=auth.uid() AND active=true)` —
   **role 술어 자체가 없음**. active clinic member 전원 허용(consultant 완전 커버). SEAL(819)에 form_submissions 미포함 확인.
3. **Supabase 에러코드(42501?)** → **해당 없음**. INSERT 시도가 client 게이트에서 막혀 DB 미도달.
   에러는 toast "직원 계정 정보를 확인할 수 없어…"(권한오류 아님).
4. **오늘 발행요청 시도 이력** → 08-20 staff_consult 소견서 draft 다수 정상 생성(진이서/박민석/송지현/엄경은).
   전원 `staff.user_id` **링크됨**(has_userlink=true). 최현희만 미링크 = 유일 이상치.

## 판별 결과

RC = **계정설정 회귀(staff.user_id 미링크)** — 권한 predicate 누락/신규 grant **아님**.
→ 신규 의료문서 권한 결정 아님 → **field/medical 게이트 비대상**. planner 지침대로 **일반 fix 착수**.

## 안전성 게이트 (fix 전)

- [C1] auth uid `44a73b6d` 가 이미 다른 staff 에 링크? → **0건**(충돌 없음).
- [C2] 최현희(이름) staff 중복행? → **단일행**(9172beb7)만.
- [C3] 오늘 발행요청 성공 직원 전원 user_id 링크됨 → path 정상 대조 확증.
- [C4] jongno-foot active consultant 9명 중 user_id NULL = **1명(=최현희)**.

## FIX (apply 완료)

```sql
UPDATE public.staff SET user_id = '44a73b6d-e7f5-4aa1-a4e6-a49d8853b21f'
 WHERE id = '9172beb7-1294-4153-b549-9eb45d337233' AND user_id IS NULL;
-- RETURNING 1 row. idempotent(WHERE user_id IS NULL).
```

- BEFORE: user_id=null → AFTER: user_id=44a73b6d
- VERIFY(FE 해석 쿼리 재현): `staff WHERE user_id=44a73b6d AND clinic=jongno-foot AND active AND deleted_at NULL` → **1건 반환**(9172beb7). issuedBy 정상 해석 → 버튼 해제.

## 롤백

```sql
UPDATE public.staff SET user_id = NULL
 WHERE id = '9172beb7-1294-4153-b549-9eb45d337233';
```

## 현장 확인 필요 (soak)

최현희 계정 재로그인 후 상담내역 → 소견서/진단서 '발행 요청' 실동작 confirm.
(FE 코드 변경 0 = 배포 불요. staff.user_id 는 로그인 시점 조회 → 다음 페이지 로드부터 반영.)

## 잔여 리스크 (planner 판단용, 별건)

- jongno-foot 활성 staff 중 user_id 미링크 잔존: therapist 5, technician 5, director 4,
  coordinator 2 (일부는 로그인 계정 미부여 직군일 수 있음 = 정상). consultant 는 이제 0건.
  → 발행요청 외 다른 staff.user_id 의존 기능(패키지 차감 performed_by 등) 잠복 가능 →
  계정-staff 링크 완결성 점검을 별도 티켓으로 검토 권고(본 티켓 scope 밖).
