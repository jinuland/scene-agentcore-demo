const languages = ["ko", "en", "ja"];
const requested = new URLSearchParams(location.search).get("lang");
let saved;
try { saved = localStorage.getItem("scene.language"); } catch { /* Optional preference */ }
export const locale = languages.includes(requested) ? requested : languages.includes(saved) ? saved : "ko";

const copy = {
  "SCENE — 내가 들어가는 이야기": ["SCENE — Stories you step into", "SCENE — 物語の中へ"],
  "주 메뉴": ["Main menu", "メインメニュー"],
  "SCENE 홈": ["SCENE home", "SCENE ホーム"],
  "라이브러리": ["Library", "ライブラリ"],
  "작품 메뉴": ["Stories menu", "作品メニュー"],
  "언어": ["Language", "言語"],
  "작품 탐색": ["Discover", "作品を探す"],
  "내 대화": ["My chats", "マイチャット"],
  "작품 만들기": ["Create a story", "作品を作る"],
  "작품을 불러오는 중입니다.": ["Loading stories…", "作品を読み込み中…"],
  "이번 회차의 이미지": ["Episode images", "このエピソードの画像"],
  "이미지 보관함 닫기": ["Close image gallery", "画像ギャラリーを閉じる"],
  "전체": ["All", "すべて"],
  "판타지": ["Fantasy", "ファンタジー"],
  "로맨스": ["Romance", "ロマンス"],
  "내 작품": ["My story", "自作"],
  "STORY LIBRARY": ["STORY LIBRARY", "作品ライブラリ"],
  "PROLOGUE": ["PROLOGUE", "プロローグ"],
  "YOUR EPISODES": ["YOUR EPISODES", "エピソード一覧"],
  "CREATOR STUDIO": ["CREATOR STUDIO", "クリエイタースタジオ"],
  "AgentCore 연결 설정됨": ["AgentCore connected", "AgentCore 接続済み"],
  "AgentCore 설정 필요": ["AgentCore setup required", "AgentCore の設定が必要"],
  "추천 스토리": ["Featured story", "おすすめ作品"],
  "이야기 열기": ["Open story", "作品を開く"],
  "어떤 이야기에 들어갈까요?": ["Which story will you step into?", "どの物語に入りますか？"],
  "작품마다 다른 역할과 첫 장면이 기다립니다.": ["Each story has a different role and opening scene.", "作品ごとに異なる役割と最初の場面が待っています。"],
  "장르 필터": ["Genre filter", "ジャンルで絞り込む"],
  "내 역할": ["Your role", "あなたの役割"],
  "이어하기": ["Continue", "続きから"],
  "새 회차 시작": ["Start a new episode", "新しいエピソードを始める"],
  "대화 시작": ["Start chat", "チャットを始める"],
  "예시 대화 보기": ["View sample dialogue", "会話例を見る"],
  "플레이어": ["Player", "プレイヤー"],
  "예시 대화": ["Sample dialogue", "会話例"],
  "{story} 대화 삭제": ["Delete chat: {story}", "チャットを削除：{story}"],
  "삭제": ["Delete", "削除"],
  "이 브라우저에서 열었던 회차를 다시 읽을 수 있어요.": ["Return to the episodes you started in this browser.", "このブラウザーで始めたエピソードを読み返せます。"],
  "아직 대화가 없어요. 작품을 하나 골라 시작해 보세요.": ["No chats yet. Pick a story to get started.", "チャットはまだありません。作品を選んで始めましょう。"],
  "캐릭터와 첫 장면을 정한 뒤 새 회차에서 곧바로 대화해 보세요.": ["Set up a character and opening scene, then start a chat.", "キャラクターと最初の場面を設定し、すぐにチャットを試せます。"],
  "작품 제목": ["Story title", "作品タイトル"],
  "예: 심야 수리점": ["e.g. The Midnight Repair Shop", "例：真夜中の修理店"],
  "캐릭터 이름": ["Character name", "キャラクター名"],
  "예: 윤": ["e.g. Yun", "例：ユン"],
  "장르": ["Genre", "ジャンル"],
  "표지": ["Cover", "カバー"],
  "{genre} 표지": ["{genre} cover", "{genre}のカバー"],
  "세계관과 첫 상황": ["Setting and opening scene", "世界観と最初の場面"],
  "장소, 캐릭터의 말투와 지금 일어난 일을 적어 주세요.": ["Describe the place, how the character speaks, and what just happened.", "場所、キャラクターの話し方、今起きた出来事を入力してください。"],
  "플레이어 역할": ["Player role", "プレイヤーの役割"],
  "예: 고장 난 기기를 맡기러 온 손님": ["e.g. A customer bringing in a broken device", "例：壊れた機器を修理に持ち込んだ客"],
  "캐릭터의 첫 대사": ["Character's opening line", "キャラクターの最初のセリフ"],
  "예: 불은 껐지만, 아직 문은 안 잠갔어요.": ["e.g. The lights are off, but I haven't locked the door.", "例：明かりは消したけど、まだ鍵は閉めていません。"],
  "신뢰도가 오르는 행동": ["What earns trust", "信頼度が上がる行動"],
  "선택 사항 · 해당하는 발언에 신뢰도 +1": ["Optional · Matching replies earn +1 trust", "任意 · 条件に合う発言で信頼度 +1"],
  "예: 손님이 수리를 함께 돕겠다고 자발적으로 말한다.": ["e.g. The customer volunteers to help with the repair.", "例：客が自分から修理を手伝うと言う。"],
  "저장하고 테스트 채팅": ["Save and test chat", "保存して試しにチャットする"],
  "초": [" s", "秒"],
  "신뢰도 +1": ["Trust +1", "信頼度 +1"],
  "프롤로그": ["Prologue", "プロローグ"],
  "{name}의 다음 장면을 이어가는 중…": ["Waiting for {name}…", "{name}の返答を待っています…"],
  "상태창 닫기": ["Close status panel", "ステータスを閉じる"],
  "상태창": ["Status", "ステータス"],
  "현재 장면": ["Current scene", "現在の場面"],
  "목표": ["Objective", "目標"],
  "대화 턴": ["Turns", "会話ターン"],
  "신뢰도": ["Trust", "信頼度"],
  "이미지 보관함": ["Image gallery", "画像ギャラリー"],
  "새 회차": ["New episode", "新しいエピソード"],
  "작품으로 돌아가기": ["Back to story", "作品に戻る"],
  "상태창 열기": ["Open status panel", "ステータスを開く"],
  "이 대화 삭제": ["Delete this chat", "このチャットを削除"],
  "대화 입력": ["Message", "メッセージ"],
  "{name}에게 무엇이라고 말할까요?": ["What will you say to {name}?", "{name}に何と話しかけますか？"],
  "보내기": ["Send", "送信"],
  "모델": ["Model", "モデル"],
  "모델 선택": ["Select model", "モデルを選択"],
  "Enter 보내기 · Shift+Enter 줄바꿈": ["Enter to send · Shift+Enter for a new line", "Enterで送信 · Shift+Enterで改行"],
  "회차를 불러오는 중입니다.": ["Loading episode…", "エピソードを読み込み中…"],
  "작품을 찾지 못했습니다.": ["Story not found.", "作品が見つかりませんでした。"],
  "대화를 삭제했어요.": ["Chat deleted.", "チャットを削除しました。"],
  "SCENE 데모 입장": ["Enter the SCENE demo", "SCENEデモに入る"],
  "접속 코드": ["Access code", "アクセスコード"],
  "입장하기": ["Enter demo", "デモに入る"],
  "작품을 불러오지 못했습니다. 새로고침해 주세요.": ["Couldn't load the stories. Refresh to try again.", "作品を読み込めませんでした。ページを更新してください。"],
  "요청을 완료할 수 없습니다.": ["Couldn't complete the request.", "リクエストを完了できませんでした。"],
  "문제가 생겼습니다. 잠시 후 다시 시도해 주세요.": ["Something went wrong. Try again in a moment.", "問題が発生しました。少し待ってからもう一度お試しください。"],
  "접속 코드를 확인해 주세요.": ["Check the access code.", "アクセスコードをご確認ください。"],
  "접속 코드가 필요합니다.": ["An access code is required.", "アクセスコードが必要です。"],
  "필수 입력과 글자 수를 확인해 주세요.": ["Check the required fields and length limits.", "必須項目と文字数をご確認ください。"],
  "회차를 찾지 못했습니다.": ["Episode not found.", "エピソードが見つかりませんでした。"],
  "이 모델은 현재 선택할 수 없습니다.": ["This model is currently unavailable.", "このモデルは現在選択できません。"],
  "AgentCore Runtime이 연결되어 있지 않습니다.": ["AgentCore Runtime isn't connected.", "AgentCore Runtimeに接続されていません。"],
  "이 회차는 24턴을 마쳤습니다. 새 회차를 열어 주세요.": ["This episode has reached 24 turns. Start a new episode to continue.", "このエピソードは24ターンに達しました。新しいエピソードを始めてください。"],
  "이 회차가 처리 중이거나 변경됐습니다. 다시 열어 주세요.": ["This episode is busy or has changed. Reopen it to continue.", "エピソードが処理中か変更されています。開き直してください。"],
  "회차가 변경됐습니다. 다시 열어 주세요.": ["This episode changed. Reopen it to continue.", "エピソードが変更されました。開き直してください。"],
  "모델이 대사를 완성하지 못했습니다. 입력을 남겨 두었으니 다시 보내거나 모델을 바꿔 주세요.": ["The model didn't finish its reply. Resend your message or switch models.", "モデルが返答を完了できませんでした。再送信するか、モデルを切り替えてください。"],
  "문장 형식이나 모델 응답을 확인하지 못했습니다. 저장하지 않았습니다. 잠시 후 다시 보내 주세요.": ["The model reply couldn't be saved. Try sending your message again in a moment.", "モデルの返答を保存できませんでした。少し待ってから再送信してください。"],
  "AgentCore의 모델 실행이 실패했습니다. 기존 회차는 유지됩니다.": ["AgentCore couldn't complete the reply. Your episode is still available.", "AgentCoreが返答を完了できませんでした。エピソードはそのまま残っています。"],
  "AgentCore 호출에 실패했습니다. 프로필·권한·리전·런타임 상태를 확인하세요.": ["Couldn't reach AgentCore. Check the profile, permissions, region, and runtime status.", "AgentCoreに接続できませんでした。プロファイル、権限、リージョン、ランタイムの状態をご確認ください。"],
  "오늘의 데모 대화 한도에 도달했습니다.": ["The demo has reached its daily chat limit.", "デモの一日の会話上限に達しました。"],
};
export function t(key, values) {
  const translated = locale === "ko" ? key : (Object.hasOwn(copy, key) ? copy[key][locale === "en" ? 0 : 1] : key);
  return values ? translated.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match) : translated;
}

export function setupLanguage() {
  document.documentElement.lang = locale;
  document.title = t(document.title);
  for (const element of document.querySelectorAll("[data-i18n]")) element.textContent = t(element.textContent);
  for (const element of document.querySelectorAll("[data-i18n-aria]")) element.setAttribute("aria-label", t(element.getAttribute("aria-label")));
  const selector = document.querySelector("#language");
  selector.value = locale;
  selector.addEventListener("change", () => {
    try { localStorage.setItem("scene.language", selector.value); } catch { /* Optional preference */ }
    const url = new URL(location.href);
    url.searchParams.set("lang", selector.value);
    location.assign(url);
  });
}
