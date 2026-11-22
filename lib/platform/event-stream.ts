/** SSE is framed per event, never as one JSON document for the entire response. */
export const streamEvent = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

export async function* streamEvents(body: AsyncIterable<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    if (buffer.length > 1_000_000) throw Error("Stream frame too large");
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/u.exec(buffer))) {
      const frame = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      const lines = frame.split(/\r?\n/u);
      const event = lines.find(line => line.startsWith("event:"))?.slice(6).trim() ?? "message";
      const data = lines.filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      if (data && data !== "[DONE]") yield { event, data: JSON.parse(data) };
    }
  }
  buffer += decoder.decode();
  if (buffer.trim() && !buffer.trim().startsWith(":")) throw Error("Incomplete stream frame");
}
