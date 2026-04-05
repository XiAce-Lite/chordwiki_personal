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

      if (key === "title" || key === "t") { result.title = value; continue; }
      if (key === "subtitle" || key === "st") { result.subtitle = value; continue; }
      if (key === "key") { result.key = value; continue; }

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
 * ✅ 同期保証のセル分割：
 * [C] の直後歌詞は必ず同じセルの lyric に入る
 */
function splitToCells(lineText) {
  const line = lineText || "";
  const regex = /\[[^\]]+\]/g;

  const cells = [{ chord: "", lyric: "" }];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(line)) !== null) {
    // 直前セルに歌詞を追記
    cells[cells.length - 1].lyric += line.slice(lastIndex, match.index);

    // 新しいコードセル開始（[]は外す。中身はすべてコード扱い）
    const chordText = match[0].slice(1, -1);
    cells.push({ chord: chordText, lyric: "" });

    lastIndex = match.index + match[0].length;
  }

  cells[cells.length - 1].lyric += line.slice(lastIndex);

  // 完全空セルのみ除去
  return cells.filter(c => !(c.chord === "" && c.lyric === ""));
}

/**
 * ✅ 歌詞内の | だけを cw-bar にする（cw-markは廃止）
 */
function appendLyricWithBars(targetSpan, lyricText) {
  const text = lyricText || "";
  const parts = text.split(/(\|)/);

  for (const p of parts) {
    if (p === "|") {
      targetSpan.appendChild(createSpan("cw-bar", "|"));
    } else if (p !== "") {
      targetSpan.appendChild(document.createTextNode(p));
    }
  }
}

/**
 * ✅ コード右端＝歌詞開始：コード表示幅(px)を計測して CSS 変数へ
 */
function applyChordPadding(lineEl) {
  const cells = lineEl.querySelectorAll(".cw-cell");
  for (const cell of cells) {
    const chordEl = cell.querySelector(".cw-chord");
    if (!chordEl) continue;

    const raw = (chordEl.textContent || "").trim();
    if (!raw) {
      cell.style.setProperty("--cw-chord-pad", "0px");
      continue;
    }

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


    // [] の中身はすべてコード扱い（優先度ルール）
    if (cell.chord && isNoChordToken(cell.chord)) {
        chordEl.classList.add("cw-nc");
        chordEl.textContent = "N.C.";
    } else {
        const chordText = cell.chord || "";
        chordEl.textContent = chordText;

        // ★追加：コードが | のときだけ縦位置補正用クラス
        if (chordText.trim() === "|" || chordText.trim() === "｜") {
            chordEl.classList.add("cw-chord-bar");
        }
    }

      const wordEl = document.createElement("span");
      wordEl.className = "cw-word";
      appendLyricWithBars(wordEl, cell.lyric || "");

      cellEl.appendChild(chordEl);
      cellEl.appendChild(wordEl);
      lineEl.appendChild(cellEl);
    }

    containerEl.appendChild(lineEl);
    applyChordPadding(lineEl);
  }

  return { title: parsed.title, subtitle: parsed.subtitle, key: parsed.key };
}