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
      continue;
    }

    result.lines.push({ type: "text", text: line });
  }

  return result;
}

function isNoChordToken(token) {
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
 * ✅ 正しいセル分割：
 * - 行頭から最初のコードまでは「先頭セル(コード無し)の lyric」
 * - [C] を見つけたら「新しい chord セル」を開始
 * - 次のコードまでのテキストは「その chord セルの lyric」に入る
 * これで chord と “直後の歌詞” が必ず同一セルになり同期が取れる
 */
function splitToCells(lineText) {
  const line = lineText || "";
  const regex = /\[[^\]]+\]/g;

  // 先頭セル（コード無し）を必ず用意して、そこに先頭の歌詞を溜める
  const cells = [{ chord: "", lyric: "" }];

  let lastIndex = 0;
  let match;

  while ((match = regex.exec(line)) !== null) {
    // 今のコードの直前までの歌詞を「直前セル」に追記
    const between = line.slice(lastIndex, match.index);
    cells[cells.length - 1].lyric += between;

    // コードセル開始
    const chordText = match[0].slice(1, -1); // []除去
    cells.push({ chord: chordText, lyric: "" });

    lastIndex = match.index + match[0].length;
  }

  // 最後の残り歌詞を直前セルに追記
  cells[cells.length - 1].lyric += line.slice(lastIndex);

  // 末尾に空のセルが増えるのを防ぐ（完全空セルだけ削除）
  return cells.filter(c => !(c.chord === "" && c.lyric === ""));
}

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
    if (line.type === "comment" || line.type === "comment_italic") {
      const lineEl = document.createElement("div");
      lineEl.className = "cw-line cw-comment-line";

      const label = createSpan("cw-comment", line.text);
      if (line.type === "comment_italic") label.classList.add("cw-ci");

      lineEl.appendChild(label);
      containerEl.appendChild(lineEl);
      continue;
    }

    const lineEl = document.createElement("div");
    lineEl.className = "cw-line";

    const cells = splitToCells(line.text);

    for (const cell of cells) {
      const cellEl = document.createElement("span");
      cellEl.className = "cw-cell";

      const chordEl = document.createElement("span");
      chordEl.className = "cw-chord";
      if (cell.chord && isNoChordToken(cell.chord)) {
        chordEl.classList.add("cw-nc");
        chordEl.textContent = "N.C.";
      } else {
        chordEl.textContent = cell.chord || "";
      }

      const wordEl = document.createElement("span");
      wordEl.className = "cw-word";
      appendLyricWithBars(wordEl, cell.lyric || "");

      cellEl.appendChild(chordEl);
      cellEl.appendChild(wordEl);
      lineEl.appendChild(cellEl);
    }

    containerEl.appendChild(lineEl);
  }

  return { title: parsed.title, subtitle: parsed.subtitle, key: parsed.key };
}