```
═══════════════════════════════════════════════════════════════
T-20260616-foot-BUNDLERX-DRUGNAME-MIGRATE-KEEPTAB — DRY-RUN (READ-ONLY)
실행시각: 2026-06-16T06:46:08.339Z
prod: rxlomoozakkjesdqjtvd
═══════════════════════════════════════════════════════════════

[0] 소스 현황
    prescription_sets        = 19
    prescription_codes       = 499
    prescription_folders     = 2
    prescription_code_folders= 1 (이미 폴더배정된 약)
    '이관약' 폴더 존재 = 아니오 → apply시 신규생성

[1] 묶음처방 약 항목 수집
    총 items 원소 = 19
    distinct 약   = 19

[2] 약 해소 상태 분포
    NEW_NEEDED               : 19

[3] apply 영향 요약
    신규 prescription_codes 생성 필요 = 19
    폴더 배정(prescription_code_folders insert) = 19
    SKIP(이미 배정/빈이름)            = 0
    모호(동명 다건)                   = 0
    code_id dangling/폴백             = 0
    '이관약' 폴더 신규생성 = 필요(1건)

[4] 신규 생성 약 목록 (이름매칭 0 → prescription_codes INSERT 대상)
    1. "닥터로반"  ← 출처세트: [닥터로반]
    2. "대웅푸루나졸정150mg(플루코나졸)"  ← 출처세트: [대웅푸루나졸정150mg(플루코나졸)]
    3. "록소포펜"  ← 출처세트: [록소포펜]
    4. "루마졸크림"  ← 출처세트: [루마졸크림]
    5. "바르토벤 외용액 4ml(에피나코나졸)"  ← 출처세트: [바르토벤 외용액 4ml(에피나코나졸)]
    6. "바르토벤 외용액 8ml(에피나코나졸)"  ← 출처세트: [바르토벤 외용액 8ml(에피나코나졸)]
    7. "베타베이트연고(클로베타솔프로피오네이트)15g"  ← 출처세트: [베타베이트연고(클로베타솔프로피오네이트)15g]
    8. "삼아리도멕스크림(프레드니솔론발레로아세테이트)"  ← 출처세트: [삼아리도멕스크림(프레드니솔론발레로아세테이트)]
    9. "세파클리어"  ← 출처세트: [세파클리어]
    10. "스티렌"  ← 출처세트: [스티렌]
    11. "에스로반연고(무피로신)10g"  ← 출처세트: [에스로반연고(무피로신)10g]
    12. "오구멘토"  ← 출처세트: [오구멘토]
    13. "주블리아 외용액 8ml(에피나코나졸)"  ← 출처세트: [주블리아 외용액 8ml(에피나코나졸)]
    14. "주블리아외용액 4ml(에피나코나졸)"  ← 출처세트: [주블리아외용액 4ml(에피나코나졸)]
    15. "터미졸크림(테르비나핀염산염)15g"  ← 출처세트: [터미졸크림(테르비나핀염산염)15g]
    16. "플루나코엠캡슐(플루코나졸)"  ← 출처세트: [플루나코엠캡슐(플루코나졸)]
    17. "하이트리크림 20g"  ← 출처세트: [하이트리크림 20g]
    18. "한미유리아크림 200ml(우레아)20g"  ← 출처세트: [한미유리아크림 200ml(우레아)20g]
    19. "한미유리아크림 200ml(우레아)50g"  ← 출처세트: [한미유리아크림 200ml(우레아)50g]

[6] 전체 이관 계획 (약별)
    ─────────────────────────────────────────────────────────
     1. [NEW_NEEDED] "닥터로반"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
     2. [NEW_NEEDED] "대웅푸루나졸정150mg(플루코나졸)"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
     3. [NEW_NEEDED] "록소포펜"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
     4. [NEW_NEEDED] "루마졸크림"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
     5. [NEW_NEEDED] "바르토벤 외용액 4ml(에피나코나졸)"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
     6. [NEW_NEEDED] "바르토벤 외용액 8ml(에피나코나졸)"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
     7. [NEW_NEEDED] "베타베이트연고(클로베타솔프로피오네이트)15g"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
     8. [NEW_NEEDED] "삼아리도멕스크림(프레드니솔론발레로아세테이트)"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
     9. [NEW_NEEDED] "세파클리어"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
    10. [NEW_NEEDED] "스티렌"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
    11. [NEW_NEEDED] "에스로반연고(무피로신)10g"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
    12. [NEW_NEEDED] "오구멘토"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
    13. [NEW_NEEDED] "주블리아 외용액 8ml(에피나코나졸)"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
    14. [NEW_NEEDED] "주블리아외용액 4ml(에피나코나졸)"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
    15. [NEW_NEEDED] "터미졸크림(테르비나핀염산염)15g"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
    16. [NEW_NEEDED] "플루나코엠캡슐(플루코나졸)"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
    17. [NEW_NEEDED] "하이트리크림 20g"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
    18. [NEW_NEEDED] "한미유리아크림 200ml(우레아)20g"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)
    19. [NEW_NEEDED] "한미유리아크림 200ml(우레아)50g"
        code=——none—— | ASSIGN→'이관약' | 이름매칭 0 → 신규 prescription_codes 생성 (claim=RXMIG-*)

═══════════════════════════════════════════════════════════════
게이트 판단 입력:
  · prescription_codes INSERT  : 19건 (claim_code='RXMIG-<seq>')
  · prescription_folders INSERT: 1건 ('이관약')
  · prescription_code_folders INSERT: 19건
  · 묶음처방 탭/데이터/FE: 무변경 (이 마이그는 prescription_sets 를 읽기만 함)
  · posology(dosage/route/frequency/days/notes): 이관 안 함 (약 이름만)
═══════════════════════════════════════════════════════════════
```
