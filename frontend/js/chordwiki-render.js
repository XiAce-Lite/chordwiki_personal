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

function isBarChordToken(token) {
  // [|] をコードとして使うケースに対応（全角の｜も）
  const t = (token || "").trim();
  return t === "|" || t === "｜";
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
    cells[cells.length - 1].lyric += line.slice(lastIndex, match.index);

    const chordText = match[0].slice(1, -1);
    cells.push({ chord: chordText, lyric: "" });

    lastIndex = match.index + match[0].length;
  }

  cells[cells.length - 1].lyric += line.slice(lastIndex);

  return cells.filter(c => !(c.chord === "" && c.lyric === ""));
}

/**
 * 1) | は cw-bar（左右余白あり：CSSで padding）
 * 3) ---- / -> / >- / >-> / >> / ≫ / ≧=≫ / ＞- 等は cw-mark（色は cw-bar と同じ）
 */
function appendLyricWithMarks(targetSpan, lyricText) {
  const text = lyricText || "";

  // 長いものを先にマッチさせる（順序重要）
  // - ≧=≫ / >=>> も含めて拾う
  // - ＞-（全角）や >-（半角）
  // - >-> / -> / >> / ≫
  // - ----（2個以上のハイフン）
  // - 連続 >（>>>>> など）
  const re = /(≧=≫|>=>>|＞-+|>->|>-\s*|->|≫+|>>+|\|)|(-{2,})|(>+)/g;

  let last = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    const before = text.slice(last, m.index);
    if (before) targetSpan.appendChild(document.createTextNode(before));

    const tok = m[0];

    if (tok === "|") {
      targetSpan.appendChild(createSpan("cw-bar", "|"));
    } else {
      // 色は cw-bar と同じにしたいので cw-bar を併用
      targetSpan.appendChild(createSpan("cw-mark cw-bar", tok));
    }

    last = m.index + tok.length;
  }

  const rest = text.slice(last);
  if (rest) targetSpan.appendChild(document.createTextNode(rest));
}

/**
 * 2) コード右端＝歌詞開始：コード幅(px)を計測して CSS 変数へ
 * ※ cw-bar の左右余白は padding にしているので、ここで測った幅に含まれる
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
      } else if (cell.chord && isBarChordToken(cell.chord)) {
        // [|] はバー専用（高さ・色・余白を揃える）
        chordEl.classList.add("cw-bar-chord", "cw-bar");
        chordEl.textContent = "|";
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
    applyChordPadding(lineEl);
  }

  return { title: parsed.title, subtitle: parsed.subtitle, key: parsed.key };
}