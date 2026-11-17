export type StoryBeat = { kind: "speech" | "action" | "scene"; text: string };

export const narrationPolicy =
  "응답의 text를 읽는 소설처럼 구성한다. 자연스러울 때 [행동] 표기 뒤에 캐릭터 자신의 표정·몸짓·말하지 않은 반응을 짧게 쓰고, [대사] 표기 뒤에 캐릭터의 직접 대사를 쓴다. 필요한 경우에만 [장면] 표기를 붙여 현재 확정된 장소의 분위기나 감각을 한 문단 묘사한다. 표기는 각 줄의 첫머리에 두고 서로 다른 문단 사이에는 빈 줄을 둔다. 짧은 질문에는 억지로 모두 넣지 말고 실제 대답을 우선한다. 사용자의 말·행동·감정은 대신 정하거나 확정하지 않는다. 다음 장면 이동이나 엔딩을 임의로 일으키지 않는다.";

export const lunaNarrationPolicy = [
  "GPT-6 Luna의 story_result 연출 규칙: text에는 캐릭터의 대사 한두 문장, actionBeat에는 캐릭터의 몸짓이나 반응 한 문장을 쓴다. 짧게 답해 달라는 요청에도 actionBeat는 비우지 않는다.",
  "sceneBeat가 필수인 호출에서는 확정된 현재 장면을 한 문장으로 묘사한다. 선택 항목이면 scene.opening과 공개된 사실에서 새로 주목할 단서가 있거나 장소가 바뀌었을 때만 쓴다. 장면 정보가 없거나 같은 묘사를 반복하게 되면 생략한다.",
  "각 항목에는 표기 없이 문장만 넣는다. 들어맞는 예: sceneBeat는 '창가에 접힌 지도가 놓여 있다.', actionBeat는 '안내인이 지도 쪽으로 고개를 돌린다.', text는 '제가 확인한 건 여기까지예요.' 예시 내용이나 장소를 복사하지 않는다.",
  "새 사건, 플레이어의 행동, 미확인 정보는 만들어내지 않는다. 인물의 말투를 유지하고, 상황이 바뀌어도 작품의 금기와 플레이어의 결정권을 무시하지 않는다.",
].join(" ");

// Convert provider-only fields into the canonical saved dialogue format.
// Keep speech if the provider sends a usable turn but misses a narration beat.
export function assembleLunaBeats(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const { text, actionBeat, sceneBeat, ...rest } = raw as Record<string, unknown>;
  if (typeof text !== "string" || !text.trim()) return { ...rest, text };
  const body = (value: unknown) => typeof value === "string"
    ? value.trim().replace(/^\[(?:대사|행동|장면|묘사)\]\s*/u, "").trim() : "";
  const scene = body(sceneBeat), action = body(actionBeat);
  if (!scene && !action) return { ...rest, text };
  return { ...rest, text: [scene && `[장면] ${scene}`, action && `[행동] ${action}`, `[대사] ${body(text) || text}`].filter(Boolean).join("\n\n") };
}

/** The saved message remains verbatim for memory evidence. These markers are
 * presentation text only; they can never execute tools or change story state. */
export function storyBeats(text: string): StoryBeat[] {
  const result: StoryBeat[] = [];
  const labels = { "대사": "speech", "행동": "action", "장면": "scene", "묘사": "scene" } as const;
  // Some models escape the layout separator in the text field itself. Decode
  // it only at our authored marker boundaries, never in stored dialogue.
  const renderedText = text.replace(/(?:\\{1,2}n)+(?=\s*\[(?:대사|행동|장면|묘사)\])/gu, "\n\n");
  for (const paragraph of renderedText.split(/\n{2,}|\n(?=\s*\[(?:대사|행동|장면|묘사)\])/u)) {
    const value = paragraph.trim();
    if (!value) continue;
    if (/^\[(?:대사|행동|장면|묘사)\]/u.test(value)) {
      // Models sometimes put the next marker on the same line.
      for (const part of value.split(/\s+(?=\[(?:대사|행동|장면|묘사)\])/u)) {
        const tagged = /^\[(대사|행동|장면|묘사)\]\s*([\s\S]*)$/u.exec(part);
        if (tagged?.[2].trim()) result.push({ kind: labels[tagged[1] as keyof typeof labels], text: tagged[2].trim() });
      }
      continue;
    }
    // Legacy role-play convention: one entire lightly emphasized paragraph.
    const stage = /^\*([^*][\s\S]*?)\*$/u.exec(value);
    if (stage && !stage[1].includes("*")) result.push({ kind: "action", text: stage[1] });
    else result.push({ kind: "speech", text: value });
  }
  return result.length ? result : [{ kind: "speech", text }];
}

export function hasSceneDialogue(text: string) {
  if (/^(?:\s*[`{]|\s*(?:analysis|reasoning|thought|추론|생각 과정)\s*[:：])|<\/?(?:think|analysis)>|<\|/iu.test(text)) return false;
  return storyBeats(text).some(beat => beat.kind === "speech"
    && /\p{L}/u.test(beat.text.replace(/\[[^\]\n]+\]/gu, "")));
}

/** Only the explicit single-star role-play convention formats the player's words. */
export function playerStoryParts(text: string): StoryBeat[] {
  const parts: StoryBeat[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/gu)) {
    if (!match[1].trim()) continue;
    if (match.index > cursor) parts.push({ kind: "speech", text: text.slice(cursor, match.index) });
    parts.push({ kind: "action", text: match[1] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ kind: "speech", text: text.slice(cursor) });
  return parts;
}
