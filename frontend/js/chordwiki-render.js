function normalizeNewlines(text) {
  return (text || '').replace(/\r\n|\n\r|\r/g, '\n');
}

function parseChordPro(chordProText) {
  const lines = normalizeNewlines(chordProText).split('\n');
  const result = {
    title: null,
    subtitle: null,
    key: null,
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
      if (key === 'key') {
        result.key = value;
        continue;
      }
      if (key === 'comment' || key === 'c') {
        result.lines.push({ type: 'comment', text: value });
        continue;
      }
      if (key === 'comment_italic' || key === 'ci') {
        result.lines.push({ type: 'comment_italic', text: value });
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

function createPre(className) {
  const pre = document.createElement('pre');
  pre.className = className;
  return pre;
}

function isNoChordToken(token) {
  // N.C. / N.C / NC / N C などにゆるく対応（大文字小文字も吸収）
  const t = (token || '').replace(/\s+/g, '').toUpperCase();
  return t === 'N.C.' || t === 'N.C' || t === 'NC';
}

function appendText(pre, text) {
  if (!text) return;
  pre.appendChild(document.createTextNode(text));
}

/**
 * pre にテキストを流し込みつつ、
 * - '|' を <span class="cw-bar"> にする（両方の行でOK）
 * - コード行の場合のみ N.C. を <span class="cw-nc"> にする
 */
function setPreWithDecor(pre, text, isChordLine) {
  pre.textContent = '';

  // まず '|' を保持しつつ分割
  const parts = (text || '').split(/(\|)/);

  for (const p of parts) {
    if (p === '|') {
      const span = document.createElement('span');
      span.className = 'cw-bar';
      span.textContent = '|';
      pre.appendChild(span);
      continue;
    }

    if (!p) continue;

    // 歌詞行はそのまま流し込み（N.C. の特別扱いはしない）
    if (!isChordLine) {
      appendText(pre, p);
      continue;
    }

    // コード行だけ N.C. を検出して span 化
    // N.C. は単独で入るケースが多いが、念のため文中も検出する
    // ここは「トークンとして N.C. が現れたら装飾」の方針
    const ncRegex = /\bN\s*\.?\s*C\s*\.?\b/gi;
    let last = 0;
    let m;

    while ((m = ncRegex.exec(p)) !== null) {
      const before = p.slice(last, m.index);
      appendText(pre, before);

      const raw = m[0];
      // トークン判定に通るものだけ cw-nc にする
      if (isNoChordToken(raw)) {
        const span = document.createElement('span');
        span.className = 'cw-nc';
        span.textContent = 'N.C.';
        pre.appendChild(span);
      } else {
        // 判定外はそのまま
        appendText(pre, raw);
      }

      last = m.index + raw.length;
    }

    appendText(pre, p.slice(last));
  }
}

function renderChordWikiLike(chordProText, containerEl) {
  containerEl.innerHTML = '';
  const parsed = parseChordPro(chordProText || '');

  for (const line of parsed.lines) {
    const lineEl = document.createElement('div');
    lineEl.className = 'cw-line';

    const chordsPre = createPre('cw-chords');
    const lyricsPre = createPre('cw-lyrics');

    if (line.type === 'comment') {
      lyricsPre.classList.add('cw-comment');
      lyricsPre.textContent = line.text;
    } else if (line.type === 'comment_italic') {
      lyricsPre.classList.add('cw-comment', 'cw-ci');
      lyricsPre.textContent = line.text;
    } else {
      const segments = splitLineSegments(line.text);
      const chordParts = [];
      const lyricParts = [];

      for (const seg of segments) {
        const w = Math.max(seg.chord.length, seg.lyric.length);
        chordParts.push(seg.chord.padEnd(w, ' '));
        lyricParts.push(seg.lyric.padEnd(w, ' '));
      }

      setPreWithDecor(chordsPre, chordParts.join(''), true);
      setPreWithDecor(lyricsPre, lyricParts.join(''), false);
    }

    lineEl.appendChild(chordsPre);
    lineEl.appendChild(lyricsPre);
    containerEl.appendChild(lineEl);
  }

  return {
    title: parsed.title,
    subtitle: parsed.subtitle,
    key: parsed.key
  };
}