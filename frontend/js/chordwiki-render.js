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
    const m = rawLine.match(/^\{\s*([^:}]+)\s*:\s*(.*)\}\s*$/);

    if (m) {
      const key = m[1].trim().toLowerCase();
      const value = m[2].trim();

      if (key === "title" || key === "t") { result.title = value; continue; }
      if (key === "subtitle" || key === "st") { result.subtitle = value; continue; }
      if (key === "key") { result.key = value; continue; }

      if (key === "comment" || key === "c") {
        result.lines.push({ type: "comment", text: value, tokens: [] });
        continue;
      }
      if (key === "comment_italic" || key === "ci") {
        result.lines.push({ type: "comment_italic", text: value, tokens: [] });
        continue;
      }

      continue;
    }

    if (rawLine === "") {
      result.lines.push({ type: "blank", text: "", tokens: [] });
      continue;
    }

    result.lines.push({
      type: "lyrics",
      text: rawLine,
      tokens: tokenizeLyricsLine(rawLine)
    });
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
 * ChordWiki互換: tokenize では `chord` と `word` だけを作る。
 * `wordtop` は render 時に、行頭の最初の歌詞 span にのみ後付けする。
 */
function tokenizeLyricsLine(lineText) {
  const tokens = [];
  const line = lineText || "";
  let i = 0;

  while (i < line.length) {
    if (line[i] === "[") {
      const end = line.indexOf("]", i);
      if (end !== -1) {
        tokens.push({
          kind: "chord",
          text: line.slice(i + 1, end)
        });
        i = end + 1;
        continue;
      }
    }

    let j = i;
    while (j < line.length && line[j] !== "[") j++;

    const lyric = line.slice(i, j);
    if (lyric.length > 0) {
      tokens.push({
        kind: "word",
        text: lyric
      });
    }

    i = j;
  }

  return tokens;
}

function renderBlankLine(containerEl) {
  const p = document.createElement("p");
  p.className = "line blank";
  containerEl.appendChild(p);
}

function renderCommentLine(text, containerEl, isItalic = false) {
  const p = document.createElement("p");
  p.className = isItalic ? "comment ci" : "comment";

  const body = createSpan("comment-body", text || "");
  p.appendChild(body);
  containerEl.appendChild(p);
}

function renderLyricsLine(tokens, containerEl, options = {}) {
  const p = document.createElement("p");
  p.className = "line";

  const {
    transposeSemitones = 0,
    accidentalMode = "none",
    keyContext = null
  } = options;

  for (const token of tokens || []) {
    const span = createSpan(token.kind);
    if (token.kind === "chord") {
      const raw = transposeChordString(token.text, transposeSemitones, accidentalMode, keyContext);
      if (displayPrefsState.superscriptEnabled) {
        span.innerHTML = convertChordToSuperscriptHtml(raw);
      } else {
        span.textContent = raw;
      }
    } else {
      span.textContent = token.text || "";
    }
    p.appendChild(span);
  }

  const first = p.firstElementChild;
  if (first && first.classList.contains("word")) {
    first.classList.remove("word");
    first.classList.add("wordtop");
  }

  containerEl.appendChild(p);
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

  const rawSuffix = m[3] || "";
  const normalizedSuffix = rawSuffix.toLowerCase();
  const isMinor = normalizedSuffix === "m"
    || normalizedSuffix.startsWith("min")
    || (normalizedSuffix.startsWith("m") && !normalizedSuffix.startsWith("maj"));

  return {
    semitone,
    isMinor,
    root,
    suffix: rawSuffix,
    normalizedSuffix
  };
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
    if (line.type !== "lyrics") continue;

    const tokens = Array.isArray(line.tokens) ? line.tokens : tokenizeLyricsLine(line.text || "");
    for (const token of tokens) {
      if (token.kind !== "chord") continue;

      const chord = (token.text || "").trim();
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

function transposeKeyText(keyText, semitones = 0, accidentalMode = "none") {
  const original = keyText == null ? "" : String(keyText).trim();
  if (!original) {
    return "";
  }

  const normalizedMode = normalizeAccidentalMode(accidentalMode);
  if (normalizedMode === "none" && semitones === 0) {
    return original;
  }

  const parsedKey = parseKeySignature(original);
  if (!parsedKey) {
    return original;
  }

  const outputMode = normalizedMode !== "none"
    ? normalizedMode
    : (inferAccidentalFromKey(original, semitones) || inferAccidentalFromKey(original, 0) || "sharp");

  const transposedRoot = semitoneToNote(parsedKey.semitone + semitones, outputMode);
  return `${transposedRoot}${parsedKey.suffix || ""}`;
}

if (typeof window !== "undefined") {
  window.transposeKeyText = transposeKeyText;
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
    if (line.type === "blank") {
      renderBlankLine(containerEl);
      continue;
    }

    if (line.type === "comment" || line.type === "comment_italic") {
      renderCommentLine(line.text, containerEl, line.type === "comment_italic");
      continue;
    }

    renderLyricsLine(line.tokens || tokenizeLyricsLine(line.text || ""), containerEl, {
      transposeSemitones,
      accidentalMode,
      keyContext
    });
  }

  return { title: parsed.title, subtitle: parsed.subtitle, key: parsed.key };
}

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getChordSegmentBeforeIndex(source, index) {
  let start = index - 1;
  while (start >= 0 && !/[\s\(\)\/,]/.test(source[start])) {
    start -= 1;
  }

  return source.slice(start + 1, index).toLowerCase();
}

function convertChordToSuperscriptHtml(chordText) {
  const source = String(chordText || "");
  if (!source) {
    return "";
  }

  let result = "";
  let index = 0;
  let lastAffix = "";

  while (index < source.length) {
    const rest = source.slice(index);

    const affixMatch = rest.match(/^(sus|aug|dim|omit|add)/i);
    if (affixMatch) {
      const affixText = affixMatch[0];
      result += `<span class="cw-chord-affix">${escapeHtml(affixText)}</span>`;
      lastAffix = affixText.toLowerCase();
      index += affixText.length;
      continue;
    }

    const excludedSeventhMatch = rest.match(/^(m7|dim7|aug7)/i);
    if (excludedSeventhMatch) {
      const excludedText = excludedSeventhMatch[0];
      result += escapeHtml(excludedText);
      lastAffix = "";
      index += excludedText.length;
      continue;
    }

    if (source[index] === "(") {
      const closeIndex = source.indexOf(")", index + 1);
      if (closeIndex !== -1) {
        const inner = source.slice(index + 1, closeIndex);
        if (/\d/.test(inner)) {
          result += `(<sup>${escapeHtml(inner)}</sup>)`;
        } else {
          result += `(${escapeHtml(inner)})`;
        }

        lastAffix = "";
        index = closeIndex + 1;
        continue;
      }
    }

    const alteredTensionMatch = rest.match(/^[b#♭♯\-](13|11|9|5)/);
    if (alteredTensionMatch) {
      const alteredText = alteredTensionMatch[0];
      result += `<sup>${escapeHtml(alteredText)}</sup>`;
      lastAffix = "";
      index += alteredText.length;
      continue;
    }

    const tensionNumberMatch = rest.match(/^(13|11|9|7)/);
    if (tensionNumberMatch) {
      const tensionText = tensionNumberMatch[0];
      const segment = getChordSegmentBeforeIndex(source, index);
      const isBlockedMinorSeventh = tensionText === "7" && /(m|dim|aug)$/.test(segment);
      const isAddTension = ["9", "11", "13"].includes(tensionText) && lastAffix === "add";

      if (!isBlockedMinorSeventh || isAddTension) {
        result += `<sup>${escapeHtml(tensionText)}</sup>`;
      } else {
        result += escapeHtml(tensionText);
      }

      lastAffix = "";
      index += tensionText.length;
      continue;
    }

    const currentChar = source[index];
    const previousChar = source[index - 1] || "";
    const nextChar = source[index + 1] || "";
    if (/[b#♭♯]/.test(currentChar) && /[A-Ga-g]/.test(previousChar) && !/\d/.test(nextChar)) {
      result += `<sup>${escapeHtml(currentChar)}</sup>`;
      lastAffix = "";
      index += 1;
      continue;
    }

    result += escapeHtml(currentChar);
    lastAffix = "";
    index += 1;
  }

  return result;
}