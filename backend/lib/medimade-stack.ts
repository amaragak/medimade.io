import * as fs from "fs";
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
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import { LayerVersion } from "aws-cdk-lib/aws-lambda";
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

    const meditationAnalyticsTable = new dynamodb.Table(
      this,
      "MeditationAnalyticsTable",
      {
        partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    // ffmpeg: Fish TTS proxy loudnorm + meditation bed mixing (account-local layer).
    const ffmpegLayer = LayerVersion.fromLayerVersionArn(
      this,
      "FfmpegLayer",
      "arn:aws:lambda:ap-southeast-2:382309212161:layer:serverlessrepo-soundws-audio-tools-lambda-layer-LambdaLayer:1",
    );

    // Background-audio ingest: S3 trigger normalizes uploads from background-audio-raw/ into background-audio/
    const bgAudioNormalize = new lambda_nodejs.NodejsFunction(this, "BgAudioNormalizeFunction", {
      entry: path.join(__dirname, "../lambdas/bg-audio-normalize.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      layers: [ffmpegLayer],
      environment: {
        MEDIA_BUCKET_NAME: mediaBucket.bucketName,
      },
    });
    mediaBucket.grantReadWrite(bgAudioNormalize);
    mediaBucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(bgAudioNormalize),
      { prefix: "background-audio-raw/" },
    );

    const fishTts = new lambda_nodejs.NodejsFunction(this, "FishTtsFunction", {
      entry: path.join(__dirname, "../lambdas/fish-tts.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(60),
      memorySize: 512,
      layers: [ffmpegLayer],
      environment: {
        FISH_AUDIO_SECRET_ARN: fishApiKeySecret.secretArn,
        FISH_TTS_MODEL: "s2-pro",
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
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PATCH,
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

    const meditationJobsTable = new dynamodb.Table(this, "MeditationJobsTable", {
      partitionKey: { name: "jobId", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const meditationAudioWorker = new lambda_nodejs.NodejsFunction(
      this,
      "MeditationAudioWorkerFunction",
      {
        entry: path.join(__dirname, "../lambdas/generate-meditation-audio.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(180),
        memorySize: 1024,
        layers: [ffmpegLayer],
        environment: {
          CLAUDE_SECRET_ARN: claudeApiKeySecret.secretArn,
          FISH_AUDIO_SECRET_ARN: fishApiKeySecret.secretArn,
          MEDIA_BUCKET_NAME: mediaBucket.bucketName,
          MEDIA_CLOUDFRONT_DOMAIN: mediaDistribution.domainName,
          MEDIMADE_API_URL: httpApi.apiEndpoint,
          MEDITATION_ANALYTICS_TABLE_NAME: meditationAnalyticsTable.tableName,
          MEDITATION_JOBS_TABLE_NAME: meditationJobsTable.tableName,
          FISH_TTS_MODEL: "s2-pro",
          // Speech rate for Fish TTS; 1 = normal speed.
          SPEECH_SPEED: "1",
        },
      },
    );
    claudeApiKeySecret.grantRead(meditationAudioWorker);
    fishApiKeySecret.grantRead(meditationAudioWorker);
    mediaBucket.grantPut(meditationAudioWorker);
    mediaBucket.grantRead(meditationAudioWorker);
    meditationAnalyticsTable.grantWriteData(meditationAudioWorker);
    meditationJobsTable.grantReadWriteData(meditationAudioWorker);

    const createMeditationJob = new lambda_nodejs.NodejsFunction(
      this,
      "CreateMeditationJobFunction",
      {
        entry: path.join(__dirname, "../lambdas/create-meditation-job.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment: {
          MEDITATION_JOBS_TABLE_NAME: meditationJobsTable.tableName,
          WORKER_FUNCTION_NAME: meditationAudioWorker.functionName,
        },
      },
    );
    meditationJobsTable.grantReadWriteData(createMeditationJob);
    meditationAudioWorker.grantInvoke(createMeditationJob);

    const getMeditationJob = new lambda_nodejs.NodejsFunction(
      this,
      "GetMeditationJobFunction",
      {
        entry: path.join(__dirname, "../lambdas/get-meditation-job.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment: {
          MEDITATION_JOBS_TABLE_NAME: meditationJobsTable.tableName,
        },
      },
    );
    meditationJobsTable.grantReadData(getMeditationJob);

    httpApi.addRoutes({
      path: "/meditation/audio/jobs",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        "CreateMeditationJobIntegration",
        createMeditationJob,
      ),
    });

    httpApi.addRoutes({
      path: "/meditation/audio/jobs/{jobId}",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "GetMeditationJobIntegration",
        getMeditationJob,
      ),
    });

    const analyticsList = new lambda_nodejs.NodejsFunction(
      this,
      "AnalyticsListFunction",
      {
        entry: path.join(__dirname, "../lambdas/analytics-list.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(15),
        memorySize: 256,
        environment: {
          MEDITATION_ANALYTICS_TABLE_NAME: meditationAnalyticsTable.tableName,
        },
      },
    );
    meditationAnalyticsTable.grantReadData(analyticsList);

    httpApi.addRoutes({
      path: "/analytics/meditations",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "AnalyticsMeditationsListIntegration",
        analyticsList,
      ),
    });

    const libraryList = new lambda_nodejs.NodejsFunction(
      this,
      "LibraryListFunction",
      {
        entry: path.join(__dirname, "../lambdas/library-list.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
        environment: {
          MEDITATION_ANALYTICS_TABLE_NAME: meditationAnalyticsTable.tableName,
          MEDIA_BUCKET_NAME: mediaBucket.bucketName,
          MEDIA_CLOUDFRONT_DOMAIN: mediaDistribution.domainName,
        },
      },
    );
    meditationAnalyticsTable.grantReadData(libraryList);
    libraryList.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["s3:ListBucket"],
        resources: [mediaBucket.bucketArn],
        conditions: {
          StringLike: { "s3:prefix": ["meditations/*"] },
        },
      }),
    );

    httpApi.addRoutes({
      path: "/library/meditations",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "LibraryListIntegration",
        libraryList,
      ),
    });

    const libraryDraft = new lambda_nodejs.NodejsFunction(
      this,
      "LibraryDraftFunction",
      {
        entry: path.join(__dirname, "../lambdas/library-draft.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(15),
        memorySize: 256,
        environment: {
          MEDITATION_ANALYTICS_TABLE_NAME: meditationAnalyticsTable.tableName,
        },
      },
    );
    meditationAnalyticsTable.grantReadWriteData(libraryDraft);

    const libraryDraftIntegration = new integrations.HttpLambdaIntegration(
      "LibraryDraftIntegration",
      libraryDraft,
    );

    httpApi.addRoutes({
      path: "/library/meditations/draft",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.POST],
      integration: libraryDraftIntegration,
    });

    const fishSpeakersList = new lambda_nodejs.NodejsFunction(
      this,
      "FishSpeakersListFunction",
      {
        entry: path.join(__dirname, "../lambdas/fish-speakers.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
      },
    );

    httpApi.addRoutes({
      path: "/fish/speakers",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "FishSpeakersListIntegration",
        fishSpeakersList,
      ),
    });

    const meditationRating = new lambda_nodejs.NodejsFunction(
      this,
      "MeditationRatingFunction",
      {
        entry: path.join(__dirname, "../lambdas/meditation-rating.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment: {
          MEDITATION_ANALYTICS_TABLE_NAME: meditationAnalyticsTable.tableName,
        },
      },
    );
    meditationAnalyticsTable.grantWriteData(meditationRating);

    httpApi.addRoutes({
      path: "/library/meditations/rating",
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new integrations.HttpLambdaIntegration(
        "MeditationRatingIntegration",
        meditationRating,
      ),
    });

    const meditationFavourite = new lambda_nodejs.NodejsFunction(
      this,
      "MeditationFavouriteFunction",
      {
        entry: path.join(__dirname, "../lambdas/meditation-favourite.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment: {
          MEDITATION_ANALYTICS_TABLE_NAME: meditationAnalyticsTable.tableName,
        },
      },
    );
    meditationAnalyticsTable.grantWriteData(meditationFavourite);

    httpApi.addRoutes({
      path: "/library/meditations/favourite",
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new integrations.HttpLambdaIntegration(
        "MeditationFavouriteIntegration",
        meditationFavourite,
      ),
    });

    const meditationArchive = new lambda_nodejs.NodejsFunction(
      this,
      "MeditationArchiveFunction",
      {
        entry: path.join(__dirname, "../lambdas/meditation-archive.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment: {
          MEDITATION_ANALYTICS_TABLE_NAME: meditationAnalyticsTable.tableName,
        },
      },
    );
    meditationAnalyticsTable.grantWriteData(meditationArchive);

    httpApi.addRoutes({
      path: "/library/meditations/archive",
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new integrations.HttpLambdaIntegration(
        "MeditationArchiveIntegration",
        meditationArchive,
      ),
    });

    const listBackgroundAudio = new lambda_nodejs.NodejsFunction(
      this,
      "ListBackgroundAudioFunction",
      {
        entry: path.join(__dirname, "../lambdas/list-background-audio.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment: {
          MEDIA_BUCKET_NAME: mediaBucket.bucketName,
          MEDIA_CLOUDFRONT_DOMAIN: mediaDistribution.domainName,
        },
      },
    );
    mediaBucket.grantRead(listBackgroundAudio);

    httpApi.addRoutes({
      path: "/media/background-audio",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "ListBackgroundAudioIntegration",
        listBackgroundAudio,
      ),
    });

    // --- Python: voice FX (Pedalboard) — layer is pre-built with Docker, committed under layers/pedalboard/
    const pedalboardLayerRoot = path.join(__dirname, "../layers/pedalboard");
    const pedalboardPackageInit = path.join(
      pedalboardLayerRoot,
      "python/lib/python3.12/site-packages/pedalboard/__init__.py",
    );
    if (!fs.existsSync(pedalboardPackageInit)) {
      throw new Error(
        "Pedalboard Lambda layer missing. From backend/ run: ./scripts/build-pedalboard-layer " +
          "(requires Docker), then commit layers/pedalboard/python/. See layers/pedalboard/README.md.",
      );
    }

    const pedalboardLayer = new lambda.LayerVersion(this, "PedalboardLayer", {
      code: lambda.Code.fromAsset(pedalboardLayerRoot),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description:
        "Spotify Pedalboard (rebuild: scripts/build-pedalboard-layer, commit layers/pedalboard/python)",
    });

    const voiceFx = new lambda.Function(this, "VoiceFxFunction", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../lambdas-python/voice-fx"),
      ),
      layers: [pedalboardLayer],
      timeout: cdk.Duration.seconds(60),
      memorySize: 1024,
      description: "Apply Pedalboard effects to voice WAV (base64 in/out)",
      environment: {
        MEDIA_BUCKET_NAME: mediaBucket.bucketName,
      },
    });
    mediaBucket.grantReadWrite(voiceFx);

    httpApi.addRoutes({
      path: "/audio/voice-fx",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        "VoiceFxIntegration",
        voiceFx,
      ),
    });

    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
    });
    new cdk.CfnOutput(this, "FishTtsUrl", {
      value: `${httpApi.apiEndpoint}/fish/tts`,
    });
    new cdk.CfnOutput(this, "VoiceFxUrl", {
      description: "POST JSON { audioBase64, preset? } WAV → effected WAV",
      value: `${httpApi.apiEndpoint}/audio/voice-fx`,
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
    new cdk.CfnOutput(this, "MediaBucketName", {
      description:
        "S3 bucket that stores generated meditations and background audio",
      value: mediaBucket.bucketName,
      exportName: "MediaBucketName",
    });
  }
}
