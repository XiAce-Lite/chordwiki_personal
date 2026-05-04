(function attachLocalTestSongLibrary(global) {
  const sampleSong = {
    id: 'sample-song-001',
    artist: 'Local Sample',
    title: 'Local Sample 001',
    slug: 'sample-song-001',
    key: 'G',
    tags: ['local', 'sample', 'test'],
    youtube: [{ id: 'mz5huG6uKUM', start: 0 }],
    score: 30,
    display_score: 30,
    chordPro: [
      '{title: Local Sample 001}',
      '{subtitle: Local Sample}',
      '{key: G}',
      '',
      '{comment: Verse}',
      '| [G]ここから [D]テスト [Em7]データ [C]表示',
      '| [G]スタート [D]挙動を [Em7]確認 [C]できます',
      '',
      '{comment: Chorus}',
      '| [G]ローカル [D]サンプル [Em7]ロード [C]成功',
      '| [G]VSCode [D]ブラウザで [Em7]見える [C]状態'
    ].join('\n')
  };

  global.__LOCAL_TEST_SONG_LIBRARY__ = {
    generatedAt: '2026-05-04',
    songs: [sampleSong]
  };
  global.__LOCAL_TEST_SONG__ = sampleSong;
})(window);
