let originalChordPro = '';
let transposeSemitones = 0;

const MIN_TRANSPOSE = -6;
const MAX_TRANSPOSE = 6;

function clampTranspose(value) {
  return Math.max(MIN_TRANSPOSE, Math.min(MAX_TRANSPOSE, value));
}

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

async function loadSong() {
  const artist = getQueryParam('artist');
  const id = getQueryParam('id');

  const titleEl = document.getElementById('title');
  const artistEl = document.getElementById('artist');
  const keyEl = document.getElementById('key');   // ★追加
  const sheetEl = document.getElementById('sheet');

  if (!artist || !id) {
    titleEl.textContent = 'Invalid parameters';
    artistEl.textContent = '';
    if (keyEl) keyEl.textContent = '';            // ★追加
    sheetEl.textContent = 'artist または id が指定されていません。';
    return;
  }

  try {
    const response = await fetch(
      `/api/song/${encodeURIComponent(artist)}/${encodeURIComponent(id)}`,
      { credentials: 'include' } // ★認証環境なら付けると安定
    );

    if (response.status === 404) {
      titleEl.textContent = 'Song not found';
      artistEl.textContent = '';
      if (keyEl) keyEl.textContent = '';          // ★追加
      sheetEl.textContent = '指定された曲が見つかりませんでした。';
      return;
    }

    const song = await response.json();
    originalChordPro = song.chordPro || '';
    const renderResult = renderChordWikiLike(originalChordPro, sheetEl, transposeSemitones);

    titleEl.textContent = renderResult.title || song.title || 'タイトルなし';
    artistEl.textContent = renderResult.subtitle || song.artist || '';

    // ★追加：Key 表示（CSSで赤字ボールドにする）
    if (keyEl) {
      const k = renderResult.key || song.key || '';
      keyEl.textContent = k ? `Key: ${k}` : '';
    }

  } catch (error) {
    console.error('Error loading song:', error);
    titleEl.textContent = 'Error loading song';
    artistEl.textContent = '';
    if (keyEl) keyEl.textContent = '';            // ★追加
    document.getElementById('sheet').textContent = '曲の読み込み中にエラーが発生しました。';
  }
}

function updateTransposeDisplay() {
  const displayEl = document.getElementById('transpose-display');
  if (displayEl) {
    displayEl.textContent = `Transpose: ${transposeSemitones}`;
  }

  const downButton = document.getElementById('transpose-down');
  const upButton = document.getElementById('transpose-up');

  if (downButton) downButton.disabled = transposeSemitones <= MIN_TRANSPOSE;
  if (upButton) upButton.disabled = transposeSemitones >= MAX_TRANSPOSE;
}

function reRender() {
  const sheetEl = document.getElementById('sheet');
  renderChordWikiLike(originalChordPro, sheetEl, transposeSemitones);
  updateTransposeDisplay();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('transpose-down').addEventListener('click', () => {
    transposeSemitones = clampTranspose(transposeSemitones - 1);
    reRender();
  });

  document.getElementById('transpose-up').addEventListener('click', () => {
    transposeSemitones = clampTranspose(transposeSemitones + 1);
    reRender();
  });

  document.getElementById('transpose-reset').addEventListener('click', () => {
    transposeSemitones = 0;
    reRender();
  });

  updateTransposeDisplay();
  loadSong();
});