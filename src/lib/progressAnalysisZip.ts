/**
 * T-20260821-foot-PROGANALYSIS-EXTRACT-PHASE1
 * 무의존 ZIP(STORE, 무압축) 생성기 — 새 npm 패키지 추가 없이(§S2 금지) 브라우저에서 .md 여러 개를 zip 1개로 묶는다.
 *   · TXMEMO-3VISIT-MD-ZIP 계보 스크립트는 서버에서 `zip` CLI 를 썼으나, FE 에는 zip 라이브러리가 없어(deps 실측 NONE)
 *     STORE(무압축) ZIP 을 순수 JS 로 직접 조립. 무압축이라 경과분석 인풋 .md(텍스트) 용량엔 무해.
 *   · 파일명 UTF-8(한글 차트/이름) — general purpose flag bit 11(0x0800) 세팅.
 *   · read-only 산출물 반출 전용. DB/스키마 무접촉.
 */

/** CRC-32 (IEEE 802.3) 테이블 — ZIP local/central header 무결성 필드용. */
const CRC_TABLE: number[] = (() => {
  const table: number[] = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** zip 내부 파일명(확장자 포함, 예: "12345_홍길동.md"). */
  name: string;
  /** 파일 텍스트 내용(UTF-8 로 인코딩). */
  content: string;
}

/**
 * STORE(무압축) 방식으로 여러 텍스트 파일을 하나의 ZIP Blob 으로 조립.
 * @param entries 파일명·내용 목록
 * @returns application/zip Blob
 */
export function createStoreZip(entries: ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    // UTF-8 BOM 부착 → Windows 메모장 등에서 한글 인코딩 자동 인식(기존 txt 다운로드와 정합).
    const dataBytes = encoder.encode('﻿' + entry.content);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // ── Local file header (30바이트 + 파일명) ──
    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // flags: bit11 = UTF-8 파일명
    lv.setUint16(8, 0, true); // method 0 = STORE
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0, true); // mod date
    lv.setUint32(14, crc, true); // crc-32
    lv.setUint32(18, size, true); // compressed size (= uncompressed, STORE)
    lv.setUint32(22, size, true); // uncompressed size
    lv.setUint16(26, nameBytes.length, true); // filename length
    lv.setUint16(28, 0, true); // extra length
    local.set(nameBytes, 30);

    chunks.push(local, dataBytes);

    // ── Central directory header (46바이트 + 파일명) ──
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); // signature
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true); // flags: UTF-8
    cv.setUint16(10, 0, true); // method STORE
    cv.setUint16(12, 0, true); // mod time
    cv.setUint16(14, 0, true); // mod date
    cv.setUint32(16, crc, true); // crc-32
    cv.setUint32(20, size, true); // compressed size
    cv.setUint32(24, size, true); // uncompressed size
    cv.setUint16(28, nameBytes.length, true); // filename length
    cv.setUint16(30, 0, true); // extra length
    cv.setUint16(32, 0, true); // comment length
    cv.setUint16(34, 0, true); // disk number start
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // local header offset
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + dataBytes.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const centralOffset = offset;

  // ── End of central directory record (22바이트) ──
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // signature
  ev.setUint16(4, 0, true); // disk number
  ev.setUint16(6, 0, true); // disk with central dir
  ev.setUint16(8, entries.length, true); // entries on this disk
  ev.setUint16(10, entries.length, true); // total entries
  ev.setUint32(12, centralSize, true); // central dir size
  ev.setUint32(16, centralOffset, true); // central dir offset
  ev.setUint16(20, 0, true); // comment length

  return new Blob([...chunks, ...central, eocd], { type: 'application/zip' });
}

/** ZIP Blob 을 파일로 다운로드(무의존). */
export function downloadZip(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.zip') ? filename : `${filename}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
