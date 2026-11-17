import sharp from "sharp";
import { StudioError } from "./store";

export const MAX_UPLOAD_BYTES = 8_000_000;
let decoding = 0;

// Shared by upload and model-reference input; never hand SVG/PDF to libvips.
export async function normalizeUpload(bytes: Uint8Array, maxInputBytes: 8_000_000 | 12_000_000 = MAX_UPLOAD_BYTES) {
  if (!bytes.length || bytes.length > maxInputBytes) throw new StudioError(413, `이미지는 ${maxInputBytes / 1_000_000}MB 이하의 파일이어야 합니다.`);
  const b = Buffer.from(bytes);
  const format: "png" | "jpeg" | "webp" | undefined = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "png"
    : b[0] === 255 && b[1] === 216 && b[2] === 255 ? "jpeg"
    : b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" ? "webp" : undefined;
  if (!format) throw new StudioError(415, "PNG, JPEG, WebP 정지 이미지만 지원합니다.");
  // libvips may expose only the first frame of APNG; reject its animation chunk explicitly.
  if (format === "png") {
    for (let offset = 8; offset + 12 <= b.length;) {
      const length = b.readUInt32BE(offset), type = b.toString("ascii", offset + 4, offset + 8);
      if (length > b.length - offset - 12) break;
      if (type === "acTL") throw new StudioError(422, "움직이는 PNG는 지원하지 않습니다. 정지 이미지로 준비하세요.");
      if (type === "IEND") break;
      offset += length + 12;
    }
  }
  if (decoding >= 2) throw new StudioError(429, "다른 이미지 파일을 처리 중입니다. 잠시 후 다시 시도하세요.");
  decoding++;
  try {
    const decoder = sharp(b, { failOn: "warning", limitInputPixels: 16_000_000 }).timeout({ seconds: 10 });
    const meta = await decoder.metadata();
    if (meta.format !== format || (meta.pages ?? 1) !== 1 || !meta.width || !meta.height || meta.width > 4096 || meta.height > 4096 || meta.width * meta.height > 16_000_000)
      throw new StudioError(422, "정지 이미지 한 장만 가능합니다. 한 변 4,096px·전체 1,600만 화소 이하로 준비하세요.");
    // Full decode/re-encode strips metadata/trailing bytes without resizing or generative edits.
    const result = await decoder.autoOrient().png().toBuffer({ resolveWithObject: true });
    if (result.data.length > 12_000_000) throw new StudioError(413, "변환된 PNG가 12MB를 초과합니다. 작은 이미지로 다시 시도하세요.");
    return { png: result.data, format, width: result.info.width, height: result.info.height };
  } catch (error) {
    if (error instanceof StudioError) throw error;
    throw new StudioError(422, "이미지 파일을 안전하게 읽지 못했습니다. 손상되지 않은 정지 이미지로 다시 시도하세요.");
  } finally { decoding--; }
}

export async function prepareBedrockReference(bytes: Uint8Array) {
  const image = await normalizeUpload(bytes, 12_000_000);
  if (image.width < 64 || image.height < 64)
    throw new StudioError(422, "기준 이미지는 가로·세로 각각 64px 이상이어야 합니다. 더 큰 원본을 기준 이미지로 지정하세요. 모델은 호출하지 않았습니다.");
  return image.png;
}
