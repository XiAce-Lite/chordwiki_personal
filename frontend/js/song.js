function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

async function loadSong() {
  const artist = getQueryParam('artist');
  const id = getQueryParam('id');
  const titleEl = document.getElementById('title');
  const artistEl = document.getElementById('artist');
  const sheetEl = document.getElementById('sheet');

  if (!artist || !id) {
    titleEl.textContent = 'Invalid parameters';
    artistEl.textContent = '';
    sheetEl.textContent = 'artist または id が指定されていません。';
    return;
  }

  try {
    const response = await fetch(`/api/song/${encodeURIComponent(artist)}/${encodeURIComponent(id)}`);
    if (response.status === 404) {
      titleEl.textContent = 'Song not found';
      artistEl.textContent = '';
      sheetEl.textContent = '指定された曲が見つかりませんでした。';
      return;
    }

    const song = await response.json();
    const renderResult = renderChordWikiLike(song.chordPro || '', sheetEl);

    titleEl.textContent = renderResult.title || song.title || 'タイトルなし';
    artistEl.textContent = renderResult.subtitle || song.artist || '';
  } catch (error) {
    console.error('Error loading song:', error);
    titleEl.textContent = 'Error loading song';
    artistEl.textContent = '';
    document.getElementById('sheet').textContent = '曲の読み込み中にエラーが発生しました。';
  }
}

window.onload = loadSong;
