# SCENE · AWS 배포 패키지

[한국어](README.md) · [English](readme_en.md)

이 프로젝트에는 공개 캐릭터 챗 데모의 웹 화면, Lambda API, AgentCore Runtime, 작품 이미지, CDK 코드와 의존성 잠금 파일이 들어 있습니다. 기본 작품 네 개의 상세 화면에서 예시 대화 3턴을 볼 수 있습니다. 내 대화에는 브라우저에서 실제로 시작한 회차만 표시됩니다.

[한국어 데모](https://d3ib5121x21g7w.cloudfront.net/?lang=ko) · [English demo](https://d3ib5121x21g7w.cloudfront.net/?lang=en) · [日本語デモ](https://d3ib5121x21g7w.cloudfront.net/?lang=ja)

언어 메뉴를 바꾸면 화면, 기본 작품과 예시 대화, 새 모델 응답에 선택한 언어가 적용됩니다. 이미 저장된 메시지와 직접 작성한 작품은 입력된 언어로 표시됩니다.

## 준비

- Node.js 22.13 이상과 npm
- 사용할 AWS 계정에 로그인한 AWS CLI 프로필
- 기본 배포 리전은 서울(ap-northeast-2)입니다. 서울에서 Bedrock Runtime 글로벌 추론 프로파일을 호출하고, Bedrock Mantle은 미국 버지니아 북부(us-east-1)에서 호출합니다.
- 대상 계정에서 사용하려는 Bedrock 모델에 대한 접근을 활성화하세요. Anthropic을 처음 사용하는 계정은 사용 사례 등록이 필요할 수 있습니다. [Amazon Bedrock 모델 접근](https://docs.aws.amazon.com/bedrock/latest/userguide/model-access.html)

## 배포

저장소를 클론하거나 배포 ZIP을 푼 디렉터리에서 실행합니다. 아래의 customer-demo를 자신의 AWS CLI 프로필로 바꾸세요.

~~~sh
npm ci
aws sts get-caller-identity --profile customer-demo

scene_account="$(aws sts get-caller-identity --profile customer-demo --query Account --output text)"
npx cdk bootstrap "aws://$scene_account/ap-northeast-2" --profile customer-demo

npm run deploy -- --profile customer-demo
~~~

대상 리전에 CDK 부트스트랩이 되어 있으면 bootstrap 단계는 건너뛸 수 있습니다. [AWS CDK 부트스트랩](https://docs.aws.amazon.com/cdk/v2/guide/bootstrapping-env.html)

배포가 끝나면 CDK 출력과 **outputs/scene-demo-stack.json**의 **DemoUrl**을 공유하세요. CloudFront 주소 전파에 몇 분이 걸릴 수 있습니다. 처음 접속한 브라우저에서 작품을 골라 바로 시작할 수 있습니다. 브라우저마다 서명된 세션 쿠키로 작품과 회차를 구분합니다. 공개 데모의 모델 호출 한도는 서울 날짜 기준 전체 하루 500턴이고, 한 회차는 24턴입니다. 저장된 대화와 작품은 DynamoDB의 7일 TTL로 만료됩니다.

접속 코드가 필요한 배포는 다음 명령을 사용합니다.

~~~sh
npm run deploy -- --profile customer-demo -c sceneAccess=code
~~~

코드 모드에서 CloudFormation 출력 **AccessSecretArn**은 AWS Secrets Manager의 입장 코드 항목을 가리킵니다. 공개 모드에서도 이 값은 세션 쿠키 서명에 사용됩니다.

~~~sh
npm run synth -- --profile customer-demo
AWS_PROFILE=customer-demo npm run demo:character
~~~

synth는 소스 번들을 만들고 CloudFormation 템플릿을 생성합니다. 로컬 데모는 배포 출력의 Runtime ARN과 AWS CLI 자격 증명을 사용합니다.

## 아키텍처

![SCENE AWS 아키텍처. 브라우저에서 CloudFront, Lambda, AgentCore Runtime, Bedrock으로 이어지고 Lambda가 DynamoDB에 회차를 저장합니다.](docs/scene-aws-architecture.png)

브라우저 → CloudFront → Lambda Function URL → AgentCore Node.js Runtime → Amazon Bedrock. CloudFront가 Origin Access Control로 Lambda의 IAM 원본을 호출합니다. Lambda가 DynamoDB에서 작품·대화·상태를 조회하고 저장합니다. AgentCore가 작품 설정과 대화 문맥을 모델에 보내고 문장과 상태 판정 결과를 받습니다. [CloudFront에서 Lambda 원본 보호](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-lambda.html)

카탈로그의 작품과 삽화 출처, 모델 호출 형태는 [데모 설명](examples/agentcore-character-demo/README.md)에 있습니다.
