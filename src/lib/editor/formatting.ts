export function toggleFormat(
  text: string,
  start: number,
  end: number,
  marker: string
) {
  const size = marker.length;
  if (
    start >= size &&
    text.slice(start - size, start) === marker &&
    text.slice(end, end + size) === marker
  ) {
    return {
      text:
        text.slice(0, start - size) +
        text.slice(start, end) +
        text.slice(end + size),
      start: start - size,
      end: end - size,
    };
  }
  const selected = text.slice(start, end);
  if (
    selected.length >= size * 2 &&
    selected.startsWith(marker) &&
    selected.endsWith(marker)
  ) {
    return {
      text:
        text.slice(0, start) + selected.slice(size, -size) + text.slice(end),
      start,
      end: end - size * 2,
    };
  }
  return {
    text: text.slice(0, start) + marker + selected + marker + text.slice(end),
    start: start + size,
    end: end + size,
  };
}

/** Convert clipboard markup without inserting clipboard HTML into the page. */
export function clipboardText(data: Pick<DataTransfer, 'getData'>): string {
  const plain = data.getData('text/plain');
  const html = data.getData('text/html');
  if (!html) return plain;
  const document = new DOMParser().parseFromString(html, 'text/html');
  function read(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (!(node instanceof HTMLElement)) return '';
    if (['SCRIPT', 'STYLE', 'META', 'LINK'].includes(node.tagName)) return '';
    if (node.tagName === 'BR') return '\n';
    let value = Array.from(node.childNodes).map(read).join('');
    const style = node.style;
    const markers = [
      (['B', 'STRONG'].includes(node.tagName) ||
        Number(style.fontWeight) >= 600 ||
        style.fontWeight === 'bold') &&
        '*',
      (['I', 'EM'].includes(node.tagName) || style.fontStyle === 'italic') &&
        '_',
      (['S', 'STRIKE', 'DEL'].includes(node.tagName) ||
        style.textDecoration.includes('line-through')) &&
        '~',
      ['CODE', 'PRE'].includes(node.tagName) && '```',
    ].filter(Boolean) as string[];
    for (const marker of markers)
      if (value && !(value.startsWith(marker) && value.endsWith(marker)))
        value = marker + value + marker;
    if (['P', 'DIV', 'LI'].includes(node.tagName)) value += '\n';
    return value;
  }
  const result = Array.from(document.body.childNodes)
    .map(read)
    .join('')
    .replace(/\n+$/, '');
  return result || plain;
}

export function selectionPosition(editor: HTMLTextAreaElement) {
  const mirror = document.createElement('div');
  const style = getComputedStyle(editor);
  for (const key of [
    'font',
    'letterSpacing',
    'lineHeight',
    'padding',
    'border',
    'boxSizing',
    'wordSpacing',
    'tabSize',
  ] as const)
    mirror.style[key] = style[key];
  Object.assign(mirror.style, {
    position: 'fixed',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
    width: `${editor.clientWidth}px`,
    left: '0',
    top: '0',
  });
  mirror.textContent = editor.value.slice(0, editor.selectionStart);
  const span = document.createElement('span');
  span.textContent =
    editor.value.slice(editor.selectionStart, editor.selectionEnd) || '.';
  mirror.append(span);
  document.body.append(mirror);
  const bounds = editor.getBoundingClientRect();
  const selected = span.getClientRects()[0] ?? span.getBoundingClientRect();
  const position = {
    left: Math.max(
      8,
      Math.min(
        window.innerWidth - 200,
        bounds.left + selected.left - editor.scrollLeft
      )
    ),
    top: Math.max(8, bounds.top + selected.top - editor.scrollTop - 48),
  };
  mirror.remove();
  return position;
}
