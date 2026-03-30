import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambda_nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

/** Create this secret in AWS Secrets Manager before calling the API (see DEPLOY.md). */
export const FISH_AUDIO_SECRET_NAME = "medimade/FISH_AUDIO_API_KEY";
/** Anthropic API key for Claude (Haiku) chat in the create flow. */
export const CLAUDE_SECRET_NAME = "medimade/CLAUDE_API_KEY";

export class MedimadeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const fishApiKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "FishAudioApiKey",
      FISH_AUDIO_SECRET_NAME,
    );

    const claudeApiKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "ClaudeApiKey",
      CLAUDE_SECRET_NAME,
    );

    // Storage for generated MP3s, served via CloudFront (streaming-friendly).
    const mediaBucket = new s3.Bucket(this, "MediaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const mediaOai = new cloudfront.OriginAccessIdentity(this, "MediaOAI");
    // Grant CloudFront permission to read from the private bucket.
    mediaBucket.grantRead(mediaOai);

    const mediaDistribution = new cloudfront.Distribution(
      this,
      "MediaDistribution",
      {
        defaultBehavior: {
          origin: new origins.S3Origin(mediaBucket, {
            originAccessIdentity: mediaOai,
          }),
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      },
    );

    const fishTts = new lambda_nodejs.NodejsFunction(this, "FishTtsFunction", {
      entry: path.join(__dirname, "../lambdas/fish-tts.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      environment: {
        FISH_AUDIO_SECRET_ARN: fishApiKeySecret.secretArn,
      },
    });
    fishApiKeySecret.grantRead(fishTts);

    const claudeChat = new lambda_nodejs.NodejsFunction(this, "ClaudeChatFunction", {
      entry: path.join(__dirname, "../lambdas/claude-chat.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      environment: {
        CLAUDE_SECRET_ARN: claudeApiKeySecret.secretArn,
      },
    });
    claudeApiKeySecret.grantRead(claudeChat);

    const claudeChatUrl = claudeChat.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
      cors: {
        allowedOrigins: ["*"],
        // Lambda URL CORS AllowMethods must be GET|PUT|HEAD|POST|PATCH|DELETE|* — not OPTIONS.
        // Preflight OPTIONS is still answered by Lambda when CORS is configured.
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ["content-type"],
      },
    });

    // addFunctionUrl only adds lambda:InvokeFunctionUrl. Since Oct 2025, public URLs also require
    // lambda:InvokeFunction with InvokedViaFunctionUrl or browsers get 403 Forbidden.
    const chatUrlInvokeFn = new lambda.CfnPermission(
      this,
      "ClaudeChatPublicInvokeFunction",
      {
        action: "lambda:InvokeFunction",
        functionName: claudeChat.functionName,
        principal: "*",
      },
    );
    chatUrlInvokeFn.addPropertyOverride("InvokedViaFunctionUrl", true);

    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: "medimade-api",
      corsPreflight: {
        allowHeaders: ["Content-Type", "Authorization"],
        allowMethods: [
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowOrigins: ["*"],
        maxAge: cdk.Duration.days(1),
      },
    });

    httpApi.addRoutes({
      path: "/fish/tts",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        "FishTtsIntegration",
        fishTts,
      ),
    });

    const meditationAudio = new lambda_nodejs.NodejsFunction(
      this,
      "MeditationAudioFunction",
      {
        entry: path.join(__dirname, "../lambdas/generate-meditation-audio.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(180),
        memorySize: 1024,
        environment: {
          CLAUDE_SECRET_ARN: claudeApiKeySecret.secretArn,
          FISH_AUDIO_SECRET_ARN: fishApiKeySecret.secretArn,
          MEDIA_BUCKET_NAME: mediaBucket.bucketName,
          MEDIA_CLOUDFRONT_DOMAIN: mediaDistribution.domainName,
        },
      },
    );
    claudeApiKeySecret.grantRead(meditationAudio);
    fishApiKeySecret.grantRead(meditationAudio);
    mediaBucket.grantPut(meditationAudio);

    httpApi.addRoutes({
      path: "/meditation/audio",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        "MeditationAudioIntegration",
        meditationAudio,
      ),
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
    });
    new cdk.CfnOutput(this, "FishTtsUrl", {
      value: `${httpApi.apiEndpoint}/fish/tts`,
    });
    new cdk.CfnOutput(this, "MedimadeChatUrl", {
      description:
        "Lambda Function URL (response streaming) for POST chat — set NEXT_PUBLIC_MEDIMADE_CHAT_URL",
      value: claudeChatUrl.url,
    });
    new cdk.CfnOutput(this, "FishAudioSecretName", {
      description: "Put your Fish Audio API key as the secret string value",
      value: FISH_AUDIO_SECRET_NAME,
    });
    new cdk.CfnOutput(this, "ClaudeSecretName", {
      description: "Put your Anthropic API key as the secret string value",
      value: CLAUDE_SECRET_NAME,
    });
    new cdk.CfnOutput(this, "MediaCloudFrontDomain", {
      value: mediaDistribution.domainName,
    });
  }
}
