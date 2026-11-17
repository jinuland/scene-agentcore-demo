# SCENE · AgentCore 캐릭터 챗 데모

기존 봇팩토리와 다른 포트와 저장소를 쓰는 고객 발표용 데모다. 봇팩토리 작업실이나 운영 사이트를 실행하지 않아도 된다. 채팅은 기존 AWS 계정의 Amazon Bedrock AgentCore Runtime을 호출한다. 설치는 저장소 루트 기준이다.

```sh
npm run demo:character
```

[http://127.0.0.1:4317](http://127.0.0.1:4317) 접속. Node.js 22.13 이상 및 저장소의 npm 의존성이 필요하다. 로컬은 `CHARACTER_DEMO_RUNTIME_ARN`, SCENE 배포 출력, 기존 `.env.local` 설정 순서로 Runtime을 선택한다. SSO 세션이 만료되었으면 `aws sso login --profile game-forge` 후 서버를 재시작한다.

## AWS 배포

SCENE은 서울 리전의 `BotFactorySceneDemo`에 배포한다. CloudFront HTTPS 주소를 열면 게스트 세션이 자동으로 생성된다. CloudFront는 Origin Access Control로 Lambda의 IAM 원본을 호출한다. SCENE 전용 AgentCore Runtime이 Bedrock을 호출하고 DynamoDB가 브라우저별 작품과 회차를 저장한다. 호스팅 데이터는 7일 TTL을 사용한다. 라이브 모델 호출은 서울 날짜 기준 배포당 하루 500턴까지다.

```sh
node scripts/build-scene-demo.mjs
./node_modules/.bin/cdk deploy BotFactorySceneDemo \
  --app './node_modules/.bin/tsx infra/scene-demo-app.ts' \
  --profile game-forge --output .studio/scene-demo-build/cdk \
  --outputs-file outputs/scene-demo-stack.json --require-approval never
```

`outputs/scene-demo-stack.json`의 `DemoUrl`을 고객에게 공유한다. `-c sceneAccess=code`를 추가하면 접속 코드를 입력하는 모드로 배포한다. 양쪽 모드에서 Secrets Manager 값을 세션 쿠키 서명에 쓴다.

다른 AWS 계정에 배포할 소스 ZIP은 저장소 루트에서 `node scripts/package-scene-demo.mjs`로 만든다. 배포 절차는 ZIP의 루트 README에 있다.

## 3분 시연

1. 기본 작품의 상세 화면에서 **예시 대화 보기**를 눌러 작가가 작성한 3턴과 캐릭터 말투를 살펴본다. **대화 시작**을 누르면 별도 회차가 열리며, 아카데미 상태창은 ‘미등록 · D-9’와 신뢰도 0에서 시작한다.
2. **“리에, 내가 재심 준비를 같이 도울게요.”**를 누르거나 “제 이름은 노을이에요. 리에, 내가 재심 준비를 같이 도울게요.”를 보내고 **신뢰도 +1**, **준비 중 · D-9**와 근거를 확인한다. 이 변화는 재심 합격이나 시간 경과를 뜻하지 않는다.
3. 모델을 Claude Haiku 5.5로 바꾸고 “제 이름을 기억해요? 왜 퇴학 대상인지도 알려주세요.”라고 묻는다. 동일 회차에서 이름과 시한이 이어지고, 질문만 하면 신뢰도가 그대로 표시된다. 이미지 보관함은 회차에서 실제로 본 컷을 모은다.
4. **작품 만들기**에서 제목·캐릭터·세계관·첫 대사를 써서 테스트 채팅을 시작한다. 선택 항목인 신뢰도 조건도 직접 적을 수 있다. 새 회차나 다른 작품으로 이동하면 이전 회차의 기억과 상태가 섞이지 않는다.
5. **내 대화**의 **삭제** 또는 채팅 상단의 휴지통 버튼을 누르면 해당 회차의 대화와 상태가 즉시 삭제된다.

## 관찰한 기능과 구현

| 관찰 | 데모 구현 |
| --- | --- |
| 크랙 프롤로그, 역할, 첫 추천 답변 | 작품 카드 → 상세 → 프롤로그 채팅. 선택하거나 자유 입력으로 진행한다. |
| 크랙의 시한·장소·관계 INFO와 숫자 스탯 | 현재 장면·역할·목표·이야기 상태·턴·신뢰도 표시. 판정 모델은 조건 ID와 이번 입력의 근거를 반환한다. 서버가 조건 ID와 발언 일치를 검사해 신뢰도 0~5 범위에서 +1 한다. 관계 수준과 작품 상태는 다음 모델 호출의 맥락에 포함한다. |
| 크랙 상황 이미지와 보관함 | 승인된 후보만 제시하고 반환된 키를 검사한다. 맞는 후보가 없으면 기본 이미지가 유지된다. 표시한 이미지는 턴에 기록한다. |
| 크랙에서 같은 회차로 돌아가거나 대화 설정 변경 | 현재 빌더의 플레이어 모델 13종. 같은 회차에서 모델만 바꾼다. 회차는 새로고침 후 복원한다. |
| 캐릭터 제작 후 테스트 | 제목·세계관·말투/상황·첫 대사·선택 스탯 조건을 저장하고 새 테스트 채팅을 연다. |

브라우저 → 로컬 Node API → 기존 **AgentCore Runtime → Bedrock**. 로컬 SQLite에는 익명 브라우저별 작품과 회차가 저장된다. 각 모델 요청에는 현재 캐릭터, 공식 설정, 최근 6턴, 근거 문구가 확인된 이전 기억을 보낸다. 모델은 대사·행동·추천 답변을 쓰고, 기존 AgentCore의 별도 판정이 스탯 조건과 상황 그림을 판단한다. 숫자·회차·저장 상태는 API가 정한다. 모델 정책은 그대로 적용되며 수위 조절 메뉴는 없다. 운영 시에는 동일한 API 계약에 인증과 DynamoDB 원장을 붙이면 된다.

데모 저장 경로는 `.studio/agentcore-character-demo/demo.sqlite`다. 이 데모에서 한 회차는 최대 24턴이다. 필요한 경우 `CHARACTER_DEMO_PORT`와 `CHARACTER_DEMO_DB`로 별도 실행할 수 있다.

## 작품과 이미지 출처

- **퇴학까지 9일, 내 소환사는 낙제생**: [코기토의 크랙 작품](https://share.crack.wrtn.ai/ptcus73)이 쓰는 소환수 역할, 퇴학 기한과 상태창을 참고했다. [모아봄의 11/10~11/16 집계](https://moabom.kr/contents/contents-c-1116)에서 SA판 주간 최고 1위. 데모 인물·대사·이미지는 별도다.
- **스타워즈: 아우터 림의 마지막 통신**: [StarWars.com 반란군 연합 설정](https://www.starwars.com/databank/rebel-alliance)을 참고한 비공식 팬 에피소드. 캐릭터와 삽화는 이 데모용이다.
- **여자친구 사귀기: 마지막 곡은 네가 골라**: 이 저장소의 성인 재회 로맨스 [원본](../last-record/story.ts)과 삽화를 재사용했다.
- **너와 나만 듣는 트랙**: 이 저장소의 기존 성인 BL [시나리오](../../lib/studio/benchmark-starters.ts)와 작품 아트를 재사용했다.

아카데미·스타워즈 그림은 내장 이미지 생성 도구로 제작해 `web/art/academy-*.webp`, `web/art/outer-cover.webp`로 저장했다. 전자는 황금 소환진과 여우 정령을 마주한 성인 소환사, 후자는 외곽 달 격납고에서 민간 화물선 옆에 서 있는 반란군 조력자를 그리도록 요청했다. 크랙 유저의 원문과 삽화를 고객 데모에 재게시하지 않았다.

## 현장 검증 · 2026-11-18

실제 AWS Runtime으로 네 작품에서 응답을 받았다. 아카데미에서는 GPT-6 Luna의 협력 제안으로 신뢰도 0→1, Claude Haiku 5.5로 바꾼 뒤 이름 회상·D-9 유지, 새로고침 후 2턴 복원을 확인했다. 모바일 상태창, 이미지 보관함, 새 캐릭터의 첫 실제 답변도 브라우저에서 확인했다. 모델 13종 모두 최소 한 번 실제 응답을 확인했다. Nova 2 Lite와 Gemma 4 31B는 재심 질문에서 출력 형식 오류가 있었으나 짧은 인사에는 응답했다. 발표 첫 모델은 기본값인 GPT-6 Luna를 권한다.

## 배포판의 모델 호출

브라우저 → CloudFront → Lambda 웹 API → 전용 AgentCore Node.js Runtime → Bedrock 모델. Lambda가 DynamoDB에서 회차를 읽고 답변을 저장한다. AgentCore는 모델에 작품 설정, 최근 대화와 확인된 기억을 전달하고 결과를 검증한다.

Grok 4.3, Gemma 3종, Nova 2 Lite의 대사는 일반 텍스트로 받는다. Claude와 GPT 계열은 `story_result` 함수 스키마로 답변 JSON을 받고, Grok 4.7은 JSON Schema를 사용한다. `story_result`의 결과를 애플리케이션에서 읽어 검증한다. 모델에 검색, 외부 API, DB 접근이나 함수를 실행할 권한은 없다. 상태 판정용 Haiku 5.5는 별도로 호출하며, 현재 입력과 작가가 정의한 조건에서 근거를 뽑는다.

Grok 4.3은 `reasoning_effort: "none"`이다. 배포판에서 추론 토큰은 측정한 모든 Grok 4.3 요청에서 0개였고, 네 번의 HTTP 요청은 2.3~5.4초였다. 협력 제안 턴에서 Bedrock 대사 생성은 0.8초, 병렬 Haiku 판정은 4.2초였다. 기본 작품의 단순 인사와 이름 질문에서는 판정을 건너뛴다. Gemma 31B는 세 질문에서 정상 대사를 냈다. E2B는 답변 형식을 개선했지만 배포 검증 중 한 건은 응답 제한 시간에 걸렸고 같은 질문으로 두 번 재검사할 때는 응답했다.
