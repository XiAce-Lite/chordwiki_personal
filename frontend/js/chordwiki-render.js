function normalizeNewlines(text) {
  return (text || '').replace(/\r\n|\n\r|\r/g, '\n');
}

function parseChordPro(chordProText) {
  const lines = normalizeNewlines(chordProText).split('\n');
  const result = {
    title: null,
    subtitle: null,
    lines: []
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const directiveMatch = line.match(/^\{\s*([^:}]+)\s*:\s*(.*)\}$/);

    if (directiveMatch) {
      const key = directiveMatch[1].trim().toLowerCase();
      const value = directiveMatch[2].trim();

      if (key === 'title' || key === 't') {
        result.title = value;
        continue;
      }
      if (key === 'subtitle' || key === 'st') {
        result.subtitle = value;
        continue;
      }
      if (key === 'comment' || key === 'c') {
        result.lines.push({ type: 'comment', text: value });
        continue;
      }

      // 未対応ディレクティブは無視
      continue;
    }

    result.lines.push({ type: 'text', text: line });
  }

  return result;
}

function splitLineSegments(line) {
  const regex = /\[[^\]]+\]/g;
  const segments = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(line)) !== null) {
    const leadingText = line.slice(lastIndex, match.index);

    if (segments.length === 0) {
      if (leadingText !== '') {
        segments.push({ chord: '', lyric: leadingText });
      }
    } else {
      const prev = segments[segments.length - 1];
      if (prev.lyric === '') {
        prev.lyric = leadingText;
      } else if (leadingText !== '') {
        segments.push({ chord: '', lyric: leadingText });
      }
    }

    // 表示では [] を外してコード名だけにする
    segments.push({ chord: match[0].slice(1, -1), lyric: '' });
    lastIndex = match.index + match[0].length;
  }

  const trailingText = line.slice(lastIndex);

  if (segments.length === 0) {
    segments.push({ chord: '', lyric: trailingText });
  } else if (trailingText !== '') {
    const prev = segments[segments.length - 1];
    if (prev.lyric === '') {
      prev.lyric = trailingText;
    } else {
      segments.push({ chord: '', lyric: trailingText });
    }
  }

  return segments;
}

function createPre(className, text) {
  const pre = document.createElement('pre');
  pre.className = className;
  pre.textContent = text || '';
  return pre;
}

function setPreWithBars(pre, text) {
  // pre は white-space: pre でスペース保持
  pre.textContent = '';

  // '|' を保持しつつ分割（キャプチャ付き）
  const parts = (text || '').split(/(\|)/);

  for (const p of parts) {
    if (p === '|') {
      const span = document.createElement('span');
      span.className = 'cw-bar';
      span.textContent = '|';
      pre.appendChild(span);
    } else if (p !== '') {
      // それ以外はそのままテキストノードでOK（スペース含む）
      pre.appendChild(document.createTextNode(p));
    }
  }
}

function renderChordWikiLike(chordProText, containerEl) {
  containerEl.innerHTML = '';
  const parsed = parseChordPro(chordProText || '');

  for (const line of parsed.lines) {
    const lineEl = document.createElement('div');
    lineEl.className = 'cw-line';

    const chordsPre = createPre('cw-chords', '');
    const lyricsPre = createPre('cw-lyrics', '');

    if (line.type === 'comment') {
      // コメントはグレー＆イタリック用クラスを付与
      lineEl.classList.add('cw-comment-line');
      lyricsPre.classList.add('cw-comment');
      lyricsPre.textContent = line.text;
    } else {
      const segments = splitLineSegments(line.text);
      const chordParts = [];
      const lyricParts = [];

      // 重要：配列を埋めてから最後に描画する
      for (const segment of segments) {
        const width = Math.max(segment.chord.length, segment.lyric.length);
        chordParts.push(segment.chord.padEnd(width, ' '));
        lyricParts.push(segment.lyric.padEnd(width, ' '));
      }

      setPreWithBars(chordsPre, chordParts.join(''));
      setPreWithBars(lyricsPre, lyricParts.join(''));
    }

    lineEl.appendChild(chordsPre);
    lineEl.appendChild(lyricsPre);
    containerEl.appendChild(lineEl);
  }

  return {
    title: parsed.title,
    subtitle: parsed.subtitle
  };
}