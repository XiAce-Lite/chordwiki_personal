/**
 * editor-highlight.js
 * ChordPro シンタックスハイライト (Approach B: overlay 前面方式)
 *
 * textarea は color: rgba(0,0,0,0.01) で事実上不可視にし、overlay (z-index:1) を
 * 前面に重ねてカラーテキストを表示する。IME 確定前は overlay を非表示にして
 * textarea を通常色で表示し、確定後に再描画する。
 *
 * 補助入力:
 *   [ → [] 自動補完、{ → {} 自動補完
 *   [] 内ルート音位置で a-g → A-G (フラット b は変換しない)
 *
 * 公開 API: window.ChordWikiEditorHighlight = { render, attach }
 *   render()         - #chordPro の overlay を再描画 (edit.js から呼ぶ)
 *   attach(textarea) - 任意の textarea にハイライトを適用してインスタンスを返す
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* MIDI ルート音マッピング (C=0 … B=11)                               */
  /* ------------------------------------------------------------------ */
  var ROOT_MIDI = Object.freeze({
    'C': 0, 'C#': 1, 'Db': 1,
    'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'Fb': 4,
    'F': 5, 'E#': 5, 'F#': 6, 'Gb': 6,
    'G': 7, 'G#': 8, 'Ab': 8,
    'A': 9, 'A#': 10, 'Bb': 10,
    'B': 11, 'Cb': 11
  });

  /* ------------------------------------------------------------------ */
  /* ユーティリティ                                                      */
  /* ------------------------------------------------------------------ */
  function esc(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function midiCls(root) {
    var m = ROOT_MIDI[root];
    return (m !== undefined) ? ' cm-midi-' + m : '';
  }

  /** 文字列先頭からルート音 (例: "C#", "Bb", "G") を切り出す */
  function splitRoot(s) {
    var m = s.match(/^([A-G][b#]?)/);
    return m ? { root: m[1], rest: s.slice(m[1].length) } : { root: '', rest: s };
  }

  /* ------------------------------------------------------------------ */
  /* コード内部レンダリング ([] 内: ルート + サフィックス + スラッシュ) */
  /* ------------------------------------------------------------------ */
  function renderChordInner(s) {
    var slash = s.indexOf('/');
    if (slash > 0) {
      var r1 = splitRoot(s.slice(0, slash));
      var r2 = splitRoot(s.slice(slash + 1));
      return (
        (r1.root ? '<span class="cm-note' + midiCls(r1.root) + '">' + esc(r1.root) + '</span>' : '') +
        (r1.rest ? '<span class="cm-chord">' + esc(r1.rest) + '</span>' : '') +
        '<span class="cm-slash">/</span>' +
        (r2.root ? '<span class="cm-bass' + midiCls(r2.root) + '">' + esc(r2.root) + '</span>' : '') +
        (r2.rest ? '<span class="cm-chord">' + esc(r2.rest) + '</span>' : '')
      );
    }
    var r = splitRoot(s);
    return (
      (r.root ? '<span class="cm-note' + midiCls(r.root) + '">' + esc(r.root) + '</span>' : '') +
      (r.rest ? '<span class="cm-chord">' + esc(r.rest) + '</span>' : '')
    );
  }

  /* ------------------------------------------------------------------ */
  /* 1行パーサ                                                           */
  /* ------------------------------------------------------------------ */
  function parseLine(line) {
    /* コメント行: # で始まる */
    if (/^\s*#/.test(line)) {
      return '<span class="cm-comment">' + esc(line) + '</span>';
    }

    var html = '';
    var i = 0;
    var len = line.length;

    while (i < len) {
      var ch = line[i];

      /* ディレクティブ {name:text} or {name} */
      if (ch === '{') {
        var close = line.indexOf('}', i + 1);
        if (close !== -1) {
          var inner = line.slice(i + 1, close);
          var colon = inner.indexOf(':');
          html += '<span class="cm-brace">{</span>';
          if (colon !== -1) {
            html += '<span class="cm-name">' + esc(inner.slice(0, colon)) + '</span>';
            html += '<span class="cm-colon">:</span>';
            html += '<span class="cm-brace-text">' + esc(inner.slice(colon + 1)) + '</span>';
          } else {
            html += '<span class="cm-name">' + esc(inner) + '</span>';
          }
          html += '<span class="cm-brace">}</span>';
          i = close + 1;
          continue;
        }
      }

      /* コード [chord] */
      if (ch === '[') {
        var cClose = line.indexOf(']', i + 1);
        if (cClose !== -1) {
          var cInner = line.slice(i + 1, cClose);
          html += '<span class="cm-square cm-square-open">[</span>';
          html += '<span class="cm-square-text">' + renderChordInner(cInner) + '</span>';
          html += '<span class="cm-square cm-square-close">]</span>';
          i = cClose + 1;
          continue;
        }
      }

      /* 小節線 | */
      if (ch === '|') {
        html += '<span class="cm-barline">|</span>';
        i++;
        continue;
      }

      /* 伸ばし符号のハイフン連続 */
      if (ch === '-') {
        var j = i + 1;
        while (j < len && line[j] === '-') j++;
        html += '<span class="cm-hyphen">' + esc(line.slice(i, j)) + '</span>';
        i = j;
        continue;
      }

      /* その他テキスト (次の特殊文字まで) */
      var k = i + 1;
      while (k < len && '{}[]|-'.indexOf(line[k]) === -1) k++;
      html += '<span class="cm-other">' + esc(line.slice(i, k)) + '</span>';
      i = k;
    }

    return html;
  }

  function convertToColoredHTML(text) {
    return String(text || '').split('\n').map(parseLine).join('\n');
  }

  /* ------------------------------------------------------------------ */
  /* overlay スタイル同期                                                */
  /* ------------------------------------------------------------------ */

  /**
   * フォント・パディングは実行中に変化しないため attach 時に一度だけ設定する。
   * (Ctrl+ホイールによるフォントサイズ変更機能を削除したため)
   */
  function initOverlayStaticStyles(ta, ov) {
    var cs = getComputedStyle(ta);
    ov.style.boxSizing     = 'border-box';
    ov.style.paddingTop    = cs.paddingTop;
    ov.style.paddingRight  = cs.paddingRight;
    ov.style.paddingBottom = cs.paddingBottom;
    ov.style.paddingLeft   = cs.paddingLeft;
    ov.style.fontFamily    = cs.fontFamily;
    ov.style.fontSize      = cs.fontSize;
    ov.style.fontWeight    = cs.fontWeight;
    ov.style.lineHeight    = cs.lineHeight;
    ov.style.letterSpacing = cs.letterSpacing;
  }

  /**
   * サイズ・位置はリサイズ操作で変化するためレンダリングのたびに更新する。
   */
  function syncOverlaySize(ta, ov) {
    var cs = getComputedStyle(ta);
    ov.style.top    = cs.borderTopWidth;
    ov.style.left   = cs.borderLeftWidth;
    ov.style.width  = ta.clientWidth  + 'px';
    ov.style.height = ta.clientHeight + 'px';
  }

  /* ------------------------------------------------------------------ */
  /* [] 内ルート音位置の判定                                            */
  /* カーソル位置がブラケット内の先頭、または / の直後かを返す          */
  /* ------------------------------------------------------------------ */
  function isRootPosition(val, cursorPos) {
    var before = val.slice(0, cursorPos);
    var depth = 0;
    var bracketStart = -1;
    for (var i = before.length - 1; i >= 0; i--) {
      if (before[i] === ']') { depth++; }
      else if (before[i] === '[') {
        if (depth === 0) { bracketStart = i; break; }
        depth--;
      }
    }
    if (bracketStart === -1) return false;
    var inBracket = val.slice(bracketStart + 1, cursorPos);
    return inBracket.length === 0 || inBracket[inBracket.length - 1] === '/';
  }

  /* ------------------------------------------------------------------ */
  /* ハイライト適用                                                      */
  /* ------------------------------------------------------------------ */
  function attachHighlight(ta) {
    if (!ta) return null;

    /* wrapper で包む */
    var wrapper = document.createElement('div');
    wrapper.className = 'editor-hl-wrapper';
    ta.parentNode.insertBefore(wrapper, ta);
    wrapper.appendChild(ta);

    /* overlay (DOM上は ta の前、CSS z-index:1 で視覚的に前面) */
    var ov = document.createElement('div');
    ov.className = 'editor-hl-overlay';
    ov.setAttribute('aria-hidden', 'true');
    wrapper.insertBefore(ov, ta);

    ta.classList.add('editor-hl-textarea');

    /* フォント・パディングは変化しないため一度だけ設定 */
    initOverlayStaticStyles(ta, ov);

    var composing = false;
    var raf = 0;

    function render() {
      syncOverlaySize(ta, ov);
      ov.innerHTML = convertToColoredHTML(ta.value);
      ov.scrollTop  = ta.scrollTop;
      ov.scrollLeft = ta.scrollLeft;
    }

    function schedule() {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { raf = 0; render(); });
    }

    /* ---- IME: 確定前は overlay を非表示・textarea を通常表示 ---- */
    ta.addEventListener('compositionstart', function () {
      composing = true;
      ta.classList.add('editor-hl-composing');
      ov.style.opacity = '0';
    });
    ta.addEventListener('compositionend', function () {
      composing = false;
      ta.classList.remove('editor-hl-composing');
      ov.style.opacity = '';
      schedule();
    });

    ta.addEventListener('input',  function () { if (!composing) schedule(); });
    ta.addEventListener('scroll', function () {
      ov.scrollTop  = ta.scrollTop;
      ov.scrollLeft = ta.scrollLeft;
    });

    /* ---- キーボード補助入力 ---- */
    ta.addEventListener('keydown', function (e) {
      if (e.isComposing || composing) return;

      var sel    = ta.selectionStart;
      var selEnd = ta.selectionEnd;
      var val    = ta.value;

      /* Backspace: ブラケットペアをまとめて削除 */
      if (e.key === 'Backspace' && sel === selEnd && sel > 0) {
        var pc = val[sel - 1], nc = val[sel];
        if ((pc === '[' && nc === ']') || (pc === '{' && nc === '}')) {
          e.preventDefault();
          ta.value = val.slice(0, sel - 1) + val.slice(sel + 1);
          ta.selectionStart = ta.selectionEnd = sel - 1;
          schedule();
          return;
        }
      }

      /* ] / } : 自動挿入済みならカーソルをスキップ */
      if ((e.key === ']' && val[sel] === ']') || (e.key === '}' && val[sel] === '}')) {
        e.preventDefault();
        ta.selectionStart = ta.selectionEnd = sel + 1;
        return;
      }

      /* [ → [] */
      if (e.key === '[') {
        e.preventDefault();
        ta.value = val.slice(0, sel) + '[]' + val.slice(selEnd);
        ta.selectionStart = ta.selectionEnd = sel + 1;
        schedule();
        return;
      }

      /* { → {} */
      if (e.key === '{') {
        e.preventDefault();
        ta.value = val.slice(0, sel) + '{}' + val.slice(selEnd);
        ta.selectionStart = ta.selectionEnd = sel + 1;
        schedule();
        return;
      }

      /* [] 内ルート音位置で a-g → A-G */
      /* ただし A-G の直後の b はフラット記号なので変換しない */
      if (/^[a-g]$/.test(e.key) && sel === selEnd) {
        if (isRootPosition(val, sel)) {
          var isFlat = e.key === 'b' && /[A-G]/.test(val[sel - 1] || '');
          if (!isFlat) {
            e.preventDefault();
            ta.value = val.slice(0, sel) + e.key.toUpperCase() + val.slice(selEnd);
            ta.selectionStart = ta.selectionEnd = sel + 1;
            schedule();
          }
        }
      }
    });

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(schedule).observe(ta);
    }

    render();
    return { render: render };
  }

  /* ------------------------------------------------------------------ */
  /* 自動適用 (#chordPro が存在する場合)                                */
  /* ------------------------------------------------------------------ */
  var defaultTa = document.getElementById('chordPro');
  var defaultInst = attachHighlight(defaultTa);

  /* ------------------------------------------------------------------ */
  /* 公開 API                                                            */
  /* ------------------------------------------------------------------ */
  global.ChordWikiEditorHighlight = Object.freeze({
    /** edit.js の populateForm() 後に呼ぶ手動再描画 */
    render: function () { if (defaultInst) defaultInst.render(); },
    /** テスト用: 任意の textarea にハイライトを適用する */
    attach: attachHighlight
  });

})(window);
