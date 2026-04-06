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

  // 完全空セルのみ除去。ただし空行は 1 セル残して改行を維持する
  const filtered = cells.filter(c => !(c.chord === "" && c.lyric === ""));
  return filtered.length ? filtered : [{ chord: "", lyric: "" }];
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

/*
 * 受け入れテスト:
 * - mode=sharp, semitones=0: "Eb" -> "D#", "Bb/F" -> "A#/F"
 * - mode=flat, semitones=0: "D#" -> "Eb", "F#/A#" -> "Gb/Bb"
 * - mode=none, semitones=0: "Eb" は入力のまま維持
 * - mode=none + {key:Eb} +3: 目標キーは sharp 系扱い
 * - mode=none + {key:Cm}: relative major が Eb なので flat 系扱い
 * - suffix は不変: "Cm7b5" の b5 / "C7#11" の #11 は変更しない
 */
const NOTES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const NOTES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

const NOTE_TO_SEMITONE = {
  "C": 0,
  "B#": 0,
  "C#": 1,
  "DB": 1,
  "D": 2,
  "D#": 3,
  "EB": 3,
  "E": 4,
  "FB": 4,
  "F": 5,
  "E#": 5,
  "F#": 6,
  "GB": 6,
  "G": 7,
  "G#": 8,
  "AB": 8,
  "A": 9,
  "A#": 10,
  "BB": 10,
  "B": 11,
  "CB": 11
};

const KEY_SIGNATURE_MODE_BY_SEMITONE = [
  "sharp", // C
  "flat",  // Db
  "sharp", // D
  "flat",  // Eb
  "sharp", // E
  "flat",  // F
  "sharp", // F#/Gb -> sharp を優先
  "sharp", // G
  "flat",  // Ab
  "sharp", // A
  "flat",  // Bb
  "sharp"  // B
];

function normalizeAccidentalMode(mode) {
  return mode === "sharp" || mode === "flat" ? mode : "none";
}

function isBarToken(token) {
  const t = (token || "").trim();
  return t === "|" || t === "｜";
}

function noteToSemitone(note) {
  if (!note) return null;

  const normalized = note.trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(NOTE_TO_SEMITONE, normalized)
    ? NOTE_TO_SEMITONE[normalized]
    : null;
}

function semitoneToNote(semitone, mode = "sharp") {
  const normalized = (semitone % 12 + 12) % 12;
  return mode === "flat" ? NOTES_FLAT[normalized] : NOTES_SHARP[normalized];
}

function parseKeySignature(keyText) {
  if (!keyText) return null;

  const compact = String(keyText).trim().replace(/\s+/g, "");
  const m = compact.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) return null;

  const root = m[1].toUpperCase() + (m[2] || "");
  const semitone = noteToSemitone(root);
  if (semitone === null) return null;

  const suffix = (m[3] || "").toLowerCase();
  const isMinor = suffix === "m"
    || suffix.startsWith("min")
    || (suffix.startsWith("m") && !suffix.startsWith("maj"));

  return { semitone, isMinor };
}

function inferAccidentalFromKey(keyText, transposeSemitones = 0) {
  const parsedKey = parseKeySignature(keyText);
  if (!parsedKey) return null;

  let signatureSemitone = parsedKey.semitone + transposeSemitones;
  if (parsedKey.isMinor) {
    signatureSemitone += 3; // relative major
  }

  return KEY_SIGNATURE_MODE_BY_SEMITONE[(signatureSemitone % 12 + 12) % 12] || "sharp";
}

function countAccidentalsInChordPart(chordPart) {
  const m = (chordPart || "").match(/^([A-Ga-g])([#b]?)/);
  if (!m) {
    return { sharp: 0, flat: 0 };
  }

  return {
    sharp: m[2] === "#" ? 1 : 0,
    flat: m[2] === "b" ? 1 : 0
  };
}

function inferAccidentalFromChord(chord) {
  const parts = splitSlashOrOn((chord || "").trim());
  let sharpCount = 0;
  let flatCount = 0;

  for (const part of parts) {
    const counts = countAccidentalsInChordPart(part);
    sharpCount += counts.sharp;
    flatCount += counts.flat;
  }

  return flatCount > sharpCount ? "flat" : "sharp";
}

function inferAccidentalPreferenceFromLines(lines) {
  let sharpCount = 0;
  let flatCount = 0;

  for (const line of lines || []) {
    if (line.type !== "text") continue;

    const cells = splitToCells(line.text);
    for (const cell of cells) {
      const chord = (cell.chord || "").trim();
      if (!chord || isNoChordToken(chord) || isBarToken(chord)) continue;

      const parts = splitSlashOrOn(chord);
      for (const part of parts) {
        const counts = countAccidentalsInChordPart(part);
        sharpCount += counts.sharp;
        flatCount += counts.flat;
      }
    }
  }

  return flatCount > sharpCount ? "flat" : "sharp";
}

function resolveAccidentalMode(chord, semitones, accidentalMode = "none", keyContext = null) {
  const normalizedMode = normalizeAccidentalMode(accidentalMode);
  if (normalizedMode !== "none") {
    return normalizedMode;
  }

  if (semitones === 0) {
    return "none";
  }

  const keyText = typeof keyContext === "string" ? keyContext : keyContext?.key;
  const inferredFromKey = inferAccidentalFromKey(keyText, semitones);
  if (inferredFromKey) {
    return inferredFromKey;
  }

  const fallbackMode = typeof keyContext === "object" ? keyContext?.fallbackMode : null;
  return fallbackMode || inferAccidentalFromChord(chord);
}

/**
 * chordPart の先頭のルート音だけを変換し、残り(suffix)は保持する
 * 例: "F#m7(b13)" -> root "F#" + suffix "m7(b13)"
 */
function transposeChordHead(chordPart, semitones, mode = "sharp") {
  const m = chordPart.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) return chordPart;

  const root = m[1].toUpperCase() + (m[2] || "");
  const suffix = m[3] || "";

  const s = noteToSemitone(root);
  if (s === null) return chordPart;

  const newRoot = semitoneToNote(s + semitones, mode);
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

  if (s.includes("/")) {
    const i = s.indexOf("/");
    return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  }

  let m = s.match(/^(.*?)(?:\s+on\s+)([A-Ga-g][#b]?)(.*)$/i);
  if (m) {
    const left = m[1].trim();
    const right = (m[2] + (m[3] || "")).trim();
    return [left, right];
  }

  const lower = s.toLowerCase();
  const idx = lower.lastIndexOf("on");
  if (idx > 0 && idx < s.length - 2) {
    const left = s.slice(0, idx).trim();
    const right = s.slice(idx + 2).trim();
    if (/^[A-Ga-g][#b]?/.test(right)) {
      return [left, right];
    }
  }

  return [s];
}

/**
 * 移調 / 表記変換本体：
 * - N.C. と | はそのまま
 * - slash と on を両方受け付ける
 * - 変換対象は root / bass の音名だけ。suffix はそのまま保持
 */
function transposeChordString(chord, semitones = 0, accidentalMode = "none", keyContext = null) {
  if (!chord) return chord;

  const trimmed = chord.trim();
  if (trimmed === "" || isNoChordToken(trimmed) || isBarToken(trimmed)) {
    return chord;
  }

  if (normalizeAccidentalMode(accidentalMode) === "none" && semitones === 0) {
    return chord;
  }

  const resolvedMode = resolveAccidentalMode(trimmed, semitones, accidentalMode, keyContext);
  const outputMode = resolvedMode === "flat" ? "flat" : "sharp";
  const parts = splitSlashOrOn(trimmed);

  if (parts.length === 1) {
    return transposeChordHead(parts[0], semitones, outputMode);
  }

  const transChord = transposeChordHead(parts[0], semitones, outputMode);
  const transBass = transposeChordHead(parts[1], semitones, outputMode);
  return `${transChord}/${transBass}`;
}

/* ==========================
   Render
   ========================== */

function renderChordWikiLike(chordProText, containerEl, transposeSemitones = 0, accidentalMode = "none") {
  containerEl.innerHTML = "";
  const parsed = parseChordPro(chordProText || "");
  const keyContext = {
    key: parsed.key,
    fallbackMode: inferAccidentalPreferenceFromLines(parsed.lines)
  };

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
        const chordText = cell.chord || "";
        chordEl.textContent = transposeChordString(chordText, transposeSemitones, accidentalMode, keyContext);

        if (isBarToken(chordText)) {
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