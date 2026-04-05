function normalizeNewlines(text) {
  return (text || "").replace(/\r\n|\n\r|\r/g, "\n");
}

function parseChordPro(chordProText) {
  const lines = normalizeNewlines(chordProText).split("\n");
  const result = {
    title: null,
    subtitle: null,
    key: null,
    lines: []
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // {key:value} directives
    const m = line.match(/^\{\s*([^:}]+)\s*:\s*(.*)\}$/);
    if (m) {
      const key = m[1].trim().toLowerCase();
      const value = m[2].trim();

      if (key === "title" || key === "t") {
        result.title = value;
        continue;
      }
      if (key === "subtitle" || key === "st") {
        result.subtitle = value;
        continue;
      }
      if (key === "key") {
        result.key = value;
        continue;
      }
      if (key === "comment" || key === "c") {
        result.lines.push({ type: "comment", text: value });
        continue;
      }
      if (key === "comment_italic" || key === "ci") {
        result.lines.push({ type: "comment_italic", text: value });
        continue;
      }

      // ignore unsupported directives
      continue;
    }

    result.lines.push({ type: "text", text: line });
  }

  return result;
}

function isNoChordToken(token) {
  // N.C. / N.C / NC / N C をゆるく吸収
  const t = (token || "").replace(/\s+/g, "").toUpperCase();
  return t === "N.C." || t === "N.C" || t === "NC";
}

function createSpan(className, text) {
  const s = document.createElement("span");
  if (className) s.className = className;
  if (text != null) s.textContent = text;
  return s;
}

/**
 * ChordPro 1行を「セル列」に分解する
 * - 先頭の歌詞（コード無し）も 1セルにする
 * - [C] の直後〜次のコード直前までが同一セルの lyric
 * - コードは [] を外して chord に入れる
 */
function splitToCells(lineText) {
  const line = lineText || "";
  const regex = /\[[^\]]+\]/g;

  const cells = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(line)) !== null) {
    const chordToken = match[0];           // like "[F#m7]"
    const chordText = chordToken.slice(1, -1); // "F#m7"
    const leadingLyric = line.slice(lastIndex, match.index);

    // 先に「コード無し lyric」セルを必要なら追加
    if (leadingLyric !== "") {
      cells.push({ chord: "", lyric: leadingLyric });
    } else if (cells.length === 0) {
      // 行頭がコードの場合、位置を保持するために空セルを入れても良いが、
      // ChordWiki的には不要なので入れない
    }

    // chord セルは一旦 lyric を空で作り、後で次の lyric を入れる
    cells.push({ chord: chordText, lyric: "" });

    lastIndex = match.index + chordToken.length;
  }

  // trailing lyric
  const trailing = line.slice(lastIndex);
  if (cells.length === 0) {
    cells.push({ chord: "", lyric: trailing });
  } else if (trailing !== "") {
    // 直前が chord セルならそこに lyric を入れる
    const last = cells[cells.length - 1];
    if (last.lyric === "") last.lyric = trailing;
    else cells.push({ chord: "", lyric: trailing });
  }

  return cells;
}

/**
 * lyric 内の '|' を span 化して薄く表示（セルの lyric 内で処理）
 */
function appendLyricWithBars(targetSpan, lyricText) {
  const parts = (lyricText || "").split(/(\|)/);
  for (const p of parts) {
    if (p === "|") {
      targetSpan.appendChild(createSpan("cw-bar", "|"));
    } else if (p !== "") {
      targetSpan.appendChild(document.createTextNode(p));
    }
  }
}

function renderChordWikiLike(chordProText, containerEl) {
  containerEl.innerHTML = "";
  const parsed = parseChordPro(chordProText || "");

  for (const line of parsed.lines) {
    // comment / ci: comment line block
    if (line.type === "comment" || line.type === "comment_italic") {
      const lineEl = document.createElement("div");
      lineEl.className = "cw-line cw-comment-line";

      const label = createSpan("cw-comment", "");
      if (line.type === "comment_italic") label.classList.add("cw-ci");

      // 背景は文字幅だけにするため span に入れる
      label.textContent = line.text;

      lineEl.appendChild(label);
      containerEl.appendChild(lineEl);
      continue;
    }

    // normal text line
    const lineEl = document.createElement("div");
    lineEl.className = "cw-line";

    const cells = splitToCells(line.text);

    for (const cell of cells) {
      const cellEl = document.createElement("span");
      cellEl.className = "cw-cell";

      // chord (top row)
      const chordEl = document.createElement("span");
      chordEl.className = "cw-chord";
      if (cell.chord && isNoChordToken(cell.chord)) {
        chordEl.classList.add("cw-nc");
        chordEl.textContent = "N.C.";
      } else {
        chordEl.textContent = cell.chord || "";
      }

      // lyric (bottom row)
      const wordEl = document.createElement("span");
      wordEl.className = "cw-word";
      appendLyricWithBars(wordEl, cell.lyric || "");

      cellEl.appendChild(chordEl);
      cellEl.appendChild(wordEl);
      lineEl.appendChild(cellEl);
    }

    containerEl.appendChild(lineEl);
  }

  return {
    title: parsed.title,
    subtitle: parsed.subtitle,
    key: parsed.key
  };
}