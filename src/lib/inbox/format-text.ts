// ============================================================
// WhatsApp-style text formatting for the inbox:
//   *bold*  _italic_  ~strike~  `code`  ```code block```  + links
//
// Pure (no React) so it can be tested; the renderer is
// components/inbox/formatted-text.tsx.
// ============================================================

export type FormatNode =
  | string
  | { type: 'bold' | 'italic' | 'strike' | 'code'; children: FormatNode[] }
  | { type: 'codeblock'; text: string }
  | { type: 'link'; url: string };

const MARKS: Record<string, 'bold' | 'italic' | 'strike' | 'code'> = {
  '*': 'bold',
  _: 'italic',
  '~': 'strike',
  '`': 'code',
};

const URL_RE = /https?:\/\/[^\s<>]+/gi;
const TRAILING_PUNCT = /[.,;:!?)\]}'"*_~`]+$/;
// Private-use characters stand in for URLs while formatting is parsed, so
// underscores or asterisks inside a link are never read as markers.
const PLACEHOLDER = (i: number) => `${i}`;
const WORD_CHAR = /[\p{L}\p{N}]/u;

function opensSpan(s: string, i: number): boolean {
  const prev = s[i - 1];
  const next = s[i + 1];
  if (prev !== undefined && WORD_CHAR.test(prev)) return false;
  return next !== undefined && !/\s/.test(next) && next !== s[i];
}

function findClose(s: string, i: number): number {
  const mark = s[i];
  for (let j = i + 2; j < s.length; j++) {
    if (s[j] === '\n') return -1;
    if (s[j] !== mark || /\s/.test(s[j - 1])) continue;
    const after = s[j + 1];
    if (after === undefined || !WORD_CHAR.test(after)) return j;
  }
  return -1;
}

function parseInline(s: string): FormatNode[] {
  const out: FormatNode[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) out.push(buf);
    buf = '';
  };

  while (i < s.length) {
    const type = MARKS[s[i]];
    if (type && opensSpan(s, i)) {
      const j = findClose(s, i);
      if (j > -1) {
        flush();
        const inner = s.slice(i + 1, j);
        out.push({
          type,
          children: type === 'code' ? [inner] : parseInline(inner),
        });
        i = j + 1;
        continue;
      }
    }
    buf += s[i++];
  }
  flush();
  return out;
}

/** Swap placeholders for link nodes (or the raw URL text inside code). */
function restoreUrls(nodes: FormatNode[], urls: string[], inCode = false): FormatNode[] {
  const out: FormatNode[] = [];
  for (const node of nodes) {
    if (typeof node !== 'string') {
      if (node.type === 'link' || node.type === 'codeblock') {
        out.push(node);
      } else {
        out.push({
          ...node,
          children: restoreUrls(node.children, urls, inCode || node.type === 'code'),
        });
      }
      continue;
    }
    node.split(/(\d+)/).forEach((part, idx) => {
      if (idx % 2 === 0) {
        if (part) out.push(part);
      } else {
        const url = urls[Number(part)];
        out.push(inCode ? url : { type: 'link', url });
      }
    });
  }
  return out;
}

export function parseFormatting(text: string): FormatNode[] {
  const out: FormatNode[] = [];
  const blockRe = /```([\s\S]+?)```/g;
  let last = 0;

  const pushPlain = (chunk: string) => {
    if (!chunk) return;
    const urls: string[] = [];
    const masked = chunk.replace(URL_RE, (match) => {
      const trimmed = match.replace(TRAILING_PUNCT, '');
      const tail = match.slice(trimmed.length);
      urls.push(trimmed);
      return PLACEHOLDER(urls.length - 1) + tail;
    });
    out.push(...restoreUrls(parseInline(masked), urls));
  };

  for (const m of text.matchAll(blockRe)) {
    pushPlain(text.slice(last, m.index));
    out.push({ type: 'codeblock', text: m[1].replace(/^\n|\n$/g, '') });
    last = m.index + m[0].length;
  }
  pushPlain(text.slice(last));
  return out;
}
