(function attachLocalTestSongLibrary(global) {
  const sampleSong = {
    id: 'local-measure-align-sample',
    artist: 'Local QA Band',
    title: '小節揃え・均等割りテスト',
    slug: 'local-measure-align-sample',
    key: 'C',
    tags: ['local', 'layout-test', 'measure-align', 'bar', 'sample'],
    youtube: [{ id: 'mz5huG6uKUM', start: 0 }],
    score: 60,
    display_score: 59,
    chordPro: [
      '{title: 小節揃え・均等割りテスト}',
      '{subtitle: Local QA Band}',
      '{key: C}',
      '{comment: 表示カスタマイズON → 「ブロック内の小節線を揃える」で確認}',
      '{comment: 各行は先頭・末尾とも | で閉じた4小節。短フレーズと長フレーズを混在}',
      '',
      '{comment: Block A（横に長い・4小節×3行）}',
      '| [C]あ [G]い | [Am]うたえよ こころのままに [F]ひびけ | [C]ひかり [G]みちて | [Am]ながいことばをつないでうたうよ [F]ほら |',
      '| [C]ちいさな [G]ね | [Am]あさのメロディをそっと [F]かなで | [C]ゆめ [G]みて | [Am]きょうもまたここから歩きだすよ [F]うた |',
      '| [C]わ [G]た | [Am]きみのなまえをよんでみる [F]たび | [C]そら [G]へと | [Am]とおくひびかせてみたいなフレーズ [F]いま |',
      '',
      '{comment: Block B（短いブロック・4小節×2行）}',
      '| [Dm]あお [G]い | [C]そら | [Am]かぜ [F]よ | [G]ふけ |',
      '| [Dm]ちい [G]さ | [C]な | [Am]ひ [F]と | [G]つぶ |',
      '',
      '{comment: Block C（中くらい・短長混在）}',
      '| [F]はじまりの [C]おと | [Dm]きこえるかな [Am]そっと | [Bb]とおくにひびく [F]こえ | [C]いま |',
      '| [F]みじかい [C]ひ | [Dm]ながいことばのよるをこえて [Am]うたう | [Bb]かさなる [F]リズム | [C]ここ |',
      '| [F]あ [C]お | [Dm]い [Am]ろ | [Bb]そらにうかぶ [F]くも | [C]ひとつふたつとながれていく |'
    ].join('\n')
  };

  global.__LOCAL_TEST_SONG_LIBRARY__ = {
    generatedAt: '2026-08-02',
    songs: [sampleSong]
  };
  global.__LOCAL_TEST_SONG__ = sampleSong;
})(window);
