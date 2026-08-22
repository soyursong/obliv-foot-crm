/**
 * T-20260822-foot-PROGANALYSIS-RESULT-UPLOAD-LINK (AC-1)
 * 무의존 ZIP **해제**기 — 새 npm 추가 없이(risk#5·§S2 금지) 브라우저에서 .zip → 내부 PNG 추출.
 *   · 압축(STORE) 생성은 progressAnalysisZip.createStoreZip 이 담당(반출). 본 파일은 그 역(반입/해제).
 *   · STORE(method 0) = 그대로. DEFLATE(method 8) = 브라우저 네이티브 DecompressionStream('deflate-raw') 인플레이트.
 *   · Central Directory 기반 파싱(data descriptor 안전). UTF-8 파일명(flag bit11) — 한글 차트/이름.
 *   · read-only 해제. DB/스키마 무접촉.
 */

import { RESULT_IMG_EXT, resultFileExt } from './progressResultFilename';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;

export interface UnzippedFile {
  name: string; // 내부 파일명(경로 제거된 basename)
  blob: Blob;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  // 브라우저 네이티브(무의존). deflate-raw = zip 내부 method 8.
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** 파일명 basename(zip 내부 경로 slash 제거). */
function baseName(p: string): string {
  const s = p.replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

/**
 * ZIP Blob → 내부 **이미지 파일만** 추출(png/jpg/jpeg/webp). 디렉토리·기타 파일·__MACOSX 무시.
 * fail-soft: 개별 엔트리 해제 실패는 건너뛰고 계속(전체 실패로 번지지 않음).
 */
export async function unzipImages(zipBlob: Blob): Promise<UnzippedFile[]> {
  const dv = new DataView(await zipBlob.arrayBuffer());
  const len = dv.byteLength;

  // ── EOCD 탐색(뒤에서부터, 코멘트 최대 65535 + 22). ──
  let eocd = -1;
  const minPos = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= minPos; i--) {
    if (dv.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('올바른 ZIP 파일이 아닙니다(EOCD 없음).');

  const total = dv.getUint16(eocd + 10, true);
  let cdOffset = dv.getUint32(eocd + 16, true);

  const out: UnzippedFile[] = [];
  for (let n = 0; n < total; n++) {
    if (cdOffset + 46 > len || dv.getUint32(cdOffset, true) !== SIG_CENTRAL) break;
    const method = dv.getUint16(cdOffset + 10, true);
    const flags = dv.getUint16(cdOffset + 8, true);
    const compSize = dv.getUint32(cdOffset + 20, true);
    const nameLen = dv.getUint16(cdOffset + 28, true);
    const extraLen = dv.getUint16(cdOffset + 30, true);
    const commentLen = dv.getUint16(cdOffset + 32, true);
    const localOffset = dv.getUint32(cdOffset + 42, true);

    const nameBytes = new Uint8Array(dv.buffer, cdOffset + 46, nameLen);
    // flag bit11 = UTF-8. 미설정 zip(구 Windows CP949)은 UTF-8 decode 시 깨질 수 있음 → 파일명 검증이 fail-closed(보류) 처리.
    const rawName = new TextDecoder(flags & 0x0800 ? 'utf-8' : 'utf-8').decode(nameBytes);
    const entryName = baseName(rawName);

    cdOffset += 46 + nameLen + extraLen + commentLen;

    // 디렉토리·__MACOSX·이미지 아닌 것 skip.
    if (rawName.endsWith('/') || rawName.startsWith('__MACOSX') || entryName.startsWith('.')) continue;
    if (!RESULT_IMG_EXT.has(resultFileExt(entryName))) continue;

    try {
      // Local header: 30 + localNameLen + localExtraLen 뒤가 데이터.
      if (dv.getUint32(localOffset, true) !== 0x04034b50) continue;
      const lNameLen = dv.getUint16(localOffset + 26, true);
      const lExtraLen = dv.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const comp = new Uint8Array(dv.buffer, dataStart, compSize);

      let data: Uint8Array;
      if (method === 0) {
        data = comp.slice();
      } else if (method === 8) {
        data = await inflateRaw(comp.slice());
      } else {
        continue; // 미지원 압축(bzip2 등) — skip.
      }
      out.push({ name: entryName, blob: new Blob([data]) });
    } catch {
      continue; // 개별 엔트리 실패 = skip(fail-soft).
    }
  }
  return out;
}

/** File 이 zip 인지(확장자/타입). */
export function isZipFile(f: File): boolean {
  return (
    resultFileExt(f.name) === 'zip' ||
    f.type === 'application/zip' ||
    f.type === 'application/x-zip-compressed'
  );
}
