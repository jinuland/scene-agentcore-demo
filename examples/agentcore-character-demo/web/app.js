const app = document.querySelector("#app");
const dialog = document.querySelector("#gallery");
const toast = document.querySelector("#toast");
let library, current, routeRevision = 0, filter = "전체", toastTimer, statusOpen = false;
const pendingTurns = new Set();
const deletingEpisodes = new Set();
const deletedEpisodes = new Set();
const esc = (str) => String(str ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const icon = key => '<svg aria-hidden="true"><use href="#' + key + '"/></svg>';
const image = (file, alt, cls = "", eager = false) => '<img class="' + cls + '" src="' + esc(file) + '" alt="' + esc(alt) + '"' + (eager ? '' : ' loading="lazy"') + '>';
const button = (className, attr, text, symbol) => '<button type="button" class="' + className + '" ' + attr + '>' + (symbol ? icon(symbol) : "") + text + '</button>';
const iconButton = (attr, symbol, label, extra = "") => button("icon-btn " + extra, attr + ' aria-label="' + label + '" title="' + label + '"', "", symbol);
const badge = (label, key) => '<span class="badge">' + (key ? icon(key) : "") + esc(label) + '</span>';
const storyFor = id => library.stories.find(story => story.id === id);
const modelFor = id => library.models.find(model => model.id === id)?.label ?? id;
const rememberedModel = () => {
  let id; try { id = localStorage.getItem("scene.model"); } catch { /* Optional preference */ }
  return library.models.some(model => model.id === id) ? id : library.defaultModel;
};
async function api(path, data) {
  let init;
  if (data !== undefined) {
    const body = JSON.stringify(data);
    const headers = {"Content-Type":"application/json"};
    if (location.protocol === "https:") {
      const bytes = new TextEncoder().encode(body);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      headers["x-amz-content-sha256"] = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
    }
    init = {method:"POST", headers, body};
  }
  const response = await fetch("/api/" + path, init);
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || "요청을 완료할 수 없습니다.");
    error.accessRequired = payload.accessRequired === true;
    error.status = response.status;
    throw error;
  }
  return payload;
}
function message(text) {
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4800);
}
function navState(active) {
  for (const button of document.querySelectorAll(".navitem")) {
    const selected = button.dataset.view === active;
    button.classList.toggle("active", selected);
    if (selected) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}
function locationParts() { return location.hash.slice(1).split("/"); }
function go(page, id) {
  const hash = "#" + page + (id ? "/" + id : "");
  if (location.hash !== hash) history.pushState(null, "", hash);
  void renderRoute();
}
function setContent(markup) {
  app.innerHTML = markup;
  app.setAttribute("aria-busy", "false");
}
function discover() {
  const [feature] = library.stories;
  const genres = ["전체", ...new Set(library.stories.map(story => story.genre))];
  const filtered = filter === "전체" ? library.stories : library.stories.filter(s => s.genre === filter);
  const cards = filtered.map(story => '<button class="card story-' + esc(story.id) + '" data-story="' + esc(story.id) + '"><div class="thumb">' +
    image(story.cover, "") + badge(story.custom ? "내 작품" : story.genre) + '</div><div class="card-copy"><h3>' + esc(story.title) + '</h3><p>' + esc(story.tagline) + '</p></div></button>').join("");
  setContent('<div class="container"><div class="topline"><div><p class="kicker">STORY LIBRARY</p><h2 class="section-title">작품 탐색</h2></div>' +
    '<span class="live">' + (library.runtime ? '<i></i> AgentCore 연결 설정됨' : 'AgentCore 설정 필요') + '</span></div>' +
    '<section class="hero">' + image(feature.cover, "", "hero-art", true) + '<div class="hero-copy">' +
    badge("추천 스토리 · " + feature.genre, "spark") + '<h1>' + esc(feature.title) + '</h1><p>' + esc(feature.tagline) + '</p><div class="actions">' +
    button("btn primary", 'data-story="' + feature.id + '"', "이야기 열기", "play") +
    button("btn", 'data-view="craft"', "작품 만들기", "editIcon") + '</div></div></section>' +
    '<section><div class="section-head"><div><h2>어떤 이야기에 들어갈까요?</h2><p>작품마다 다른 역할과 첫 장면이 기다립니다.</p></div><div class="filters" aria-label="장르 필터">' +
    genres.map(g => button("filter" + (g === filter ? " current" : ""), 'data-filter="' + esc(g) + '" aria-pressed="' + (g === filter) + '"', esc(g))).join("") +
    '</div></div><div class="cards">' + cards + '</div></section></div>');
}
function detail(story) {
  const last = library.sessions.find(item => item.story === story.id);
  setContent('<div class="container detail">' + button("btn", 'data-view="discover"', "작품 탐색", "back") +
    '<section class="cover-detail story-' + esc(story.id) + '">' + image(story.cover, "", "", true) + '<header>' +
    badge(story.premiseBadge || story.genre) + '<h1>' + esc(story.title) + '</h1><p>' + esc(story.tagline) + '</p></header></section>' +
    '<section class="detail-body"><p class="kicker">PROLOGUE</p><p>' + esc(story.prologue) + '</p><p><strong>내 역할</strong> · ' + esc(story.role) + '</p>' +
    (story.source ? '<a class="source" target="_blank" rel="noreferrer" href="' + esc(story.source.url) + '">' + esc(story.source.label) + ' ↗</a>' : '') + '</section>' +
    '<div class="actions">' + (last ? button("btn primary", 'data-episode="' + last.id + '"', "이어하기", "play") : '') +
    button(last ? "btn" : "btn primary", 'data-start="' + esc(story.id) + '"', last ? "새 회차 시작" : "대화 시작", "arrow") +
    (story.previewTurns?.length ? button("btn", 'data-story-preview="open" aria-controls="story-preview"', "예시 대화 보기", "chatIcon") : "") +
    '</div>' + storyPreview(story) + '</div>');
}
function storyPreview(story) {
  if (!story.previewTurns?.length) return "";
  const turns = story.previewTurns.map(turn =>
    '<li class="preview-turn"><div class="preview-player"><span>플레이어</span><p>' + esc(turn.input) + '</p></div>' +
    reply(story, turn.beats) + '</li>',
  ).join("");
  return '<section class="story-preview" id="story-preview" aria-labelledby="story-preview-heading">' +
    '<h2 id="story-preview-heading" tabindex="-1">예시 대화</h2><ol class="preview-transcript">' + turns + '</ol></section>';
}
function shelf() {
  const rows = library.sessions.map(session => {
    const story = storyFor(session.story);
    if (!story) return "";
    return '<div class="shelf-row"><button class="shelf-item" data-episode="' + session.id + '">' + image(story.cover, "") +
      '<span><strong>' + esc(story.title) + '</strong><small>' + esc(story.character) + ' · 이어하기</small></span>' + icon("arrow") + '</button>' +
      button("btn delete-button", 'data-delete-episode="' + session.id + '" aria-label="' + esc(story.title) + ' 대화 삭제"', "삭제", "trash") + '</div>';
  }).join("");
  setContent('<div class="container new-story"><p class="kicker">YOUR EPISODES</p><h1 class="section-title">내 대화</h1><p class="subtle">이 브라우저에서 열었던 회차를 다시 읽을 수 있어요.</p>' +
    (rows ? '<div class="shelf">' + rows + '</div>' : '<p class="empty">아직 대화가 없어요. 작품을 하나 골라 시작해 보세요.</p>' + button("btn primary", 'data-view="discover"', "작품 탐색", "arrow")) + '</div>');
}
function craft() {
  const genres = [...new Set(library.stories.map(s => s.genre))];
  setContent('<div class="container new-story"><p class="kicker">CREATOR STUDIO</p><h1 class="section-title">작품 만들기</h1><p class="subtle">캐릭터와 첫 장면을 정한 뒤 새 회차에서 곧바로 대화해 보세요.</p>' +
    '<form id="draft" class="craft-form"><div class="fields">' +
    '<label>작품 제목<input name="title" maxlength="48" placeholder="예: 심야 수리점" required></label>' +
    '<label>캐릭터 이름<input name="name" maxlength="24" placeholder="예: 윤" required></label>' +
    '<label>장르<select name="genre">' + genres.map(g => '<option>' + esc(g) + '</option>').join("") + '</select></label>' +
    '<label>표지<select name="cover">' + library.stories.filter(s => !s.custom).map(s => '<option value="' + s.id + '">' + esc(s.genre) + ' 표지</option>').join("") + '</select></label></div>' +
    '<label>세계관과 첫 상황<textarea name="setting" rows="4" maxlength="700" placeholder="장소, 캐릭터의 말투와 지금 일어난 일을 적어 주세요." required></textarea></label>' +
    '<label>플레이어 역할<input name="role" maxlength="120" placeholder="예: 고장 난 기기를 맡기러 온 손님" required></label>' +
    '<label>캐릭터의 첫 대사<textarea name="greeting" rows="2" maxlength="400" placeholder="예: 불은 껐지만, 아직 문은 안 잠갔어요." required></textarea></label>' +
    '<label>신뢰도가 오르는 행동 <span class="form-hint">선택 사항 · 해당하는 발언에 신뢰도 +1</span><input name="trustWhen" maxlength="180" placeholder="예: 손님이 수리를 함께 돕겠다고 자발적으로 말한다."></label>' +
    '<p id="draft-error" class="error" role="alert" hidden></p><div class="actions"><button class="btn primary" type="submit">' + icon("play") + '저장하고 테스트 채팅</button></div></form></div>');
}
function cardFor(story, key) { return story.cards[key] ?? story.cards.neutral; }
function reply(story, beats) {
  return '<div class="reply"><p class="speaker">' + esc(story.character) + '</p>' +
    beats.map(({kind,text}) => '<p class="beat beat-' + esc(kind) + '">' + esc(text) + '</p>').join("") + '</div>';
}
function chatHistory(story, episode, pendingText) {
  const body = episode.turns.map(turn => {
    const card = cardFor(story, turn.mood);
    return '<article class="turn"><div class="turn-player"><p>' + esc(turn.input) + '</p></div>' +
      (turn.mood !== "neutral" ? image(card.file, card.label, "scene-img") : "") +
      reply(story, turn.beats) + '<p class="turn-caption">' + esc(modelFor(turn.mode)) + ' · ' + (turn.timing / 1000).toFixed(1) + '초' +
      (turn.trustQuote ? ' <strong title="' + esc(turn.trustQuote) + '">신뢰도 +1</strong>' : '') + '</p></article>';
  }).join("");
  return '<div class="stream-wrap"><p class="opening-mark">' + icon("book") + ' 프롤로그</p>' +
    image(story.cards.neutral.file, story.cards.neutral.label, "scene-img", true) +
    '<p class="opening-text">' + esc(story.prologue) + '</p>' + reply(story,[{kind:"speech",text:story.greeting}]) + body +
    (pendingText ? '<div class="turn-player"><p>' + esc(pendingText) + '</p></div><p class="send-pending" role="status">' + esc(story.character) + '의 다음 장면을 이어가는 중…</p>' : '') + '</div>';
}
function statusPanel(story, episode) {
  const stats = episode.stats;
  const card = cardFor(story, episode.turns.at(-1)?.mood);
  const event = episode.turns.at(-1)?.trustQuote;
  const statText = stats.trust + " / " + stats.max;
  return iconButton('data-status="close"',"close","상태창 닫기","status-close") +
    '<h2 id="status-heading">' + icon("statusIcon") + '상태창</h2>' + image(card.file, card.label, "status-image", true) +
    '<dl class="status-block"><dt>현재 장면</dt><dd>' + esc(story.scene) + '</dd><dt>내 역할</dt><dd>' + esc(story.role) + '</dd>' +
    (story.objective ? '<dt>목표</dt><dd>' + esc(story.objective) + '</dd>' : '') +
    (episode.status ? '<dt>' + esc(episode.status.label) + '</dt><dd>' + esc(episode.status.value) + '</dd>' : '') +
    '<dt>대화 턴</dt><dd>' + episode.turns.length + '</dd></dl>' +
    (story.hasTrust ? '<div class="status-block"><p class="stat-heading">신뢰도 <span class="stat-value">' + statText + '</span></p>' +
      '<div class="meter" role="meter" aria-label="신뢰도" aria-valuemin="0" aria-valuemax="' + stats.max + '" aria-valuenow="' + stats.trust + '">' +
      Array.from({length:stats.max},(_,i) => '<span' + (i < stats.trust ? ' class="filled"' : '') + '></span>').join("") + '</div>' +
      '<p class="caption">' + esc(stats.level) + '</p>' + (event ? '<p class="status-change">+1 · “' + esc(event) + '”</p>' : '') + '</div>' : '') +
    '<div class="status-foot">' + button("btn", 'data-gallery="open"', "이미지 보관함", "imageIcon") +
    button("btn", 'data-start="' + esc(story.id) + '"', "새 회차", "spark") + '</div>';
}
function suggestions(story, episode) {
  const picks = episode.turns.length ? episode.turns.at(-1).suggestions : story.suggestions;
  return picks.map(s => button("suggest", 'data-suggestion="' + esc(s) + '"', esc(s))).join("");
}
function chat(story, episode) {
  const model = rememberedModel();
  const groups = [...new Set(library.models.map(m => m.provider))].map(provider => '<optgroup label="' + esc(provider) + '">' +
    library.models.filter(m => m.provider === provider).map(m => '<option value="' + esc(m.id) + '"' + (m.id === model ? ' selected' : '') + '>' + esc(m.label) + '</option>').join("") + '</optgroup>').join("");
  setContent('<div class="storychat"><div class="chat-core"><header class="chatbar">' + iconButton('data-story="' + esc(story.id) + '"',"back","작품으로 돌아가기") +
    '<div><h1>' + esc(story.title) + '</h1><p class="subtle">' + esc(story.character) + ' · ' + esc(story.job) + '</p></div><div class="chatbar-right">' +
    iconButton('data-gallery="open"',"imageIcon","이미지 보관함") + iconButton('data-status="open" aria-controls="story-status"',"statusIcon","상태창 열기","mobile-status") +
    iconButton('data-delete-episode="' + episode.id + '"',"trash","이 대화 삭제","delete-button") +
    '</div></header><div class="transcript" id="transcript">' + chatHistory(story,episode) + '</div><form id="chat-form" class="composer"><div class="compose-inner">' +
    '<div id="suggestions" class="suggestions">' + suggestions(story,episode) + '</div><p id="turn-error" class="error" role="alert" hidden></p>' +
    '<div class="compose-line"><textarea id="compose" aria-label="대화 입력" rows="1" maxlength="1500" placeholder="' + esc(story.character) + '에게 무엇이라고 말할까요?" required></textarea>' +
    '<button type="submit" class="send" aria-label="보내기">' + icon("send") + '</button></div><div class="model-controls">' +
    '<label>모델 <select id="model" aria-label="모델 선택">' + groups + '</select></label><span class="keyhint">Enter 보내기 · Shift+Enter 줄바꿈</span></div>' +
    '</div></form></div><aside id="story-status" aria-labelledby="status-heading" class="status-panel' + (statusOpen ? ' open' : '') + '">' + statusPanel(story,episode) + '</aside></div>');
  if (episode.turns.length) scrollChat();
}
function scrollChat() {
  const feed = document.querySelector("#transcript");
  if (feed) feed.scrollTop = feed.scrollHeight;
}
function upsertSession(episode) {
  if (deletedEpisodes.has(episode.id)) return;
  library.sessions = [{id:episode.id, story:episode.story}, ...library.sessions.filter(s => s.id !== episode.id)].slice(0,30);
}
async function renderRoute() {
  if (!library) return;
  const revision = ++routeRevision;
  const [view,id] = locationParts();
  current = undefined;
  statusOpen = false;
  if (dialog.open) dialog.close();
  navState(view === "craft" || view === "shelf" ? view : "discover");
  try {
    if (view === "chat" && id) {
      setContent('<p class="loading">회차를 불러오는 중입니다.</p>');
      const episode = await api("episodes/" + encodeURIComponent(id));
      if (revision !== routeRevision) return;
      const story = storyFor(episode.story);
      if (!story) throw new Error("작품을 찾지 못했습니다.");
      current = { story, episode };
      upsertSession(episode);
      chat(story,episode);
    } else if (view === "story" && storyFor(id)) detail(storyFor(id));
    else if (view === "craft") craft();
    else if (view === "shelf") shelf();
    else discover();
    window.scrollTo(0,0);
  } catch (error) {
    if (revision === routeRevision) setContent('<div class="container"><p class="empty">' + esc(error.message) + '</p>' + button("btn", 'data-view="discover"', "작품 탐색", "back") + '</div>');
  }
}
async function start(id, trigger) {
  if (trigger) trigger.disabled = true;
  const revision = routeRevision;
  try {
    const episode = await api("episodes",{story:id});
    upsertSession(episode);
    if (revision === routeRevision) go("chat",episode.id);
  } catch (e) { message(e.message); }
  finally { if (trigger) trigger.disabled = false; }
}
async function deleteEpisode(id, trigger) {
  if (deletingEpisodes.has(id)) return;
  deletingEpisodes.add(id);
  trigger.disabled = true;
  try {
    await api("episodes/" + id + "/delete", {});
  } catch (error) {
    if (error.status !== 404) {
      message(error.message);
      return;
    }
  } finally {
    deletingEpisodes.delete(id);
    trigger.disabled = false;
  }
  deletedEpisodes.add(id);
  library.sessions = library.sessions.filter(session => session.id !== id);
  const [view, opened] = locationParts();
  if (view === "chat" && opened === id) {
    history.replaceState(null, "", "#shelf");
    await renderRoute();
  } else if (view === "shelf") {
    shelf();
  }
  message("대화를 삭제했어요.");
}
async function send() {
  if (!current) return;
  const { story, episode } = current;
  if (pendingTurns.has(episode.id) || deletingEpisodes.has(episode.id)) return;
  const draft = document.querySelector("#compose"), select = document.querySelector("#model");
  const err = document.querySelector("#turn-error"), submit = document.querySelector(".send");
  const content = draft.value.trim();
  if (!content || !select.value) return;
  pendingTurns.add(episode.id);
  draft.disabled = select.disabled = submit.disabled = true;
  err.hidden = true;
  document.querySelector("#suggestions").hidden = true;
  const feed = document.querySelector("#transcript");
  feed.innerHTML = chatHistory(story,episode,content);
  scrollChat();
  try {
    const updated = await api("episodes/" + episode.id + "/turn",{message:content,mode:select.value});
    upsertSession(updated);
    if (current?.episode.id !== episode.id) return;
    current.episode = updated;
    feed.innerHTML = chatHistory(story,updated);
    document.querySelector("#story-status").innerHTML = statusPanel(story,updated);
    document.querySelector("#suggestions").innerHTML = suggestions(story,updated);
    draft.value = "";
  } catch (e) {
    if (current?.episode.id !== episode.id) return;
    feed.innerHTML = chatHistory(story,episode);
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    pendingTurns.delete(episode.id);
    if (current?.episode.id === episode.id && draft.isConnected) {
      draft.disabled = select.disabled = submit.disabled = false;
      document.querySelector("#suggestions").hidden = false;
      scrollChat();
      if (matchMedia("(pointer:fine)").matches) draft.focus({preventScroll:true});
    } else if (current?.episode.id === episode.id) {
      void renderRoute();
    }
  }
}
function openGallery() {
  if (!current) return;
  const {story,episode} = current;
  const cards = new Map([story.cards.neutral, ...episode.turns.map(t => cardFor(story,t.mood))].map(card => [card.file,card]));
  document.querySelector("#gallery-images").innerHTML = [...cards.values()].map(card => '<figure>' + image(card.file,card.label) +
    '<figcaption class="caption">' + esc(card.label) + '</figcaption></figure>').join("");
  dialog.showModal();
}
document.addEventListener("click", event => {
  const trigger = event.target.closest("button");
  if (!trigger || !library) return;
  const d = trigger.dataset;
  if (d.view) go(d.view);
  if (d.story) go("story",d.story);
  if (d.storyPreview) {
    const heading = document.querySelector("#story-preview-heading");
    heading?.focus({preventScroll:true});
    heading?.scrollIntoView({block:"start"});
  }
  if (d.episode) go("chat",d.episode);
  if (d.deleteEpisode) void deleteEpisode(d.deleteEpisode, trigger);
  if (d.start) void start(d.start, trigger);
  if (d.filter) {
    filter = d.filter; discover();
    [...document.querySelectorAll("[data-filter]")].find(b => b.dataset.filter === filter)?.focus();
  }
  if (d.suggestion && current && !pendingTurns.has(current.episode.id)) { document.querySelector("#compose").value = d.suggestion; void send(); }
  if (d.gallery) openGallery();
  if (d.status) {
    statusOpen = d.status === "open";
    document.querySelector("#story-status")?.classList.toggle("open",statusOpen);
    document.querySelector(statusOpen ? ".status-close" : ".mobile-status")?.focus();
  }
  if (trigger.id === "gallery-close") dialog.close();
});
app.addEventListener("submit", async event => {
  event.preventDefault();
  if (event.target.id === "access-form") {
    const form = event.target;
    const submit = form.querySelector("button");
    const error = form.querySelector("[role=alert]");
    submit.disabled = true;
    error.hidden = true;
    try {
      await api("access", Object.fromEntries(new FormData(form)));
      await loadLibrary();
    } catch (e) {
      error.textContent = e.message;
      error.hidden = false;
    } finally { submit.disabled = false; }
    return;
  }
  if (event.target.id === "chat-form") { void send(); return; }
  if (event.target.id !== "draft") return;
  const form = event.target, trigger = form.querySelector('[type="submit"]');
  const revision = routeRevision;
  trigger.disabled = true;
  const err = form.querySelector("#draft-error");
  err.hidden = true;
  try {
    const story = await api("stories",Object.fromEntries(new FormData(form)));
    library.stories.push(story);
    if (routeRevision === revision) await start(story.id);
  } catch (e) { err.textContent = e.message; err.hidden = false; }
  finally { trigger.disabled = false; }
});
app.addEventListener("change", event => {
  if (event.target.id === "model") { try { localStorage.setItem("scene.model",event.target.value); } catch { /* Optional preference */ } }
});
app.addEventListener("keydown", event => {
  if (event.target.id === "compose" && event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault(); void send();
  }
  if (event.key === "Escape" && statusOpen) document.querySelector(".status-close")?.click();
});
addEventListener("hashchange",() => { void renderRoute(); });
async function loadLibrary() {
  try {
    library = await api("library");
    await renderRoute();
  } catch (error) {
    if (error.accessRequired) {
      library = undefined;
      setContent('<div class="container access"><h1 class="section-title">SCENE 데모 입장</h1>' +
        '<form class="craft-form" id="access-form"><label>접속 코드<input name="code" type="password" autocomplete="one-time-code" maxlength="128" required></label>' +
        '<p class="error" role="alert" hidden></p><button class="btn primary" type="submit">입장하기</button></form></div>');
      return;
    }
    setContent('<p class="loading" role="alert">작품을 불러오지 못했습니다. 새로고침해 주세요.</p>');
  }
}
await loadLibrary();
