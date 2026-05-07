/**
 * editor-highlight.js
 * ChordPro シンタックスハイライト (textarea overlay 方式)
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
  function syncOverlay(ta, ov) {
    var cs = getComputedStyle(ta);
    /* 位置: テキストエリアのボーダー内側の角に合わせる */
    ov.style.top  = cs.borderTopWidth;
    ov.style.left = cs.borderLeftWidth;
    /* サイズ: clientWidth/Height はスクロールバー・ボーダーを除いた内側幅 */
    ov.style.width  = ta.clientWidth  + 'px';
    ov.style.height = ta.clientHeight + 'px';
    ov.style.boxSizing     = 'border-box';
    /* パディングをテキストエリアと揃える */
    ov.style.paddingTop    = cs.paddingTop;
    ov.style.paddingRight  = cs.paddingRight;
    ov.style.paddingBottom = cs.paddingBottom;
    ov.style.paddingLeft   = cs.paddingLeft;
    /* フォントをテキストエリアと揃える */
    ov.style.fontFamily    = cs.fontFamily;
    ov.style.fontSize      = cs.fontSize;
    ov.style.fontWeight    = cs.fontWeight;
    ov.style.lineHeight    = cs.lineHeight;
    ov.style.letterSpacing = cs.letterSpacing;
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

    /* overlay (テキストエリアの後ろに重ねる) */
    var ov = document.createElement('div');
    ov.className = 'editor-hl-overlay';
    ov.setAttribute('aria-hidden', 'true');
    wrapper.insertBefore(ov, ta); /* ta の前 = DOM上は先 → z-index で後ろに */

    /* テキストエリアを透明化 */
    ta.classList.add('editor-hl-textarea');

    var composing = false;
    var raf = 0;

    function render() {
      syncOverlay(ta, ov);
      ov.innerHTML = convertToColoredHTML(ta.value);
      ov.scrollTop  = ta.scrollTop;
      ov.scrollLeft = ta.scrollLeft;
    }

    function schedule() {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(function () { raf = 0; render(); });
    }

    ta.addEventListener('compositionstart', function () { composing = true; });
    ta.addEventListener('compositionend',   function () { composing = false; schedule(); });
    ta.addEventListener('input',  function () { if (!composing) schedule(); });
    ta.addEventListener('scroll', function () {
      ov.scrollTop  = ta.scrollTop;
      ov.scrollLeft = ta.scrollLeft;
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
