# SCENE · AWS deployment guide

[한국어](README.md) · [English](readme_en.md)

[Download deployment source ZIP](https://github.com/jinuland/scene-agentcore-demo/raw/refs/heads/main/downloads/scene-aws-deploy.zip)

SCENE is a character chat demo built with Amazon Bedrock AgentCore. The repository includes the web app, Lambda API, AgentCore Runtime, story artwork, CDK infrastructure, and a dependency lockfile. Each of the five built-in stories includes a three-turn conversation preview. **My Chats** lists episodes started in the current browser.

[English demo](https://d3ib5121x21g7w.cloudfront.net/?lang=en) · [日本語デモ](https://d3ib5121x21g7w.cloudfront.net/?lang=ja) · [한국어 데모](https://d3ib5121x21g7w.cloudfront.net/?lang=ko)

The language selector applies to the interface, the built-in stories and sample dialogue, and new model replies. Previously saved messages and user-authored story text are displayed in their original language.

## Prerequisites

- Node.js 22.13 or later and npm
- An authenticated AWS CLI profile for the target AWS account
- The default deployment region is Seoul (ap-northeast-2). The application calls Bedrock Runtime global inference profiles from Seoul and Bedrock Mantle from Northern Virginia (us-east-1).
- Enable access to the Bedrock models you plan to use in the target account. An account using Anthropic models for the first time may need to submit use case details. [Amazon Bedrock model access](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)

## Deploy

Clone the repository or extract the deployment ZIP, then run these commands from the project root. Replace customer-demo with your AWS CLI profile name.

~~~sh
npm ci
aws sts get-caller-identity --profile customer-demo

scene_account="$(aws sts get-caller-identity --profile customer-demo --query Account --output text)"
npx cdk bootstrap "aws://$scene_account/ap-northeast-2" --profile customer-demo

npm run deploy -- --profile customer-demo
~~~

Skip the bootstrap step if CDK has already been bootstrapped in the target account and region. [AWS CDK bootstrapping](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html)

After deployment, share **DemoUrl** from the CDK output or **outputs/scene-demo-stack.json**. CloudFront propagation can take a few minutes. Visitors can pick a story and start chatting as guests. A signed browser cookie keeps each guest's stories and episodes separate. The public demo allows 500 model turns per deployment each day, using the Seoul calendar date, and 24 turns per episode. DynamoDB uses a seven-day TTL for saved episodes and stories.

To require an access code, deploy with this command.

~~~sh
npm run deploy -- --profile customer-demo -c sceneAccess=code
~~~

In code mode, the CloudFormation output **AccessSecretArn** points to the access code in AWS Secrets Manager. The application uses the same secret to sign session cookies in either mode.

To synthesize the CloudFormation template or run the demo locally, use the commands below. The local demo uses the Runtime ARN in the deployment output and your AWS CLI credentials.

~~~sh
npm run synth -- --profile customer-demo
AWS_PROFILE=customer-demo npm run demo:character
~~~

## Architecture

![SCENE AWS architecture. Requests flow from the browser through CloudFront, Lambda, and AgentCore Runtime to Bedrock. Lambda stores episodes in DynamoDB.](docs/scene-aws-architecture-en.png)

CloudFront uses Origin Access Control to call the IAM-protected Lambda Function URL. Lambda serves the app and reads and writes stories, messages, and episode state in DynamoDB. The Node.js runtime on AgentCore sends story rules and conversation context to Amazon Bedrock, then validates the dialogue and state decisions returned by the models. [Restrict access to Lambda origins with CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)

See the [demo notes in Korean](examples/agentcore-character-demo/README.md) for story and artwork credits and details about the model calls.

## Story graph and episode state

The new story **If the Day Comes When I Like People Again** includes a cover, scene illustration, four-panel prologue comic and three sample exchanges. Its public setting and introduction are reused with permission from the original work by 냥치기 on Crack. New artwork was generated using the authorized original as a reference. The original private rules were not supplied; this demo defines its own six scenes and three endings.

The authored definition is in `examples/agentcore-character-demo/sarang-story.ts`, and the reusable engine is in `lib/platform/narrative-graph.ts`. Graphology builds an in-memory graph of Scene, Fact, Action, Counter, Transition, Gate and Ending nodes, linked by ALLOWS, CHANGES, REQUIRES, READS and OPENS edges. Only facts whose gates pass are sent to the dialogue model. The story progresses from the store meeting through a window-seat conversation, a walk, a next-day reunion, a park conversation and a support plan. Transitions combine affection (0–200%), communication counts, one-time events, minimum scene turns and the player's expressed intent. The endings are “Until next time”, “At our own pace” and “A new step”.

Each turn runs **Haiku input interpretation → deterministic graph update → selected dialogue model → persistence**. The interpreter selects authored action/transition IDs with exact evidence from the current message. Code calculates counters, time, movement and endings. There is no additional LLM review or regeneration pass. The API replays the proposed state with the same rules and commits the dialogue and state under the existing episode lock. Failed turns do not advance saved progress.

Each episode pins its definition and release hash and stores its scene, clock, counters and event/transition history. The in-memory graph is reconstructed from this durable snapshot on the next request. Cloud deployments store it in DynamoDB; the local web API uses SQLite WAL in its own data directory, rather than the AgentCore temporary filesystem. Shared-room UI, automatic graph authoring from free text and embedding-based memory search are outside this demo. The graph and the recent dialogue/evidence memories passed to the model are separate data.

The status panel shows date, story day, scene, affection and next-scene requirements. **View timings** shows interpretation, graph calculation and dialogue generation times. AgentCore response wait includes model execution and overlaps the other stages. Ended episodes remain readable; starting a new episode allows different choices.

Run `npm test` in the deployment package to check gates, counter bounds, all three reachable endings, deterministic state replay, release identity after JSON decoding, SQLite restoration and owner-scoped deletion.

## Verification · 2026-11-20

- All 35 regression checks passed. A separate installation from the ZIP passed nine graph tests and the build. State verification accepts DynamoDB map key reordering while rejecting altered counters or event history.
- A local Runtime HTTP test using real Bedrock models reached all six scenes and the “A new step” ending in 12 exchanges. Automated tests also cover reachability of the other two endings.
- The public deployment returned usable replies with GPT-6 Luna, Grok 4.3, Claude Haiku 5.5, Gemma 4 31B and Gemma 4 E2B, and restored saved episodes. English and Japanese responses and UI were checked. This new-story test does not guarantee dialogue quality for all 13 selectable models.
- Two browser exchanges using Grok 4.3 took 5.0 and 6.4 seconds. Affection advanced 10→14→22, the scene moved to the window seats, and a reload restored both exchanges and state. Test episodes were deleted. Timing varies with the model and cold starts.
