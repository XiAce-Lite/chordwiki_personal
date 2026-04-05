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

function setPreWithBars(pre, text) {
  pre.textContent = '';
  const parts = (text || '').split(/(\|)/);

  for (const p of parts) {
    if (p === '|') {
      const span = document.createElement('span');
      span.className = 'cw-bar';
      span.textContent = '|';
      pre.appendChild(span);
    } else if (p !== '') {
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

      setPreWithBars(chordsPre, chordParts.join(''));
      setPreWithBars(lyricsPre, lyricParts.join(''));
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