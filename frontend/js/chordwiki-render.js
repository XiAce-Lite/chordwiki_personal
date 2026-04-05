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

      // 未対応は無視
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
 * [C] の直後歌詞は必ず同じセルの lyric に入る（同期保証）
 */
function splitToCells(lineText) {
  const line = lineText || "";
  const regex = /\[[^\]]+\]/g;

  const cells = [{ chord: "", lyric: "" }];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(line)) !== null) {
    const between = line.slice(lastIndex, match.index);
    cells[cells.length - 1].lyric += between;

    const chordText = match[0].slice(1, -1);
    cells.push({ chord: chordText, lyric: "" });

    lastIndex = match.index + match[0].length;
  }

  cells[cells.length - 1].lyric += line.slice(lastIndex);

  return cells.filter(c => !(c.chord === "" && c.lyric === ""));
}

/**
 * 3) ---- や -> や > を | と同色にするため、装飾トークンとして span 化
 * 1) | の左右余白は CSS（cw-bar）で実現
 */
function appendLyricWithMarks(targetSpan, lyricText) {
  const text = lyricText || "";
  // | / 連続ハイフン / -> / 連続 > をトークンとして扱う
  const re = /(\||-{2,}|->|>+)/g;

  let last = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before) targetSpan.appendChild(document.createTextNode(before));

    const tok = m[0];
    if (tok === "|") {
      targetSpan.appendChild(createSpan("cw-bar", "|"));
    } else {
      // ---- や -> や > は拍・アクセント記号として同色に
      targetSpan.appendChild(createSpan("cw-mark", tok));
    }

    last = m.index + tok.length;
  }

  const rest = text.slice(last);
  if (rest) targetSpan.appendChild(document.createTextNode(rest));
}

/**
 * 2) コード右端＝歌詞開始 を作るために、
 * 各セルに “コード幅(px)” を CSS 変数としてセットする。
 */
function applyChordPadding(lineEl) {
  const cells = lineEl.querySelectorAll(".cw-cell");
  for (const cell of cells) {
    const chordEl = cell.querySelector(".cw-chord");
    if (!chordEl) continue;

    // chord が空なら 0
    const raw = (chordEl.textContent || "").trim();
    if (!raw) {
      cell.style.setProperty("--cw-chord-pad", "0px");
      continue;
    }

    // 表示後の実幅を測って列幅にする（N.C. の枠も含めて確保）
    const w = Math.ceil(chordEl.getBoundingClientRect().width);
    cell.style.setProperty("--cw-chord-pad", `${w}px`);
  }
}

function renderChordWikiLike(chordProText, containerEl) {
  containerEl.innerHTML = "";
  const parsed = parseChordPro(chordProText || "");

  for (const line of parsed.lines) {
    // コメント
    if (line.type === "comment" || line.type === "comment_italic") {
      const lineEl = document.createElement("div");
      lineEl.className = "cw-line cw-comment-line";

      const label = createSpan("cw-comment", line.text);
      if (line.type === "comment_italic") label.classList.add("cw-ci");

      lineEl.appendChild(label);
      containerEl.appendChild(lineEl);
      continue;
    }

    // 通常行
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
      appendLyricWithMarks(wordEl, cell.lyric || "");

      cellEl.appendChild(chordEl);
      cellEl.appendChild(wordEl);
      lineEl.appendChild(cellEl);
    }

    containerEl.appendChild(lineEl);

    // ここで幅計測 → CSS変数へ反映
    applyChordPadding(lineEl);
  }

  return { title: parsed.title, subtitle: parsed.subtitle, key: parsed.key };
}