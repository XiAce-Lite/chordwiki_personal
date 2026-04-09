(function attachLocalTestSongs(global) {
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

  const songs = [
    {
      id: 'local-long-line-test',
      artist: 'Local QA Band',
      title: 'スマホ幅テスト用ロング譜面 3ケース',
      slug: 'local-long-line-test',
      tags: ['local', 'layout-test', 'narrow', 'sample', 'bar', 'no-bar', 'scroll'],
      score: 35,
      display_score: 34,
      last_viewed_at: null
    }
  ];

  for (let round = 0; round < 3; round += 1) {
    seedSongs.forEach((seed, index) => {
      const order = (round * seedSongs.length) + index + 1;
      const suffix = round === 0 ? '' : ` ${round + 1}`;
      const score = Math.max(1, seed.score - (round * 2) - (index % 3));
      const displayScore = Math.max(0, score - (round % 2));

      songs.push({
        id: `local-song-${order}`,
        artist: `${seed.artist}${suffix}`,
        title: `${seed.title}${suffix}`,
        slug: `local-song-${order}`,
        tags: seed.tags.slice(),
        score,
        display_score: displayScore,
        last_viewed_at: null
      });
    });
  }

  global.__LOCAL_TEST_SONGS__ = {
    generatedAt: '2026-04-09',
    songs
  };
})(window);
