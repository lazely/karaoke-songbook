'use strict';

/* ============================================================
   노래방 수첩
   - 내 목록: 검색(초성/가나/로마자) · 태그 필터 · 플리
   - 노래방 DB: api.manana.kr (TJ/금영/DAM/JOYSOUND 곡번호 조회)
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const HUES = ['#0a84ff', '#34c759', '#ff9f0a', '#ff453a', '#bf5af2', '#5e5ce6', '#ff375f', '#30b0c7'];
const JAMO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JAMO_RE = /^[\u3131-\u314e]+$/;

const DB_BASE = 'https://api.manana.kr/karaoke';
const BRANDS = { tj: 'TJ', kumyoung: '금영', dam: 'DAM', joysound: 'JOY' };
const BRAND_RANK = { tj: 0, kumyoung: 1, dam: 2, joysound: 3 };

/* ---------------- 정규화 ---------------- */

const toHira = (s) => s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

function norm(s) {
  return toHira(String(s ?? '').normalize('NFKC').toLowerCase()).replace(/[^\p{L}\p{N}]+/gu, '');
}

function choseong(s) {
  let out = '';
  for (const ch of String(s ?? '')) {
    const c = ch.codePointAt(0);
    if (c >= 0xac00 && c <= 0xd7a3) out += JAMO[Math.floor((c - 0xac00) / 588)];
    else if (c >= 0x3131 && c <= 0x314e) out += ch;
    else if (c >= 0x30a1 && c <= 0x30f6) out += ch;
    else if (c >= 0x41 && c <= 0x5a) out += ch.toLowerCase();
  }
  return out;
}

/* ---------------- 상태 ---------------- */

const STORE_KEY = 'karaoke.v1';

const PRESET_TAGS = [
  { id: 'tg-confident', label: '자신있음', hue: '#34c759' },
  { id: 'tg-condition', label: '컨디션 좋으면', hue: '#ff9f0a' },
  { id: 'tg-tone', label: '음색 안 어울림', hue: '#ff453a' },
  { id: 'tg-duet', label: '듀엣', hue: '#bf5af2' },
];

const SAMPLE = [
  { title: '残酷な天使のテーゼ', artist: '高橋洋子', reading: 'zankoku na tenshi no teeze / ざんこくなてんしのてーぜ' },
  { title: '夜に駆ける', artist: 'YOASOBI', reading: 'yoru ni kakeru / よるにかける' },
  { title: 'Lemon', artist: '米津玄師', reading: 'remon / れもん' },
  { title: 'ドライフラワー', artist: '優里', reading: 'dry flower / どらいふらわー' },
  { title: '밤편지', artist: '아이유', reading: 'bam pyeonji' },
  { title: '사랑은 늘 도망가', artist: '임영웅', reading: 'sarang-eun neul domangga' },
];

let state = { songs: [], tags: [], playlists: [], settings: { theme: 'dark' } };

const ui = {
  view: 'songs',
  q: '',
  tags: new Set(),
  matchAll: true,
  sort: 'recent',
  playlistId: null,
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      state = {
        songs: Array.isArray(d.songs) ? d.songs.map(cleanSong) : [],
        tags: Array.isArray(d.tags) ? d.tags : PRESET_TAGS.map((t) => ({ ...t })),
        playlists: Array.isArray(d.playlists) ? d.playlists : [],
        settings: { theme: 'dark', ...(d.settings || {}) },
      };
      return;
    }
  } catch (err) {
    console.warn('load failed', err);
  }
  state.tags = PRESET_TAGS.map((t) => ({ ...t }));
  state.songs = SAMPLE.map((s, i) => ({
    id: uid() + i,
    title: s.title,
    artist: s.artist || '',
    reading: s.reading || '',
    memo: '',
    number: '',
    tags: [],
    sample: true,
    createdAt: Date.now() - i * 1000,
    updatedAt: Date.now() - i * 1000,
  }));
  state.playlists = [];
  save();
}

function cleanSong(s) {
  return {
    id: s.id || uid(),
    title: s.title || '',
    artist: s.artist || '',
    reading: s.reading || '',
    memo: s.memo || '',
    number: s.number || '',
    tags: Array.isArray(s.tags) ? s.tags : [],
    sample: !!s.sample,
    createdAt: s.createdAt || Date.now(),
    updatedAt: s.updatedAt || Date.now(),
  };
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (err) {
    toast('저장 실패 · 저장 공간을 확인해 주세요');
  }
}

const tagOf = (id) => state.tags.find((t) => t.id === id);
const songOf = (id) => state.songs.find((s) => s.id === id);

/* ---------------- 내 목록 검색 ---------------- */

function haystack(s) {
  const labels = s.tags.map((id) => tagOf(id)?.label || '');
  return [s.title, s.artist, s.reading, s.memo, s.number, ...labels].map(norm).join('|');
}

function matchTokens(s, tokens) {
  const hay = haystack(s);
  const cho = choseong(s.title + s.artist + s.reading);
  return tokens.every((t) => (JAMO_RE.test(t) ? cho.includes(t) : hay.includes(norm(t))));
}

function visibleSongs() {
  const tokens = ui.q.trim().split(/\s+/).filter(Boolean);
  const picked = [...ui.tags];
  const list = state.songs.filter((s) => {
    if (picked.length) {
      const hit = ui.matchAll ? picked.every((t) => s.tags.includes(t)) : picked.some((t) => s.tags.includes(t));
      if (!hit) return false;
    }
    return tokens.length ? matchTokens(s, tokens) : true;
  });
  const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
  if (ui.sort === 'title') list.sort((a, b) => collator.compare(a.title, b.title));
  else if (ui.sort === 'artist') list.sort((a, b) => collator.compare(a.artist || '~', b.artist || '~') || collator.compare(a.title, b.title));
  else list.sort((a, b) => b.createdAt - a.createdAt);
  return list;
}

/* ---------------- 노래방 DB 검색 ---------------- */

function fetchJson(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { signal: ctrl.signal })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
    .finally(() => clearTimeout(t));
}

/* 제목/가수로 노래방 DB 조회 → [{brand, no, title, singer}] */
async function searchDb(q, limit = 6) {
  const term = q.trim();
  if (!term) return [];
  const enc = encodeURIComponent(term);
  const [byTitle, bySinger] = await Promise.all([
    fetchJson(`${DB_BASE}/song/${enc}.json`).catch(() => []),
    fetchJson(`${DB_BASE}/singer/${enc}.json`).catch(() => []),
  ]);
  return rankDb([...(Array.isArray(byTitle) ? byTitle : []), ...(Array.isArray(bySinger) ? bySinger : [])], term, limit);
}

function rankDb(items, q, limit = 80) {
  const nq = norm(q);
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || !it.title) continue;
    const key = `${it.brand}|${it.no}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  const score = (it) => {
    const nt = norm(it.title);
    const ns = norm(it.singer);
    let s = 0;
    if (nt === nq) s += 100;
    else if (nt.startsWith(nq)) s += 55;
    else if (nt.includes(nq)) s += 25;
    if (ns === nq) s += 40;
    else if (ns.includes(nq)) s += 12;
    if (/^[[(【]/.test(it.title.trim())) s -= 35;
    if (/(カラオケ|歌ってみた|オルゴール|ピアノ|インスト|名演|サビカラ|ガイドメロディ|メドレー|ヒットソング|ベスト)/.test(it.title)) s -= 80;
    s -= Math.min(nt.length, 40) * 0.3;
    s -= (BRAND_RANK[it.brand] ?? 9) * 2;
    return s;
  };
  out.sort((a, b) => score(b) - score(a));
  return out.slice(0, limit);
}

/* ---------------- 공통 UI ---------------- */

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1900);
}

function applyTheme() {
  const t = state.settings.theme || 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function openSheet({ title, body, mount }) {
  closeSheet();
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-grab"></div>
      <div class="sheet-head">
        <h2>${esc(title)}</h2>
        <button class="icon-btn ghost" data-close aria-label="닫기">✕</button>
      </div>
      <div class="sheet-body">${body}</div>
    </div>`;
  document.body.appendChild(back);
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => back.classList.add('in'));
  back.addEventListener('click', (e) => {
    if (e.target === back || e.target.closest('[data-close]')) closeSheet();
  });
  if (mount) mount(back);
  return back;
}

function closeSheet() {
  $$('.sheet-backdrop').forEach((el) => el.remove());
  document.body.classList.remove('no-scroll');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
});

/* ---------------- 렌더 ---------------- */

const app = $('#app');
const topbar = $('#topbar');

function render() {
  applyTheme();
  renderTop();
  if (ui.view === 'songs') renderSongsView();
  else if (ui.view === 'playlists') renderPlaylistsView();
  else if (ui.view === 'playlist') renderPlaylistView();
  else renderSettingsView();
  renderTabs();
}

function renderTabs() {
  const active = ui.view === 'playlist' ? 'playlists' : ui.view;
  $$('#tabbar .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === active));
}

function renderTop() {
  const pl = ui.view === 'playlist' ? state.playlists.find((p) => p.id === ui.playlistId) : null;
  if (ui.view === 'playlist' && !pl) {
    ui.view = 'playlists';
    return render();
  }
  const isPl = ui.view === 'playlist';
  const title = isPl ? pl.name : { songs: '노래방 수첩', playlists: '플레이리스트', settings: '설정' }[ui.view];
  const add = { songs: 'newSong', playlists: 'newPlaylist' }[ui.view];
  topbar.innerHTML = `
    <div class="topbar-inner">
      ${isPl ? '<button class="icon-btn ghost" data-act="backPl" aria-label="뒤로">‹</button>' : ''}
      <h1 class="${isPl ? 'small' : ''}">${esc(title)}</h1>
      ${add ? `<button class="icon-btn" data-act="${add}" aria-label="추가">＋</button>` : '<span class="topbar-spacer"></span>'}
    </div>`;
}

/* ---------------- 곡 화면 ---------------- */

const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>';

function renderSongsView() {
  app.innerHTML = `
    <div class="pad">
      <div class="searchbox">
        ${SEARCH_ICON}
        <input id="q" type="search" autocomplete="off" enterkeyhint="search"
          placeholder="제목 · 가수 · 읽기 · 초성" value="${esc(ui.q)}">
        <button class="clearbtn" data-act="clearQ" aria-label="지우기" ${ui.q ? '' : 'hidden'}>✕</button>
      </div>
      <div class="filterrow" id="filterRow"></div>
      <div class="listbar"><span id="count"></span><div class="seg" id="sortSeg"></div></div>
      <div id="songList"></div>
    </div>`;

  const input = $('#q');
  input.addEventListener('input', () => {
    ui.q = input.value;
    $('.clearbtn').hidden = !ui.q;
    renderSongList();
  });

  renderFilterChips();
  renderSongList();
}

function renderFilterChips() {
  const row = $('#filterRow');
  if (!row) return;
  const chips = state.tags
    .map((t) => `<button class="chip ${ui.tags.has(t.id) ? 'on' : ''}" data-act="toggleTag" data-tag="${t.id}" style="--hue:${t.hue}">${esc(t.label)}</button>`)
    .join('');
  const mode = ui.tags.size > 1 ? `<button class="chip mode ${ui.matchAll ? 'on' : ''}" data-act="matchMode">${ui.matchAll ? '모두 포함' : '하나라도'}</button>` : '';
  row.innerHTML = chips + mode;
}

function renderSongList() {
  const box = $('#songList');
  if (!box) return;
  const list = visibleSongs();
  $('#count').textContent = state.songs.length ? (list.length === state.songs.length ? `${list.length}곡` : `${list.length} / ${state.songs.length}곡`) : '';
  $('#sortSeg').innerHTML = [['recent', '최근'], ['title', '제목'], ['artist', '가수']]
    .map(([v, l]) => `<button class="segbtn ${ui.sort === v ? 'on' : ''}" data-act="sort" data-v="${v}">${l}</button>`)
    .join('');

  if (!list.length) {
    box.innerHTML = state.songs.length
      ? '<div class="empty"><strong>조건에 맞는 곡이 없어요</strong>검색어나 태그 필터를 지워 보세요</div>'
      : '<div class="empty"><strong>아직 곡이 없어요</strong>＋ 로 곡을 추가하면<br>노래방 번호까지 자동으로 찾아줘요</div>';
    return;
  }
  box.innerHTML = list.map(songRow).join('');
}

function songRow(s) {
  const tags = s.tags.map(tagOf).filter(Boolean);
  const sub = [s.artist, s.reading].filter(Boolean).join(' · ');
  return `<button class="row" data-act="openSong" data-id="${s.id}">
    <span class="row-main">
      <span class="row-title">${esc(s.title)}</span>
      <span class="row-sub">${esc(sub)}</span>
      ${tags.length ? `<span class="row-tags">${tags.map((t) => `<span class="pill" style="--hue:${t.hue}">${esc(t.label)}</span>`).join('')}</span>` : ''}
    </span>
    ${s.number ? `<span class="row-num">${esc(s.number)}</span>` : ''}
  </button>`;
}

/* ---------------- DB 결과 ---------------- */

function haveKey(title, artist) {
  return state.songs.some((s) => norm(s.title) === norm(title) && norm(s.artist) === norm(artist));
}

function dbHitRow(it, i) {
  const brand = BRANDS[it.brand] || it.brand || '?';
  const have = haveKey(it.title, it.singer);
  return `<button type="button" class="dbrow" data-i="${i}">
    <span class="brand ${esc(it.brand || '')}">${esc(brand)}</span>
    <span class="row-main">
      <span class="row-title">${esc(it.title)}</span>
      <span class="row-sub">${esc(it.singer || '')}</span>
    </span>
    <span class="dbno">${esc(it.no || '')}</span>
    ${have ? '<span class="addmark have">있음</span>' : ''}
  </button>`;
}

/* ---------------- 플리 ---------------- */

function renderPlaylistsView() {
  app.innerHTML = `<div class="pad">${
    state.playlists.length
      ? state.playlists.map(plCard).join('')
      : '<div class="empty"><strong>플레이리스트가 없어요</strong>＋ 로 “1부 오프닝” 같은 목록을 만들어 보세요</div>'
  }</div>`;
}

function plCard(p) {
  const preview = p.songIds.map(songOf).filter(Boolean).slice(0, 3).map((s) => esc(s.title)).join(', ');
  return `<button class="card-row" data-act="openPl" data-id="${p.id}">
    <div>
      <div class="row-title">${esc(p.name)}</div>
      <div class="row-sub">${p.songIds.length}곡${preview ? ' · ' + preview : ''}</div>
    </div>
    <span class="chev">›</span>
  </button>`;
}

function renderPlaylistView() {
  const p = state.playlists.find((x) => x.id === ui.playlistId);
  if (!p) {
    ui.view = 'playlists';
    return render();
  }
  const songs = p.songIds.map(songOf).filter(Boolean);
  app.innerHTML = `<div class="pad">
    <div class="plhead">
      <button class="btn small" data-act="addToPl">＋ 곡 추가</button>
      <button class="btn small ghost" data-act="renamePl">이름 변경</button>
      <button class="btn small ghost danger" data-act="delPl">삭제</button>
    </div>
    ${
      songs.length
        ? songs
            .map(
              (s, i) => `<div class="row static">
          <button class="row-main" data-act="openSong" data-id="${s.id}">
            <span class="row-title">${esc(s.title)}</span>
            <span class="row-sub">${esc(s.artist || '')}</span>
          </button>
          <div class="reorder">
            <button class="icon-btn tiny" data-act="moveUp" data-id="${s.id}" aria-label="위로" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button class="icon-btn tiny" data-act="moveDown" data-id="${s.id}" aria-label="아래로" ${i === songs.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="icon-btn tiny danger" data-act="rmFromPl" data-id="${s.id}" aria-label="빼기">✕</button>
          </div>
        </div>`
            )
            .join('')
        : '<div class="empty"><strong>비어 있는 플리</strong>“＋ 곡 추가”로 곡을 담아 보세요</div>'
    }
  </div>`;
}

/* ---------------- 설정 ---------------- */

function renderSettingsView() {
  const sampleCount = state.songs.filter((s) => s.sample).length;
  const themeOpts = [['auto', '자동'], ['light', '라이트'], ['dark', '다크']];
  app.innerHTML = `<div class="pad">
    <section class="section">
      <h2>화면</h2>
      <div class="theme-seg">
        ${themeOpts.map(([v, l]) => `<button class="${(state.settings.theme || 'auto') === v ? 'on' : ''}" data-act="theme" data-v="${v}">${l}</button>`).join('')}
      </div>
    </section>

    <section class="section">
      <h2>태그</h2>
      ${
        state.tags.length
          ? state.tags
              .map(
                (t) => `<div class="rowline">
            <span class="pill" style="--hue:${t.hue}">${esc(t.label)}</span>
            <span class="grow"></span>
            <button class="btn small ghost" data-act="editTag" data-tag="${t.id}">이름</button>
            <button class="btn small ghost danger-text" data-act="delTag" data-tag="${t.id}">삭제</button>
          </div>`
              )
              .join('')
          : '<div class="note">태그가 없어요.</div>'
      }
      <button class="linkbtn" data-act="newTagSettings">＋ 새 태그</button>
    </section>

    <section class="section">
      <h2>데이터</h2>
      <div class="rowline">
        <span class="grow">곡 ${state.songs.length} · 플리 ${state.playlists.length}</span>
        <button class="btn small" data-act="export">내보내기</button>
      </div>
      <div class="rowline">
        <span class="grow">백업 파일(JSON)에서 복원</span>
        <button class="btn small" data-act="import">가져오기</button>
      </div>
      ${sampleCount ? `<div class="rowline"><span class="grow">샘플 곡 ${sampleCount}개</span><button class="btn small ghost danger-text" data-act="purgeSample">샘플 삭제</button></div>` : ''}
      <div class="rowline"><span class="grow danger-text">전체 삭제</span><button class="btn small ghost danger-text" data-act="wipe">지우기</button></div>
      <p class="note">데이터는 이 기기 브라우저에만 저장돼요. 폰을 바꾸거나 브라우저 데이터를 지우면 사라지니 가끔 <b>내보내기</b>로 백업해 두세요.</p>
    </section>
  </div>`;
}

/* ---------------- 곡 추가/수정 ---------------- */

function openSongSheet(song, prefill) {
  const isNew = !song;
  const base = isNew ? prefill || {} : song;
  const draft = isNew
    ? { title: base.title || '', artist: base.artist || '', reading: '', memo: '', number: base.number || '', tags: [] }
    : { title: song.title, artist: song.artist, reading: song.reading, memo: song.memo, number: song.number, tags: [...song.tags] };

  const tagChips = () =>
    state.tags.length
      ? state.tags
          .map((t) => `<button type="button" class="chip ${draft.tags.includes(t.id) ? 'on' : ''}" data-tagid="${t.id}" style="--hue:${t.hue}">${esc(t.label)}</button>`)
          .join('')
      : '<span class="muted small">태그 없음</span>';

  const plChips = () =>
    state.playlists.length
      ? state.playlists
          .map((p) => `<button type="button" class="chip ${!isNew && p.songIds.includes(song.id) ? 'on' : ''}" data-plid="${p.id}">${esc(p.name)}</button>`)
          .join('')
      : '<span class="muted small">플레이리스트 없음</span>';

  openSheet({
    title: isNew ? '곡 추가' : '곡 수정',
    body: `<form class="form" id="songForm" novalidate>
      <label class="field"><span>제목</span><input name="title" value="${esc(draft.title)}" autocomplete="off" placeholder="곡 제목을 치면 노래방 번호를 찾아요"></label>
      <div class="hits" id="dbHits" hidden></div>
      <label class="field"><span>가수</span><input name="artist" value="${esc(draft.artist)}" autocomplete="off" placeholder="아티스트"></label>
      <label class="field"><span>읽기 (가나 · 로마자)</span><input name="reading" value="${esc(draft.reading)}" autocomplete="off" placeholder="예: zankoku na tenshi / ざんこく"></label>
      <div class="field"><span>태그</span><div class="chips" id="tagChips">${tagChips()}</div>
        <button type="button" class="linkbtn js-newtag">＋ 새 태그</button></div>
      <div class="field"><span>플리에 담기</span><div class="chips" id="plChips">${plChips()}</div></div>
      <label class="field"><span>메모</span><textarea name="memo" rows="2" placeholder="키, 어려운 구간, 분위기…">${esc(draft.memo)}</textarea></label>
      <label class="field"><span>노래방 번호</span><input name="number" inputmode="numeric" value="${esc(draft.number)}" placeholder="TJ / 금영"></label>
      <div class="sheet-actions"><button class="btn primary" type="submit">저장</button></div>
      ${isNew ? '' : '<button type="button" class="btn danger-ghost js-delsong">곡 삭제</button>'}
    </form>`,
    mount(root) {
      const form = $('#songForm', root);
      const chips = $('#tagChips', root);

      /* 제목 입력 → 노래방 DB 조회 → 번호 자동 채움 */
      const titleInput = form.querySelector('input[name="title"]');
      const artistInput = form.querySelector('input[name="artist"]');
      const numberInput = form.querySelector('input[name="number"]');
      const hits = $('#dbHits', root);
      let hitsSeq = 0;
      let hitsTimer = null;

      const paintHits = (html) => {
        hits.innerHTML = html;
        hits.hidden = !html;
      };

      titleInput.addEventListener('input', () => {
        const v = titleInput.value.trim();
        clearTimeout(hitsTimer);
        const my = ++hitsSeq;
        if (!v) {
          paintHits('');
          return;
        }
        hitsTimer = setTimeout(async () => {
          paintHits('<div class="hitsmsg">노래방 번호 찾는 중…</div>');
          let items = [];
          try {
            items = await searchDb(v);
          } catch (err) {
            if (my !== hitsSeq) return;
            paintHits('<div class="hitsmsg">DB 연결 실패 · 번호는 직접 입력해도 돼요</div>');
            return;
          }
          if (my !== hitsSeq) return;
          if (!items.length) {
            paintHits('<div class="hitsmsg">DB에 없음 · 그대로 저장하고 번호는 나중에 넣어도 돼요</div>');
            return;
          }
          paintHits(items.map((it, i) => dbHitRow(it, i)).join(''));
          $$('.dbrow', hits).forEach((el) => {
            el.addEventListener('click', () => {
              const it = items[Number(el.dataset.i)];
              if (!it) return;
              titleInput.value = it.title;
              artistInput.value = it.singer || '';
              numberInput.value = `${BRANDS[it.brand] || ''} ${it.no}`.trim();
              paintHits(`<div class="hitsmsg ok">${esc(BRANDS[it.brand] || it.brand)} ${esc(it.no)} 채움 · 태그만 골라 저장</div>`);
            });
          });
        }, 380);
      });

      chips.addEventListener('click', (e) => {
        const c = e.target.closest('.chip');
        if (!c) return;
        const id = c.dataset.tagid;
        const i = draft.tags.indexOf(id);
        if (i < 0) draft.tags.push(id);
        else draft.tags.splice(i, 1);
        c.classList.toggle('on');
      });

      $('#plChips', root).addEventListener('click', (e) => {
        const c = e.target.closest('.chip');
        if (c) c.classList.toggle('on');
      });

      $('.js-newtag', root).addEventListener('click', (e) => {
        if ($('.newtag-row', root)) return;
        const wrap = document.createElement('div');
        wrap.className = 'newtag-row';
        wrap.innerHTML = '<input placeholder="태그 이름" maxlength="20"><button type="button" class="btn small">추가</button>';
        e.target.after(wrap);
        const inp = $('input', wrap);
        inp.focus();
        const commit = () => {
          const label = inp.value.trim();
          if (label) {
            const tag = { id: 'tg-' + uid(), label, hue: HUES[state.tags.length % HUES.length] };
            state.tags.push(tag);
            draft.tags.push(tag.id);
            save();
            chips.innerHTML = tagChips();
          }
          wrap.remove();
        };
        $('button', wrap).addEventListener('click', commit);
        inp.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            commit();
          }
        });
      });

      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const title = String(fd.get('title') || '').trim();
        if (!title) {
          toast('제목을 입력해 주세요');
          $('input[name="title"]', form).focus();
          return;
        }
        const payload = {
          title,
          artist: String(fd.get('artist') || '').trim(),
          reading: String(fd.get('reading') || '').trim(),
          memo: String(fd.get('memo') || '').trim(),
          number: String(fd.get('number') || '').trim(),
          tags: [...draft.tags],
        };
        let id;
        if (song) {
          Object.assign(song, payload, { updatedAt: Date.now() });
          id = song.id;
        } else {
          id = uid();
          state.songs.unshift({ id, ...payload, sample: false, createdAt: Date.now(), updatedAt: Date.now() });
        }
        const want = new Set($$('.chip[data-plid].on', root).map((c) => c.dataset.plid));
        for (const p of state.playlists) {
          const has = p.songIds.includes(id);
          if (want.has(p.id) && !has) p.songIds.push(id);
          else if (!want.has(p.id) && has) p.songIds = p.songIds.filter((x) => x !== id);
        }
        save();
        closeSheet();
        render();
        toast(song ? '수정했어요' : '추가했어요');
      });

      const del = $('.js-delsong', root);
      if (del) {
        del.addEventListener('click', () => {
          if (!confirm(`“${song.title}” 곡을 삭제할까요?`)) return;
          state.songs = state.songs.filter((s) => s.id !== song.id);
          state.playlists.forEach((p) => (p.songIds = p.songIds.filter((x) => x !== song.id)));
          save();
          closeSheet();
          render();
          toast('삭제했어요');
        });
      }
    },
  });
}

/* ---------------- 플리 조작 ---------------- */

function openNewPlaylist() {
  openSheet({
    title: '새 플레이리스트',
    body: `<form class="form" id="plForm">
      <label class="field"><span>이름</span><input name="name" autocomplete="off" placeholder="예: 1부 오프닝"></label>
      <div class="sheet-actions"><button class="btn primary" type="submit">만들기</button></div>
    </form>`,
    mount(root) {
      $('#plForm', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const name = String(new FormData(e.target).get('name') || '').trim();
        if (!name) {
          toast('이름을 입력해 주세요');
          return;
        }
        const id = uid();
        state.playlists.push({ id, name, songIds: [], createdAt: Date.now() });
        save();
        closeSheet();
        ui.view = 'playlist';
        ui.playlistId = id;
        render();
      });
      $('input[name="name"]', root).focus();
    },
  });
}

function renamePlaylist(id) {
  const p = state.playlists.find((x) => x.id === id);
  if (!p) return;
  openSheet({
    title: '이름 변경',
    body: `<form class="form" id="rnForm">
      <label class="field"><span>이름</span><input name="name" value="${esc(p.name)}" autocomplete="off"></label>
      <div class="sheet-actions"><button class="btn primary" type="submit">저장</button></div>
    </form>`,
    mount(root) {
      $('#rnForm', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const name = String(new FormData(e.target).get('name') || '').trim();
        if (!name) return toast('이름을 입력해 주세요');
        p.name = name;
        save();
        closeSheet();
        render();
      });
      $('input[name="name"]', root).focus();
    },
  });
}

function openPicker(plId) {
  const p = state.playlists.find((x) => x.id === plId);
  if (!p) return;
  let q = '';
  openSheet({
    title: '플리에 곡 추가',
    body: `<div class="searchbox compact">
        ${SEARCH_ICON}
        <input id="pkq" type="search" placeholder="검색" autocomplete="off">
      </div>
      <div class="pklist" id="pkList"></div>
      <div class="sheet-actions" style="margin-top:12px"><button class="btn primary" type="button" data-close>완료</button></div>`,
    mount(root) {
      const draw = () => {
        const tokens = q.trim().split(/\s+/).filter(Boolean);
        const items = state.songs.filter((s) => !tokens.length || matchTokens(s, tokens));
        $('#pkList', root).innerHTML = items.length
          ? items
              .map((s) => {
                const on = p.songIds.includes(s.id);
                return `<button type="button" class="pick ${on ? 'on' : ''}" data-sid="${s.id}">
                  <span class="pick-main">
                    <span class="row-title">${esc(s.title)}</span>
                    <span class="row-sub">${esc(s.artist || '')}</span>
                  </span>
                  <span class="pick-mark">${on ? '✓' : '＋'}</span>
                </button>`;
              })
              .join('')
          : '<div class="empty">곡이 없어요</div>';
      };
      $('#pkq', root).addEventListener('input', (e) => {
        q = e.target.value;
        draw();
      });
      $('#pkList', root).addEventListener('click', (e) => {
        const b = e.target.closest('.pick');
        if (!b) return;
        const id = b.dataset.sid;
        const i = p.songIds.indexOf(id);
        if (i < 0) p.songIds.push(id);
        else p.songIds.splice(i, 1);
        save();
        b.classList.toggle('on', i < 0);
        $('.pick-mark', b).textContent = i < 0 ? '✓' : '＋';
        if (ui.view === 'playlist') render();
      });
      draw();
      $('#pkq', root).focus();
    },
  });
}

function moveSongInPlaylist(songId, dir) {
  const p = state.playlists.find((x) => x.id === ui.playlistId);
  if (!p) return;
  const i = p.songIds.indexOf(songId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.songIds.length) return;
  [p.songIds[i], p.songIds[j]] = [p.songIds[j], p.songIds[i]];
  save();
  render();
}

/* ---------------- 태그 관리 ---------------- */

function newTagFromSettings() {
  openSheet({
    title: '새 태그',
    body: `<form class="form" id="tagForm">
      <label class="field"><span>이름</span><input name="label" maxlength="20" autocomplete="off" placeholder="예: 새벽에 부르기"></label>
      <div class="sheet-actions"><button class="btn primary" type="submit">추가</button></div>
    </form>`,
    mount(root) {
      $('#tagForm', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const label = String(new FormData(e.target).get('label') || '').trim();
        if (!label) return toast('이름을 입력해 주세요');
        state.tags.push({ id: 'tg-' + uid(), label, hue: HUES[state.tags.length % HUES.length] });
        save();
        closeSheet();
        render();
      });
      $('input[name="label"]', root).focus();
    },
  });
}

function editTag(id) {
  const t = tagOf(id);
  if (!t) return;
  openSheet({
    title: '태그 이름 변경',
    body: `<form class="form" id="etForm">
      <label class="field"><span>이름</span><input name="label" maxlength="20" value="${esc(t.label)}" autocomplete="off"></label>
      <div class="sheet-actions"><button class="btn primary" type="submit">저장</button></div>
    </form>`,
    mount(root) {
      $('#etForm', root).addEventListener('submit', (e) => {
        e.preventDefault();
        const label = String(new FormData(e.target).get('label') || '').trim();
        if (!label) return toast('이름을 입력해 주세요');
        t.label = label;
        save();
        closeSheet();
        render();
      });
      $('input[name="label"]', root).focus();
    },
  });
}

function deleteTag(id) {
  const t = tagOf(id);
  if (!t) return;
  if (!confirm(`“${t.label}” 태그를 삭제할까요? 곡에 붙은 태그도 함께 사라져요.`)) return;
  state.tags = state.tags.filter((x) => x.id !== id);
  state.songs.forEach((s) => (s.tags = s.tags.filter((x) => x !== id)));
  ui.tags.delete(id);
  save();
  render();
}

/* ---------------- 백업 ---------------- */

function exportJson() {
  const data = JSON.stringify(
    { app: 'karaoke-songbook', version: 1, exportedAt: new Date().toISOString(), songs: state.songs, tags: state.tags, playlists: state.playlists },
    null,
    2
  );
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `karaoke-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('백업 파일을 내보냈어요');
}

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!d || !Array.isArray(d.songs)) throw new Error('곡 목록이 없어요');
    if (!confirm(`현재 데이터를 덮어쓸까요?\n곡 ${d.songs.length}개로 복원합니다.`)) return;
    state.songs = d.songs.map(cleanSong);
    state.tags = Array.isArray(d.tags) && d.tags.length ? d.tags : PRESET_TAGS.map((t) => ({ ...t }));
    state.playlists = Array.isArray(d.playlists)
      ? d.playlists.map((p) => ({ id: p.id || uid(), name: p.name || '플리', songIds: Array.isArray(p.songIds) ? p.songIds : [], createdAt: p.createdAt || Date.now() }))
      : [];
    ui.tags.clear();
    save();
    render();
    toast('복원했어요');
  } catch (err) {
    toast('가져오기 실패 · ' + err.message);
  }
});

/* ---------------- 이벤트 ---------------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;

  switch (act) {
    case 'tab':
      ui.view = el.dataset.tab;
      if (ui.view !== 'playlist') ui.playlistId = null;
      render();
      window.scrollTo({ top: 0 });
      break;

    case 'newSong':
      openSongSheet(null);
      break;

    case 'openSong': {
      const s = songOf(id);
      if (s) openSongSheet(s);
      break;
    }

    case 'toggleTag': {
      const t = el.dataset.tag;
      if (ui.tags.has(t)) ui.tags.delete(t);
      else ui.tags.add(t);
      renderFilterChips();
      renderSongList();
      break;
    }

    case 'matchMode':
      ui.matchAll = !ui.matchAll;
      renderFilterChips();
      renderSongList();
      break;

    case 'sort':
      ui.sort = el.dataset.v;
      renderSongList();
      break;

    case 'clearQ': {
      const input = $('#q');
      ui.q = '';
      if (input) {
        input.value = '';
        input.focus();
      }
      const cb = $('.clearbtn');
      if (cb) cb.hidden = true;
      break;
    }

    case 'newPlaylist':
      openNewPlaylist();
      break;

    case 'openPl':
      ui.view = 'playlist';
      ui.playlistId = id;
      render();
      break;

    case 'backPl':
      ui.view = 'playlists';
      ui.playlistId = null;
      render();
      break;

    case 'addToPl':
      openPicker(ui.playlistId);
      break;

    case 'renamePl':
      renamePlaylist(ui.playlistId);
      break;

    case 'delPl': {
      const p = state.playlists.find((x) => x.id === ui.playlistId);
      if (!p) break;
      if (!confirm(`“${p.name}” 플리를 삭제할까요? (곡은 남아요)`)) break;
      state.playlists = state.playlists.filter((x) => x.id !== p.id);
      ui.view = 'playlists';
      ui.playlistId = null;
      save();
      render();
      break;
    }

    case 'moveUp':
      moveSongInPlaylist(id, -1);
      break;

    case 'moveDown':
      moveSongInPlaylist(id, 1);
      break;

    case 'rmFromPl': {
      const p = state.playlists.find((x) => x.id === ui.playlistId);
      if (!p) break;
      p.songIds = p.songIds.filter((x) => x !== id);
      save();
      render();
      break;
    }

    case 'theme':
      state.settings.theme = el.dataset.v;
      save();
      render();
      break;

    case 'export':
      exportJson();
      break;

    case 'import':
      $('#importFile').click();
      break;

    case 'purgeSample': {
      if (!confirm('샘플 곡을 모두 지울까요?')) break;
      const ids = new Set(state.songs.filter((s) => s.sample).map((s) => s.id));
      state.songs = state.songs.filter((s) => !ids.has(s.id));
      state.playlists.forEach((p) => (p.songIds = p.songIds.filter((x) => !ids.has(x))));
      save();
      render();
      toast('샘플을 지웠어요');
      break;
    }

    case 'wipe':
      if (!confirm('곡·플리·태그를 전부 지웁니다. 되돌릴 수 없어요.')) break;
      if (!confirm('정말 한 번 더 확인합니다. 지울까요?')) break;
      state.songs = [];
      state.playlists = [];
      state.tags = PRESET_TAGS.map((t) => ({ ...t }));
      ui.tags.clear();
      save();
      render();
      break;

    case 'newTagSettings':
      newTagFromSettings();
      break;

    case 'editTag':
      editTag(el.dataset.tag);
      break;

    case 'delTag':
      deleteTag(el.dataset.tag);
      break;
  }
});

/* ---------------- 부팅 ---------------- */

load();
render();

if ('serviceWorker' in navigator && !/[?&]dev\b/.test(location.search)) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW 등록 실패', err));
  });
}
