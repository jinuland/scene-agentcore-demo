import type { NarrativeDefinition as Definition } from "../../lib/platform/narrative-graph";
import { continueReunion } from "./reunion-continuation";
import type { Story } from "./stories";
type Condition = Definition["facts"][number]["conditions"][number];
const g = (counter: string, value = 1, op: Condition["op"] = "gte"): Condition => ({ counter, op, value });

function author(id: string, startScene: string, startTime: string, minutesPerTurn: number) {
  const d: Definition = { id, version: 1, startScene, startTime, minutesPerTurn, counters: [], facts: [], scenes: [], events: [], transitions: [], endings: [], statusFields: [], plotThreads: [], translations: { en: {}, ja: {} } };
  const L = (ko: string, en = ko, ja = ko) => { d.translations!.en![ko] = en; d.translations!.ja![ko] = ja; return ko; };
  const counter = (id: string, label: string, initial = 0, max = 1, visible = false, unit = "") => d.counters.push({ id, label, initial, min: 0, max, visible, unit });
  const fact = (id: string, text: string, conditions: Condition[] = []) => d.facts.push({ id, text, conditions });
  const choice = (id: string, text: string, actionId?: string, conditions: Condition[] = [], unless: Condition[] = []) => ({ id, text, actionId, conditions, unless });
  const scene = (id: string, title: string, location: string, opening: string, objective: string, choices: ReturnType<typeof choice>[], mood: "neutral" | "focused" | "concerned" | "relieved" = "neutral") => d.scenes.push({ id, title, location, opening, objective, minTurns: 1, choices, suggestions: choices.slice(0, 3).map(c => c.text), mood });
  const event = (id: string, label: string, when: string, scenes: string[], effects: [string, number][], opensTransition?: string, conditions: Condition[] = [], minutes = 0, once = true) => d.events.push({ id, label, result: label, when, scenes, effects: effects.map(([counter, delta]) => ({ counter, delta })), opensTransition, conditions, minutes, once });
  const transition = (id: string, from: string, to: string, label: string, when: string, conditions: Condition[] = []) => d.transitions.push({ id, from, to, label, when, conditions });
  const field = (id: string, label: string, cases: [string, Condition[]][]) => d.statusFields!.push({ id, label, cases: cases.map(([text, conditions]) => ({ text, conditions })) });
  const thread = (id: string, title: string, description: string, resolveWhen: Condition[], activeWhen: Condition[] = []) => d.plotThreads!.push({ id, title, description, activeWhen, resolveWhen, resolution: L("조건을 충족해 마무리했습니다.", "Resolved by confirmed actions.", "確認した行動により完了しました。") });
  const ending = (id: string, title: string, text: string, conditions: Condition[], scenes = d.scenes.map(s => s.id), priority = 50) => d.endings.push({ id, title, text, conditions, scenes, priority });
  return { d, L, counter, fact, choice, scene, event, transition, field, thread, ending };
}

function outerRim() {
  const { d, L, counter: c, fact: f, choice: q, scene: s, event: e, transition: tr, field, thread, ending } = author("outer-rim-world", "hangar", "2026-03-16T21:00:00+09:00", 1);
  d.summary = L("은하 제국 시대의 외곽 달. 민간 항법 정비사 나린과 피난민 선박 여섯 척의 탈출을 돕는다. 직행·우회에는 서로 다른 위험이 있고 선택은 플레이어가 한다.", "An Outer Rim moon under the Empire. Help navigator Narin escort six refugee ships; direct and detour routes carry different risks.", "帝国時代の外縁の月。航法整備士ナリンと避難船6隻の脱出を助ける。直行・迂回には別々の危険がある。");
  d.clockStyle = "elapsed"; d.clockLabel = L("경보 후 경과", "Time since alarm", "警報からの経過");
  c("trust", L("신뢰도", "Trust", "信頼度"), 0, 5, true); c("fuel", L("예비 연료", "Reserve fuel", "予備燃料"), 80, 100, true, "%"); c("risk", L("추적 위험", "Pursuit risk", "追跡リスク"), 10, 100, true, "%");
  for (const id of ["briefed", "fuel-checked", "route-ready", "direct", "detour", "departed", "escorted", "reported", "withdrawn"]) c(id, id);
  c("convoy", L("출항한 피난선", "Refugee ships launched", "出港した避難船"), 0, 6, true, "척"); c("safe-ships", L("합류 확인 선박", "Ships accounted for", "合流確認済みの船"), 0, 6, true, "척");
  f("world", d.summary); f("agency", L("나린은 민간 정비사다. 아직 확인하지 않은 항로의 안전이나 플레이어의 능력을 보장하지 않는다.", "Narin is a civilian mechanic. Unchecked routes and the player's abilities are not guaranteed safe.", "ナリンは民間整備士。未確認の航路の安全やプレイヤーの能力を保証しない。"));
  f("docked", L("피난선 여섯 척은 아직 격납고에서 대기하고 있다.", "All six refugee ships are still docked.", "避難船6隻はまだ格納庫で待機している。"), [g("convoy", 0, "eq")]);
  f("convoy-underway", L("피난선 여섯 척이 출항해 호송 중이다. 출발 전으로 되돌리지 않는다.", "All six refugee ships have launched and are being escorted. Do not reset them to pre-launch.", "避難船6隻は出港して護送中。出港前に戻さない。"), [g("convoy", 6)]);
  f("approaching", L("제국 순찰은 접근 중이며 경보 후 10분에 검문을 시작한다.", "The Imperial patrol is approaching; inspections begin ten minutes after the alarm.", "帝国巡察が接近中。警報から10分で検問を始める。"), [g("elapsed-minutes", 9, "lte")]);
  f("inspection", L("제국 순찰이 격납고 출입구에서 검문을 시작했다. 아직 일행이 체포되거나 함선이 격침된 것은 아니다.", "Imperial inspections have begun at the hangar entrance. No capture or ship destruction has been confirmed.", "格納庫入口で帝国の検問が始まった。逮捕や撃沈はまだ確定していない。"), [g("elapsed-minutes", 10)]);
  f("control-droid",L("화물선이 궤도에 오르면 관제 드로이드 케이세븐이 통신으로 피난선 여섯 척의 출항 신호를 기다린다. 선박이 자동으로 출발하거나 목적지에 도착하지는 않는다.","In orbit, traffic droid K-Seven waits on comms for the six ships’ launch signal. No automatic departure or arrival is implied.","軌道では管制ドロイドのケイセブンが通信で6隻への出港信号を待つ。自動出港や到着を意味しない。"),[g("departed"),g("convoy",0,"eq")]);
  f("direct-route", L("직행 항로를 선택했다. 짧지만 순찰에 노출될 위험이 높다.", "The direct route is selected: shorter, with greater exposure to patrols.", "直行航路を選んだ。短いが巡察に見つかる危険が高い。"), [g("direct")]);
  f("detour-route", L("우회 항로를 선택했다. 더 멀고 연료가 필요하지만 노출을 줄인다.", "The detour is selected: farther and fuel-intensive, with less exposure.", "迂回航路を選んだ。距離と燃料は必要だが発見されにくい。"), [g("detour")]);
  s("hangar", L("출항 준비", "Launch preparations", "出港準備"), L("외곽 달의 화물 격납고", "Outer Rim cargo hangar", "外縁の貨物格納庫"), "단말과 화물선이 있는 격납고. 필요한 항로 선택과 연료 점검을 마치면 실제로 출항할 수 있다. 이전에 나눈 이야기를 반복해 소개하지 않는다.", L("항로 선택과 연료 점검 후 출항하기", "Choose a route, check fuel, then launch", "航路と燃料を確認して出港する"), [
    q("brief", L("항로 지도를 같이 확인하고 위험 구간을 짚자.", "Review the route map and its risks together.", "航路図と危険区間を一緒に確認しよう。"), "brief"),
    q("fuel", L("내 배의 예비 연료와 항법 장치를 점검한다.", "Check my ship's reserve fuel and navigation.", "自分の船の予備燃料と航法装置を点検する。"), "check-fuel"),
    q("detour", L("연료를 아끼며 우회 항로로 가자. 그 경로를 선택한다.", "Choose the detour and conserve fuel.", "燃料を節約しながら迂回航路を選ぼう。"), "choose-detour", [], [g("detour")]),
    q("direct", L("위험은 알겠어. 빠른 직행 항로를 선택하자.", "Accept the risk and choose the faster direct route.", "危険を理解した上で速い直行航路を選ぼう。"), "choose-direct", [], [g("direct")]),
    q("launch", L("정한 항로로 출항한다. 나린에게 이륙 신호를 보낸다.", "Launch on our selected route and signal Narin.", "選んだ航路へ出港し、ナリンに離陸信号を送る。"), "depart", [g("route-ready"), g("fuel-checked")]),
  ]);
  s("orbit", L("궤도에서의 합류", "Orbital rendezvous", "軌道で合流"), L("외곽 달 저궤도", "Low orbit above the moon", "外縁の月の低軌道"), "플레이어의 화물선과 나린은 격납고를 떠나 궤도에 있다. 피난선 여섯 척의 출항 신호를 보낼 차례다.", L("피난선에 출항 신호 보내기", "Signal the six refugee ships to launch", "避難船6隻に出港信号を送る"), [q("signal", L("여섯 척에 출항 신호를 보내고 호송 대열을 잡는다.", "Signal all six ships and form the convoy.", "6隻に出港信号を送り、護送隊形を組む。"), "launch-convoy"), q("scan-orbit", L("순찰의 위치를 센서로 확인한다.", "Scan for the patrol's position.", "センサーで巡察の位置を確認する。"), "scan-orbit")]);
  s("convoy", L("여섯 척의 호송", "Escorting six ships", "6隻の護送"), L("피난 항로", "Evacuation corridor", "避難航路"), "여섯 척이 출항해 이동 중이다. 선택한 항로에서 대열을 지키고 마지막 이탈 지점을 통과해야 한다.", L("대열을 보호하고 이탈 지점 통과하기", "Protect the formation and reach the exit", "隊形を守り離脱地点を通過する"), [q("protect", L("대열에서 뒤처진 배를 확인하고 속도를 맞춰 호위한다.", "Check the trailing ships and match their speed.", "遅れた船を確認し速度を合わせて護衛する。"), "protect"), q("jump", L("대열을 확인했어. 이탈 지점을 통과하자.", "The formation is checked; cross the exit point.", "隊形を確認した。離脱地点を通過しよう。"), "exit", [g("escorted")])]);
  s("rendezvous", L("마지막 통신", "The final transmission", "最後の通信"), L("외곽 합류 지점", "Outer rendezvous point", "外縁の合流地点"), "호송 대열이 이탈 지점 너머로 빠져나왔다. 여섯 척의 합류를 확인하고 항로 인계 결과를 전할 수 있다.", L("여섯 척의 합류와 항로 인계 확인", "Confirm all six ships and report the handoff", "6隻の合流と航路引き継ぎを確認する"), [q("count", L("여섯 척의 호출 부호를 하나씩 확인한다.", "Confirm each of the six call signs.", "6隻のコールサインを一つずつ確認する。"), "count-ships"), q("report", L("여섯 척의 합류를 확인했어. 항로 인계를 완료하자.", "All six are accounted for. Complete the handoff.", "6隻の合流を確認した。航路の引き継ぎを完了しよう。"), "report", [g("safe-ships", 6)])], "relieved");
  e("brief", L("항로 위험 확인", "Route risks reviewed", "航路の危険を確認"), "사용자가 항로 지도와 위험 구간을 함께 확인하거나 설명을 듣자고 요청한다.", ["hangar"], [["briefed", 1], ["trust", 1]]);
  e("check-fuel", L("연료·항법 점검 완료", "Fuel and navigation checked", "燃料・航法点検完了"), "사용자가 자신의 배의 연료나 항법 장치를 지금 점검한다. 단순 위치 질문과 가정은 제외한다.", ["hangar"], [["fuel-checked", 1], ["trust", 1]]);
  e("choose-detour", L("우회 항로 선택", "Detour selected", "迂回航路を選択"), "사용자가 우회 항로로 가겠다고 직접 선택한다.", ["hangar"], [["detour", 1], ["direct", -1], ["route-ready", 1]], undefined, [], 0, false);
  e("choose-direct", L("직행 항로 선택", "Direct route selected", "直行航路を選択"), "사용자가 직행 항로로 가겠다고 직접 선택한다.", ["hangar"], [["direct", 1], ["detour", -1], ["route-ready", 1]], undefined, [], 0, false);
  e("depart", L("격납고 출항", "Departed the hangar", "格納庫を出港"), "사용자가 정한 항로로 이륙 또는 출항을 실제 실행하거나 출항 신호를 보낸다.", ["hangar"], [["departed", 1], ["fuel", -10], ["risk", 10]], "leave-hangar", [g("fuel-checked"), g("route-ready")]);
  e("scan-orbit", L("궤도 순찰 확인", "Orbital patrol scanned", "軌道巡察を確認"), "사용자가 현재 궤도의 센서로 순찰을 확인한다.", ["orbit"], [["risk", -5]]);
  e("launch-convoy", L("피난선 여섯 척 출항", "Six refugee ships launched", "避難船6隻が出港"), "사용자가 피난선 여섯 척에 출항 신호를 보내거나 호송 대열을 실제로 구성한다.", ["orbit"], [["convoy", 6], ["trust", 1]], "join-convoy");
  e("protect", L("호송 대열 보호", "Convoy protected", "護送隊形を保護"), "사용자가 뒤처진 선박을 확인하고 속도를 맞추거나 대열을 보호하는 행동을 한다.", ["convoy"], [["escorted", 1], ["fuel", -10], ["risk", -10], ["trust", 1]]);
  e("exit", L("이탈 지점 통과", "Exit point crossed", "離脱地点を通過"), "사용자가 대열을 확인한 뒤 이탈 지점 또는 합류 지점으로 실제 이동한다.", ["convoy"], [["fuel", -10]], "leave-corridor", [g("escorted")]);
  e("count-ships", L("여섯 척 합류 확인", "Six ships accounted for", "6隻の合流を確認"), "사용자가 여섯 척의 호출 부호나 합류 수를 실제로 확인한다.", ["rendezvous"], [["safe-ships", 6]]);
  e("report", L("항로 인계 완료", "Route handoff completed", "航路引き継ぎ完了"), "사용자가 확인한 합류 결과를 보고하거나 항로 인계를 완료하자고 명시한다.", ["rendezvous"], [["reported", 1]], undefined, [g("safe-ships", 6)]);
  e("withdraw", L("임무에서 물러남", "Withdrew from the mission", "任務から辞退"), "사용자가 피난 임무를 더 맡지 않고 떠나겠다고 명확히 결정한다. 잠깐 화장실에 가거나 장난으로 도망가는 말은 영구 포기와 구분한다.", ["hangar", "orbit"], [["withdrawn", 1]]);
  tr("leave-hangar", "hangar", "orbit", L("격납고를 떠나 궤도로", "Launch into orbit", "格納庫を離れ軌道へ"), "실제 출항을 선택한다.", [g("departed")]);
  tr("join-convoy", "orbit", "convoy", L("피난선 호송 시작", "Begin the escort", "避難船の護送開始"), "피난선 출항 신호를 보낸다.", [g("convoy", 6)]);
  tr("leave-corridor", "convoy", "rendezvous", L("합류 지점으로 이탈", "Reach the rendezvous", "合流地点へ離脱"), "대열을 지키며 이탈한다.", [g("escorted")]);
  field("route", L("선택한 항로", "Selected route", "選択した航路"), [[L("우회", "Detour", "迂回"), [g("detour")]], [L("직행", "Direct", "直行"), [g("direct")]], [L("미선택", "Not selected", "未選択"), []]]);
  field("departure", L("출항 상태", "Launch state", "出港状態"), [[L("피난선 여섯 척 호송 중", "Escorting all six ships", "避難船6隻を護送中"), [g("convoy", 6)]], [L("화물선 출항 완료", "Cargo ship has launched", "貨物船の出港完了"), [g("departed")]], [L("연료 점검 완료 · 출항 선택 대기", "Fuel checked; awaiting launch decision", "燃料点検済み・出港の選択待ち"), [g("fuel-checked")]], [L("출항 전 · 점검 필요", "Pre-launch; checks pending", "出港前・点検が必要"), []]]);
  field("patrol", L("제국 순찰", "Imperial patrol", "帝国巡察"), [[L("격납고 검문 시작", "Hangar inspections underway", "格納庫の検問開始"), [g("elapsed-minutes", 10)]], [L("접근 중", "Approaching", "接近中"), []]]);
  thread("departure", L("피난 항로 준비", "Prepare the evacuation route", "避難航路の準備"), L("항로와 연료를 확인한 뒤 출항을 실행한다.", "Choose a route and check fuel before launching.", "航路と燃料を確認して出港する。"), [g("departed")]);
  thread("escort", L("여섯 척을 놓치지 않기", "Keep all six together", "6隻を見失わない"), L("출항 신호와 대열 보호를 거쳐 합류 수를 확인한다.", "Launch, protect the formation and account for every ship.", "出港信号と隊形保護を経て全船の合流を確認する。"), [g("safe-ships", 6)], [g("departed")]);
  thread("handoff", L("마지막 항로 인계", "The final handoff", "最後の航路引き継ぎ"), L("합류 결과를 확인하고 나린과 항로 인계를 끝낸다.", "Confirm the rendezvous and finish the handoff with Narin.", "合流結果を確認しナリンと引き継ぎを終える。"), [g("reported")], [g("safe-ships", 6)]);
  ending("safe-convoy", L("여섯 개의 응답", "Six replies", "6つの応答"), L("여섯 척의 호출 부호가 돌아왔다. 항로 인계는 끝났고, 나린은 다음 구간의 통신을 넘겨받았다. 은하의 전쟁이 끝난 것은 아니지만 이번 호송은 마쳤다.", "Six call signs answer. The handoff and this escort are complete; the war beyond continues.", "6隻の応答が戻り、航路の引き継ぎと今回の護送は完了した。銀河の戦争は続く。"), [g("reported"), g("safe-ships", 6)]);
  ending("withdrawn", L("다른 조종사를 기다리며", "Waiting for another pilot", "別の操縦士を待って"), L("나린은 물러나겠다는 선택을 받아들이고 다른 협력자를 찾는다. 맡지 않은 탈출을 성공한 것으로 기록하지 않는다.", "Narin accepts the withdrawal and seeks another pilot. No uncompleted rescue is recorded as a success.", "ナリンは辞退を受け止め別の協力者を探す。未完の救助を成功とは記録しない。"), [g("withdrawn")]);
  ending("closed-hangar", L("닫힌 격납고", "The closed hangar", "閉じられた格納庫"), L("출항 전 경보가 20분을 넘겨 격납고가 봉쇄됐다. 이번 출항 기회는 놓쳤다.", "Twenty minutes passed before launch and the hangar was sealed. This departure window is lost.", "出港前に警報から20分が過ぎ格納庫が封鎖された。今回の出港機会を逃した。"), [g("elapsed-minutes", 20), g("departed", 0, "eq")], ["hangar"], 100);
  return d;
}

function academy() {
  const { d, L, counter: c, fact: f, choice: q, scene: s, event: e, transition: tr, field, thread, ending } = author("academy-world", "summoning", "2026-03-16T18:00:00+09:00", 1);
  d.summary = L("성인 소환술 아카데미. 재심까지 9일 남은 리에와 정체·능력이 아직 미확정인 정령이, 각자의 동의로 재심 준비를 시작한다.", "An adult summoning academy. Rie has nine days until her appeal; she and an unassessed spirit decide how to prepare together.", "成人の召喚術アカデミー。再審まで9日、リエと能力未確認の精霊が互いの意思で準備を進める。"); d.clockStyle = "elapsed"; d.clockLabel = L("소환실 대화 후 경과", "Time since the summoning-room conversation", "召喚室の会話からの経過");
  c("trust", L("신뢰도", "Trust", "信頼度"), 0, 5, true); c("days-left", L("재심까지", "Days to appeal", "再審まで"), 9, 9, true, "일"); c("repeats", L("확인한 신호", "Confirmed signals", "確認した合図"), 0, 2, true, "회");
  for (const id of ["consent", "signal", "practice-record", "registered", "plan", "withdrawn"]) c(id, id);
  f("world", d.summary); f("consent", L("정식 계약과 재심은 소환사와 정령 각자의 동의가 필요하다. 준비를 마친 것은 재심 합격이 아니다.", "A formal contract and appeal require both parties' consent. Completing preparation is not passing the appeal.", "正式契約と再審には双方の同意が必要。準備完了は再審合格を意味しない。"));
  f("unknown-ability", L("정령의 능력과 전생 기억은 아직 확인하지 않았다. 신호 확인만으로 특별한 능력이나 정식 계약을 확정하지 않는다.", "The spirit's powers and past-life memories remain unverified. Signal checks establish neither special powers nor a formal contract.", "精霊の能力と前世の記憶は未確認。合図の確認だけで特別な能力や正式契約を確定しない。"));
  f("registrar",L("실습 기록을 마치면 접수 담당 에다가 임시 접수대에서 기록과 양쪽 동의를 확인할 수 있다. 접수 담당은 능력 평가나 합격을 대신 확정하지 않는다.","After practice is recorded, registrar Eda can check the record and mutual consent at the desk. Registration is not an ability assessment or a passed appeal.","実習記録の完成後、受付担当エダが記録と双方の同意を確認できる。受付は能力評価や再審合格ではない。"),[g("practice-record")]);
  f("unregistered", L("재심 임시 접수는 아직 하지 않았다.", "The appeal has not yet been provisionally registered.", "再審の仮受付はまだしていない。"), [g("registered", 0, "eq")]);
  f("registered", L("재심 임시 접수를 마쳤다. 실제 재심은 9일 뒤이며 아직 치르지 않았다.", "Provisional registration is complete. The actual appeal is nine days away and has not happened.", "再審の仮受付は完了。実際の再審は9日後で、まだ受けていない。"), [g("registered")]);
  s("summoning", L("서로의 선택", "Each other's choice", "互いの選択"), L("아카데미 소환실", "Academy summoning room", "学院の召喚室"), "리에와 정령은 소환실에서 재심 준비에 협력할지 정한다. 기존에 나눈 이름과 대화를 이어간다.", L("준비에 대한 동의와 신호 정하기", "Agree on preparation and a signal", "準備への同意と合図を決める"), [q("agree", L("재심 준비를 같이 할게. 우리 둘 다 원할 때만 연습하자.", "I'll help prepare. Let's practice only while we both want to.", "再審の準備を手伝う。お互いが望む間だけ練習しよう。"), "agree"), q("signal", L("짧게 대답하는 신호 하나를 정하고 연습실로 가자.", "Choose one simple response signal and go to the practice room.", "短く答える合図を一つ決めて練習室へ行こう。"), "choose-signal", [g("consent")]), q("terms", L("정식 계약과 임시 등록의 차이를 확인하고 싶어.", "Let's clarify formal contracts versus provisional registration.", "正式契約と仮登録の違いを確認したい。"))]);
  s("practice", L("신호 실습", "Signal practice", "合図の実習"), L("소환술 연습실", "Summoning practice room", "召喚術の練習室"), "서로 정한 짧은 신호를 확인하는 연습이다. 숫자로 확인한 횟수를 따른다. 능력 평가나 재심 합격은 아직 아니다.", L("같은 신호를 두 번 확인하기", "Confirm the agreed signal twice", "同じ合図を2回確認する"), [q("respond", L("정한 신호에 한 번 대답하고 리에와 결과를 기록한다.", "Respond to the agreed signal once and record the result with Rie.", "決めた合図に一度答え、リエと結果を記録する。"), "repeat-signal", [], [g("repeats", 2)]), q("record", L("두 번의 신호 확인을 기록하고 재심 접수대로 가자.", "Record the two confirmations and go to the appeal desk.", "2回の確認を記録して再審の受付へ行こう。"), "record-practice", [g("repeats", 2)])], "focused");
  s("registry", L("재심 접수", "Appeal registration", "再審の受付"), L("아카데미 재심 접수대", "Academy appeal desk", "学院の再審受付"), "실습 결과 기록을 가지고 임시 재심 접수를 할 수 있다. 정식 계약과 재심 합격은 별개의 일이다.", L("동의를 확인하고 임시 접수하기", "Confirm consent and provisionally register", "同意を確認して仮受付をする"), [q("register", L("기록과 동의 여부를 확인하고 재심 임시 접수를 한다.", "Check our record and consent, then provisionally register.", "記録と同意を確認して再審の仮受付をする。"), "register")], "focused");
  s("preparation", L("아홉 날의 준비", "Nine days of preparation", "9日間の準備"), L("아카데미 연습 계획판", "Academy practice planning board", "学院の練習計画板"), "임시 접수는 끝났다. 오늘부터 9일 뒤 재심까지 어떻게 준비할지 서로 결정한다.", L("무리하지 않는 연습 계획 정하기", "Choose a sustainable practice plan", "無理のない練習計画を決める"), [q("plan", L("하루에 짧게 연습하고 중단 의사를 확인하는 계획을 세우자.", "Plan short daily practice and check when either of us wants to stop.", "毎日短く練習し、中断の意思を確かめる計画にしよう。"), "plan")], "relieved");
  e("agree", L("재심 준비에 동의", "Agreed to prepare", "再審の準備に同意"), "사용자가 지금 자발적으로 재심 준비에 협력하겠다고 동의한다.", ["summoning"], [["consent", 1], ["trust", 1]]);
  e("choose-signal", L("연습 신호 합의", "Practice signal agreed", "練習の合図に合意"), "사용자가 서로 사용할 짧은 신호를 정하고 실습을 시작하거나 연습실로 이동하자고 한다.", ["summoning"], [["signal", 1]], "to-practice", [g("consent")]);
  e("repeat-signal", L("합의한 신호 1회 확인", "Agreed signal confirmed once", "合意した合図を1回確認"), "사용자가 정한 신호에 실제로 한 번 응답하거나 반복 연습을 실행한다. 능력 보유 주장과 구분한다.", ["practice"], [["repeats", 1]], undefined, [g("repeats", 1, "lte")], 0, false);
  e("record-practice", L("실습 결과 기록", "Practice results recorded", "実習結果を記録"), "사용자가 두 번 확인한 실습 기록을 정리하고 접수대로 가자고 한다.", ["practice"], [["practice-record", 1], ["trust", 1]], "to-registry", [g("repeats", 2)]);
  e("register", L("재심 임시 접수 완료", "Provisional appeal registration complete", "再審の仮受付完了"), "사용자가 동의와 기록을 확인한 뒤 임시 재심 접수를 실제로 한다.", ["registry"], [["registered", 1]], "to-preparation");
  e("plan", L("연습 계획 합의", "Practice plan agreed", "練習計画に合意"), "사용자가 짧은 연습과 중단 선택을 존중하는 계획을 구체적으로 정한다.", ["preparation"], [["plan", 1], ["trust", 1]]);
  e("withdraw", L("오늘 연습 중단", "Today's practice stopped", "今日の練習を中断"), "사용자가 더 이상 연습하지 않고 오늘 대화를 끝내겠다고 분명히 정한다.", d.scenes.map(s => s.id), [["withdrawn", 1]]);
  tr("to-practice", "summoning", "practice", L("연습실로 이동", "Go to the practice room", "練習室へ移動"), "함께 정한 신호를 실습한다.", [g("signal")]); tr("to-registry", "practice", "registry", L("접수대로 이동", "Go to the appeal desk", "受付へ移動"), "실습 기록을 들고 접수한다.", [g("practice-record")]); tr("to-preparation", "registry", "preparation", L("준비 계획 정하기", "Plan the preparation", "準備計画を決める"), "접수 후 계획을 정한다.", [g("registered")]);
  field("appeal", L("재심 진행", "Appeal progress", "再審の進行"), [[L("임시 접수 완료 · 재심 전", "Provisionally registered; appeal pending", "仮受付完了・再審前"), [g("registered")]], [L("실습 기록 준비됨", "Practice record ready", "実習記録の準備完了"), [g("practice-record")]], [L("동의한 범위에서 준비 중", "Preparing within agreed limits", "同意した範囲で準備中"), [g("consent")]], [L("협력 여부 확인 중", "Discussing whether to cooperate", "協力するか確認中"), []]]);
  thread("signal", L("우리만의 응답 신호", "Our response signal", "二人の応答の合図"), L("동의한 신호를 정하고 두 번 확인한다.", "Agree on a signal and confirm it twice.", "合意した合図を決め、2回確認する。"), [g("repeats", 2)]);
  thread("appeal", L("재심까지 9일", "Nine days to the appeal", "再審まで9日"), L("실습 기록을 접수하고 연습 계획을 세운다. 오늘 합격으로 끝내지 않는다.", "Register the practice record and make a plan; the appeal is still ahead.", "実習記録を受付に出し練習計画を立てる。今日の合格にはしない。"), [g("registered"), g("plan")]);
  ending("prepared", L("함께 준비할 아홉 날", "Nine days to prepare together", "一緒に準備する9日間"), L("임시 접수와 연습 계획을 마쳤다. 재심은 앞으로 남아 있고 둘은 합의한 준비를 이어갈 수 있다.", "Registration and planning are complete. The appeal is still ahead; preparation can continue by agreement.", "仮受付と計画を終えた。再審はこれからで、合意した準備を続けられる。"), [g("registered"), g("plan")]);
  ending("pause", L("오늘은 여기까지", "Enough for today", "今日はここまで"), L("리에는 중단 의사를 받아들였다. 하지 않은 계약이나 재심을 완료한 것으로 바꾸지 않는다.", "Rie accepts the pause. No unfinished contract or appeal is marked complete.", "リエは中断の意思を受け止めた。未完の契約や再審を完了にはしない。"), [g("withdrawn")]);
  return d;
}

export function reunion() {
  const { d, L, counter: c, fact: f, choice: q, scene: s, event: e, transition: tr, field, thread, ending } = author("record-world", "counter", "2026-03-16T23:57:00+09:00", 0);
  d.summary = L("마지막 영업일의 심야 레코드 바 ‘파형’. 34세 서윤과 33세 전 연인이 2년 만에 만나, 남색 음반과 보내지 못한 편지를 어떻게 남길지 정한다.", "At the record bar Wave's final night, 34-year-old Seyun and her 33-year-old former partner meet after two years and decide what to do with an undelivered record and letter.", "最後の営業日の深夜のレコードバー「波形」。34歳のソユンと33歳の元恋人が2年ぶりに会い、渡せなかったレコードと手紙について決める。");
  c("trust", L("신뢰도", "Trust", "信頼度"), 0, 5, true); for (const id of ["talked", "letter-choice", "opened", "sealed", "song", "listened", "meet-again", "goodbye"]) c(id, id);
  f("world", d.summary); f("record", L("남색 음반은 2년 전 플레이어가 전하려다 남긴 것이다. 편지 내용과 서로의 마음을 임의로 지어내지 않는다.", "The navy record was left two years ago. Do not invent the letter's contents or either person's feelings.", "紺色のレコードは2年前に渡せず残したもの。手紙の内容や相手の気持ちを勝手に決めない。"));
  f("letter-open", L("두 사람이 함께 편지를 열기로 선택했다. 쓰인 내용은 플레이어가 제시한 범위에서만 확인한다.", "The pair chose to open the letter together; its contents are limited to what the player provides.", "二人で手紙を開くことを選んだ。内容はプレイヤーが示した範囲で確認する。"), [g("opened")]);
  f("letter-sealed", L("오늘 편지를 열지 않기로 합의했다. 선택을 번복하라고 계속 묻지 않는다.", "The pair agreed to leave the letter sealed today. Do not keep asking to reverse that choice.", "今日は手紙を開けないと合意した。変更を繰り返し求めない。"), [g("sealed")]);
  f("midnight",L("자정의 마지막 곡이 끝났다. 서윤은 레코드 바의 마감등을 켜지만 두 사람의 관계나 다음 만남은 대신 정하지 않는다.","The midnight song has ended. Seyun turns on the closing lights without deciding the relationship or next meeting for the player.","真夜中の最後の曲が終わった。ソユンは閉店の明かりをつけるが、関係や次の約束は勝手に決めない。"),[g("listened")]);
  const bar = L("레코드 바 파형", "Record bar Wave", "レコードバー波形");
  s("counter", L("다시 마주한 카운터", "Back at the counter", "再び向き合うカウンター"), bar, "서로 이미 나눈 말을 기억하며, 오늘 어떤 대화를 이어갈지 정한다. 처음 인사로 되돌리지 않는다.", L("서로 원하는 대화의 거리 정하기", "Choose a comfortable way to talk", "二人が望む会話の距離を決める"), [q("talk", L("오늘은 그때 못 한 말을 차분히 나누고 싶어.", "I'd like to calmly talk about what we left unsaid.", "今日はあの時話せなかったことを落ち着いて話したい。"), "talk"), q("sealed", L("오늘 편지는 열지 말자. 마지막 곡은 같이 고르고 싶어.", "Leave the letter sealed today; let's choose the last song together.", "今日は手紙を開けず、最後の曲を一緒に選びたい。"), "leave-sealed"), q("open", L("우리 둘 다 괜찮다면 편지를 같이 열어보자.", "If we're both comfortable, let's open the letter together.", "二人ともよければ手紙を一緒に開けよう。"), "open-letter")]);
  s("letter", L("편지를 두는 방식", "What to do with the letter", "手紙をどうするか"), bar, "대화를 이어가며 편지를 함께 열거나 그대로 둘지 결정한다. 이미 결정했다면 다시 허락을 묻지 않는다.", L("편지에 대한 선택을 함께 확인하기", "Agree on the letter", "手紙について二人で決める"), [q("open", L("편지를 함께 열고, 적힌 말은 내가 직접 설명할게.", "Let's open it together; I'll explain what I wrote.", "一緒に手紙を開け、書いた言葉は私が説明する。"), "open-letter"), q("sealed", L("오늘 편지는 그대로 두자. 함께 들을 곡을 고르자.", "Leave it sealed today and choose a song together.", "今日は手紙をそのままにして、一緒に聴く曲を選ぼう。"), "leave-sealed")]);
  s("music", L("마지막 곡", "The last song", "最後の曲"), bar, "편지에 대한 결정은 끝났다. 서윤이 선택을 존중하며 마지막 곡을 고르고 재생할 수 있다.", L("곡을 고르고 끝까지 함께 듣기", "Choose a song and listen together", "曲を選び最後まで一緒に聴く"), [q("song", L("마지막 곡은 네가 골라줘. 그 곡을 틀자.", "You choose the last song. Let's play it.", "最後の曲は君が選んで。その曲を流そう。"), "choose-song"), q("listen", L("곡이 끝날 때까지 함께 듣고 나서 이야기하자.", "Listen together until the song ends, then talk.", "曲が終わるまで一緒に聴いてから話そう。"), "listen", [g("song")])]);
  s("after-song", L("곡이 끝난 뒤", "After the song", "曲が終わった後"), bar, "마지막 곡은 끝났다. 오늘 이후 다시 만날지, 오늘의 인사로 남길지는 서로의 선택이다.", L("다음 만남 또는 오늘의 작별 정하기", "Choose another meeting or say goodbye", "次の約束か今日の別れを決める"), [q("meet", L("다음에 커피 한 잔 더 하자. 날짜는 같이 정하고 싶어.", "Let's have another coffee sometime and choose a date together.", "今度またコーヒーを飲もう。日程は一緒に決めたい。"), "meet-again"), q("bye", L("오늘 곡 잘 들었어. 지금은 여기서 인사할게.", "Thank you for the song. I'll say goodbye here today.", "今日は曲をありがとう。今はここで挨拶するね。"), "goodbye")], "relieved");
  e("talk", L("대화를 이어가기로 함", "Agreed to talk", "会話を続けることにした"), "사용자가 그때 못한 말을 지금 차분히 나누자고 하거나 오늘 대화할 의사를 명시한다.", ["counter"], [["talked", 1], ["trust", 1]], "to-letter");
  for (const source of ["counter", "letter"]) {
    const suffix = source === "counter" ? "-at-counter" : "";
    e("open-letter" + suffix, L("편지를 함께 열기로 선택", "Chose to open the letter together", "手紙を一緒に開けると選択"), "사용자가 서로 동의한 범위에서 편지를 함께 열자고 직접 선택한다.", [source], [["opened", 1], ["letter-choice", 1], ["trust", 1]], source === "counter" ? "counter-to-music" : "to-music-open", [g("letter-choice", 0, "eq")], 1);
    e("leave-sealed" + suffix, L("편지를 열지 않기로 선택", "Chose to leave the letter sealed", "手紙を開けないと選択"), "사용자가 오늘 편지를 열지 않고 그대로 두자고 분명히 선택한다.", [source], [["sealed", 1], ["letter-choice", 1], ["trust", 1]], source === "counter" ? "counter-to-music" : "to-music-open", [g("letter-choice", 0, "eq")], 1);
  }
  for (const choice of d.scenes.find(scene => scene.id === "counter")!.choices!) if (choice.actionId === "open-letter" || choice.actionId === "leave-sealed") choice.actionId += "-at-counter";
  tr("to-letter", "counter", "letter", L("편지의 선택으로", "Decide about the letter", "手紙の選択へ"), "서로 원하는 대화를 이어간다.", [g("talked")]);
  tr("to-music-open", "letter", "music", L("선택을 마치고 음악으로", "Move on to music", "選択を終え音楽へ"), "편지에 대한 선택을 마쳤다.", [g("letter-choice")]);
  tr("counter-to-music", "counter", "music", L("편지 선택 후 마지막 곡", "The last song after the letter decision", "手紙の選択の後、最後の曲へ"), "시작 자리에서 편지 선택을 마치고 곡을 고른다.", [g("letter-choice")]);
  // A shared action requests a matching transition in each scene (resolved below).
  e("choose-song", L("마지막 곡 선택", "Last song selected", "最後の曲を選択"), "사용자가 함께 들을 마지막 곡을 직접 고르거나 서윤에게 선곡을 맡기고 재생하자고 한다.", ["music"], [["song", 1]], undefined, [], 1);
  e("listen", L("마지막 곡 청취 완료", "Finished listening to the last song", "最後の曲の試聴完了"), "사용자가 마지막 곡을 끝까지 함께 듣는 행동을 한다.", ["music"], [["listened", 1], ["trust", 1]], "to-after-song", [g("song")], 1);
  tr("to-after-song", "music", "after-song", L("곡이 끝난 뒤의 대화", "Talk after the song", "曲の後の会話"), "곡이 끝날 때까지 듣는다.", [g("listened")]);
  e("meet-again", L("다음 만남에 동의", "Agreed to meet again", "次に会うことに同意"), "사용자가 다음에 다시 만나거나 연락을 이어가자고 직접 제안한다.", ["after-song"], [["meet-again", 1]]);
  e("goodbye", L("오늘의 작별", "Today's goodbye", "今日の別れ"), "사용자가 오늘 대화를 마치고 떠나겠다고 분명히 인사한다.", d.scenes.map(s => s.id), [["goodbye", 1]]);
  field("letter", L("편지", "Letter", "手紙"), [[L("함께 열기로 선택함 · 내용은 당사자가 확인", "Opening together; contents confirmed by the author", "一緒に開けると選択・内容は本人が確認"), [g("opened")]], [L("오늘은 열지 않기로 함", "Leaving it sealed today", "今日は開けない"), [g("sealed")]], [L("선택 전 · 내용 미확인", "Undecided; contents unconfirmed", "選択前・内容は未確認"), []]]);
  field("music", L("마지막 곡", "Last song", "最後の曲"), [[L("청취 완료", "Finished listening", "試聴完了"), [g("listened")]], [L("선곡·재생함", "Chosen and playing", "選曲・再生済み"), [g("song")]], [L("선곡 전", "Not yet chosen", "選曲前"), []]]);
  thread("letter", L("전하지 못한 편지", "The undelivered letter", "渡せなかった手紙"), L("열지 않거나 함께 여는 선택을 존중한다.", "Respect the choice to open it together or leave it sealed.", "一緒に開けるか、そのままにするかの選択を尊重する。"), [g("letter-choice")]);
  thread("song", L("마지막 한 곡", "One last song", "最後の一曲"), L("선곡 후 함께 듣고 오늘 이후를 정한다.", "Choose, listen, then decide what comes after today.", "曲を選び、一緒に聴いて今日の後を決める。"), [g("listened")], [g("letter-choice")]);
  ending("another-coffee", L("한 잔 더", "Another coffee", "もう一杯"), L("마지막 곡을 듣고 다시 만나자는 뜻을 나눴다. 관계의 이름은 서두르지 않고 함께 정해갈 수 있다.", "After the last song, you agreed to meet again. The relationship can take shape at your own pace.", "最後の曲を聴き、また会う意思を分かち合った。関係の形は急がず決めていける。"), [g("listened"), g("meet-again")]);
  ending("goodnight", L("오늘의 마지막 곡", "Tonight's last song", "今日の最後の曲"), L("서윤은 작별을 받아들인다. 편지를 남겨 두어도, 펼쳤어도 오늘의 선택은 존중된다.", "Seyun accepts the goodbye and respects what you decided about the letter.", "ソユンは別れを受け止め、手紙についての今日の選択を尊重する。"), [g("goodbye")]);
  return d;
}

function radioWorld() {
  const {d,L,counter:c,fact:f,choice:q,scene:s,event:e,transition:tr,field,thread,ending}=author("radio-world","control","2026-03-16T23:48:00+09:00",1);
  d.summary=L("폐국을 앞둔 심야 라디오. 성인인 은결과 옛 공동 진행자가 3년 전 지운 트랙을 복구했다. 마지막 방송까지 12분, 둘만 들을지 함께 공개할지는 두 사람이 결정한다.","At a late-night station's closure, adult former co-hosts Eungyeol and the player revisit a restored track deleted three years ago. Twelve minutes remain; listening privately and broadcasting are separate decisions.","閉局前の深夜ラジオ。成人のウンギョルと元共同司会者が3年前に消したトラックを復元した。最後の放送まで12分。二人で聴くか公開するかは別々に決める。");
  d.clockStyle="elapsed";
  d.clockLabel=L("마지막 방송 준비 후 경과","Since final broadcast preparations","最後の放送準備から");
  c("trust",L("신뢰도","Trust","信頼度"),0,5,true);
  for(const id of ["private-ready","listened","publish","kept-private","meet-again","goodbye"])c(id,id);
  f("world",d.summary);f("consent",L("트랙 복구와 비공개 청취는 공개 송출 동의가 아니다. 복구하지 않은 과거 대사나 상대의 감정을 사실로 만들어내지 않는다.","Restoration and private listening do not authorize broadcast. Do not invent the missing recording or either person's feelings.","復元と非公開の試聴は放送への同意ではない。録音の内容や相手の感情を勝手に確定しない。"));
  f("not-broadcast",L("복구한 트랙은 아직 공개 송출하지 않았다.","The restored track has not been broadcast.","復元トラックはまだ公開放送していない。"),[g("publish",0,"eq")]);
  f("broadcast",L("두 사람이 청취 후 공개하기로 선택해 트랙 송출을 시작했다. 청취자 반응과 관계의 결론은 아직 확정하지 않는다.","After listening, both chose to broadcast. Audience reactions and the relationship's future are not established.","試聴後、二人で公開を選び放送を始めた。聴取者の反応や関係の結論は未確定。"),[g("publish")]);
  f("private",L("둘만의 트랙으로 남기기로 결정했다. 공개를 반복해서 권하지 않는다.","The track will stay private. Respect that decision.","二人だけのトラックとして残すと決めた。その意思を尊重する。"),[g("kept-private")]);
  f("broadcast-slot-closed",L("마지막 송출 시간이 지나 공개 슬롯이 닫혔다. 아직 송출하지 않은 트랙은 비공개로 남으며 둘은 보관과 다음 만남을 정할 수 있다.","The final broadcast slot has closed. Any unbroadcast track remains private; storage and another meeting are still choices.","最後の放送枠が閉じた。未放送のトラックは非公開のままで、保存や次の約束を決められる。"),[g("elapsed-minutes",12),g("publish",0,"eq")]);
  const room=L("심야 라디오 조정실","Late-night radio control room","深夜ラジオの調整室");
  s("control",L("복구한 파형","The restored waveform","復元した波形"),room,"트랙은 복구했지만 아직 듣거나 방송하지 않았다. 이미 나눈 대화를 이어간다.",L("비공개 청취부터 함께 결정하기","Agree on private listening first","まず非公開の試聴を決める"),[q("private",L("송출은 보류하고 헤드폰으로 우리 둘만 먼저 듣자.","Hold the broadcast. Let's listen privately on headphones first.","放送は保留にして、ヘッドホンで二人だけで先に聴こう。"),"prepare-private"),q("track",L("복구된 부분과 아직 비어 있는 구간을 같이 확인하자.","Check which parts were restored and which remain missing.","復元された部分とまだ欠けている区間を一緒に確認しよう。"))]);
  s("listening",L("헤드폰 두 개","Two headphones","二つのヘッドホン"),room,"비공개 청취에 합의했다. 외부 송출 채널은 닫혀 있다. 복구한 트랙을 함께 들을 수 있다.",L("복구한 트랙을 끝까지 듣기","Listen to the restored track","復元したトラックを最後まで聴く"),[q("listen",L("외부 송출이 꺼진 것을 확인하고 트랙을 끝까지 듣는다.","Check the broadcast is off and listen to the whole track.","外部放送がオフと確認してトラックを最後まで聴く。"),"listen")],"focused");
  s("decision",L("어디까지 들려줄까","Who should hear it?","どこまで聴かせるか"),room,"둘만 트랙을 들었다. 그 경험과 이미 나눈 말을 기억하며 공개 범위를 정한다.",L("비공개 보관 또는 공개 송출 선택","Choose private storage or joint broadcast","非公開の保存か二人の同意で放送するか決める"),[q("keep",L("이 트랙은 우리 둘만 듣는 것으로 남기자. 공개하지 않을게.","Keep this track between us. I won't broadcast it.","このトラックは二人だけで聴くものにしよう。公開しない。"),"keep-private"),q("publish",L("나는 공개 송출에 동의해. 너도 원한다면 같이 송출을 시작하자.","I consent to broadcasting it. If you also want to, let's broadcast together.","私は公開放送に同意する。君も望むなら一緒に放送を始めよう。"),"broadcast",[],[g("elapsed-minutes",12)])]);
  s("closing",L("방송이 끝나기 전에","Before signing off","放送を終える前に"),room,"트랙 공개 범위는 이미 정했다. 결정을 다시 묻지 않고 두 사람이 앞으로 연락을 이어갈지 정한다.",L("다음 만남 또는 오늘의 인사","Another meeting or today's goodbye","次の約束か今日の挨拶"),[q("meet",L("방송이 끝난 뒤에도 만나서 이야기하고 싶어. 다음 약속을 정하자.","I'd like to talk after the station closes. Let's make another plan.","閉局後も会って話したい。次の約束を決めよう。"),"meet-again"),q("bye",L("오늘 함께 들어줘서 고마워. 지금은 여기서 인사할게.","Thank you for listening with me. I'll say goodbye for today.","今日は一緒に聴いてくれてありがとう。今はここで挨拶するね。"),"goodbye")],"relieved");
  e("prepare-private",L("비공개 청취 준비","Private listening prepared","非公開の試聴を準備"),"사용자가 공개 송출을 보류하고 둘만 트랙을 먼저 듣자고 직접 제안한다.",["control"],[["private-ready",1],["trust",1]],"to-listening");
  e("listen",L("복구 트랙 청취 완료","Restored track heard","復元トラックの試聴完了"),"사용자가 비공개로 복구 트랙을 끝까지 함께 듣는다.",["listening"],[["listened",1],["trust",1]],"to-decision");
  e("keep-private",L("비공개 보관 선택","Chose private storage","非公開の保存を選択"),"사용자가 들은 트랙을 공개하지 않고 둘만의 것으로 남기자고 선택한다.",["decision"],[["kept-private",1],["trust",1]],"to-closing-private",[g("publish",0,"eq")]);
  e("broadcast",L("함께 공개 송출 시작","Joint broadcast started","二人で公開放送を開始"),"사용자가 공개 송출에 명시적으로 동의하고 은결도 원하면 함께 방송하자고 선택한다. 단순 재생이나 청취는 공개가 아니다.",["decision"],[["publish",1],["trust",1]],"to-closing-public",[g("kept-private",0,"eq"),g("elapsed-minutes",11,"lte")]);
  e("meet-again",L("다음 만남 약속","Another meeting agreed","次の約束"),"사용자가 폐국 이후 다시 만나거나 연락을 이어가자고 직접 제안한다.",["closing"],[["meet-again",1]]);
  e("goodbye",L("오늘 대화 마무리","Today's conversation closed","今日の会話を終了"),"사용자가 오늘 대화를 마치고 떠나겠다고 분명히 인사한다.",d.scenes.map(s=>s.id),[["goodbye",1]]);
  tr("to-listening","control","listening",L("둘만의 청취로","Listen privately","二人だけの試聴へ"),"비공개 청취를 선택한다.",[g("private-ready")]);
  tr("to-decision","listening","decision",L("들은 뒤 선택하기","Decide after listening","聴いてから選ぶ"),"트랙을 끝까지 듣는다.",[g("listened")]);
  tr("to-closing-private","decision","closing",L("우리만의 트랙으로","Keep it between us","二人だけのトラックに"),"비공개 보관을 선택한다.",[g("kept-private")]);
  tr("to-closing-public","decision","closing",L("함께 송출한 뒤","After our broadcast","一緒に放送した後"),"명시적 동의로 공개한다.",[g("publish")]);
  field("track",L("복구 트랙","Restored track","復元トラック"),[[L("청취 완료","Heard","試聴完了"),[g("listened")]],[L("비공개 청취 준비됨","Ready for private listening","非公開の試聴準備完了"),[g("private-ready")]],[L("복구 완료 · 청취 전","Restored; not yet heard","復元完了・試聴前"),[]]]);
  field("privacy",L("공개 범위","Sharing choice","公開範囲"),[[L("공개 송출 시작","Broadcast started","公開放送開始"),[g("publish")]],[L("비공개로 보관","Kept private","非公開で保存"),[g("kept-private")]],[L("송출 보류","Broadcast on hold","放送保留"),[]]]);
  thread("listen",L("지웠던 마지막 트랙","The deleted last track","消した最後のトラック"),L("헤드폰으로 함께 듣고 복구한 기록을 확인한다.","Listen privately and revisit the restored record.","ヘッドホンで一緒に聴き、復元した記録を確かめる。"),[g("listened")]);
  thread("future",L("폐국 이후의 우리","After the station closes","閉局後の二人"),L("공개 범위를 정한 뒤 다음 만남에 대한 마음을 나눈다.","Decide the sharing scope, then discuss meeting again.","公開範囲を決め、次の約束への気持ちを伝える。"),[g("meet-again")],[g("listened")]);
  ending("public-next",L("온에어 다음의 약속","After the on-air light","オンエアの後の約束"),L("함께 송출한 트랙이 끝나고 두 사람은 폐국 이후에도 만나기로 했다. 청취자의 반응보다 지금 함께 고른 다음 시간이 남았다.","The joint broadcast ends, and you agree to meet after the station closes. The next shared moment matters more than unconfirmed audience reactions.","一緒に放送したトラックが終わり、閉局後も会うと決めた。聴取者の反応より二人で選んだ次の時間が残る。"),[g("meet-again"),g("publish")],undefined,80);
  ending("another-track",L("다음 트랙의 약속","A promise of another track","次のトラックの約束"),L("트랙을 들려줄 범위를 함께 정했고 다음 만남을 약속했다. 관계의 결론을 서두르지 않아도 다음 대화는 남아 있다.","You agreed who should hear the track and planned to meet again. The next conversation remains open.","聴かせる範囲を二人で決め、次の約束をした。関係の結論を急がなくても次の会話がある。"),[g("meet-again")]);
  ending("goodnight",L("오늘의 사인오프","Today's sign-off","今日のサインオフ"),L("은결은 오늘의 인사를 받아들인다. 공개하지 않은 트랙은 비공개로 남는다.","Eungyeol accepts the goodbye. Any unbroadcast track stays private.","ウンギョルは今日の挨拶を受け止める。未公開のトラックは非公開のまま残る。"),[g("goodbye")]);
  return d;
}

function genericWorld(story: Story) {
  const {d,L,counter:c,fact:f,choice:q,scene:s,event:e,transition:tr,field,thread,ending}=author("custom-world","opening","2026-03-16T12:00:00+09:00",1);
  d.summary=story.setting;d.clockStyle="elapsed";d.clockLabel=L("이번 장면 시작 후 경과","Since the opening scene","場面の開始から");
  c("trust",L("신뢰도","Trust","信頼度"),0,5,true);for(const id of ["goal","step","review","closed"])c(id,id);
  f("authored-world",story.setting);f("agency",L("작품 설정과 사용자가 실제로 선택한 행동을 따른다. 목표를 정한 것과 실행해 성공한 것은 구별한다. 설정에 없는 권력·능력·과거 사건은 확정하지 않는다.","Follow the authored world and actual choices. Agreeing on a goal is not completing it. Do not invent powers or past events.","作品の設定と実際の選択に従う。目標の合意と達成は別。未設定の能力や過去の事件は確定しない。"));
  const loc=L("작품 속 현재 장소","Current story location","作品内の現在地");
  s("opening",L("상황과 목표","Situation and goal","状況と目標"),loc,story.prologue,L("지금 함께 해결할 작은 목표 정하기","Agree on one immediate goal","今一緒に取り組む小さな目標を決める"),[q("goal",L("지금 우리가 함께 할 수 있는 작은 목표 하나를 정하자.","Let's agree on one small goal we can pursue now.","今一緒にできる小さな目標を一つ決めよう。"),"agree-goal"),q("context",L("지금 상황과 네가 원하는 것을 먼저 알고 싶어.","Tell me about the situation and what you want.","今の状況と君が望むことを先に知りたい。"))]);
  s("working",L("함께 실행하기","Taking a step together","一緒に実行する"),loc,"지금까지 나눈 대화에서 합의한 목표를 이어간다. 아직 실행하지 않은 일은 성공했다고 말하지 않는다.",L("합의한 목표의 첫 행동 실행하기","Take the first agreed step","合意した目標の最初の行動を実行する"),[q("step",L("방금 정한 목표를 향해 우리가 합의한 첫 행동을 지금 실행한다.","Take the first step we just agreed on toward our goal.","今決めた目標に向けて、合意した最初の行動を実行する。"),"take-step")]);
  s("aftermath",L("행동 뒤의 대화","After the action","行動の後の会話"),loc,"선택한 첫 행동을 했다. 실제 확인한 결과만 이야기하며 다음 행동은 서로 결정한다.",L("확인한 결과와 다음 행동 나누기","Review what happened and choose what comes next","確認した結果と次の行動を話す"),[q("review",L("방금 한 행동으로 확인한 결과를 정리하고 다음 선택을 함께 정하자.","Review what our action established and decide what comes next.","今の行動で確認した結果を整理し、次の選択を一緒に決めよう。"),"review"),q("close",L("오늘은 여기까지 하고 다음에 이어가자.","Let's stop here today and continue next time.","今日はここまでにして次に続けよう。"),"close")]);
  e("agree-goal",L("공동 목표 정함","Agreed on a goal","共通の目標を決定"),"사용자가 현재 설정에서 함께 할 수 있는 작은 목표를 정하자고 직접 제안하거나 목표에 동의한다.",["opening"],[["goal",1],["trust",1]],"start-working");
  e("take-step",L("합의한 첫 행동 실행","Took the agreed first step","合意した最初の行動を実行"),"사용자가 이전 대화에서 합의한 목표를 향한 첫 행동을 현재 실행한다. 단순 가능성 질문이나 세계관을 무시한 만능 해결은 제외한다.",["working"],[["step",1],["trust",1]],"review-action");
  e("review",L("결과와 다음 선택 정리","Reviewed results and next choices","結果と次の選択を整理"),"사용자가 이미 한 행동의 결과를 함께 확인하고 다음 선택을 정하자고 한다.",["aftermath"],[["review",1]]);
  e("close",L("오늘의 대화 마무리","Closed today's conversation","今日の会話を終了"),"사용자가 오늘의 대화를 마치겠다고 분명히 말한다.",d.scenes.map(s=>s.id),[["closed",1]]);
  tr("start-working","opening","working",L("합의한 목표로","Work toward the goal","合意した目標へ"),"목표를 정한다.",[g("goal")]);tr("review-action","working","aftermath",L("행동 뒤 결과 확인","Review the action","行動後の結果確認"),"첫 행동을 한다.",[g("step")]);
  field("progress",L("진행 상태","Progress","進行状況"),[[L("첫 행동 완료 · 결과 확인 중","First step taken; reviewing","最初の行動を実行・結果確認中"),[g("step")]],[L("목표 합의 · 첫 행동 대기","Goal agreed; first step pending","目標合意・最初の行動待ち"),[g("goal")]],[L("상황과 목표 알아가는 중","Exploring the situation and goal","状況と目標を確認中"),[]]]);
  thread("goal",L("함께 정한 작은 목표","A small shared goal","一緒に決めた小さな目標"),L("목표 합의, 첫 행동, 결과 확인을 차례로 이어간다.","Agree on a goal, take a step, then review.","目標の合意、最初の行動、結果確認を順につなぐ。"),[g("review")]);
  ending("chapter",L("다음 대화의 시작","The next conversation","次の会話の始まり"),L("합의한 첫 행동과 확인한 결과를 남겼다. 더 큰 목표의 완수 여부는 앞으로 이어갈 이야기다.","The agreed first step and its observed results are recorded. The wider goal remains for the next chapter.","合意した最初の行動と確認した結果を記録した。大きな目標は次の物語へ続く。"),[g("review")]);
  ending("pause",L("오늘은 여기까지","Enough for today","今日はここまで"),L("오늘의 대화를 마쳤다. 하지 않은 일은 완료로 기록하지 않는다.","The conversation ends here. Unfinished actions remain unfinished.","今日の会話を終えた。未実行のことは完了にしない。"),[g("closed")]);return d;
}

function enrichSarang(original: Definition): Definition {
  const d=structuredClone(original);d.version=3;d.summary="학교 앞 편의점에서 만난 임사랑과, 각자의 속도로 일상을 나누고 신뢰를 쌓아가는 이야기. 선택한 도움은 준비 단계이며 실제 해결과 구별한다.";
  const labels:Record<string,string>={"respectful-communication":"서로 이해할 방식으로 소통함","share-pudding":"함께 푸딩을 먹기로 함","walk-together":"함께 하굣길 걷기","next-visit":"약속한 날 다시 만남","share-memory":"서로의 이야기 나눔","support-chosen":"함께 도움 요청하기로 함","friendship-chosen":"친구로 이어가기로 함","goodbye":"오늘의 인사","pressure":"불편한 압박"};
  d.events.forEach(e=>{e.label=labels[e.id];e.result=e.label;});
  const onward:Record<string,string>={"sit-together":"창가에 함께 앉아 푸딩을 먹으며 이야기하자.","walk-home":"하굣길을 천천히 함께 걸어가자.","meet-again":"다음 날, 약속한 편의점으로 다시 찾아왔다.","quiet-place":"서로 괜찮다면 조용한 공원 벤치로 가서 이야기를 이어가자.","plan-support":"네가 원하는 도움을 누구에게 어떻게 요청할지 함께 정하자."};
  for(const scene of d.scenes) {
    const old=scene.suggestions;
    scene.choices=old.map((text,i)=>({id:"choice-"+i,text,conditions:[]}));
    const bind=(index:number,actionId:string,conditions:Condition[]=[])=>Object.assign(scene.choices![index],{actionId,conditions});
    if(scene.id==="store"){bind(0,"respectful-communication");bind(2,"share-pudding");}
    if(scene.id==="first-conversation")bind(2,"walk-together",[g("scene-turns",1)]);
    if(scene.id==="school-road"){bind(1,"next-visit",[g("scene-turns",1)]);bind(2,"goodbye");}
    if(scene.id==="next-meeting"){bind(1,"share-memory");scene.choices![2]={id:"quiet",text:old[2],conditions:[],transitionId:"quiet-place",priority:80};}
    if(scene.id==="quiet-conversation"){bind(1,"support-chosen");bind(2,"friendship-chosen");}
    if(scene.id==="support-plan")scene.choices!.push({id:"friend",text:"노트에 앞으로도 친구로서 네 이야기를 듣고 싶다고 적는다.",conditions:[],actionId:"friendship-chosen"});
  }
  // Korean authored presentation; optional translations fall back to the existing UI dictionary.
  d.statusFields=[{id:"connection",label:"관계와 선택",cases:[{text:"함께 도움을 요청할 준비 중",conditions:[g("support-chosen")]},{text:"친구로서 이어가기로 함",conditions:[g("friendship-chosen")]},{text:"서로 알아가는 중",conditions:[]}]}];
  d.scenes.find(s=>s.id==="support-plan")!.choices!.at(-1)!.text="노트에 앞으로도 친구로서 네 이야기를 듣고 싶다고 적는다.";
  for (const transition of d.transitions) d.scenes.find(scene=>scene.id===transition.from)!.choices!.push({id:"onward-"+transition.id,text:onward[transition.id],conditions:[],transitionId:transition.id,priority:100});
  d.plotThreads=[{id:"first-meeting",title:"첫 만남에서 함께 걷기",description:"소통 방식을 맞추고 푸딩을 나눈 뒤 하굣길을 함께 걷는다.",activeWhen:[],resolveWhen:[g("walk-together")],resolution:"첫 인사와 함께 걷는 경험을 나눴다."},{id:"meet-again",title:"다시 만날 수 있다는 것",description:"약속한 날 실제로 다시 만나 대화를 이어간다.",activeWhen:[g("walk-together")],resolveWhen:[g("next-visit")],resolution:"약속한 날 다시 만났다."},{id:"support",title:"혼자 정하지 않아도 되는 일",description:"사랑이 말하고 싶은 만큼 듣고 원하는 도움을 함께 고른다.",activeWhen:[g("shared-memory")],resolveWhen:[g("support-chosen")],resolution:"도움을 요청할 방향을 함께 정했다. 실제 해결은 아직이다."}];
  return d;
}

/** Definitions are authored per work; custom works receive a small, explicit baseline. */
export function withWorldEngine(story: Story): Story {
  if(story.narrative) return story.id==="sarang" && story.narrative.version===2 ? {...story,narrative:enrichSarang(story.narrative)} : story;
  const narrative=story.id==="outer-rim"?outerRim():story.id==="academy"?academy():story.id==="girlfriend"?continueReunion(reunion()):story.id==="radio"?radioWorld():genericWorld(story);
  return {...story,narrative};
}
