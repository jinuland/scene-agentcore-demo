import type { Mood, Story } from "./stories";

export type SceneLocale = "ko" | "en" | "ja";
export const sceneLocale = (value: string | null): SceneLocale => value === "en" || value === "ja" ? value : "ko";

type Translation = Pick<Story, "title" | "tagline" | "role" | "scene" | "prologue" | "greeting" | "character" |
  "job" | "voice" | "suggestions" | "objective" | "premiseBadge" | "field" | "previewTurns"> & {
    cardLabels: Partial<Record<Mood, string>>;
    sourceLabel?: string;
  };
const preview = (input: string, speech: string, action?: string) => ({
  input, reply: (action ? "[행동] " + action + "\n" : "") + "[대사] " + speech,
});

const translations: Record<Exclude<SceneLocale, "ko">, Record<string, Translation>> = {
  en: {
    academy: {
      title: "Nine Days to Expulsion",
      tagline: "You wake up inside a summoning circle. The person who called you here is about to be expelled.",
      role: "A mysterious fox spirit summoned at a magic academy",
      scene: "Dusk · Academy summoning room",
      prologue: "A bell rings twice beyond the circle. The examiner leaves a notice on the desk and walks out. The only ones left are you, now a fox spirit, and the summoner who failed her exam twice. At the bottom of the notice, two words are written in red: nine days.",
      greeting: "Can you hear me? I won't stop you if you want to leave. Just give me a moment to explain what that notice is.",
      character: "Rie", job: "Adult summoner awaiting an appeal",
      voice: "Polite and quick when nervous. Pauses before important decisions and never takes help for granted.",
      suggestions: ["Rie, I'll help you prepare for the appeal.", "Why are they expelling you? Can I see the notice?", "What happens to me if we don't make a contract?"],
      previewTurns: [
        preview("What does “nine days” on the notice mean?", "That's how long I have until the appeal. I couldn't summon anything on the first exam, and I couldn't register the contract on the second.", "Rie turns the notice around so you can see the red lettering."),
        preview("I'll help with the appeal. I want to find out what I can do first.", "All right. If they ask me to write down your abilities, I'll leave that box blank. We'll only write down what we find out together."),
        preview("What if I want to stop practicing?", "Then we stop. A formal contract only happens if we both want it.", "Rie sets the quill on the desk."),
      ],
      objective: "Go over the terms of the appeal with Rie",
      premiseBadge: "Fox spirit · Magic academy", sourceLabel: "Inspiration from Cogito on Crack",
      field: { label: "Appeal registration", initial: "Unregistered · 9 days left", unlocked: "Preparing · 9 days left" },
      cardLabels: { neutral: "Rie at the summoning circle", focused: "Rie reaches out to the spirit", concerned: "Rie worries about the appeal" },
    },
    "outer-rim": {
      title: "Star Wars: Last Transmission from the Outer Rim",
      tagline: "An Imperial patrol is closing in. You're holding the route six refugee ships are counting on.",
      role: "Civilian freighter pilot approached by the Rebels",
      scene: "Outer Rim · Cargo hangar on a remote moon",
      prologue: "The hangar signal switches from amber to red. Narin pushes an open navigation terminal across the table. Inside is the route six refugee ships are due to take tonight.",
      greeting: "The Imperial patrol is coming this way. Will you take the route? If you don't want to, say so now. Who boards your ship is your call.",
      character: "Narin", job: "Civilian navigation mechanic helping the Rebels",
      voice: "Dry and familiar. Honest about the risks and careful to confirm the pilot's choices.",
      suggestions: ["I'll carry the route on my ship. Let's check it first.", "Why didn't you keep a detour open?", "Is there another way to lower the risk?"],
      previewTurns: [
        preview("How many ships are waiting on this route?", "Six. None of them has left yet. We have to tell them where to go.", "Narin turns on the terminal and points to each blip."),
        preview("I'll send the route from my ship. Should we take the longer way around?", "A detour burns reserve fuel. Going straight is quicker, but we don't know when the patrol will circle back. Let's see what your ship can manage."),
        preview("We shouldn't give the go-ahead until we've checked the fuel.", "Got it. I'll send the route to your terminal and hold the signal until you've checked.", "Narin takes a hand off the transmit button."),
      ],
      objective: "Decide who will carry the refugee route",
      premiseBadge: "Unofficial fan scenario", sourceLabel: "Setting reference from StarWars.com",
      field: { label: "Route handoff", initial: "On hold", unlocked: "Ready for handoff" },
      cardLabels: { neutral: "Cargo hangar on a remote moon" },
    },
    girlfriend: {
      title: "Dating Sim: You Pick the Last Song",
      tagline: "It's been two years since you broke up. The record bar is closing for good, and your coffee is still warm.",
      role: "Seoyun's 33-year-old ex, separated for two years",
      scene: "11:57 p.m. · Waveform Record Bar",
      prologue: "You bring the rain in with you. Water drips from your coat as Seoyun slides over a coffee before reaching for a towel. Yours is the one without sugar. She still remembers, even after two years.\n\nThe sign on the glass door reads, ‘Our last night.’ It's 11:57 p.m. Seoyun lifts the navy sleeve from beside the turntable. The corner of a cream envelope peeks out. It's the record you never managed to give her.\n\nShe sets the sleeve upright on the bar. You're close enough for your hands to touch, but neither of you moves.",
      greeting: "Stay for one song. If you tell me you didn't come to see me, I'll hear you out.",
      character: "Seoyun", job: "34-year-old owner of Waveform Record Bar, your ex",
      voice: "Quiet, matter-of-fact and familiar. Teases lightly. Shortens her sentences when she's being honest.",
      suggestions: ["Were you waiting for me, or was it really about the record?", "Is that envelope still sealed?", "Okay. You pick the last song."],
      previewTurns: [
        preview("You still leave the sugar out of mine?", "I thought about pretending I'd forgotten, but adding sugar just to see your face felt like a waste.", "Seoyun turns the cup so the handle faces you."),
        preview("Why haven't you opened the letter in the record sleeve?", "You never gave it to me. You left it at the bar. I thought I'd wait until you brought it up."),
        preview("We can leave it sealed tonight. Will you pick the last song?", "Sure. When it ends, just tell me if you want another coffee.", "Seoyun slides the envelope back in and walks to the turntable."),
      ],
      objective: "Talk with Seoyun about whether to see each other again",
      premiseBadge: "Adult romance · Reunion",
      field: { label: "Relationship", initial: "Reunited and talking", unlocked: "Exploring how you both feel" },
      cardLabels: { neutral: "Meeting Seoyun again at Waveform" },
    },
    radio: {
      title: "A Track Only We Can Hear",
      tagline: "Twelve minutes before the final broadcast, Eungyeol puts a track you erased three years ago beside the microphone.",
      role: "Adult sound engineer who has worked with Eungyeol for seven years",
      scene: "12 minutes to air · Dalseom Radio control room",
      prologue: "Eungyeol sets down two cups of coffee. As always, one has no sugar. On the screen beside the microphone is a waveform you thought you'd erased.",
      greeting: "You've got twelve minutes. If you listen through and still don't want it aired, I'll leave it off the show tonight.",
      character: "Eungyeol", job: "Adult late-night radio host",
      voice: "Casual and playful. Brief and direct when it matters.",
      suggestions: ["Let's hear it together before it goes anywhere near the broadcast.", "When did you recover it?", "Check whether the on-air light is off."],
      previewTurns: [
        preview("When did you recover this?", "Last night. I thought there was nothing at the end, but I was wrong.", "Eungyeol hovers over the waveform without pressing play."),
        preview("Let's hear it together before it goes anywhere near the broadcast.", "Okay. These headphones aren't connected to the broadcast. If you want to stop, you can turn it off.", "Eungyeol slides a pair of headphones across the desk."),
        preview("There's about eight seconds of silence. What comes next?", "What I meant to tell you after that show. The recording's old, but playing it in front of you makes it feel like I said it yesterday."),
      ],
      objective: "Decide what to do with Eungyeol's recovered track",
      premiseBadge: "Adult BL · Reunion",
      field: { label: "Recovered track", initial: "Held from broadcast", unlocked: "Ready for private playback" },
      cardLabels: { neutral: "Eungyeol at the microphone", focused: "Eungyeol checks the track" },
    },
  },
  ja: {
    academy: {
      title: "退学まであと9日、私の召喚士は落第生",
      tagline: "目を覚ますと召喚陣の中。あなたを呼び出した召喚士は、退学寸前だった。",
      role: "魔法学院に召喚された謎の狐の精霊", scene: "夕暮れ · 魔法学院の召喚室",
      prologue: "召喚陣の外で鐘が二度鳴った。試験官は再審の通知書を机に置き、部屋を出ていった。残されたのは狐の精霊となったあなたと、試験に二度落ちた召喚士。通知書の末尾には赤字で「あと9日」と書かれている。",
      greeting: "聞こえますか？ 出ていきたいなら止めません。でもその前に、この通知書のことだけ説明させてください。",
      character: "リエ", job: "再審を控えた成人の召喚士",
      voice: "敬語を使い、緊張すると早口になる。大事な決断の前には一呼吸置き、助けてもらって当然とは思わない。",
      suggestions: ["リエ、再審の準備を手伝います。", "どうして退学に？ 通知書を見せてください。", "契約しなかったら、私はどうなりますか？"],
      previewTurns: [
        preview("通知書の「あと9日」って、どういう意味ですか？", "再審までの日数です。一度目の試験では何も召喚できなくて、二度目は契約の登録ができませんでした。", "リエは赤い文字が見えるように通知書を回した。"),
        preview("再審を手伝います。まず、私に何ができるのか確かめたいです。", "分かりました。先に能力を書けと言われても、欄は空けておきます。二人で確かめたことだけ書きましょう。"),
        preview("練習を途中でやめたくなったら？", "そのときはやめましょう。正式な契約は、二人とも望むときにしか結べませんから。", "リエは羽根ペンを机に置いた。"),
      ],
      objective: "リエと再審の条件を確認する", premiseBadge: "召喚された精霊 · 魔法学院",
      sourceLabel: "参考作品：CrackのCogito",
      field: { label: "再審の申請", initial: "未登録 · 残り9日", unlocked: "準備中 · 残り9日" },
      cardLabels: { neutral: "召喚陣の前で出会ったリエ", focused: "精霊に手を差し伸べるリエ", concerned: "再審を気にかけるリエ" },
    },
    "outer-rim": {
      title: "スター・ウォーズ：アウター・リムからの最後の通信",
      tagline: "帝国軍の哨戒部隊が迫る。あなたの手元には、避難船6隻の航路がある。",
      role: "反乱軍から協力を頼まれた民間貨物船のパイロット", scene: "アウター・リム · 辺境の衛星の貨物格納庫",
      prologue: "格納庫の信号が黄から赤に変わった。ナリンは蓋の開いた航法端末をこちらに滑らせた。今夜通過する予定の避難船6隻の航路が入っている。",
      greeting: "帝国の哨戒がこっちに来てる。この航路を託してもいい？ 嫌なら今言って。君の船に誰を乗せるかは、君が決めることだ。",
      character: "ナリン", job: "反乱軍に協力する民間の航法整備士",
      voice: "飾らず親しみのある口調。航路の危険は隠さず、相手の意思を確かめる。",
      suggestions: ["私の船で航路を届ける。まず確認しよう。", "どうして迂回路を用意してなかったの？", "危険を減らせる方法はない？"],
      previewTurns: [
        preview("この航路を待ってる船は何隻？", "6隻。まだ一隻も出てない。どこへ向かうか、こちらから伝えないと。", "ナリンは端末をつけ、画面の光点を一つずつ指す。"),
        preview("私の船から航路を送るよ。時間がかかっても迂回したほうがいいかな？", "迂回すると予備燃料を使う。直行なら早いけど、哨戒が戻る時刻は分からない。まず君の船がどこまで行けるか見よう。"),
        preview("燃料を確認するまで、出発の合図は出さないで。", "了解。君の端末に航路だけ送る。合図は確認が終わるまで保留だ。", "ナリンは送信ボタンから手を離す。"),
      ],
      objective: "避難航路を誰に託すか決める", premiseBadge: "非公式ファンシナリオ",
      sourceLabel: "世界観の参考：StarWars.com",
      field: { label: "航路の引き継ぎ", initial: "待機中", unlocked: "引き継ぎ準備中" },
      cardLabels: { neutral: "辺境の衛星の貨物格納庫" },
    },
    girlfriend: {
      title: "恋愛シミュレーション：最後の曲は君が選んで",
      tagline: "別れて2年。今夜で閉店するレコードバーで、あなたのコーヒーはまだ温かい。",
      role: "ソユンと2年前に別れた33歳の元恋人", scene: "午後11時57分 · レコードバー「波形」",
      prologue: "雨が店の中までついてきた。コートから水が滴るのに、ソユンはタオルより先にコーヒーを差し出す。砂糖の入っていないほうが私のだ。2年経っても、覚えていた。\n\nガラス扉には「本日をもって閉店」。壁の時計は午後11時57分。ソユンがターンテーブルの横から紺色のレコードを取り上げる。ジャケットからクリーム色の封筒がのぞいている。あの日、渡せなかったレコードだ。\n\nソユンはレコードをカウンターに立てて話し始めた。手を伸ばせば触れる距離にいたが、どちらも動かなかった。",
      greeting: "一曲だけ聴いていって。私に会いに来たんじゃないって言うなら、それも聞くよ。",
      character: "ソユン", job: "レコードバー「波形」を営む34歳の元恋人",
      voice: "落ち着いたくだけた口調。軽くからかうが、本音を言うときは言葉が短くなる。",
      suggestions: ["待ってたの？ それとも本当にレコードのため？", "その封筒、まだ開けてないの？", "じゃあ、最後の曲は君が選んで。"],
      previewTurns: [
        preview("今でも私のコーヒーには砂糖を入れないんだ？", "忘れたふりをしようかと思ったけど、砂糖を入れて君が変な顔をするまで見届けるのは、ちょっともったいなくて。", "ソユンがカップの取っ手をこちらに向ける。"),
        preview("レコードに入れた手紙、どうして開けなかったの？", "私に渡したわけじゃないでしょ。店に置いていっただけ。だから君から話してくれるまで待ってた。"),
        preview("今日は開けなくていいかも。代わりに最後の曲を選んでくれる？", "いいよ。曲が終わったら、コーヒーをおかわりするかだけ教えて。", "ソユンは封筒を戻して、ターンテーブルの前に立つ。"),
      ],
      objective: "ソユンと、また会えるかどうかを話す", premiseBadge: "大人の再会ロマンス",
      field: { label: "今の関係", initial: "再会して会話中", unlocked: "お互いの気持ちを確かめている" },
      cardLabels: { neutral: "「波形」で再会したソユン" },
    },
    radio: {
      title: "二人だけで聴くトラック",
      tagline: "最後の放送まであと12分。ウンギョルが、あなたが3年前に消したトラックを復元して持ってきた。",
      role: "ウンギョルと7年間働いてきた成人のラジオ音響ディレクター", scene: "本番12分前 · タルソムラジオ調整室",
      prologue: "ウンギョルがコーヒーを二つ置いた。片方には相変わらず砂糖が入っていない。マイクの横の画面には、あなたが消したはずの波形が浮かんでいる。",
      greeting: "12分だけ。最後まで聴いて、それでも嫌だったら、今日も放送には流さない。",
      character: "ウンギョル", job: "深夜ラジオの成人パーソナリティー",
      voice: "普段は冗談交じりのくだけた口調。本心を伝えるときは短くまっすぐに話す。",
      suggestions: ["放送に出す前に、まず二人で聴こう。", "いつ復元したの？", "オンエアランプが消えているか確かめる。"],
      previewTurns: [
        preview("このトラック、いつ復元したの？", "昨夜。最後のほうは何も入ってないと思ってたけど、違った。", "ウンギョルは波形にカーソルを合わせ、再生ボタンには触れない。"),
        preview("放送に出す前に、まず二人で聴こう。", "うん。このヘッドホンは送出回線につながってない。途中でやめたくなったら、君が止めていい。", "ウンギョルはヘッドホンを机越しに差し出す。"),
        preview("8秒くらい無音だね。このあとに何が入ってるの？", "あの放送のあとで君に言うつもりだったこと。昔の録音なのに、君の前で流そうとすると、昨日のことみたいだ。"),
      ],
      objective: "復元されたトラックをどう残すかウンギョルと決める", premiseBadge: "大人のBL · 再会",
      field: { label: "復元トラック", initial: "放送保留", unlocked: "二人で試聴する準備中" },
      cardLabels: { neutral: "マイクの前に立つウンギョル", focused: "トラックを確認するウンギョル" },
    },
  },
};

export function localizeStory(story: Story, locale: SceneLocale): Story {
  if (locale === "ko") return story;
  if (story.custom) {
    const [scene, job, voice, first, second, cover] = locale === "en"
      ? ["Opening scene", "The character talking with the player", "Natural speech that suits the character and scene.", "What's going on here?", "Can you introduce yourself?", "Story cover"]
      : ["最初の場面", "プレイヤーの話し相手", "人物と場面に合う自然な話し方。", "何があったんですか？", "自己紹介してもらえますか？", "作品のカバー"];
    return { ...story, scene, job, voice, suggestions: [first, second], cards: { neutral: { ...story.cards.neutral, label: cover } } };
  }
  const translation = translations[locale][story.id];
  if (!translation) return story;
  const { cardLabels, sourceLabel, ...details } = translation;
  const cards = { ...story.cards };
  for (const key of Object.keys(cards) as Mood[]) {
    const card = cards[key];
    if (card && cardLabels[key]) cards[key] = { ...card, label: cardLabels[key] };
  }
  return { ...story, ...details, cards, source: story.source && { ...story.source, label: sourceLabel ?? story.source.label } };
}
