/** Bedrock's native strict tool grammar supports a JSON Schema subset.
 * Generation-only bounds become hints; the original Zod schema still validates
 * every response before any proposal can be reviewed/applied. */
export function strictToolSchema(raw: unknown): Record<string, unknown> {
  const hints = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "maxItems", "uniqueItems", "default"]);
  function visit(value: unknown, depth: number): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value) || depth > 80) throw new Error("Unsupported strict tool schema structure");
    const source = value as Record<string, unknown>, result: Record<string, unknown> = {}, constraints: string[] = [];
    for (const [key, item] of Object.entries(source)) {
      if (key === "$schema") continue;
      if (hints.has(key) || key === "minItems" && item !== 0 && item !== 1) { constraints.push(`${key}=${JSON.stringify(item)}`); continue; }
      if (["properties", "$defs", "definitions"].includes(key)) {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid strict tool schema map");
        result[key] = Object.fromEntries(Object.entries(item).map(([name, schema]) => [name, visit(schema, depth + 1)]));
      } else if (key === "oneOf") {
        if (!Array.isArray(item) || !item.length) throw new Error("Invalid strict tool schema union");
        const branches = item as Array<{ properties?: Record<string, { const?: unknown }> }>;
        const disjoint = Object.keys(branches[0].properties ?? {}).some(name => {
          const values = branches.map(branch => branch.properties?.[name]?.const);
          return values.every(value => value !== undefined) && new Set(values.map(value => JSON.stringify(value))).size === branches.length;
        });
        // Zod discriminated unions emit oneOf. Distinct literal tags make
        // anyOf equivalent; arbitrary overlapping oneOf must not be weakened.
        if (!disjoint) throw new Error("Strict tool union requires distinct literal tags");
        result.anyOf = item.map(schema => visit(schema, depth + 1));
      } else if (["anyOf", "allOf"].includes(key)) {
        if (!Array.isArray(item)) throw new Error("Invalid strict tool schema union");
        result[key] = item.map(schema => visit(schema, depth + 1));
      } else if (key === "items") result[key] = visit(item, depth + 1);
      else if (key === "$ref") {
        if (typeof item !== "string" || !/^#\/(?:\$defs|definitions)\//.test(item)) throw new Error("External strict tool schema references are forbidden");
        result[key] = item;
      } else if (key === "additionalProperties") {
        if (item !== false) throw new Error("Open strict tool schema objects are forbidden");
        result[key] = false;
      } else if (["type", "enum", "const", "required", "format", "minItems", "description", "title"].includes(key)) result[key] = structuredClone(item);
      else throw new Error("Unsupported strict tool schema keyword");
    }
    if (source.type === "object" && source.additionalProperties !== false) throw new Error("Strict tool objects must reject unknown fields");
    if (constraints.length) result.description = [result.description, `Application validation: ${constraints.join("; ")}`].filter(Boolean).join(". ");
    return result;
  }
  return visit(raw, 0);
}
