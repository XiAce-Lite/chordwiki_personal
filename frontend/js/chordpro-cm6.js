/**
 * chordpro-cm6.js
 * CodeMirror 6 を使った ChordPro エディター
 *
 * 依存: CDN ESM (jsDelivr) 経由で CodeMirror 6 モジュールをインポート
 * 公開 API (window.ChordProEditor):
 *   getValue()               - エディター内容を文字列で返す
 *   setValue(text)           - エディター内容を設定する
 *   onChange(callback)       - 変更時コールバック登録 (コールバック引数: text)
 *   focus()                  - エディターにフォーカス
 *   setDisabled(bool)        - 読み取り専用切替
 */

import {
  EditorView,
  Decoration,
  ViewPlugin,
  keymap,
  lineNumbers,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view';

import {
  EditorState,
  RangeSetBuilder,
  Compartment,
} from '@codemirror/state';

import {
  defaultKeymap,
  indentWithTab,
  history,
  historyKeymap,
} from '@codemirror/commands';

import {
  HighlightStyle,
  syntaxHighlighting,
  StreamLanguage,
} from '@codemirror/language';

import {
  Tag,
} from '@lezer/highlight';

/* ====================================================================
   1. MIDI ルート音カラーテーブル (editor-highlight.js と同じ定義)
   ==================================================================== */
const MIDI_COLORS = [
  'hsl(0,   88%, 46%)',   // 0  C
  'hsl(30,  99%, 33%)',   // 1  C#/Db
  'hsl(49,  90%, 46%)',   // 2  D
  'hsl(60,  98%, 33%)',   // 3  D#/Eb
  'hsl(79,  59%, 46%)',   // 4  E
  'hsl(135, 76%, 33%)',   // 5  F
  'hsl(172, 68%, 46%)',   // 6  F#/Gb
  'hsl(191, 41%, 33%)',   // 7  G
  'hsl(273, 79%, 46%)',   // 8  G#/Ab
  'hsl(291, 46%, 33%)',   // 9  A
  'hsl(295, 97%, 46%)',   // 10 A#/Bb
  'hsl(332, 97%, 33%)',   // 11 B
];

const ROOT_MIDI = {
  C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,Fb:4,
  F:5,'E#':5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,
  A:9,'A#':10,Bb:10,B:11,Cb:11
};

function rootMidi(root) {
  return ROOT_MIDI[root] ?? -1;
}

/* ====================================================================
   2. カスタム Tag 定義
   ==================================================================== */
const T = {
  comment:    Tag.define(),
  brace:      Tag.define(),
  directName: Tag.define(),
  colon:      Tag.define(),
  directVal:  Tag.define(),
  bracket:    Tag.define(),
  // ルート音は MIDI 番号ごとに12種
  note:       Array.from({length:12}, () => Tag.define()),
  chord:      Tag.define(),   // サフィックス (m, maj7 など)
  slash:      Tag.define(),
  bass:       Array.from({length:12}, () => Tag.define()),  // スラッシュ後ルート
  barline:    Tag.define(),
  hyphen:     Tag.define(),
  lyric:      Tag.define(),   // 歌詞テキスト
};

/* ====================================================================
   3. HighlightStyle (Tag → CSS スタイル)
   ==================================================================== */
const chordProHighlightStyle = HighlightStyle.define([
  { tag: T.comment,    color: '#006f00' },
  { tag: T.brace,      color: '#26af1e', fontWeight: 'bold' },
  { tag: T.directName, color: '#26af1e', fontWeight: 'bold' },
  { tag: T.colon,      color: '#802f14', fontWeight: 'bold' },
  { tag: T.directVal,  color: '#4785bc' },
  { tag: T.bracket,    color: '#1818ff', fontWeight: 'bold' },
  { tag: T.chord,      color: '#333',    fontWeight: 'bold' },
  { tag: T.slash,      color: '#888',    fontWeight: 'bold' },
  { tag: T.barline,    color: '#00537e', fontWeight: 'bold' },
  { tag: T.hyphen,     color: '#d9006c', fontWeight: 'bold' },
  { tag: T.lyric,      color: '#636363' },
  // ルート音 (note) と ベース音 (bass) - 各 MIDI 番号ごと
  ...T.note.map((t, i) => ({ tag: t, color: MIDI_COLORS[i], fontWeight: 'bold' })),
  ...T.bass.map((t, i) => ({ tag: t, color: MIDI_COLORS[i], fontWeight: 'bold' })),
]);


const ROOT_RE = /^([A-G][b#]?)/;

function parseRoot(s) {
  const m = s.match(ROOT_RE);
  return m ? { root: m[1], rest: s.slice(m[1].length) } : null;
}

/**
 * CodeMirror 6 StreamParser for ChordPro
 */
const chordProStreamParser = {
  name: 'chordpro',
  token(stream, state) {
    // コメント行 (# で始まる)
    if (state.lineStart && stream.peek() === '#') {
      stream.skipToEnd();
      return 'comment';
    }

    // ディレクティブ開始 {
    if (stream.peek() === '{') {
      state.lineStart = false;
      stream.next();
      state.inDirective = true;
      state.afterColon = false;
      return 'brace';
    }

    // ディレクティブ内部
    if (state.inDirective) {
      if (stream.peek() === '}') {
        stream.next();
        state.inDirective = false;
        return 'brace';
      }
      if (stream.peek() === ':') {
        stream.next();
        state.afterColon = true;
        return 'colon';
      }
      if (state.afterColon) {
        // 値: } まで or 行末まで
        if (!stream.skipTo('}')) {
          stream.skipToEnd();
        }
        return 'directVal';
      }
      // ディレクティブ名: : or } まで
      if (!stream.match(/^[^:}]+/)) {
        stream.next();
      }
      return 'directName';
    }

    // コード [ ... ]
    if (stream.peek() === '[') {
      state.lineStart = false;
      stream.next();
      state.inChord = true;
      state.chordBuf = '';
      return 'bracket';
    }

    if (state.inChord) {
      if (stream.peek() === ']') {
        stream.next();
        state.inChord = false;
        return 'bracket';
      }
      // スラッシュ
      if (stream.peek() === '/') {
        stream.next();
        return 'slash';
      }
      // ルート音
      const rest = stream.string.slice(stream.pos);
      const m = rest.match(ROOT_RE);
      if (m) {
        const root = m[1];
        const midi = rootMidi(root);
        stream.pos += root.length;
        return midi >= 0 ? `note-${midi}` : 'chord';
      }
      // サフィックス (] / までの文字)
      if (!stream.match(/^[^\]/]+/)) {
        stream.next();
      }
      return 'chord';
    }

    // 小節線 |
    if (stream.peek() === '|') {
      state.lineStart = false;
      stream.next();
      return 'barline';
    }

    // ハイフン連続
    if (stream.peek() === '-') {
      stream.match(/^-+/);
      state.lineStart = false;
      return 'hyphen';
    }

    // 歌詞テキスト (次の特殊文字まで)
    if (!stream.match(/^[^{}\[\]|\-#]+/)) {
      stream.next();
    }
    state.lineStart = false;
    return 'lyric';
  },

  startState() {
    return { lineStart: true, inDirective: false, afterColon: false, inChord: false };
  },

  blankLine(state) {
    state.lineStart = true;
    state.inDirective = false;
    state.afterColon = false;
    state.inChord = false;
  },

  indent() { return 0; },

  languageData: {
    commentTokens: { line: '#' },
  }
};

// token 名 → Tag のマッピング
const tokenTagMap = {
  comment:    T.comment,
  brace:      T.brace,
  directName: T.directName,
  colon:      T.colon,
  directVal:  T.directVal,
  bracket:    T.bracket,
  chord:      T.chord,
  slash:      T.slash,
  barline:    T.barline,
  hyphen:     T.hyphen,
  lyric:      T.lyric,
};
for (let i = 0; i < 12; i++) {
  tokenTagMap[`note-${i}`] = T.note[i];
  tokenTagMap[`bass-${i}`] = T.bass[i];
}

chordProStreamParser.tokenTable = tokenTagMap;

const chordProLanguage = StreamLanguage.define(chordProStreamParser);

/* ====================================================================
   4.1 保険: デコレーションで直接着色 (parser依存を回避)
   ==================================================================== */
function addMark(builder, from, to, className) {
  if (to <= from) return;
  builder.add(from, to, Decoration.mark({ class: className }));
}

function decorateChordLine(builder, lineFrom, text) {
  if (text.startsWith('#')) {
    addMark(builder, lineFrom, lineFrom + text.length, 'cp-comment');
    return;
  }

  let i = 0;
  while (i < text.length) {
    const ch = text[i];

    if (ch === '{') {
      const close = text.indexOf('}', i + 1);
      const end = close >= 0 ? close + 1 : text.length;
      addMark(builder, lineFrom + i, lineFrom + i + 1, 'cp-brace');

      const innerStart = i + 1;
      const innerEnd = close >= 0 ? close : text.length;
      const colon = text.indexOf(':', innerStart);
      if (colon >= 0 && colon < innerEnd) {
        addMark(builder, lineFrom + innerStart, lineFrom + colon, 'cp-direct-name');
        addMark(builder, lineFrom + colon, lineFrom + colon + 1, 'cp-colon');
        addMark(builder, lineFrom + colon + 1, lineFrom + innerEnd, 'cp-direct-val');
      } else {
        addMark(builder, lineFrom + innerStart, lineFrom + innerEnd, 'cp-direct-name');
      }
      if (close >= 0) addMark(builder, lineFrom + close, lineFrom + close + 1, 'cp-brace');
      i = end;
      continue;
    }

    if (ch === '[') {
      const close = text.indexOf(']', i + 1);
      const end = close >= 0 ? close + 1 : text.length;
      addMark(builder, lineFrom + i, lineFrom + i + 1, 'cp-bracket');

      const innerStart = i + 1;
      const innerEnd = close >= 0 ? close : text.length;
      const inside = text.slice(innerStart, innerEnd);
      const slashLocal = inside.indexOf('/');
      const head = slashLocal >= 0 ? inside.slice(0, slashLocal) : inside;

      if (head.length > 0) {
        const m = head.match(ROOT_RE);
        if (m) {
          const root = m[1];
          const midi = rootMidi(root);
          addMark(builder, lineFrom + innerStart, lineFrom + innerStart + root.length, midi >= 0 ? `cp-note-${midi}` : 'cp-chord');
          addMark(builder, lineFrom + innerStart + root.length, lineFrom + innerStart + head.length, 'cp-chord');
        } else {
          addMark(builder, lineFrom + innerStart, lineFrom + innerStart + head.length, 'cp-chord');
        }
      }

      if (slashLocal >= 0) {
        const slashAbs = innerStart + slashLocal;
        addMark(builder, lineFrom + slashAbs, lineFrom + slashAbs + 1, 'cp-slash');
        const tail = inside.slice(slashLocal + 1);
        if (tail.length > 0) {
          const tailStart = slashAbs + 1;
          const m = tail.match(ROOT_RE);
          if (m) {
            const root = m[1];
            const midi = rootMidi(root);
            addMark(builder, lineFrom + tailStart, lineFrom + tailStart + root.length, midi >= 0 ? `cp-bass-${midi}` : 'cp-chord');
            addMark(builder, lineFrom + tailStart + root.length, lineFrom + tailStart + tail.length, 'cp-chord');
          } else {
            addMark(builder, lineFrom + tailStart, lineFrom + tailStart + tail.length, 'cp-chord');
          }
        }
      }

      if (close >= 0) addMark(builder, lineFrom + close, lineFrom + close + 1, 'cp-bracket');

      i = end;
      continue;
    }

    if (ch === '|') {
      addMark(builder, lineFrom + i, lineFrom + i + 1, 'cp-barline');
      i++;
      continue;
    }

    if (ch === '-') {
      let k = i + 1;
      while (k < text.length && text[k] === '-') k++;
      addMark(builder, lineFrom + i, lineFrom + k, 'cp-hyphen');
      i = k;
      continue;
    }

    let k = i + 1;
    while (k < text.length && !/[{\[\]|-]/.test(text[k])) k++;
    addMark(builder, lineFrom + i, lineFrom + k, 'cp-lyric');
    i = k;
  }
}

function buildChordDecorations(view) {
  const builder = new RangeSetBuilder();
  const doc = view.state.doc;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    decorateChordLine(builder, line.from, line.text);
  }
  return builder.finish();
}

const chordProDecorationPlugin = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = buildChordDecorations(view);
  }
  update(update) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildChordDecorations(update.view);
    }
  }
}, {
  decorations: v => v.decorations,
});

/* ====================================================================
   5. キーマップ: [ → [] 補完、{ → {} 補完、a-g 大文字変換
   ==================================================================== */
const ROOT_MIDI_KEYS = Object.freeze({
  C:0,'C#':1,Db:1,D:2,'D#':3,Eb:3,E:4,F:5,'F#':6,Gb:6,G:7,'G#':8,Ab:8,
  A:9,'A#':10,Bb:10,B:11
});

/** カーソル直前が [] 内のルート音位置か判定 */
function isInBracketRoot(state) {
  const pos = state.selection.main.from;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  // 最後の [ と対応する ] を確認
  let depth = 0;
  let bracketStart = -1;
  for (let i = before.length - 1; i >= 0; i--) {
    if (before[i] === ']') { depth++; }
    else if (before[i] === '[') {
      if (depth === 0) { bracketStart = i; break; }
      depth--;
    }
  }
  if (bracketStart === -1) return false;
  const inBracket = before.slice(bracketStart + 1);
  return inBracket.length === 0 || inBracket[inBracket.length - 1] === '/';
}

/** カーソルが {key:...} の値部分か判定 */
function isInKeyDirectiveVal(state) {
  const pos = state.selection.main.from;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const braceStart = before.lastIndexOf('{');
  if (braceStart === -1) return false;
  const seg = before.slice(braceStart);
  if (seg.includes('}')) return false;
  return /^\{key:/i.test(seg);
}

/** [ → [] を挿入してカーソルを内側に移動 */
function insertBracketPair(view) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: '[]' },
    selection: { anchor: from + 1 },
  });
  return true;
}

/** { → {} を挿入してカーソルを内側に移動 */
function insertBracePair(view) {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: '{}' },
    selection: { anchor: from + 1 },
  });
  return true;
}

/** ] が次の文字と一致する場合はスキップ */
function skipClosingBracket(view) {
  const pos = view.state.selection.main.from;
  const next = view.state.doc.sliceString(pos, pos + 1);
  if (next === ']' || next === '}') {
    view.dispatch({ selection: { anchor: pos + 1 } });
    return true;
  }
  return false;
}

/** a-g の大文字変換ハンドラー生成 */
function makeLetterHandler(letter) {
  return function (view) {
    const state = view.state;
    if (!state.selection.main.empty) return false;  // 選択範囲あり時は通常入力
    const upper = letter.toUpperCase();
    const pos = state.selection.main.from;

    const doUppercase = isInBracketRoot(state) || isInKeyDirectiveVal(state);
    if (!doUppercase) return false;

    // フラット判定: A-G の直後の b は変換しない
    if (letter === 'b') {
      const prev = state.doc.sliceString(pos - 1, pos);
      if (/[A-G]/.test(prev)) return false;
    }

    view.dispatch({
      changes: { from: pos, to: pos, insert: upper },
      selection: { anchor: pos + 1 },
    });
    return true;
  };
}

/** Backspace: [] や {} ペアをまとめて削除 */
function deleteBracketPair(view) {
  const pos = view.state.selection.main.from;
  if (!view.state.selection.main.empty) return false;
  if (pos === 0) return false;
  const prev = view.state.doc.sliceString(pos - 1, pos);
  const next = view.state.doc.sliceString(pos, pos + 1);
  if ((prev === '[' && next === ']') || (prev === '{' && next === '}')) {
    view.dispatch({
      changes: { from: pos - 1, to: pos + 1, insert: '' },
      selection: { anchor: pos - 1 },
    });
    return true;
  }
  return false;
}

const chordProKeymap = [
  { key: '[',         run: insertBracketPair },
  { key: '{',         run: insertBracePair },
  { key: ']',         run: skipClosingBracket },
  { key: '}',         run: skipClosingBracket },
  { key: 'Backspace', run: deleteBracketPair },
  ...['a','b','c','d','e','f','g'].map(l => ({ key: l, run: makeLetterHandler(l) })),
];

/* ====================================================================
   6. エディタースタイル (CM6 の .cm-editor に注入)
   ==================================================================== */
const chordProTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
    fontFamily: '"メイリオ", Meiryo, "MS Gothic", "ＭＳ ゴシック", monospace',
    borderRadius: '8px',
    border: '1px solid #cfd8e3',
    background: '#fff',
    maxHeight: '70vh',
  },
  '&.cm-focused': {
    outline: '2px solid #3b82f6',
    outlineOffset: '1px',
  },
  '.cm-content': {
    caretColor: '#1f2937',
    minHeight: '320px',
    padding: '10px 12px',
    lineHeight: '1.6',
    color: '#636363',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'inherit',
  },
  '.cm-activeLine': {
    backgroundColor: '#f0f7ff',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: '#b3d4ff !important',
  },
  '.cm-gutters': {
    borderRight: '1px solid #e5eaf1',
    background: '#f7f9fc',
    color: '#9aa5b4',
    fontSize: '11px',
  },
  '.cm-content .cp-comment': { color: '#006f00' },
  '.cm-content .cp-brace': { color: '#26af1e', fontWeight: 'bold' },
  '.cm-content .cp-direct-name': { color: '#26af1e', fontWeight: 'bold' },
  '.cm-content .cp-colon': { color: '#802f14', fontWeight: 'bold' },
  '.cm-content .cp-direct-val': { color: '#4785bc' },
  '.cm-content .cp-bracket': { color: '#1818ff', fontWeight: 'bold' },
  '.cm-content .cp-chord': { color: '#333', fontWeight: 'bold' },
  '.cm-content .cp-slash': { color: '#888', fontWeight: 'bold' },
  '.cm-content .cp-barline': { color: '#00537e', fontWeight: 'bold' },
  '.cm-content .cp-hyphen': { color: '#d9006c', fontWeight: 'bold' },
  '.cm-content .cp-lyric': { color: '#636363' },
  '.cm-content .cp-note-0, .cm-content .cp-bass-0': { color: MIDI_COLORS[0], fontWeight: 'bold' },
  '.cm-content .cp-note-1, .cm-content .cp-bass-1': { color: MIDI_COLORS[1], fontWeight: 'bold' },
  '.cm-content .cp-note-2, .cm-content .cp-bass-2': { color: MIDI_COLORS[2], fontWeight: 'bold' },
  '.cm-content .cp-note-3, .cm-content .cp-bass-3': { color: MIDI_COLORS[3], fontWeight: 'bold' },
  '.cm-content .cp-note-4, .cm-content .cp-bass-4': { color: MIDI_COLORS[4], fontWeight: 'bold' },
  '.cm-content .cp-note-5, .cm-content .cp-bass-5': { color: MIDI_COLORS[5], fontWeight: 'bold' },
  '.cm-content .cp-note-6, .cm-content .cp-bass-6': { color: MIDI_COLORS[6], fontWeight: 'bold' },
  '.cm-content .cp-note-7, .cm-content .cp-bass-7': { color: MIDI_COLORS[7], fontWeight: 'bold' },
  '.cm-content .cp-note-8, .cm-content .cp-bass-8': { color: MIDI_COLORS[8], fontWeight: 'bold' },
  '.cm-content .cp-note-9, .cm-content .cp-bass-9': { color: MIDI_COLORS[9], fontWeight: 'bold' },
  '.cm-content .cp-note-10, .cm-content .cp-bass-10': { color: MIDI_COLORS[10], fontWeight: 'bold' },
  '.cm-content .cp-note-11, .cm-content .cp-bass-11': { color: MIDI_COLORS[11], fontWeight: 'bold' },
}, { dark: false });

/* ====================================================================
   7. Compartment (disabled 切替用)
   ==================================================================== */
const editableCompartment = new Compartment();

/* ====================================================================
   8. EditorView 生成とグローバル API 公開
   ==================================================================== */
(function init() {
  const placeholder = document.getElementById('chordPro');
  if (!placeholder) return;

  const initialValue = placeholder.value || '';
  const parentEl = placeholder.parentNode;

  // hidden input: フォーム送信用
  const hiddenInput = document.createElement('input');
  hiddenInput.type   = 'hidden';
  hiddenInput.name   = 'chordPro';
  hiddenInput.id     = 'chordPro-hidden';
  parentEl.insertBefore(hiddenInput, placeholder);

  // CM6 のマウント先 div
  const mountEl = document.createElement('div');
  mountEl.id = 'chordpro-cm6';
  parentEl.insertBefore(mountEl, placeholder);

  // textarea を非表示にする (DOM は残す: edit.js が getElementById で参照するため)
  placeholder.style.display = 'none';
  placeholder.removeAttribute('required');  // バリデーション対象から除外

  // 変更コールバックリスト
  const changeListeners = [];

  const view = new EditorView({
    state: EditorState.create({
      doc: initialValue,
      extensions: [
        history(),
        drawSelection(),
        dropCursor(),
        EditorView.lineWrapping,
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        chordProLanguage.extension,
        syntaxHighlighting(chordProHighlightStyle),
        chordProDecorationPlugin,
        chordProTheme,
        keymap.of([
          ...chordProKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        editableCompartment.of(EditorView.editable.of(true)),
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return;
          const text = update.state.doc.toString();
          // hidden input を同期
          hiddenInput.value = text;
          // 登録済みコールバックを呼ぶ
          for (const fn of changeListeners) {
            try { fn(text); } catch (_) {}
          }
        }),
      ],
    }),
    parent: mountEl,
  });

  // 初期値を hidden input に反映
  hiddenInput.value = initialValue;

  /* ---- グローバル API ---- */
  window.ChordProEditor = Object.freeze({
    getValue() {
      return view.state.doc.toString();
    },
    setValue(text) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: String(text || '') },
      });
    },
    onChange(fn) {
      if (typeof fn === 'function') changeListeners.push(fn);
    },
    focus() {
      view.focus();
    },
    setDisabled(disabled) {
      view.dispatch({
        effects: editableCompartment.reconfigure(
          EditorView.editable.of(!disabled)
        ),
      });
    },
  });

  // edit.js の既存コードが window.ChordWikiEditorHighlight?.render() を呼ぶため
  // 互換スタブとして用意 (値の再描画は CM6 が自動でやるため noop)
  window.ChordWikiEditorHighlight = Object.freeze({ render() {} });
})();
