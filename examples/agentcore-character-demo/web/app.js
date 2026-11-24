import { mountCreator } from "./creator.js";
import { locale, setupLanguage, t } from "./i18n.js";

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
const rememberedLength = () => {
  try { return localStorage.getItem("scene.responseLength") === "short" ? "short" : "scene"; } catch { return "scene"; }
};
async function api(path, data, onDelta, onEvent) {
  let init;
  if (data !== undefined) {
    const body = JSON.stringify(data);
    const headers = {"Content-Type":"application/json", ...(onDelta ? {Accept:"text/event-stream"} : {})};
    if (location.protocol === "https:") {
      const bytes = new TextEncoder().encode(body);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      headers["x-amz-content-sha256"] = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
    }
    init = {method:"POST", headers, body};
  }
  const response = await fetch("/api/" + path + "?lang=" + locale, init);
  if (onDelta && response.ok && response.headers.get("content-type")?.includes("text/event-stream")) {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "", committed;
    for (;;) {
      const {value,done} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value,{stream:true});
      if (buffer.length > 1000000) throw new Error(t("요청을 완료할 수 없습니다."));
      let match;
      while ((match = /\r?\n\r?\n/u.exec(buffer))) {
        const frame = buffer.slice(0,match.index); buffer = buffer.slice(match.index+match[0].length);
        const lines = frame.split(/\r?\n/u);
        const event = lines.find(line=>line.startsWith("event:"))?.slice(6).trim();
        const raw = lines.filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
        if (!raw) continue;
        const payload = JSON.parse(raw);
        if (event === "dialogue.delta" || event === "creator.delta") onDelta(payload.text);
        if (["creator.tool","creator.activity","creator.artifacts","creator.heartbeat","creator.proposal","creator.research"].includes(event)) onEvent?.(event,payload);
        if (event === "creator.completed") committed = payload;
        if (event === "creator.error") throw new Error(t(payload.error));
        if (event === "turn.error") throw new Error(t(payload.error));
        if (event === "state.committed") committed = payload.episode;
      }
    }
    if (!committed) throw new Error(t("응답을 완성하지 못했습니다. 저장 상태를 확인하고 다시 시도해 주세요."));
    return committed;
  }
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(t(payload.error || "요청을 완료할 수 없습니다."));
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
  const visibleStories=library.stories.filter(s=>!s.preview);
  const [feature] = visibleStories;
  const genres = ["전체", ...new Set(library.stories.map(story => story.genre))];
  const filtered = filter === "전체" ? visibleStories : visibleStories.filter(s => s.genre === filter);
  const cards = filtered.map(story => '<button class="card story-' + esc(story.id) + '" data-story="' + esc(story.id) + '"><div class="thumb">' +
    image(story.cover, "") + badge(t(story.public ? "공개 작품" : story.custom ? "내 작품" : story.genre)) + '</div><div class="card-copy"><h3>' + esc(story.title) + '</h3><p>' + esc(story.tagline) + '</p></div></button>').join("");
  setContent('<div class="container"><div class="topline"><div><p class="kicker">' + t("STORY LIBRARY") + '</p><h2 class="section-title">' + t("작품 탐색") + '</h2></div>' +
    '<span class="live">' + (library.runtime ? '<i></i> ' + t("AgentCore 연결 설정됨") : t("AgentCore 설정 필요")) + '</span></div>' +
    '<section class="hero">' + image(feature.cover, "", "hero-art", true) + '<div class="hero-copy">' +
    badge(t("추천 스토리") + " · " + t(feature.genre), "spark") + '<h1>' + esc(feature.title) + '</h1><p>' + esc(feature.tagline) + '</p><div class="actions">' +
    button("btn primary", 'data-story="' + feature.id + '"', t("이야기 열기"), "play") +
    button("btn", 'data-view="craft"', t("작품 만들기"), "editIcon") + '</div></div></section>' +
    '<section><div class="section-head"><div><h2>' + t("어떤 이야기에 들어갈까요?") + '</h2><p>' + t("작품마다 다른 역할과 첫 장면이 기다립니다.") + '</p></div><div class="filters" aria-label="' + t("장르 필터") + '">' +
    genres.map(g => button("filter" + (g === filter ? " current" : ""), 'data-filter="' + esc(g) + '" aria-pressed="' + (g === filter) + '"', esc(t(g)))).join("") +
    '</div></div><div class="cards">' + cards + '</div></section></div>');
}
function detail(story) {
  const last = library.sessions.find(item => item.story === story.id);
  setContent('<div class="container detail">' + button("btn", 'data-view="discover"', t("작품 탐색"), "back") +
    '<section class="cover-detail story-' + esc(story.id) + '">' + image(story.cover, "", "", true) + '<header>' +
    badge(story.premiseBadge || t(story.genre)) + '<h1>' + esc(story.title) + '</h1><p>' + esc(story.tagline) + '</p></header></section>' +
    '<section class="detail-body"><p class="kicker">' + t("PROLOGUE") + '</p><p>' + esc(story.prologue) + '</p><p><strong>' + t("내 역할") + '</strong> · ' + esc(story.role) + '</p>' +
    (story.source ? '<a class="source" target="_blank" rel="noreferrer" href="' + esc(story.source.url) + '">' + esc(story.source.label) + ' ↗</a>' : '') + '</section>' +
    '<div class="actions">' + (last ? button("btn primary", 'data-episode="' + last.id + '"', t("이어하기"), "play") : '') +
    button(last ? "btn" : "btn primary", 'data-start="' + esc(story.id) + '"', t(last ? "새 회차 시작" : "대화 시작"), "arrow") +
    (story.previewTurns?.length ? button("btn", 'data-story-preview="open" aria-controls="story-preview"', t("예시 대화 보기"), "chatIcon") : "") +
    (story.hasTemplate?button('btn','data-edit-story="template:'+esc(story.id)+'"','공개 초안 불러오기','editIcon'):'') +
    (!story.public?button('btn','data-edit-story="'+esc(story.id)+'"','편집용으로 불러오기','editIcon'):'') +
    (story.starts?.length ? '<label>시작 설정<select id="play-start">'+story.starts.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.title)+'</option>').join('')+'</select></label>' : '') +
    '</div>' + prologue(story, true) + storyPreview(story) + '</div>');
}
function prologue(story, expanded = false) {
  if (!story.prologueImages?.length) return "";
  return '<details class="prologue-comic"' + (expanded ? ' open' : '') + '><summary>' + t("프롤로그 웹툰") + '</summary>' +
    story.prologueImages.map(card => image(card.file, t(card.label), "prologue-page")).join("") + '</details>';
}
function turnTiming(turn) {
  const usage = turn.usage;
  if (!usage) return "";
  const stages = [["서비스 첫 대사", usage.serviceFirstContentMs], ["Bedrock 첫 텍스트", usage.firstContentMs], ["기억·상태 보조 처리", usage.metadataMs], ["입력 해석", usage.interpretationMs], ["상태 규칙 계산", usage.graphMs], ["대사 생성", usage.bedrockMs], ["상태 판정", usage.refereeMs], [usage.serviceFirstContentMs === undefined ? "AgentCore 응답 대기" : "AgentCore 스트림 연결", usage.agentCoreHeadersMs], [usage.serviceFirstContentMs === undefined ? "응답 수신" : "AgentCore 스트림 수신", usage.agentCoreBodyMs]];
  return '<details class="turn-timing"><summary>' + t("처리 시간 보기") + '</summary><dl>' +
    stages.filter(([, value]) => value !== undefined).map(([label, value]) => '<dt>' + t(label) + '</dt><dd>' + (value / 1000).toFixed(2) + t("초") + '</dd>').join("") +
    (usage.reasoningTokens !== undefined ? '<dt>' + t("추론 토큰") + '</dt><dd>' + usage.reasoningTokens + '</dd>' : '') + '</dl><p>' + t("단계 시간은 중첩될 수 있습니다.") + '</p></details>';
}
function endingCard(narrative) {
  if (!narrative?.ending) return "";
  return '<section class="ending-card" role="status"><p class="kicker">ENDING</p><h2>' + esc(t(narrative.ending.title)) + '</h2><p>' + esc(t(narrative.ending.text)) + '</p><p class="caption">' + t("이 회차가 마무리되었습니다. 새 회차에서 다른 선택을 해보세요.") + '</p></section>';
}
function storyPreview(story) {
  if (!story.previewTurns?.length) return "";
  const turns = story.previewTurns.map(turn =>
    '<li class="preview-turn"><div class="preview-player"><span>' + t("플레이어") + '</span><p>' + esc(turn.input) + '</p></div>' +
    reply(story, turn.beats) + '</li>',
  ).join("");
  return '<section class="story-preview" id="story-preview" aria-labelledby="story-preview-heading">' +
    '<h2 id="story-preview-heading" tabindex="-1">' + t("예시 대화") + '</h2><ol class="preview-transcript">' + turns + '</ol></section>';
}
function shelf() {
  const rows = library.sessions.map(session => {
    const story = storyFor(session.story);
    if (!story) return "";
    return '<div class="shelf-row"><button class="shelf-item" data-episode="' + session.id + '">' + image(story.cover, "") +
      '<span><strong>' + esc(story.title) + '</strong><small>' + esc(story.character) + ' · ' + t("이어하기") + '</small></span>' + icon("arrow") + '</button>' +
      button("btn delete-button", 'data-delete-episode="' + session.id + '" aria-label="' + esc(t("{story} 대화 삭제", { story: story.title })) + '"', t("삭제"), "trash") + '</div>';
  }).join("");
  setContent('<div class="container new-story"><p class="kicker">' + t("YOUR EPISODES") + '</p><h1 class="section-title">' + t("내 대화") + '</h1><p class="subtle">' + t("이 브라우저에서 열었던 회차를 다시 읽을 수 있어요.") + '</p>' +
    (rows ? '<div class="shelf">' + rows + '</div>' : '<p class="empty">' + t("아직 대화가 없어요. 작품을 하나 골라 시작해 보세요.") + '</p>' + button("btn primary", 'data-view="discover"', t("작품 탐색"), "arrow")) + '</div>');
}
function craft(sourceId) {
  setContent('<div id="creator-host"><p class="loading">작품 편집기를 불러오는 중입니다.</p></div>');
  void mountCreator(document.querySelector('#creator-host'),{api,library,sourceId,
    onPublished:story=>{library.stories=[...library.stories.filter(s=>s.id!==story.id),story];message(story.public?'작품을 누구나 볼 수 있게 공개 게시했습니다.':'작품을 새 버전으로 등록했습니다.');},
    onTest:result=>{library.stories.push(result.story);go('chat',result.episodeId);},
  });
}
function cardFor(story, key) { return story.cards[key] ?? story.cards.neutral; }
function reply(story, beats) {
  return '<div class="reply"><p class="speaker">' + esc(story.character) + '</p>' +
    beats.map(({kind,text}) => '<p class="beat beat-' + esc(kind) + '">' + esc(text) + '</p>').join("") + '</div>';
}
function milestoneCard(narrative) {
  if (narrative?.ending || !narrative?.milestones?.length) return "";
  const item = narrative.milestones.at(-1);
  return '<section class="milestone-card" role="status"><p class="kicker">' + t("이야기 진행") + '</p><h2>' + esc(t(item.title)) + '</h2><p>' + esc(t(item.text)) + '</p><p class="caption">' + t("같은 대화에서 다음 장면을 이어가세요.") + '</p></section>';
}
function chatHistory(story, episode, pendingText) {
  const body = episode.turns.map(turn => {
    const card = cardFor(story, turn.mood);
    return '<article class="turn"><div class="turn-player"><p>' + esc(turn.input) + '</p></div>' +
      (turn.media?.length ? turn.media.map(m=>image(m.file,m.label,"scene-img")).join("") : turn.mood !== "neutral" && story.cards[turn.mood] && !story.hasMedia ? image(card.file, card.label, "scene-img") : "") +
      reply({...story,character:turn.speaker??story.character}, turn.beats) + '<p class="turn-caption">' + esc(modelFor(turn.mode)) + ' · ' + (turn.timing / 1000).toFixed(1) + t("초") +
      (turn.trustQuote ? ' <strong title="' + esc(turn.trustQuote) + '">' + t("신뢰도 +1") + '</strong>' : '') + '</p>' + turnTiming(turn) + '</article>';
  }).join("");
  return '<div class="stream-wrap"><p class="opening-mark">' + icon("book") + ' ' + t("프롤로그") + '</p>' +
    prologue(story) + image(story.cards.neutral.file, story.cards.neutral.label, "scene-img", true) +
    '<p class="opening-text">' + esc(story.prologue) + '</p>' + reply(story,[{kind:"speech",text:story.greeting}]) + body + endingCard(episode.narrative) + milestoneCard(episode.narrative) +
    (pendingText ? '<div class="turn-player"><p>' + esc(pendingText) + '</p></div><p class="send-pending" role="status">' + esc(t("{name}의 다음 장면을 이어가는 중…", { name: story.character })) + ' <span data-pending-elapsed></span></p>' : '') + '</div>';
}
function statusPanel(story, episode) {
  if (episode.narrative) return narrativePanel(story, episode);
  const stats = episode.stats;
  const card = cardFor(story, episode.turns.at(-1)?.mood);
  const event = episode.turns.at(-1)?.trustQuote;
  const statText = stats.trust + " / " + stats.max;
  return iconButton('data-status="close"',"close",t("상태창 닫기"),"status-close") +
    '<h2 id="status-heading">' + icon("statusIcon") + t("상태창") + '</h2>' + image(card.file, card.label, "status-image", true) +
    '<dl class="status-block"><dt>' + t("현재 장면") + '</dt><dd>' + esc(story.scene) + '</dd><dt>' + t("내 역할") + '</dt><dd>' + esc(story.role) + '</dd>' +
    (story.objective ? '<dt>' + t("목표") + '</dt><dd>' + esc(story.objective) + '</dd>' : '') +
    (episode.status ? '<dt>' + esc(episode.status.label) + '</dt><dd>' + esc(episode.status.value) + '</dd>' : '') +
    '<dt>' + t("대화 턴") + '</dt><dd>' + episode.turns.length + '</dd></dl>' +
    (story.hasTrust ? '<div class="status-block"><p class="stat-heading">' + t("신뢰도") + ' <span class="stat-value">' + statText + '</span></p>' +
      '<div class="meter" role="meter" aria-label="' + t("신뢰도") + '" aria-valuemin="0" aria-valuemax="' + stats.max + '" aria-valuenow="' + stats.trust + '">' +
      Array.from({length:stats.max},(_,i) => '<span' + (i < stats.trust ? ' class="filled"' : '') + '></span>').join("") + '</div>' +
      '<p class="caption">' + esc(stats.level) + '</p>' + (event ? '<p class="status-change">+1 · “' + esc(event) + '”</p>' : '') + '</div>' : '') +
    '<div class="status-foot">' + button("btn", 'data-gallery="open"', t("이미지 보관함"), "imageIcon") +
    button("btn", 'data-start="' + esc(story.id) + '"', t("새 회차"), "spark") + '</div>';
}
function narrativePanel(story, episode) {
  const n = episode.narrative;
  const clock = n.clockStyle === "elapsed" ? t("경과 {minutes}분", {minutes:n.elapsedMinutes}) : new Intl.DateTimeFormat(locale, {timeZone:"Asia/Seoul", month:"short", day:"numeric", weekday:"short", hour:"2-digit", minute:"2-digit", hour12:false}).format(new Date(n.time)) + ' · ' + t('{day}일차', {day:n.day});
  const block = (title, content, extra = "") => '<section class="status-block ' + extra + '"><h3>' + esc(t(title)) + '</h3>' + content + '</section>';
  const active = (n.ending ? [] : n.threads ?? []).filter(thread => thread.status === "active");
  const unfinished = n.ending ? (n.threads ?? []).filter(thread=>thread.status === "active") : [];
  const resolved = (n.threads ?? []).filter(thread => thread.status === "resolved");
  const threads = list => list.map(thread => '<article class="plot-thread"><strong>' + esc(t(thread.title)) + '</strong><p>' + esc(t(thread.description)) + '</p></article>').join("");
  return iconButton('data-status="close"', "close", t("상태창 닫기"), "status-close") +
    '<h2 id="status-heading">' + icon("statusIcon") + t("세계와 현재 상태") + '</h2>' +
    block("현재 상태", '<p class="world-scene">' + esc(t(n.scene)) + '</p><dl><dt>' + t("장소") + '</dt><dd>' + esc(t(n.location)) + '</dd><dt>' + esc(t(n.clockLabel ?? "이야기 시간")) + '</dt><dd>' + esc(clock) + '</dd>' +
      (n.fields ?? []).map(field => '<dt>' + esc(t(field.label)) + '</dt><dd>' + esc(t(field.value)) + '</dd>').join("") +
      '<dt>' + t("대화 턴") + '</dt><dd>' + episode.turns.length + '</dd></dl>') +
    (n.world?.trackingSinceTurn > 0 ? '<p class="tracking-note">' + esc(t("기존 {count}턴은 보존됩니다. 세계 상태는 이후 대화부터 기록합니다.", {count:n.world.trackingSinceTurn})) + '</p>' : '') +
    (episode.narrativeUpgrade?.previousEnding && episode.version === episode.narrativeUpgrade.atTurn ? '<p class="tracking-note">' + t("이전 장면의 마무리 뒤에도 같은 대화를 이어갈 수 있어요. 대화와 선택은 보존했습니다.") + '</p>' : '') +
    block("지금의 목표", '<p>' + esc(t(n.objective)) + '</p>', 'current-goal') +
    block("스탯", '<div class="world-stats">' + n.counters.map(c => '<div><p class="stat-heading">' + esc(t(c.label)) + '<span class="stat-value">' + esc(c.displayValue ?? c.value + ' / ' + c.max) + (c.unit ? ' ' + esc(t(c.unit)) : '') + '</span></p>' + (c.displayValue === undefined ? '<progress max="' + (c.max-(c.min??0)||1) + '" value="' + (c.value-(c.min??0)) + '" aria-label="' + esc(t(c.label)) + '"></progress>' : '') + '</div>').join("") + '</div>') +
    block("진행 중인 사건", active.length ? threads(active) : '<p class="caption">' + t(n.ending ? "이번 회차를 마무리했습니다." : "현재 진행 중인 사건이 없습니다.") + '</p>') +
    (n.world?.summary ? block("세계관", '<p>' + esc(t(n.world.summary)) + '</p><details><summary>' + t("현재 공개된 사실") + ' · ' + n.world.facts.length + '</summary><ul class="world-facts">' + n.world.facts.map(fact=>'<li>' + esc(t(fact.text)) + '</li>').join("") + '</ul></details>') : '') +
    ((n.timeline ?? []).length ? block("최근 변화", '<ol class="world-timeline">' + n.timeline.map(event=>'<li><span>' + esc(t("{turn}턴", {turn:event.turn})) + '</span><strong>' + esc(t(event.label)) + '</strong></li>').join("") + '</ol>') : '') +
    (unfinished.length ? '<details class="status-block"><summary>' + t("미완료로 남은 사건") + ' · ' + unfinished.length + '</summary><p class="caption">' + t("이 회차에서는 마무리하지 않았습니다.") + '</p>' + threads(unfinished) + '</details>' : '') +
    (resolved.length ? '<details class="status-block"><summary>' + t("마무리한 사건") + ' · ' + resolved.length + '</summary>' + threads(resolved) + '</details>' : '') +
    ((n.milestones ?? []).length ? '<details class="status-block"><summary>' + t("이야기 진행 기록") + ' · ' + n.milestones.length + '</summary>' + n.milestones.map(item=>'<p><strong>' + esc(t(item.title)) + '</strong></p><p class="caption">' + esc(t(item.text)) + '</p>').join("") + '</details>' : '') +
    (n.ending ? block("이번 회차의 엔딩", '<strong>' + esc(t(n.ending.title)) + '</strong><p>' + esc(t(n.ending.text)) + '</p>', 'current-goal') : '<details class="status-block"><summary>' + t("다음 장면의 조건") + '</summary>' + n.gates.map(gate => '<p><strong>' + esc(t(gate.label)) + '</strong></p><p class="caption">' + esc(t("장면 대화 {actual}/{minimum}턴", {actual:n.sceneTurns, minimum:gate.minimumTurns})) + '</p>' + gate.conditions.map(c => '<p class="caption">' + esc(t(c.label)) + ' ' + (c.op === 'gte' ? '≥' : c.op === 'lte' ? '≤' : '=') + ' ' + c.value + ' · ' + t("현재") + ' ' + c.actual + '</p>').join("") + '<p class="caption">' + t(gate.ready ? "준비 완료 · 원할 때 다음 행동을 선택하세요." : "함께 나눈 경험과 선택에 따라 열립니다.") + '</p>').join("") + '</details>') +
    '<p class="caption ending-count">' + t("발견할 수 있는 엔딩 {count}개", {count:n.endingCount}) + '</p><div class="status-foot">' + button("btn", 'data-gallery="open"', t("이미지 보관함"), "imageIcon") + button("btn", 'data-start="' + esc(story.id) + '"', t("새 회차"), "spark") + '</div>';
}
function suggestions(story, episode) {
  if (episode.narrative?.ending) return "";
  const last = episode.turns.at(-1);
  const picks = episode.narrative ? episode.narrative.suggestions.map(s => t(s)) : last && (last.responseLanguage ?? "ko") === locale && last.suggestions.length ? last.suggestions : story.suggestions;
  return picks.map(s => button("suggest", 'data-suggestion="' + esc(s) + '"', esc(s))).join("");
}
function chat(story, episode) {
  const replyLength = !episode.turns.length ? story.recommendedLength ?? rememberedLength() : rememberedLength();
  const model = !episode.turns.length && story.recommendedModel ? story.recommendedModel : rememberedModel();
  const groups = [...new Set(library.models.map(m => m.provider))].map(provider => '<optgroup label="' + esc(provider) + '">' +
    library.models.filter(m => m.provider === provider).map(m => '<option value="' + esc(m.id) + '"' + (m.id === model ? ' selected' : '') + '>' + esc(m.label) + '</option>').join("") + '</optgroup>').join("");
  setContent('<div class="storychat"><div class="chat-core"><header class="chatbar">' + iconButton('data-story="' + esc(story.id) + '"',"back",t("작품으로 돌아가기")) +
    '<div><h1>' + esc(story.title) + '</h1><p class="subtle">' + esc(story.character) + ' · ' + esc(story.job) + '</p></div><div class="chatbar-right">' +
    iconButton('data-gallery="open"',"imageIcon",t("이미지 보관함")) + iconButton('data-status="open" aria-controls="story-status"',"statusIcon",t("상태창 열기"),"mobile-status") +
    iconButton('data-delete-episode="' + episode.id + '"',"trash",t("이 대화 삭제"),"delete-button") +
    '</div></header><div class="transcript" id="transcript">' + chatHistory(story,episode) + '</div><form id="chat-form" class="composer"><div class="compose-inner">' +
    '<div id="suggestions" class="suggestions">' + suggestions(story,episode) + '</div><p id="turn-error" class="error" role="alert" hidden></p>' +
    '<div class="compose-line"><textarea id="compose" aria-label="' + t("대화 입력") + '" rows="1" maxlength="1500" placeholder="' + esc(t("{name}에게 무엇이라고 말할까요?", { name: story.character })) + '" required></textarea>' +
    '<button type="submit" class="send" aria-label="' + t("보내기") + '">' + icon("send") + '</button></div><div class="model-controls">' +
    '<label>' + t("모델") + ' <select id="model" aria-label="' + t("모델 선택") + '">' + groups + '</select></label><label class="response-length-label">' + t("답변 길이") + ' <select id="response-length" aria-label="' + t("답변 길이") + '"><option value="scene"' + (replyLength === "scene" ? ' selected' : '') + '>' + t("장면형 · 길게") + '</option><option value="short"' + (replyLength === "short" ? ' selected' : '') + '>' + t("대화형 · 짧게") + '</option></select></label><span class="keyhint">' + t("Enter 보내기 · Shift+Enter 줄바꿈") + '</span></div>' +
    '</div></form></div><aside id="story-status" aria-labelledby="status-heading" class="status-panel' + (statusOpen ? ' open' : '') + '">' + statusPanel(story,episode) + '</aside></div>');
  if (episode.turns.length) scrollChat();
  setEnded(episode);
}
function setEnded(episode) {
  if (!episode.narrative?.ending) return;
  for (const element of document.querySelectorAll('#compose, #model, #response-length, .send')) element.disabled = true;
  document.querySelector('#compose').placeholder = t("회차가 마무리되었습니다.");
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
      setContent('<p class="loading">' + t("회차를 불러오는 중입니다.") + '</p>');
      const episode = await api("episodes/" + encodeURIComponent(id));
      if (revision !== routeRevision) return;
      const story = episode.storyView ?? storyFor(episode.story);
      if (!story) throw new Error(t("작품을 찾지 못했습니다."));
      current = { story, episode };
      upsertSession(episode);
      chat(story,episode);
    } else if (view === "story" && storyFor(id)) detail(storyFor(id));
    else if (view === "craft") craft(id);
    else if (view === "shelf") shelf();
    else discover();
    window.scrollTo(0,0);
  } catch (error) {
    if (revision === routeRevision) setContent('<div class="container"><p class="empty">' + esc(error.message) + '</p>' + button("btn", 'data-view="discover"', t("작품 탐색"), "back") + '</div>');
  }
}
async function start(id, trigger) {
  if (trigger) trigger.disabled = true;
  const revision = routeRevision;
  try {
    const episode = await api("episodes",{story:id,...(document.querySelector("#play-start")?{startId:document.querySelector("#play-start").value}:{})});
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
  message(t("대화를 삭제했어요."));
}
async function send() {
  if (!current) return;
  const { story, episode } = current;
  if (episode.narrative?.ending || pendingTurns.has(episode.id) || deletingEpisodes.has(episode.id)) return;
  const draft = document.querySelector("#compose"), select = document.querySelector("#model"), lengthSelect = document.querySelector("#response-length");
  const err = document.querySelector("#turn-error"), submit = document.querySelector(".send");
  const content = draft.value.trim();
  if (!content || !select.value) return;
  pendingTurns.add(episode.id);
  draft.disabled = select.disabled = lengthSelect.disabled = submit.disabled = true;
  err.hidden = true;
  document.querySelector("#suggestions").hidden = true;
  const feed = document.querySelector("#transcript");
  feed.innerHTML = chatHistory(story,episode,content);
  scrollChat();
  const pendingStart = performance.now();
  const elapsedTimer = setInterval(() => {
    const elapsed = feed.querySelector("[data-pending-elapsed]");
    if (elapsed) elapsed.textContent = ((performance.now() - pendingStart) / 1000).toFixed(1) + t("초");
  }, 500);
  try {
    const requestId = draft.dataset.requestText === content && draft.dataset.requestMode === select.value && draft.dataset.requestLength === lengthSelect.value
      ? draft.dataset.requestId : crypto.randomUUID();
    draft.dataset.requestId = requestId;
    draft.dataset.requestText = content;
    draft.dataset.requestMode = select.value;
    draft.dataset.requestLength = lengthSelect.value;
    let liveText = "", live;
    const updated = await api("episodes/" + episode.id + "/turn",{message:content,mode:select.value,responseLength:lengthSelect.value,requestId}, text => {
      if (current?.episode.id !== episode.id) return;
      if (!live) {
        const pending = feed.querySelector(".send-pending");
        const article = document.createElement("div");
        article.className = "turn-character live-dialogue";
        article.innerHTML = '<strong>' + esc(story.character) + '</strong><p class="beat beat-speech" data-live-dialogue></p>';
        pending?.replaceWith(article);
        live = article.querySelector("[data-live-dialogue]");
      }
      liveText += text;
      const visible = liveText.replace(/\[(?:대사|행동|장면|묘사|Action|Dialogue|Scene|Narration|行動|台詞|セリフ|場面|描写)\]\s*/giu, "").replace(/\[[^\]\n]{0,20}$/u, "");
      live.textContent = visible;
      if (visible.trim() && !live.dataset.firstPaintMs) live.dataset.firstPaintMs = String(Math.round(performance.now()-pendingStart));
      scrollChat();
    });
    upsertSession(updated);
    if (current?.episode.id !== episode.id) return;
    current.episode = updated;
    feed.innerHTML = chatHistory(story,updated);
    document.querySelector("#story-status").innerHTML = statusPanel(story,updated);
    document.querySelector("#suggestions").innerHTML = suggestions(story,updated);
    draft.value = "";
    delete draft.dataset.requestId;
    delete draft.dataset.requestText;
    delete draft.dataset.requestMode;
    delete draft.dataset.requestLength;
  } catch (e) {
    if (current?.episode.id !== episode.id) return;
    feed.innerHTML = chatHistory(story,episode);
    err.textContent = e.message;
    err.hidden = false;
  } finally {
    clearInterval(elapsedTimer);
    pendingTurns.delete(episode.id);
    if (current?.episode.id === episode.id && draft.isConnected) {
      draft.disabled = select.disabled = lengthSelect.disabled = submit.disabled = false;
      document.querySelector("#suggestions").hidden = false;
      scrollChat();
      setEnded(current.episode);
      if (!draft.disabled && matchMedia("(pointer:fine)").matches) draft.focus({preventScroll:true});
    } else if (current?.episode.id === episode.id) {
      void renderRoute();
    }
  }
}
function openGallery() {
  if (!current) return;
  const {story,episode} = current;
  const cards = new Map([story.cards.neutral, ...episode.turns.flatMap(t => t.media?.length?t.media:[cardFor(story,t.mood)])].map(card => [card.file,card]));
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
  if (d.editStory) go("craft",d.editStory);
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
  if (event.target.id === "response-length") { try { localStorage.setItem("scene.responseLength", event.target.value); } catch { /* Optional preference */ } }
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
      setContent('<div class="container access"><h1 class="section-title">' + t("SCENE 데모 입장") + '</h1>' +
        '<form class="craft-form" id="access-form"><label>' + t("접속 코드") + '<input name="code" type="password" autocomplete="one-time-code" maxlength="128" required></label>' +
        '<p class="error" role="alert" hidden></p><button class="btn primary" type="submit">' + t("입장하기") + '</button></form></div>');
      return;
    }
    setContent('<p class="loading" role="alert">' + t("작품을 불러오지 못했습니다. 새로고침해 주세요.") + '</p>');
  }
}
setupLanguage();
await loadLibrary();
