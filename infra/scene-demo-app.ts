import * as cdk from "aws-cdk-lib";
import * as agentcore from "aws-cdk-lib/aws-bedrockagentcore";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secrets from "aws-cdk-lib/aws-secretsmanager";
import * as sources from "aws-cdk-lib/aws-lambda-event-sources";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { mantleDialogueModels, mantleRegionSchema, playerDialogueModels } from "../lib/platform/dialogue-modes";

const app = new cdk.App();
const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.SCENE_AWS_REGION ?? "ap-northeast-2";
const modelId = "global.anthropic.claude-sonnet-4-6";
const mantleRegion = mantleRegionSchema.parse("us-east-1");
const gpuRoleName=app.node.tryGetContext("sceneGpuRole") as string|undefined;
const gpuEnabled=!!gpuRoleName&&app.node.tryGetContext("sceneGpuEnabled")==="true";
const access = app.node.tryGetContext("sceneAccess") ?? "public";
if (!account || !/^\d{12}$/.test(account)) throw new Error("Configure AWS credentials and run CDK with the target account's profile.");
if (access !== "public" && access !== "code") throw new Error("sceneAccess must be public or code.");
const stack = new cdk.Stack(app, "BotFactorySceneDemo", { env: { account, region } });
cdk.Tags.of(stack).add("Project", "BotFactorySceneDemo");

const runtime = new agentcore.Runtime(stack, "CharacterRuntime", {
  runtimeName: "bot_factory_scene_demo",
  description: "SCENE hosted demo and character-turn model quality checks",
  agentRuntimeArtifact: agentcore.AgentRuntimeArtifact.fromCodeAsset({
    path: ".studio/scene-demo-build/runtime",
    runtime: agentcore.AgentCoreRuntime.NODE_22,
    entrypoint: ["server.js"],
  }),
  networkConfiguration: agentcore.RuntimeNetworkConfiguration.usingPublicNetwork(),
  environmentVariables: {
    SCENE_DEMO_RUNTIME: "true",
    STUDIO_AWS_AUTH: "iam",
    STUDIO_BEDROCK_REGION: region,
    STUDIO_BEDROCK_MODEL_ID: modelId,
    STUDIO_MULTI_MODEL_CHAT: "true",
    STUDIO_MANTLE_CHAT_REGION: mantleRegion,
  },
  lifecycleConfiguration: { idleRuntimeSessionTimeout: cdk.Duration.minutes(5), maxLifetime: cdk.Duration.minutes(30) },
});
const runtimeResource = runtime.node.defaultChild;
if (!(runtimeResource instanceof agentcore.CfnRuntime)) throw new Error("AgentCore runtime CDK resource changed");
runtimeResource.platformVersion = "V2";

runtime.grantPrincipal.addToPrincipalPolicy(new iam.PolicyStatement({
  actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
  resources: [
    `arn:${stack.partition}:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6`,
    `arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/${modelId}`,
    ...playerDialogueModels.filter(option => !option.legacy && option.transport !== "mantle").flatMap(option => [
      `arn:${stack.partition}:bedrock:*::foundation-model/${option.foundationModel}`,
      `arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/${option.modelId}`,
    ]),
  ],
}));
runtime.grantPrincipal.addToPrincipalPolicy(new iam.PolicyStatement({
  actions: ["bedrock-mantle:CreateInference"],
  resources: [`arn:${stack.partition}:bedrock-mantle:${mantleRegion}:${stack.account}:project/default`],
  conditions: { StringEquals: { "bedrock-mantle:Model": mantleDialogueModels(mantleRegion).filter(option => !option.legacy).map(option => option.modelId) } },
}));

const data = new dynamodb.Table(stack, "DemoData", {
  partitionKey: { name: "owner", type: dynamodb.AttributeType.STRING },
  sortKey: { name: "record", type: dynamodb.AttributeType.STRING },
  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
  encryption: dynamodb.TableEncryption.AWS_MANAGED,
  timeToLiveAttribute: "expires",
  stream: dynamodb.StreamViewType.KEYS_ONLY,
  removalPolicy: cdk.RemovalPolicy.DESTROY,
});
const projectionFailures = new sqs.Queue(stack, "ProjectionFailures", { retentionPeriod: cdk.Duration.days(14) });
const projector = new lambda.Function(stack, "GraphProjector", {
  runtime: lambda.Runtime.NODEJS_24_X,
  code: lambda.Code.fromAsset(".studio/scene-demo-build/projector"), handler: "index.handler",
  timeout: cdk.Duration.seconds(30), memorySize: 512,
  environment: { CHARACTER_DEMO_TABLE: data.tableName },
  logGroup: new logs.LogGroup(stack, "ProjectionLogs", { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.DESTROY }),
});
data.grant(projector, "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem", "dynamodb:ConditionCheckItem");
projector.addEventSource(new sources.DynamoEventSource(data, {
  startingPosition: lambda.StartingPosition.TRIM_HORIZON, batchSize: 10,
  retryAttempts: 5, bisectBatchOnError: true, reportBatchItemFailures: true,
  onFailure: new sources.SqsDlq(projectionFailures),
  filters: [lambda.FilterCriteria.filter({ dynamodb: { Keys: { record: { S: lambda.FilterRule.beginsWith("episode#") } } } })],
}));
const creatorMedia = new s3.Bucket(stack,"CreatorMedia",{blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,encryption:s3.BucketEncryption.S3_MANAGED,enforceSSL:true,lifecycleRules:[{expiration:cdk.Duration.days(8)}],removalPolicy:cdk.RemovalPolicy.DESTROY});
const secret = new secrets.Secret(stack, "DemoAccess", {
  generateSecretString: { passwordLength: 16, excludePunctuation: true },
});
const logGroup = new logs.LogGroup(stack, "WebLogs", { retention: logs.RetentionDays.ONE_WEEK, removalPolicy: cdk.RemovalPolicy.DESTROY });
const web = new lambda.Function(stack, "SceneWeb", {
  runtime: lambda.Runtime.NODEJS_24_X,
  code: lambda.Code.fromAsset(".studio/scene-demo-build/web"),
  handler: "index.handler",
  timeout: cdk.Duration.seconds(120),
  memorySize: 512,
  reservedConcurrentExecutions: 10,
  logGroup,
  environment: {
    STUDIO_AWS_AUTH: "iam",
    CHARACTER_DEMO_GPU_ENABLED:String(gpuEnabled),
    CHARACTER_DEMO_TABLE: data.tableName,
    CHARACTER_DEMO_MEDIA_BUCKET: creatorMedia.bucketName,
    CHARACTER_DEMO_ACCESS_CODE: secret.secretValue.unsafeUnwrap(),
    CHARACTER_DEMO_PUBLIC_ACCESS: String(access === "public"),
    CHARACTER_DEMO_RUNTIME_ARN: runtime.agentRuntimeArn,
    STUDIO_MULTI_MODEL_CHAT: "true",
    STUDIO_MANTLE_CHAT_REGION: mantleRegion,
  },
});
creatorMedia.grantReadWrite(web,"creator/*");
creatorMedia.grantReadWrite(web,"creator-jobs/*");
if(gpuRoleName){const gpuRole=iam.Role.fromRoleName(stack,"ExistingCreatorGpuRole",gpuRoleName);creatorMedia.grantReadWrite(gpuRole,"creator/*");creatorMedia.grantReadWrite(gpuRole,"creator-jobs/*");}
web.addToRolePolicy(new iam.PolicyStatement({actions:["bedrock:InvokeModel"],resources:[`arn:${stack.partition}:bedrock:*::foundation-model/anthropic.claude-sonnet-4-6`,`arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/global.anthropic.claude-sonnet-4-6`]}));
web.addToRolePolicy(new iam.PolicyStatement({actions:["bedrock:InvokeModel","bedrock:InvokeModelWithResponseStream"],resources:[`arn:${stack.partition}:bedrock:*::foundation-model/anthropic.claude-opus-5-5`,`arn:${stack.partition}:bedrock:${stack.region}:${stack.account}:inference-profile/global.anthropic.claude-opus-5-5`,`arn:${stack.partition}:bedrock:*::foundation-model/amazon.nova-2-lite-v1:0`,`arn:${stack.partition}:bedrock:us-east-1:${stack.account}:inference-profile/us.amazon.nova-2-lite-v1:0`]}));
web.addToRolePolicy(new iam.PolicyStatement({actions:["bedrock:InvokeTool"],resources:[`arn:${stack.partition}:bedrock::${stack.account}:system-tool/amazon.nova_grounding`]}));
data.grant(web, "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Query", "dynamodb:UpdateItem", "dynamodb:DeleteItem");
web.addToRolePolicy(new iam.PolicyStatement({
  actions: ["bedrock-agentcore:InvokeAgentRuntime"],
  resources: [runtime.agentRuntimeArn, `${runtime.agentRuntimeArn}/runtime-endpoint/DEFAULT`],
}));
const authorFailures=new sqs.Queue(stack,'AuthorFailures',{retentionPeriod:cdk.Duration.days(7)});
const authorQueue=new sqs.Queue(stack,'AuthorQueue',{visibilityTimeout:cdk.Duration.minutes(5),deadLetterQueue:{queue:authorFailures,maxReceiveCount:3}});
const authorWorker=new lambda.Function(stack,'AuthorWorker',{runtime:lambda.Runtime.NODEJS_24_X,code:lambda.Code.fromAsset('.studio/scene-demo-build/author'),handler:'index.handler',timeout:cdk.Duration.minutes(4),memorySize:1024,reservedConcurrentExecutions:3,environment:{STUDIO_AWS_AUTH:'iam',CHARACTER_DEMO_TABLE:data.tableName,CHARACTER_DEMO_AUTHOR_QUEUE:authorQueue.queueUrl},logGroup:new logs.LogGroup(stack,'AuthorLogs',{retention:logs.RetentionDays.ONE_WEEK,removalPolicy:cdk.RemovalPolicy.DESTROY})});
authorWorker.addEventSource(new sources.SqsEventSource(authorQueue,{batchSize:1}));
authorQueue.grantSendMessages(authorWorker);authorQueue.grantSendMessages(web);
web.addEnvironment('CHARACTER_DEMO_AUTHOR_QUEUE',authorQueue.queueUrl);
data.grant(authorWorker,'dynamodb:GetItem','dynamodb:PutItem','dynamodb:Query','dynamodb:UpdateItem');
for(const model of ['anthropic.claude-opus-5-5','anthropic.claude-sonnet-5-5','amazon.nova-2-lite-v1:0'])authorWorker.addToRolePolicy(new iam.PolicyStatement({actions:['bedrock:InvokeModel','bedrock:InvokeModelWithResponseStream'],resources:[`arn:${stack.partition}:bedrock:*::foundation-model/${model}`,`arn:${stack.partition}:bedrock:${model.startsWith('amazon.')?'us-east-1':stack.region}:${stack.account}:inference-profile/${model.startsWith('amazon.')?'us':'global'}.${model}`]}));
authorWorker.addToRolePolicy(new iam.PolicyStatement({actions:['bedrock:InvokeTool'],resources:[`arn:${stack.partition}:bedrock::${stack.account}:system-tool/amazon.nova_grounding`]}));
for(const actor of [web,authorWorker])actor.addToRolePolicy(new iam.PolicyStatement({actions:['bedrock-mantle:CreateInference'],resources:[`arn:${stack.partition}:bedrock-mantle:us-east-1:${stack.account}:project/default`],conditions:{StringEquals:{'bedrock-mantle:Model':'xai.grok-4.3'}}}));
new cdk.CfnOutput(stack,'AuthorQueueUrl',{value:authorQueue.queueUrl});
new cdk.CfnOutput(stack,'AuthorWorkerName',{value:authorWorker.functionName});
const url = web.addFunctionUrl({ authType: lambda.FunctionUrlAuthType.AWS_IAM, invokeMode: lambda.InvokeMode.RESPONSE_STREAM });
// The origin request uses the Lambda hostname for SigV4. Save the actual
// viewer hostname in a header CloudFront overwrites before forwarding.
const viewerHost = new cloudfront.Function(stack, "ViewerHost", {
  code: cloudfront.FunctionCode.fromInline(`
    function handler(event) {
      var request = event.request;
      request.headers["x-scene-viewer-host"] = { value: request.headers.host.value };
      return request;
    }
  `),
});
const distribution = new cloudfront.Distribution(stack, "SceneDistribution", {
  comment: "SCENE AgentCore character chat demo",
  priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
  defaultBehavior: {
    origin: origins.FunctionUrlOrigin.withOriginAccessControl(url, { readTimeout: cdk.Duration.seconds(60) }),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    functionAssociations: [{ eventType: cloudfront.FunctionEventType.VIEWER_REQUEST, function: viewerHost }],
  },
  errorResponses: [403, 404, 500, 502, 503, 504].map(httpStatus => ({ httpStatus, ttl: cdk.Duration.seconds(0) })),
});
new lambda.CfnPermission(stack, "InvokeOnlyFromSceneDistribution", {
  functionName: web.functionName,
  action: "lambda:InvokeFunction",
  principal: "cloudfront.amazonaws.com",
  sourceArn: `arn:${stack.partition}:cloudfront::${stack.account}:distribution/${distribution.distributionId}`,
  invokedViaFunctionUrl: true,
});
new cdk.CfnOutput(stack, "DemoUrl", { value: `https://${distribution.distributionDomainName}/` });
new cdk.CfnOutput(stack, "DistributionId", { value: distribution.distributionId });
new cdk.CfnOutput(stack, "AccessSecretArn", { value: secret.secretArn });
new cdk.CfnOutput(stack, "AgentRuntimeArn", { value: runtime.agentRuntimeArn });
new cdk.CfnOutput(stack, "WebLogGroup", { value: logGroup.logGroupName });
new cdk.CfnOutput(stack, "DataTableName", { value: data.tableName });
new cdk.CfnOutput(stack, "GraphProjectorName", { value: projector.functionName });

new cdk.CfnOutput(stack,"CreatorMediaBucket",{value:creatorMedia.bucketName});
