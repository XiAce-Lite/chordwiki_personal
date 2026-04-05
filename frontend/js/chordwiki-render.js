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
 * ✅ 歌詞内の | だけを cw-bar にする
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

/* ==========================
   Transpose（移調）ロジック
   ========================== */

// 出力は # 表記に正規化
const NOTES_SHARP = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

// b / 例外音も解決して半音にする
const NOTE_ALIAS_TO_SHARP = {
  "DB": "C#",
  "EB": "D#",
  "GB": "F#",
  "AB": "G#",
  "BB": "A#",
  "CB": "B",
  "FB": "E",
  "E#": "F",
  "B#": "C"
};

function noteToSemitone(note) {
  if (!note) return null;
  const n = note.trim().toUpperCase();  // e.g. "Bb", "F#"
  const mapped = NOTE_ALIAS_TO_SHARP[n] || n; // normalize flats to sharps when possible
  const idx = NOTES_SHARP.indexOf(mapped);
  return idx >= 0 ? idx : null;
}

function semitoneToNote(semitone) {
  return NOTES_SHARP[(semitone % 12 + 12) % 12];
}

/**
 * chordPart の先頭のルート音だけを移調し、残り(suffix)は保持する
 * 例: "F#m7(b13)" -> root "F#" + suffix "m7(b13)"
 */
function transposeChordHead(chordPart, semitones) {
  const m = chordPart.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) return chordPart;

  const root = (m[1] + (m[2] || "")).toUpperCase(); // "Bb" etc
  const suffix = m[3] || "";

  const s = noteToSemitone(root);
  if (s === null) return chordPart;

  const newRoot = semitoneToNote(s + semitones);
  return newRoot + suffix;
}

/**
 * 入力の slash / on 表記を正規化して分解する
 * - "D/F#" -> ["D", "F#"]
 * - "D on F#" -> ["D", "F#"]
 * - "DonF#" -> ["D", "F#"]
 * - "Dm7onG" -> ["Dm7", "G"]
 *
 * 見つからなければ [whole] を返す
 */
function splitSlashOrOn(chord) {
  const s = chord.trim();

  // 1) slash
  if (s.includes("/")) {
    const i = s.indexOf("/");
    return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    // ベース側に余計な suffix があっても一応許容（後段で root抽出）
  }

  // 2) " on " (space-separated)
  let m = s.match(/^(.*?)(?:\s+on\s+)([A-Ga-g][#b]?)(.*)$/i);
  if (m) {
    // bass は通常 note 単体のはずだが、念のため suffix を許容
    const left = m[1].trim();
    const right = (m[2] + (m[3] || "")).trim();
    return [left, right];
  }

  // 3) "on" without spaces (e.g. DonF#, Dm7onG)
  //    右側は必ず音名から始まる想定で、最後に現れる "on" を区切りとみなす
  const lower = s.toLowerCase();
  const idx = lower.lastIndexOf("on");
  if (idx > 0 && idx < s.length - 2) {
    const left = s.slice(0, idx).trim();
    const right = s.slice(idx + 2).trim();
    // right が音名っぽいなら採用
    if (/^[A-Ga-g][#b]?/.test(right)) {
      return [left, right];
    }
  }

  return [s];
}

/**
 * 移調本体：
 * - N.C. と | はそのまま
 * - slash と on を両方受け付ける
 * - 出力は "/" で統一（#表記）
 */
function transposeChordString(chord, semitones) {
  if (!chord || semitones === 0) return chord;

  const trimmed = chord.trim();
  if (trimmed === "" || trimmed.toUpperCase() === "N.C." || trimmed === "|" || trimmed === "｜") {
    return chord;
  }

  const parts = splitSlashOrOn(trimmed);

  if (parts.length === 1) {
    return transposeChordHead(parts[0], semitones);
  }

  // parts[0] = chord, parts[1] = bass
  const transChord = transposeChordHead(parts[0], semitones);

  // bass は "F#" や "Bb" などの note 起点と仮定し、先頭だけ移調して残りは保持
  const transBass = transposeChordHead(parts[1], semitones);

  return `${transChord}/${transBass}`;
}

/* ==========================
   Render
   ========================== */

function renderChordWikiLike(chordProText, containerEl, transposeSemitones = 0) {
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
        chordEl.textContent = transposeChordString(chordText, transposeSemitones);

        // ★縦棒コード（[|]）の見た目調整（あなたのCSSで position: inherit）
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