#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP — Step2 v3 (외부 심평원 HIRA 이름 완전일치 재검색)

방법 정본 = 티켓 §9.1 / §12 (reporter 문지은 대표원장 ②안 확정: 심평원 외부 DB 이름 기반 재검색).
- 내부 official 499건엔 이름 완전일치 0종(§11 FOLLOWUP-3) → 외부 심평원 의약품표준코드 master로 모집단 확장.
- 이름 완전일치(L1) 또는 상품명 코어 완전일치(L2_BRAND)만 '이름 매칭 성립'.
- ❌ 성분만 같고 이름 다른 약은 매칭 아님(v1 MANUAL 접근 폐기 유지).

★ READ-ONLY 분석 스크립트 — DB 쓰기 없음, 코드/DML 변경 없음. 매핑표 산출 전용.

────────────────────────────────────────────────────────────────────────────
소스 확정 (§12.3-1, READ-ONLY, 무키 공개 다운로드 — 외부 API 무단 연결 아님):
  [이름매칭 소스] 건강보험심사평가원_약가마스터_의약품표준코드 (data.go.kr 공개파일데이터)
    https://www.data.go.kr/data/15067462/fileData.do  (CSV / EUC-KR / 무로그인·무키 / 약 30.5만행 / 최종 2025-12-01)
    컬럼: 한글상품명, 업체명, 약품규격, ..., 품목기준코드(idx6), 대표코드(idx9), 표준코드(idx10), ...
    다운로드:
      curl -sL "https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=FILE_000000003550228&fileDetailSn=1&insertDataPrcus=N" -o /tmp/hira_drugmaster.csv
      (atchFileId 는 위 fileData 페이지에서 갱신될 수 있음 → 페이지 grep 'fileDownload.do?atchFileId=' 로 재취득)
  [급여/비급여·EDI 청구코드 소스] 약제급여목록및급여상한금액표 (복지부 고시 별표1, 월간 .xlsx 수동 다운로드)
    https://www.hira.or.kr/bbsDummy.do?pgmid=HIRAA030014050000  (무키, 단 JS 첨부 → 수동 다운로드)
    ※ 이 소스는 EDI 청구코드 ↔ prescription_codes.claim_code 로 매핑 — 기존 배치
       scripts/hira_insurance_sync.mjs (T-20260609-foot-HIRA-INSURANCE-BATCH) 가 canonical 경로.
    ※ 본 스크립트는 이름매칭만 수행(표준코드 master). 급여/비급여 분류는 위 xlsx 대조 단계(Step3 게이트)에서.
────────────────────────────────────────────────────────────────────────────
실행: python3 scripts/T-20260617-foot-RXSET-CUSTOM-DRUG-HIRA-MAP_hira_namematch_v3.py /tmp/hira_drugmaster.csv
"""
import sys, re, csv, json, unicodedata
from collections import defaultdict

NFC = lambda s: unicodedata.normalize('NFC', s)

# 처방세트 '자체' 19종 (prescription_codes.code_source='custom', claim_code=LEGACY-*)
CUSTOM = [
    ("LEGACY-015b55130567", "플루나코엠캡슐(플루코나졸)"),
    ("LEGACY-12d7730e32e8", "대웅푸루나졸정150mg(플루코나졸)"),
    ("LEGACY-1bb57c2e4782", "바르토벤 외용액 4ml(에피나코나졸)"),
    ("LEGACY-1edb55721d2f", "한미유리아크림 200ml(우레아)50g"),
    ("LEGACY-1f8b80f62fbb", "세파클리어"),
    ("LEGACY-2a0c89797bce", "스티렌"),
    ("LEGACY-2e28835bfc5f", "록소포펜"),
    ("LEGACY-3e7ce9b8f6fb", "터미졸크림(테르비나핀염산염)15g"),
    ("LEGACY-45744395cb7a", "한미유리아크림 200ml(우레아)20g"),
    ("LEGACY-5d19d9727ef4", "바르토벤 외용액 8ml(에피나코나졸)"),
    ("LEGACY-a7a1a9195c67", "베타베이트연고(클로베타솔프로피오네이트)15g"),
    ("LEGACY-a9078a1449c3", "하이트리크림 20g"),
    ("LEGACY-ba5c97dfb0b8", "에스로반연고(무피로신)10g"),
    ("LEGACY-ce36618a71d0", "주블리아외용액 4ml(에피나코나졸)"),
    ("LEGACY-d17507bd1967", "삼아리도멕스크림(프레드니솔론발레로아세테이트)"),
    ("LEGACY-e11452cf9200", "주블리아 외용액 8ml(에피나코나졸)"),
    ("LEGACY-e98e0cb79ec6", "루마졸크림"),
    ("LEGACY-f76313d45cc9", "닥터로반"),
    ("LEGACY-f859925fdba2", "오구멘토"),
]

DOSAGE = re.compile(r'\d+(\.\d+)?\s*(밀리그램|밀리리터|마이크로그램|그램|ml|mL|mg|g|％|%|iu|IU|단위|정|캡슐|매|포|병|관|튜브|cc)')
FORM = ['외용액', '점안액', '점이액', '크림', '연고', '로션', '시럽', '과립', '캡슐', '패취', '패치',
        '주사', '겔', '젤', '좌제', '분말', '정', '액', '산', '환', '주']

def norm(s):
    """성분괄호·[수출명]·용량토큰·공백 제거(중첩 괄호 반복 제거)."""
    s = NFC(s)
    while True:
        s2 = re.sub(r'\([^()]*\)', '', s)
        s2 = re.sub(r'\[[^\[\]]*\]', '', s2)
        if s2 == s:
            break
        s = s2
    s = re.sub(r'[()\[\]]', '', s)   # stray bracket
    s = DOSAGE.sub('', s)
    s = re.sub(r'\s+', '', s)
    return s

def brand(s):
    """norm 후 제형 접미어 1회 제거 → 상품명 코어."""
    n = norm(s)
    for f in sorted(FORM, key=len, reverse=True):
        if n.endswith(f):
            return n[:-len(f)]
    return n

def main(csv_path):
    by_norm = defaultdict(list)
    by_brand = defaultdict(list)
    with open(csv_path, encoding='cp949', errors='replace') as f:
        r = csv.reader(f)
        next(r)  # header
        for row in r:
            if not row or not row[0].strip():
                continue
            nm = NFC(row[0])
            rec = {
                'name': nm,
                'maker': row[1] if len(row) > 1 else '',
                'spec': row[2] if len(row) > 2 else '',
                'item_code': row[6].strip() if len(row) > 6 else '',   # 품목기준코드
                'rep_code': row[9].strip() if len(row) > 9 else '',    # 대표코드
                'std_code': row[10].strip() if len(row) > 10 else '',  # 표준코드(barcode)
            }
            by_norm[norm(nm)].append(rec)
            by_brand[brand(nm)].append(rec)

    def distinct(lst):
        seen = {}
        for h in lst:
            seen.setdefault(h['name'], h)
        return list(seen.values())

    results = []
    for code, raw in CUSTOM:
        cn, cb = norm(raw), brand(raw)
        L1 = distinct(by_norm.get(cn, []))
        L2 = [h for h in distinct(by_brand.get(cb, [])) if h['name'] not in {x['name'] for x in L1}] if cb else []
        status = 'L1_EXACT' if L1 else ('L2_BRAND' if L2 else 'NONE')
        results.append({'code': code, 'raw': raw, 'norm': cn, 'brand': cb, 'status': status,
                        'L1': L1, 'L2': L2})

    n1 = sum(1 for r in results if r['status'] == 'L1_EXACT')
    n2 = sum(1 for r in results if r['status'] == 'L2_BRAND')
    n0 = sum(1 for r in results if r['status'] == 'NONE')
    for r in results:
        cand = r['L1'] or r['L2']
        best = cand[0] if cand else None
        print(f"[{r['status']:9}] {r['raw']}  ({r['code']})")
        if best:
            extra = f"  (+{len(cand)-1} 후보)" if len(cand) > 1 else ""
            print(f"            → {best['name']} | 품목기준코드={best['item_code']} 대표코드={best['rep_code']}{extra}")
    print(f"\n=== SUMMARY: L1_EXACT={n1} / L2_BRAND={n2} / NONE={n0} / matched={n1+n2} (total {len(results)}) ===")
    return results

if __name__ == '__main__':
    path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/hira_drugmaster.csv'
    main(path)
