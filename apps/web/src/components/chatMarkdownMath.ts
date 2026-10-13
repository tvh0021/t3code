function looksLikeMath(content: string): boolean {
  if (!content || !content.trim()) return false;
  if (content.includes("\n")) return false;
  // Contains LaTeX commands e.g. \frac, \alpha, \Delta, \sum (supports single or escaped slashes)
  if (/\\{1,2}[a-zA-Z]+/.test(content)) return true;
  // Contains math operators or sub/superscripts
  if (/[=^_<>]|\b(?:cos|sin|tan|log|ln|det|lim)\b/.test(content)) return true;
  // Single variable / identifier like x, y, n, or x_1, or dt
  if (/^[a-zA-Z](?:_[a-zA-Z0-9]+)?$/.test(content.trim())) return true;
  return false;
}

/**
 * Preprocesses markdown text for LaTeX math rendering:
 * 1. Converts display math \\[ ... \\] to $$ ... $$
 * 2. Converts inline math \\( ... \\) to $$ ... $$
 * 3. Converts single-dollar math $ ... $ to $$ ... $$ if the content looks like math,
 *    avoiding collision with currency amounts ($20k, $10) and skill mentions ($2spec).
 *    Supports markdown formatting wrappers (**$...$**, *$...$*) and table cells (| $...$ |).
 * Code blocks and inline code are preserved verbatim.
 */
export function preprocessMarkdownMath(text: string): string {
  if (!text.includes("$") && !text.includes("\\(") && !text.includes("\\[")) return text;

  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return parts
    .map((part, index) => {
      if (index % 2 === 1) return part;

      let res = part;
      // 1. Display math: \\[ ... \\] -> $$ ... $$
      res = res.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `\n\n$$\n${inner.trim()}\n$$\n\n`);
      // 2. Inline math: \\( ... \\) -> $$ ... $$
      res = res.replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => `$$${inner}$$`);
      // 3. Single-dollar inline math: $...$ -> $$...$$ if it looks like math
      res = res.replace(
        /(^|[\s([{|\*_~—–-])\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?=[\s.,!?;:)\]}|\*_~—–-]|[\s|]|$)/g,
        (match, prefix, content) => {
          if (looksLikeMath(content)) {
            return `${prefix}$$${content}$$`;
          }
          return match;
        },
      );
      return res;
    })
    .join("");
}
