import type { NarrativeDefinition as Definition } from "../../lib/platform/narrative-graph";
type Condition=Definition["facts"][number]["conditions"][number];
const g=(counter:string,value=1,op:Condition["op"]="gte"):Condition=>({counter,op,value});

/** A coffee invitation ends the opening chapter, not the ongoing relationship. */
export function continueReunion(original:Definition):Definition {
  const d=structuredClone(original);d.version=2;
  const L=(ko:string,en:string,ja:string)=>{d.translations!.en![ko]=en;d.translations!.ja![ko]=ja;return ko;};
  const extra=["scheduled","visited","receipt-read","archive-reviewed","archive-returned","relationship-choice"];
  for(const id of extra)d.counters.push({id,label:id,initial:0,min:0,max:id==="relationship-choice"?3:1,unit:"",visible:false});
  const fact=(id:string,text:string,conditions:Condition[]=[])=>d.facts.push({id,text,conditions});
  const choice=(id:string,text:string,actionId?:string,conditions:Condition[]=[])=>({id,text,actionId,conditions});
  const scene=(id:string,title:string,location:string,opening:string,objective:string,choices:ReturnType<typeof choice>[])=>d.scenes.push({id,title,location,opening,objective,choices,suggestions:choices.slice(0,3).map(c=>c.text),minTurns:1,mood:"focused"});
  const action=(id:string,label:string,when:string,scenes:string[],effects:[string,number][],conditions:Condition[]=[],links:string[]=[])=>d.events.push({id,label,result:label,when,scenes,once:true,effects:effects.map(([counter,delta])=>({counter,delta})),conditions,opensTransitions:links,minutes:0});
  const transition=(id:string,from:string,to:string,label:string,when:string,conditions:Condition[]=[],minutes=0)=>d.transitions.push({id,from,to,label,when,conditions,minutes});
  const bar=d.scenes[0].location;
  const nightScenes=d.scenes.map(s=>s.id);
  const after=d.scenes.find(s=>s.id==="after-song")!;
  after.objective=L("다음 만남을 제안하거나 오늘의 밤을 마무리하기","Propose another meeting or close tonight's chapter","次の約束を提案するか今夜を締めくくる");
  after.opening="마지막 곡은 끝났다. 오늘의 밤을 마무리하거나 다음 만남을 제안할 수 있다. 커피 약속은 다음 장면의 시작이며 관계의 결론이나 이야기 전체의 종료가 아니다.";
  d.summary=L("마지막 영업일의 레코드 바 ‘파형’에서 2년 만에 재회한 34세 서윤과 33세 전 연인. 첫날의 편지 선택을 존중하며 카페에서 다시 만나고, 폐점 정리 보관함에 남은 음반 반납 기록을 확인한 뒤 각자의 관계를 선택한다.","At record bar Wave's final night, 34-year-old Seyun and her 33-year-old former partner reunite after two years. Respect the letter decision, meet at a café, and trace a returned record before choosing their relationship.","レコードバー「波形」の最終営業日、34歳のソユンと33歳の元恋人が2年ぶりに再会する。手紙の選択を尊重し、カフェで再会してレコードの返却記録を確かめた後、関係を選ぶ。");
  d.facts.find(f=>f.id==="world")!.text=d.summary;
  fact("new-meeting-is-not-ending",L("다시 만나자는 동의는 다음 장면의 시작이다. 데이트나 연인 관계의 성립, 이야기 전체의 종료를 뜻하지 않는다.","Agreeing to meet again starts another chapter. It does not establish dating, a renewed relationship, or the end of the story.","再会への同意は次の場面の始まり。交際の成立、復縁、物語全体の終了を意味しない。"));
  fact("locker-hint",L("폐점 정리 중인 서윤은 보관함 B-12에 남색 음반의 반납 기록이 남아 있다는 것을 안다. 이는 보내지 못한 개인 편지와 별개의 관리 기록이다. 편지를 오늘 열지 않기로 했다면 그 선택은 계속 존중한다.","Seyun knows locker B-12 holds a return record for the navy sleeve. It is an inventory record, separate from the personal letter. Respect a choice to leave the letter sealed.","閉店整理中のソユンはB-12に紺色のレコードの返却記録があると知っている。個人の手紙とは別の管理記録で、手紙を開けない選択も引き続き尊重する。"),[g("meet-again")]);
  scene("planning",L("한 잔 더, 다음 페이지","Another coffee, another page","もう一杯、次のページ"),bar,"다시 만나자는 뜻을 나눴지만 날짜와 장소는 아직 정하는 중이다. 오늘 밤의 대화를 유지하며 내일 오후의 카페 약속을 정할 수 있다. 서윤은 폐점 정리 중 보관함 B-12의 관리 기록을 발견했고, 함께 확인하고 싶은 이유를 짧게 말할 수 있다. 아직 카페로 이동하지 않았다.",L("서로 원하는 거리와 다음 약속 정하기","Agree on boundaries and the next meeting","望む距離感と次の約束を決める"),[
    choice("schedule",L("내일 오후, 조용한 카페에서 만나자. 못다 한 이야기를 이어가고 싶어.","Let's meet at a quiet café tomorrow afternoon and continue our conversation.","明日の午後、静かなカフェで会って話を続けよう。"),"schedule"),
    choice("boundary",L("다시 만나고 싶지만 바로 예전 관계로 돌아가자는 뜻은 아니야. 천천히 이야기하자.","I'd like to meet again, without jumping straight back into our old relationship.","また会いたいけれど、すぐ昔の関係に戻るという意味ではない。ゆっくり話そう。")),
    choice("hint",L("아까 말한 보관함 B-12에는 어떤 기록이 남아 있어?","What kind of record did you find in locker B-12?","B-12にはどんな記録が残っていたの？")),
    choice("arrive",L("약속한 날 오후, 카페에 도착해 서윤을 만난다.","On the agreed afternoon, arrive at the café to meet Seyun.","約束した日の午後、カフェに着いてソユンに会う。"),"arrive-cafe",[g("scheduled")]),
    choice("night",L("오늘은 이만 갈게. 약속한 날에 다시 보자.","I'll head out for tonight. See you on the day we agreed.","今日はそろそろ帰るね。約束した日にまた会おう。"),"goodbye"),
  ]);
  scene("between-days",L("밤과 다음 만남 사이","Between tonight and the next meeting","今夜と次の約束の間"),L("각자의 일상 · 휴대전화 메시지","Apart, in a message conversation","それぞれの日常・メッセージでの会話"),"오늘 밤에는 각자의 길로 돌아갔다. 지금은 같은 장소에 함께 있지 않으며, 서윤과 휴대전화 메시지로 연락할 수 있다. 약속을 정하거나, 약속한 날 실제 도착을 선언하면 다음 장면으로 이어진다. 먼저 인사를 다시 시작하거나 편지 선택을 되묻지 않는다.",L("메시지로 약속을 정하고 약속한 날 만나기","Arrange the meeting by message, then meet on that day","メッセージで約束し、その日に会う"),[
    choice("schedule",L("내일 오후, 조용한 카페에서 만나자. 못다 한 이야기를 이어가고 싶어.","Let's meet at a quiet café tomorrow afternoon and continue our conversation.","明日の午後、静かなカフェで会って話を続けよう。"),"schedule"),
    choice("arrive",L("약속한 날 오후, 카페에 도착해 서윤을 만난다.","On the agreed afternoon, arrive at the café to meet Seyun.","約束した日の午後、カフェに着いてソユンに会う。"),"arrive-cafe",[g("scheduled")]),
    choice("message",L("어제 고마웠어. 오늘은 어떻게 지내고 있어?","Thank you for last night. How is your day going?","昨日はありがとう。今日はどう過ごしてる？")),
  ]);
  scene("cafe-reunion",L("약속한 오후의 카페","The café, on the promised afternoon","約束した午後のカフェ"),L("조용한 동네 카페","A quiet neighborhood café","静かな近所のカフェ"),"약속한 날 오후 실제로 다시 만났다. 두 사람은 전날의 대화·편지 선택·선곡을 기억한다. 서윤이 가져온 것은 남색 음반의 반납표 복사본이며, 예전에 열지 않기로 한 개인 편지를 가져와 열라고 요구하지 않는다. 반납표의 찢긴 모서리에 B-12 번호가 남아 있다.",L("카페에서 대화를 잇고 반납표의 단서 확인하기","Continue the conversation and inspect the return slip","カフェで会話を続け返却票の手掛かりを確かめる"),[
    choice("coffee",L("약속 지켜줘서 고마워. 우선 커피부터 주문하고 요즘 이야기를 듣고 싶어.","Thank you for coming. Let's get coffee first; I'd like to hear how you've been.","来てくれてありがとう。まずコーヒーを頼んで最近の話を聞きたい。")),
    choice("receipt",L("가져온 반납표를 함께 살펴보고 B-12 번호와 날짜를 확인한다.","Inspect the return slip together and check its B-12 number and date.","持ってきた返却票を一緒に見てB-12の番号と日付を確認する。"),"inspect-receipt"),
    choice("locker",L("반납표를 확인했어. 파형의 보관함 B-12로 함께 가보자.","We checked the slip. Let's go to Wave's locker B-12 together.","返却票を確認した。波形の保管庫B-12へ一緒に行こう。"),"visit-locker",[g("receipt-read")]),
  ]);
  scene("archive",L("남겨진 B-12","Locker B-12","残されたB-12"),L("파형의 폐점 정리 보관실","Wave's storage room during closing clearance","波形の閉店整理中の保管室"),"반납표를 따라 보관함 B-12에 함께 왔다. 봉투는 관리용 기록이며 개인 편지와 다르다. 기록에는 2년 전 반납처 이전으로 배송이 되돌아와 보관했다는 사실만 남아 있다. 이 사실만으로 두 사람이 헤어진 이유, 사용자의 속마음, 관계의 회복을 확정하지 않는다.",L("반송 기록을 확인하고 음반을 정리하기","Inspect the return record and settle the record's storage","返送記録を確かめてレコードを整理する"),[
    choice("inspect",L("관리용 봉투의 반송 기록과 반납 날짜를 함께 확인한다.","Check the inventory envelope's return record and date together.","管理用封筒の返送記録と返却日を一緒に確認する。"),"inspect-archive"),
    choice("settle",L("확인한 기록대로 음반을 정리하자. 우리 관계는 이 기록과 별개로 서로 정하고 싶어.","Settle the record according to its paperwork. Our relationship is a separate choice for us.","確認した記録どおりレコードを整理しよう。二人の関係は記録とは別に決めたい。"),"settle-record",[g("archive-reviewed")]),
    choice("pace",L("기록을 확인해도 그때 이야기를 다 꺼내야 하는 건 아니지. 말하고 싶은 만큼만 이야기하자.","Finding the record doesn't mean we must unpack everything. Share only what you want to.","記録を見つけても昔の話を全部する必要はない。話したい分だけ話そう。")),
  ]);
  scene("decision",L("음반 밖에 남은 말","What the record cannot decide","レコードには決められないこと"),L("정리를 마친 파형의 창가","By Wave's window after the clearance","整理を終えた波形の窓際"),"반송 기록을 확인하고 음반 정리를 마쳤다. 물건의 사연은 밝혀졌지만 두 사람의 관계는 아직 결정하지 않았다. 서로 직접 고르는 관계가 최종 결말을 정한다. 아직 결정하기 어렵다면 자유롭게 대화를 더 이어갈 수 있다.",L("서로 원하는 관계를 충분히 이야기하고 선택하기","Talk about and choose the relationship each person wants","互いに望む関係を十分話して選ぶ"),[
    choice("reconnect",L("지금까지 나눈 이야기를 바탕으로, 너와 다시 연인으로 시작하고 싶어.","After everything we've discussed, I'd like to start again with you as partners.","ここまでの話を踏まえて、君ともう一度恋人として始めたい。"),"choose-reconnect"),
    choice("friends",L("추억은 소중하지만 연인으로 돌아가지는 않을게. 서로 괜찮다면 친구로 이어가자.","Our memories matter, but I don't want to resume the romance. I'd like to stay friends if you do.","思い出は大切だけれど恋人には戻らない。お互いによければ友達でいたい。"),"choose-friends"),
    choice("more",L("지금 결론을 내리기는 어려워. 서로에게 달라진 것을 조금 더 이야기하고 싶어.","I'm not ready to decide yet. I'd like to talk more about how we've changed.","まだ結論を出せない。変わったことをもう少し話したい。")),
  ]);
  const meet=d.events.find(e=>e.id==="meet-again")!;meet.opensTransition="start-planning";
  transition("start-planning","after-song","planning",L("다음 약속을 정하는 밤","Make the next plan","次の約束を決める夜"),"다시 만나자고 직접 제안한다.",[g("meet-again")]);
  const goodbye=d.events.find(e=>e.id==="goodbye")!;goodbye.scenes=[...nightScenes,"planning"];goodbye.once=false;
  goodbye.when="사용자가 오늘 밤의 대화만 마치고 돌아가겠다고 인사한다. 영구적인 관계 단절과는 구별한다.";
  goodbye.opensTransitions=goodbye.scenes.map(from=>"close-night-"+from);
  for(const from of goodbye.scenes)transition("close-night-"+from,from,"between-days",L("오늘 밤을 마치고 연락 이어가기","Close tonight and stay in touch","今夜を終え連絡を続ける"),"오늘의 밤에 인사한다.",[g("goodbye")]);
  action("schedule",L("다음 카페 약속 정함","Café meeting arranged","次のカフェの約束を決定"),"사용자가 내일 오후 카페에서 다시 만나기로 날짜·장소를 구체적으로 제안하거나 동의한다. 날짜를 같이 정하고 싶다는 말만으로 확정하지 않는다.",["planning","between-days"],[["scheduled",1],["meet-again",1]]);
  action("arrive-cafe",L("약속한 날 카페에서 재회","Met again at the café","約束した日にカフェで再会"),"사용자가 약속한 날이 되어 카페에 실제로 찾아왔다고 현재 행동으로 명시한다. 만나자는 제안과 가정만으로 시간을 건너뛰지 않는다.",["planning","between-days"],[["visited",1],["trust",1]],[g("scheduled")],["arrive-from-planning","arrive-from-between"]);
  for(const [id,from] of [["arrive-from-planning","planning"],["arrive-from-between","between-days"]])transition(id,from,"cafe-reunion",L("약속한 오후로","To the promised afternoon","約束した午後へ"),"약속한 날 카페에 도착한다.",[g("visited")],960);
  action("inspect-receipt",L("찢긴 반납표 확인","Return slip inspected","破れた返却票を確認"),"사용자가 서윤이 가져온 관리용 반납표를 함께 살펴 번호와 날짜를 확인한다.",["cafe-reunion"],[["receipt-read",1]]);
  action("visit-locker",L("보관함 B-12 방문","Visited locker B-12","保管庫B-12を訪問"),"사용자가 확인한 반납표를 따라 보관함 B-12로 함께 가자고 하거나 실제 이동한다.",["cafe-reunion"],[],[g("receipt-read")],["to-locker"]);
  transition("to-locker","cafe-reunion","archive",L("보관함의 기록으로","To the stored record","保管された記録へ"),"보관함으로 함께 간다.",[g("receipt-read")]);
  action("inspect-archive",L("반송 기록 확인","Return history checked","返送記録を確認"),"사용자가 보관함의 관리용 봉투를 열어 반송 기록과 반납 날짜를 함께 확인한다. 개인 편지 개봉과 다르다.",["archive"],[["archive-reviewed",1]]);
  action("settle-record",L("음반의 관리 기록 정리","Record paperwork settled","レコードの管理記録を整理"),"사용자가 확인한 관리 기록에 따라 음반 정리를 마치고 관계에 대해서는 서로의 뜻을 정하자고 한다.",["archive"],[["archive-returned",1],["trust",1]],[g("archive-reviewed")],["to-decision"]);
  transition("to-decision","archive","decision",L("물건보다 남은 마음으로","Beyond the record","レコードの向こうの気持ちへ"),"음반 정리를 마치고 관계를 이야기한다.",[g("archive-returned")]);
  action("choose-reconnect",L("다시 연인으로 시작하기로 함","Chose to start again as partners","もう一度恋人として始めると選択"),"사용자가 충분히 대화한 지금 서로 다시 연인으로 시작하고 싶다고 직접 선택한다. 커피 약속이나 재회 제안과는 구분한다.",["decision"],[["relationship-choice",1]],[g("relationship-choice",0,"eq")]);
  action("choose-friends",L("친구로 이어가기로 함","Chose friendship","友達として続けると選択"),"사용자가 연인 관계로 돌아가지 않고 친구로 이어가자고 분명히 선택한다.",["decision"],[["relationship-choice",2]],[g("relationship-choice",0,"eq")]);
  action("close-relationship",L("각자의 길로 가기로 함","Chose separate paths","別々の道を選択"),"사용자가 오늘의 인사가 아니라 앞으로 관계를 정리하고 더는 만나거나 연락하지 않겠다고 명확히 최종 선택한다.",d.scenes.map(s=>s.id),[["relationship-choice",3]],[g("relationship-choice",0,"eq")]);
  // The metadata is derived from confirmed counters; no terminal state is set.
  d.milestones=[{id:"another-coffee",title:L("한 잔 더, 이야기는 계속","Another coffee — the story continues","もう一杯、物語は続く"),text:L("다시 만나기로 뜻을 나눴습니다. 약속을 정하고 같은 대화에서 다음 만남을 이어갈 수 있습니다.","You agreed to meet again. Arrange the details and continue to the next meeting in this conversation.","再会への意思を分かち合った。同じ会話で約束を決め、次の出会いへ進める。"),conditions:[g("meet-again")]},{id:"night-closed",title:L("오늘 밤의 마무리","Tonight's chapter closed","今夜の締めくくり"),text:L("오늘의 인사를 나눴습니다. 관계가 끝난 것은 아니며 메시지나 다음 만남으로 이어갑니다.","Tonight's goodbye closes a chapter. Messages and another meeting remain open.","今夜の挨拶で一つの場面を終えた。関係の終わりではなく、メッセージや次の約束へ続く。"),conditions:[g("goodbye")]},{id:"reunited",title:L("약속한 오후의 재회","Reunited on the promised afternoon","約束した午後の再会"),text:L("실제로 다시 만났습니다. 지난 선택을 유지하며 음반 기록을 함께 확인할 수 있습니다.","You met again. Keep earlier choices and explore the record paperwork together.","実際に再会した。以前の選択を保ちながらレコードの記録を一緒に確かめられる。"),conditions:[g("visited")]}];
  d.endings=[
    {id:"start-again",title:L("새로운 첫 곡","A new first track","新しい最初の曲"),text:L("음반의 기록과 서로의 이야기를 확인한 뒤, 두 사람은 예전으로 되돌아가는 대신 지금의 모습으로 다시 연인 관계를 시작하기로 했다.","After tracing the record and sharing their stories, the two chose to begin a relationship as the people they are now.","レコードの記録と互いの話を確かめ、昔に戻るのではなく今の二人として恋人の関係を始めると選んだ。"),scenes:["decision"],conditions:[g("visited"),g("archive-returned"),g("relationship-choice",1,"eq")],priority:80},
    {id:"new-friends",title:L("다른 이름의 한 잔","A coffee with a different name","違う名前の一杯"),text:L("오해를 모두 사랑으로 바꾸려 하지는 않았다. 음반 정리를 끝낸 두 사람은 소중했던 기억을 인정하면서 친구라는 관계를 직접 골랐다.","They did not turn every misunderstanding into romance. After settling the record, they chose friendship while honoring their memories.","すべての行き違いを恋に変えようとはしなかった。レコードを整理し、思い出を大切にしながら友達という関係を選んだ。"),scenes:["decision"],conditions:[g("visited"),g("archive-returned"),g("relationship-choice",2,"eq")],priority:80},
    {id:"separate-paths",title:L("각자의 다음 곡","Our separate next tracks","それぞれの次の曲"),text:L("두 사람은 더 만나지 않겠다는 선택을 받아들이고 각자의 길로 돌아갔다. 오늘의 인사와 달리 관계를 정리하겠다는 최종 의사를 확인했다.","The pair accepted a final decision to stop meeting and continue on separate paths.","二人は今後会わないという最終的な選択を受け止め、それぞれの道へ戻った。"),scenes:d.scenes.map(s=>s.id),conditions:[g("relationship-choice",3,"eq")],priority:100},
  ];
  for (const scene of d.scenes.filter(s=>["planning","between-days"].includes(s.id))) for (const choice of scene.choices ?? []) {
    if (choice.actionId === "schedule") choice.priority = 80;
    if (choice.actionId === "arrive-cafe") choice.priority = 100;
    if (choice.actionId === "goodbye") choice.priority = -50;
  }
  d.statusFields!.push({id:"next-meeting",label:L("다음 만남","Next meeting","次の約束"),cases:[{text:L("카페 재회 완료","Reunited at the café","カフェで再会済み"),conditions:[g("visited")]},{text:L("다음 날 오후 카페에서 만나기로 함","Café meeting arranged for the next afternoon","翌日の午後、カフェで会う約束"),conditions:[g("scheduled")]},{text:L("날짜·장소 정하는 중","Choosing a time and place","日時と場所を決める途中"),conditions:[g("meet-again")]},{text:L("아직 약속하지 않음","No meeting arranged yet","まだ約束していない"),conditions:[]}]});
  d.plotThreads!.push({id:"return-record",title:L("보관함 B-12의 음반","The record in locker B-12","保管庫B-12のレコード"),description:L("반납표를 따라 보관함의 관리 기록을 확인한다. 개인 편지에 관한 선택은 유지한다.","Follow the return slip to the inventory record, preserving the personal-letter choice.","返却票をたどって管理記録を確かめる。個人の手紙についての選択は守る。"),activeWhen:[g("visited")],resolveWhen:[g("archive-returned")],resolution:L("반송 기록과 음반 정리를 확인했다. 관계의 선택은 두 사람에게 남아 있다.","The return history and record are settled. The relationship remains a personal choice.","返送記録とレコードの整理を確かめた。関係の選択は二人に残されている。")});
  return d;
}
