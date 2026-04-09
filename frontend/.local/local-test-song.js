(function attachLocalTestSongLibrary(global) {
  const DEFAULT_YOUTUBE = [{ id: 'mz5huG6uKUM', start: 0 }];

  const seedSongs = [
    { title: 'Blue Horizon', artist: 'North Wind', tags: ['rock', 'バンド', '定番'], score: 36 },
    { title: '帰り道のメロディ', artist: '夕暮れノート', tags: ['バラード', '女性', 'しっとり'], score: 34 },
    { title: 'Morning Light', artist: 'Acoustic Lane', tags: ['acoustic', '朝', 'やさしい'], score: 32 },
    { title: '夜明けの賛歌', artist: 'Grace Echo', tags: ['worship', '礼拝', 'コーラス'], score: 31 },
    { title: 'Signal Fire', artist: 'Metro Line', tags: ['rock', 'ライブ', '疾走感'], score: 29 },
    { title: '小さな祈り', artist: 'Haru', tags: ['祈り', '女性', 'piano'], score: 28 },
    { title: 'Open Road', artist: 'Highway Stars', tags: ['drive', 'male', '爽快'], score: 27 },
    { title: '星屑ダイアリー', artist: 'Luna Park', tags: ['ポップ', '夜', '人気'], score: 26 },
    { title: 'Canvas', artist: 'Color Notes', tags: ['piano', 'duet', 'やさしい'], score: 25 },
    { title: '風のしるし', artist: '青空合唱団', tags: ['礼拝', '合唱', '定番'], score: 24 },
    { title: 'Echo Bloom', artist: 'Petal Tone', tags: ['female', 'spring', 'ballad'], score: 23 },
    { title: 'Last Train', artist: 'Night Shift', tags: ['rock', 'male', 'ライブ'], score: 22 }
  ];

  const progressionSets = [
    {
      key: 'G',
      verse1: ['G', 'D/F#', 'Em7', 'Bm7', 'Cadd9', 'G/B', 'Am7', 'D7sus4'],
      verse2: ['G', 'D/F#', 'Em7', 'Bm7', 'Cmaj7', 'G/B', 'Am7', 'D'],
      chorus: ['Gmaj7', 'D/F#', 'Em7', 'Bm7', 'Cadd9', 'G/B', 'Am7', 'D'],
      bridge: ['Em9', 'B7/D#', 'Cmaj7(add9)', 'G/B', 'Am7', 'Em/G', 'Cadd9', 'D7sus4']
    },
    {
      key: 'D',
      verse1: ['D', 'A/C#', 'Bm7', 'F#m7', 'Gmaj7', 'D/F#', 'Em7', 'A7'],
      verse2: ['Dadd9', 'A/C#', 'Bm7', 'F#m7', 'G', 'D/F#', 'Em9', 'A7sus4'],
      chorus: ['Dmaj7', 'A/C#', 'Bm7', 'F#m7', 'Gadd9', 'D/F#', 'Em7', 'A7'],
      bridge: ['Bm9', 'F#m/A', 'Gmaj7', 'D/F#', 'Em7', 'A7sus4', 'Dadd9', 'A']
    },
    {
      key: 'C',
      verse1: ['C', 'G/B', 'Am7', 'Em7', 'Fmaj7', 'C/E', 'Dm7', 'G7'],
      verse2: ['Cadd9', 'G/B', 'Am9', 'Em7', 'Fmaj7', 'C/E', 'Dm7', 'Gsus4'],
      chorus: ['Cmaj7', 'G/B', 'Am7', 'Em7', 'Fadd9', 'C/E', 'Dm7', 'G'],
      bridge: ['Am7', 'Em/G', 'Fmaj7(add9)', 'C/E', 'Dm9', 'G7sus4', 'Cadd9', 'G']
    },
    {
      key: 'E',
      verse1: ['E', 'B/D#', 'C#m7', 'G#m7', 'Aadd9', 'E/G#', 'F#m7', 'B7'],
      verse2: ['Emaj7', 'B/D#', 'C#m9', 'G#m7', 'Amaj7', 'E/G#', 'F#m7', 'B7sus4'],
      chorus: ['Eadd9', 'B/D#', 'C#m7', 'G#m7', 'Aadd9', 'E/G#', 'F#m7', 'B7'],
      bridge: ['C#m7', 'G#m/B', 'Amaj7', 'E/G#', 'F#m9', 'B7sus4', 'E6/9', 'B']
    }
  ];

  const lyricBanks = [
    {
      verse1: ['あさの', 'ひかり', 'まどを', 'あけて', 'ちいさな', 'こえを', 'そっと', 'つなぐ'],
      verse2: ['ふかい', 'こきゅう', 'こころを', 'よせて', 'やさしい', 'ひびき', 'つぎの', 'いっぽ'],
      chorus: ['ひびく', 'メロディ', 'かわる', 'けしき', 'まぶしい', 'ことば', 'たしかに', 'ひろがる'],
      bridge: ['しずかな', 'いのり', 'ゆっくり', 'あるく', 'ながれる', 'そらに', 'ひかりを', 'むける']
    },
    {
      verse1: ['よるの', 'かぜが', 'そっと', 'ふれて', 'きらめく', 'ねがいを', '胸に', 'たくす'],
      verse2: ['とおい', 'みらい', 'たしかな', 'こどう', 'ちいさな', 'しるしを', '今も', 'たどる'],
      chorus: ['つよく', 'うたう', 'こえが', 'ひびき', 'あたらしい', '景色', 'ここから', 'はじまる'],
      bridge: ['やわらかい', 'ひかり', '静かな', 'あゆみ', 'つないだ', 'ことば', '明日へ', 'むかう']
    },
    {
      verse1: ['あおい', 'そらに', 'ひとつ', 'しるし', 'なみだを', 'こえて', 'きみと', 'すすむ'],
      verse2: ['そっと', 'えがく', 'ことば', 'のなか', 'ぬくもり', 'のこして', '歌を', 'つなぐ'],
      chorus: ['めぐる', 'きせつ', 'こえて', 'いまも', 'かさなる', 'ひびき', 'たしかな', 'ねがい'],
      bridge: ['しんじる', 'こころ', 'ゆらいで', 'いても', 'まぶしい', '未来', 'この手で', 'ひらく']
    }
  ];

  function cleanWord(value, fallback = 'ことば') {
    const normalized = String(value || '')
      .trim()
      .split(/\s+/)[0]
      .replace(/[\[\]{}|]/g, '');
    return normalized || fallback;
  }

  function baseTitle(title = '') {
    return String(title || '').replace(/\s+\d+$/, '').trim();
  }

  function composeMeasuredLine(chords, words) {
    return `| [${chords[0]}]${words[0]} [${chords[1]}]${words[1]} | [${chords[2]}]${words[2]} [${chords[3]}]${words[3]} | [${chords[4]}]${words[4]} [${chords[5]}]${words[5]} | [${chords[6]}]${words[6]} [${chords[7]}]${words[7]}`;
  }

  function composeTwoBarLine(chords, words) {
    return `| [${chords[0]}]${words[0]} [${chords[1]}]${words[1]} | [${chords[2]}]${words[2]} [${chords[3]}]${words[3]}`;
  }

  function buildLongScrollChordPro() {
    const progressions = [
      ['G', 'D', 'Em7', 'C'],
      ['G', 'D/F#', 'Em7', 'Cadd9'],
      ['G/B', 'D', 'Em7', 'C'],
      ['G', 'D', 'Em7', 'Cmaj7']
    ];

    const sections = [
      {
        label: 'Verse 1',
        lines: [
          ['あさの', 'ひかり', 'まどに', 'ゆれる'],
          ['ちいさな', 'いのり', 'そっと', 'つなぐ'],
          ['きみの', 'ことば', '今日も', 'ひびく'],
          ['遠くの', 'けしき', '少し', '近づく'],
          ['歩けば', 'リズム', '胸に', 'めぐる'],
          ['やさしい', 'メロディ', '道を', 'てらす'],
          ['同じ', 'フレーズ', '何度も', '歌う'],
          ['それでも', '心は', '前へ', 'すすむ']
        ]
      },
      {
        label: 'Verse 2',
        lines: [
          ['かわる', '季節', '風に', 'まかせ'],
          ['しずかな', '願い', '空へ', 'のぼる'],
          ['きのうの', '涙', 'そっと', 'ほどけ'],
          ['あたらしい', '朝が', 'ここに', '灯る'],
          ['歩けば', 'リズム', '胸に', 'めぐる'],
          ['やさしい', 'メロディ', '道を', 'てらす'],
          ['同じ', 'ことばを', '今日も', '重ね'],
          ['それでも', '心は', '前へ', 'すすむ']
        ]
      },
      {
        label: 'Chorus',
        lines: [
          ['めぐる', '灯り', '道を', '照らす'],
          ['ひらく', '未来', '歌に', 'かわる'],
          ['きみと', '僕で', '声を', 'かさね'],
          ['長い', '夜でも', '越えて', 'ゆける'],
          ['めぐる', '灯り', '胸に', 'のこる'],
          ['つよい', '願い', '明日を', 'ひらく'],
          ['きみと', '僕で', '何度', 'でもまた'],
          ['同じ', 'サビを', '高く', 'うたう']
        ]
      },
      {
        label: 'Verse 3',
        lines: [
          ['雨あがり', 'みちに', '虹が', 'のびる'],
          ['ぬれた', 'くつ音', '少し', '軽い'],
          ['こぼれた', '息を', 'そっと', '集め'],
          ['新しい', 'ページ', 'また', 'めくる'],
          ['歩けば', 'リズム', '胸に', 'めぐる'],
          ['やさしい', 'メロディ', '道を', 'てらす'],
          ['同じ', 'フレーズ', '何度も', '歌う'],
          ['それでも', '心は', '前へ', 'すすむ']
        ]
      },
      {
        label: 'Chorus 2',
        lines: [
          ['めぐる', '灯り', '道を', '照らす'],
          ['ひらく', '未来', '歌に', 'かわる'],
          ['きみと', '僕で', '声を', 'かさね'],
          ['長い', '夜でも', '越えて', 'ゆける'],
          ['めぐる', '灯り', '胸に', 'のこる'],
          ['つよい', '願い', '明日を', 'ひらく'],
          ['きみと', '僕で', '何度', 'でもまた'],
          ['同じ', 'サビを', '高く', 'うたう']
        ]
      },
      {
        label: 'Outro',
        lines: [
          ['あさの', 'ひかり', 'また', 'めぐる'],
          ['ちいさな', 'いのり', '今日も', 'つづく'],
          ['きみの', 'ことば', '胸に', 'のこる'],
          ['長い', 'みちでも', '歌は', 'つづく'],
          ['あさの', 'ひかり', 'また', 'めぐる'],
          ['ちいさな', 'いのり', '今日も', 'つづく'],
          ['きみの', 'ことば', '胸に', 'のこる'],
          ['長い', 'みちでも', '歌は', 'つづく']
        ]
      }
    ];

    const lines = [
      '{title: 巡る灯りのロングロード}',
      '{subtitle: Local Sample Choir}',
      '{key: G}',
      ''
    ];

    sections.forEach((section) => {
      lines.push(`{comment: ${section.label}}`);
      section.lines.forEach((words, index) => {
        lines.push(composeTwoBarLine(progressions[index % progressions.length], words));
      });
      lines.push('');
    });

    return lines.join('\n').trim();
  }

  function buildStandardChordPro(song, order = 0) {
    const progression = progressionSets[order % progressionSets.length];
    const lyrics = lyricBanks[order % lyricBanks.length];
    const titleWord = cleanWord(baseTitle(song.title), 'メロディ');
    const tagWord = cleanWord(song.tags?.[0], 'うた');
    const accentWord = cleanWord(song.tags?.[1], 'ひびき');

    return `{title: ${song.title}}\n{subtitle: ${song.artist}}\n{key: ${progression.key}}\n\n{comment: Verse}\n${composeMeasuredLine(progression.verse1, [lyrics.verse1[0], lyrics.verse1[1], titleWord, lyrics.verse1[3], tagWord, lyrics.verse1[5], lyrics.verse1[6], accentWord])}\n${composeMeasuredLine(progression.verse2, [lyrics.verse2[0], lyrics.verse2[1], lyrics.verse2[2], titleWord, lyrics.verse2[4], tagWord, lyrics.verse2[6], lyrics.verse2[7]])}\n\n{comment: Chorus}\n${composeMeasuredLine(progression.chorus, [lyrics.chorus[0], titleWord, lyrics.chorus[2], accentWord, lyrics.chorus[4], tagWord, lyrics.chorus[6], lyrics.chorus[7]])}\n\n{comment: Bridge}\n${composeMeasuredLine(progression.bridge, [lyrics.bridge[0], lyrics.bridge[1], tagWord, lyrics.bridge[3], lyrics.bridge[4], accentWord, lyrics.bridge[6], lyrics.bridge[7]])}`;
  }

  function createGeneratedSong(seed, order, round) {
    const suffix = round === 0 ? '' : ` ${round + 1}`;
    const score = Math.max(1, seed.score - (round * 2) - (order % 3));
    const displayScore = Math.max(0, score - (round % 2));
    const title = `${seed.title}${suffix}`;
    const artist = `${seed.artist}${suffix}`;
    const progression = progressionSets[(order - 1) % progressionSets.length];

    return {
      id: `local-song-${order}`,
      artist,
      title,
      slug: `local-song-${order}`,
      key: progression.key,
      tags: seed.tags.slice(),
      youtube: DEFAULT_YOUTUBE.slice(),
      score,
      display_score: displayScore,
      last_viewed_at: null,
      chordPro: buildStandardChordPro({ title, artist, tags: seed.tags.slice() }, order - 1)
    };
  }

  const longScrollSong = {
    id: 'local-long-scroll-sample',
    artist: 'Local Sample Choir',
    title: '巡る灯りのロングロード',
    slug: 'local-long-scroll-sample',
    key: 'G',
    tags: ['local', 'long-scroll', 'sample', 'vertical', 'loop', 'practice'],
    youtube: DEFAULT_YOUTUBE.slice(),
    score: 42,
    display_score: 41,
    last_viewed_at: null,
    chordPro: buildLongScrollChordPro()
  };

  const longLineSong = {
    id: 'local-long-line-test',
    artist: 'Local QA Band',
    title: 'スマホ幅テスト用ロング譜面 3ケース',
    slug: 'local-long-line-test',
    key: 'G',
    tags: ['local', 'layout-test', 'narrow', 'sample', 'bar', 'no-bar', 'scroll'],
    youtube: DEFAULT_YOUTUBE.slice(),
    score: 35,
    display_score: 34,
    last_viewed_at: null,
    chordPro: `{title: スマホ幅テスト用ロング譜面 3ケース}
{subtitle: Local QA Band}
{key: G}

{comment: Case A - 小節線あり / 1行8小節 / 1小節2コード想定}
| [G]あさの [D/F#]ひかり | [Em7]まどを [Bm7]ぬけて | [Cadd9]ながい [G/B]ことば | [Am7]そっと [D]つなぐ | [G]きみの [D/F#]なまえ | [Em7]やさしく [Bm7]よべば | [Cadd9]せまい [G/B]がめんで | [Am7]どこまで [D]みえる
| [G]ふかい [D/F#]こきゅう | [Em7]ゆれる [Bm7]りずむ | [Cmaj7]こーどが [G/B]かさなり | [Am7]ことばが [D]あふれる | [G]とおい [D/F#]ねがい | [Em7]ちかい [Bm7]みらい | [Cadd9]せまい [G/B]はばでも | [Am7]うたえる [D]ように

{comment: Case B - 小節線なし / 長い行 / コード+歌詞ペア連続}
[G]あさの [D/F#]ひかり [Em7]まどを [Bm7]ぬけて [Cadd9]ながい [G/B]ことば [Am7]そっと [D]つなぐ [G]きみの [D/F#]なまえ [Em7]やさしく [Bm7]よべば [Cadd9]せまい [G/B]がめんで [Am7]どこまで [D]みえる
[Gmaj7]ひびく [D/F#]めろでぃ [Em7]かわる [Bm7]けしき [Cadd9]まぶしい [G/B]おもいで [Am7]たしかに [D]ひろがる [G]ながめの [D/F#]ふれーず [Em7]のばした [Bm7]こえで [Cmaj7]すまほの [G/B]はばでも [Am7]かさなら [D]ないように

{comment: Case C - それでも厳しいケース / 横スクロール fallback 確認用}
[Gmaj7(add9)/B]あさやけのひかりがながれる [D/F#(omit3)]まどべでそっといのる [Em11]ことばにならないおもいを [Bm7(add11)]むねのおくでつないで [Cadd9(omit5)]せまいがめんのなかでも [G/B]ふれーずをくずさずに [Am7(9)]うたいつづけたいきもちを [D7sus4]たしかめながらあるく
[Em9]こころを [B7/D#]よせて [Cmaj7(add9)]しずかな [G/B]いのり [Am7]ゆっくり [Em/G]あるく [F#m7-5]よるを [B7alt]こえて [Em7(add11)]ながれる [A7sus4]そらに [Dmaj7/F#]ひかりを [G/B]むけて [Cadd9]つぎの [D]いっぽを [G6/9]いまここで [D/F#]うたう`
  };

  const songs = [longScrollSong, longLineSong];

  for (let round = 0; round < 3; round += 1) {
    seedSongs.forEach((seed, index) => {
      const order = (round * seedSongs.length) + index + 1;
      songs.push(createGeneratedSong(seed, order, round));
    });
  }

  global.__LOCAL_TEST_SONG_LIBRARY__ = {
    generatedAt: '2026-04-09',
    songs
  };
  global.__LOCAL_TEST_SONG__ = longScrollSong;
})(window);
