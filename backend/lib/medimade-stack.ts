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
import * as sqs from "aws-cdk-lib/aws-sqs";
import { LayerVersion } from "aws-cdk-lib/aws-lambda";
import type { Construct } from "constructs";

/** Create this secret in AWS Secrets Manager before calling the API (see DEPLOY.md). */
export const FISH_AUDIO_SECRET_NAME = "medimade/FISH_AUDIO_API_KEY";
/** Anthropic API key for Claude (Haiku) chat in the create flow. */
export const CLAUDE_SECRET_NAME = "medimade/CLAUDE_API_KEY";
/** OpenAI API key for Whisper journal transcription (`POST /journal/transcribe`). */
export const OPENAI_SECRET_NAME = "medimade/OPENAI_API_KEY";
/** Brevo API key for transactional email (magic-link auth, future notifications). */
export const BREVO_SECRET_NAME = "medimade/BREVO_API_KEY";
/** RunPod API key for Orpheus TTS serverless (`nexslerdev/orpheus-fastapi-tts`, `POST /orpheus/tts`). */
export const RUNPODS_SECRET_NAME = "medimade/RUNPODS_API_KEY";
/** RunPod upstream URL (runsync or `/v1/audio/speech` on the Orpheus FastAPI worker). */
export const RUNPODS_URL_SECRET_NAME = "medimade/RUNPODS_URL";

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

    const openAiApiKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "OpenAiApiKey",
      OPENAI_SECRET_NAME,
    );

    const brevoApiKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "BrevoApiKey",
      BREVO_SECRET_NAME,
    );

    const runpodsApiKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "RunpodsApiKey",
      RUNPODS_SECRET_NAME,
    );

    const runpodsUrlSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "RunpodsUrl",
      RUNPODS_URL_SECRET_NAME,
    );

    // Storage for generated MP3s, served via CloudFront (streaming-friendly).
    const mediaBucket = new s3.Bucket(this, "MediaBucket", {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.PUT,
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag", "etag"],
          maxAge: 3600,
        },
      ],
      // Browser uploads that die mid-flight leave multipart parts behind and
      // keep billing; drop them rather than accumulating invisible garbage.
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: cdk.Duration.days(2) }],
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
          // Browser Web Audio (waveform trim) fetches MP3s with CORS.
          responseHeadersPolicy:
            cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
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

    /** Journal entries + META row per `ownerId` (opaque client id). Voice binaries stay in S3 via `/journal/voice`. */
    const journalTable = new dynamodb.Table(this, "JournalTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    /** Rolling Claude-derived journal insights (per topic + meta watermark) keyed by `ownerId`. */
    const journalInsightsTable = new dynamodb.Table(this, "JournalInsightsTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    /** Background-sound catalog: tags, in-use flag, trim window (S3 files stay under background-audio/). */
    const soundCatalogTable = new dynamodb.Table(this, "SoundCatalogTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    /** Fish speakers, hidden flags, and script pause band seconds. */
    const voiceAdminTable = new dynamodb.Table(this, "VoiceAdminTable", {
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    /** Per-listener mix overrides for public/community meditations (creator mix stays on the catalog row). */
    const meditationListenerMixTable = new dynamodb.Table(
      this,
      "MeditationListenerMixTable",
      {
        partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
        sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      },
    );

    /** HS256 secret for session JWTs (magic-link auth). */
    const authJwtSecret = new secretsmanager.Secret(this, "MedimadeAuthJwtSecret", {
      description: "Medimade user session JWT signing secret",
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
      },
    });

    /** Maps verified email → stable `userId` (JWT `sub`). */
    const usersTable = new dynamodb.Table(this, "MedimadeUsersTable", {
      partitionKey: { name: "email", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    /** One-time magic-link tokens (TTL on `ttl`). */
    const magicLinkTable = new dynamodb.Table(this, "MedimadeMagicLinkTable", {
      partitionKey: { name: "token", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: "ttl",
    });

    const authWebappOrigin =
      (this.node.tryGetContext("authWebappOrigin") as string | undefined)?.trim() ||
      "http://localhost:3000";
    const authEmailFrom =
      (this.node.tryGetContext("authEmailFrom") as string | undefined)?.trim() ||
      "medimadeaws@gmail.com";
    const adminEmails =
      (this.node.tryGetContext("adminEmails") as string | undefined)?.trim() ||
      process.env.ADMIN_EMAILS?.trim() ||
      authEmailFrom;

    const authMagicRequest = new lambda_nodejs.NodejsFunction(this, "AuthMagicRequestFunction", {
      entry: path.join(__dirname, "../lambdas/auth-magic-request.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      environment: {
        MAGIC_LINK_TABLE_NAME: magicLinkTable.tableName,
        AUTH_EMAIL_FROM: authEmailFrom,
        AUTH_WEBAPP_ORIGIN: authWebappOrigin,
        BREVO_SECRET_NAME: BREVO_SECRET_NAME,
      },
    });
    magicLinkTable.grantWriteData(authMagicRequest);
    brevoApiKeySecret.grantRead(authMagicRequest);

    const authMagicVerify = new lambda_nodejs.NodejsFunction(this, "AuthMagicVerifyFunction", {
      entry: path.join(__dirname, "../lambdas/auth-magic-verify.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(15),
      memorySize: 256,
      environment: {
        MAGIC_LINK_TABLE_NAME: magicLinkTable.tableName,
        USERS_TABLE_NAME: usersTable.tableName,
        AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
      },
    });
    magicLinkTable.grantReadWriteData(authMagicVerify);
    usersTable.grantReadWriteData(authMagicVerify);
    authJwtSecret.grantRead(authMagicVerify);

    const authProfileDisplayName = new lambda_nodejs.NodejsFunction(
      this,
      "AuthProfileDisplayNameFunction",
      {
        entry: path.join(__dirname, "../lambdas/auth-profile-display-name.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(15),
        memorySize: 256,
        environment: {
          USERS_TABLE_NAME: usersTable.tableName,
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    usersTable.grantReadWriteData(authProfileDisplayName);
    authJwtSecret.grantRead(authProfileDisplayName);

    // ffmpeg: Fish TTS proxy loudnorm + meditation bed mixing (account-local layer).
    const ffmpegLayer = LayerVersion.fromLayerVersionArn(
      this,
      "FfmpegLayer",
      "arn:aws:lambda:ap-southeast-2:382309212161:layer:serverlessrepo-soundws-audio-tools-lambda-layer-LambdaLayer:1",
    );

    // Background-audio ingest: S3 trigger normalizes uploads from background-audio-raw/ into background-audio/
    /** Normalize failures land here after retries so nothing disappears silently. */
    const bgAudioNormalizeDlq = new sqs.Queue(this, "BgAudioNormalizeDlq", {
      retentionPeriod: cdk.Duration.days(14),
    });

    // Hour-long compositions decode to multi-GB intermediates, so this function
    // is sized for the worst case rather than the median sample.
    const bgAudioNormalize = new lambda_nodejs.NodejsFunction(this, "BgAudioNormalizeFunction", {
      entry: path.join(__dirname, "../lambdas/bg-audio-normalize.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.minutes(15),
      memorySize: 3008,
      ephemeralStorageSize: cdk.Size.mebibytes(10240),
      retryAttempts: 1,
      deadLetterQueue: bgAudioNormalizeDlq,
      layers: [ffmpegLayer],
      environment: {
        MEDIA_BUCKET_NAME: mediaBucket.bucketName,
        SOUND_CATALOG_TABLE_NAME: soundCatalogTable.tableName,
      },
    });
    mediaBucket.grantReadWrite(bgAudioNormalize);
    soundCatalogTable.grantReadWriteData(bgAudioNormalize);
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
        FISH_TTS_MODEL: "s2.1-pro-free",
      },
    });
    fishApiKeySecret.grantRead(fishTts);

    const orpheusTts = new lambda_nodejs.NodejsFunction(this, "OrpheusTtsFunction", {
      entry: path.join(__dirname, "../lambdas/orpheus-tts.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      environment: {
        RUNPODS_SECRET_ARN: runpodsApiKeySecret.secretArn,
        RUNPODS_URL_SECRET_ARN: runpodsUrlSecret.secretArn,
      },
    });
    runpodsApiKeySecret.grantRead(orpheusTts);
    runpodsUrlSecret.grantRead(orpheusTts);

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
        allowHeaders: [
          "Content-Type",
          "Authorization",
          "X-Medimade-Authorization",
        ],
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.PUT,
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

    httpApi.addRoutes({
      path: "/orpheus/tts",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        "OrpheusTtsIntegration",
        orpheusTts,
      ),
    });

    httpApi.addRoutes({
      path: "/v1/audio/speech",
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration(
        "OrpheusSpeechIntegration",
        orpheusTts,
      ),
    });

    httpApi.addRoutes({
      path: "/auth/magic-link",
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "AuthMagicRequestIntegration",
        authMagicRequest,
      ),
    });
    httpApi.addRoutes({
      path: "/auth/magic-link/verify",
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "AuthMagicVerifyIntegration",
        authMagicVerify,
      ),
    });
    httpApi.addRoutes({
      path: "/auth/profile/display-name",
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "AuthProfileDisplayNameIntegration",
        authProfileDisplayName,
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
        timeout: cdk.Duration.seconds(900),
        // A 20-minute meditation is a ~100 MB WAV through the FX round trip;
        // 1024 MB ran out of memory on a 153-section script.
        memorySize: 2048,
        layers: [ffmpegLayer],
        environment: {
          CLAUDE_SECRET_ARN: claudeApiKeySecret.secretArn,
          FISH_AUDIO_SECRET_ARN: fishApiKeySecret.secretArn,
          RUNPODS_SECRET_ARN: runpodsApiKeySecret.secretArn,
          RUNPODS_URL_SECRET_ARN: runpodsUrlSecret.secretArn,
          MEDIA_BUCKET_NAME: mediaBucket.bucketName,
          MEDIA_CLOUDFRONT_DOMAIN: mediaDistribution.domainName,
          MEDIMADE_API_URL: httpApi.apiEndpoint,
          MEDITATION_ANALYTICS_TABLE_NAME: meditationAnalyticsTable.tableName,
          MEDITATION_JOBS_TABLE_NAME: meditationJobsTable.tableName,
          FISH_TTS_MODEL: "s2.1-pro-free",
          VOICE_ADMIN_TABLE_NAME: voiceAdminTable.tableName,
        },
      },
    );
    claudeApiKeySecret.grantRead(meditationAudioWorker);
    fishApiKeySecret.grantRead(meditationAudioWorker);
    runpodsApiKeySecret.grantRead(meditationAudioWorker);
    runpodsUrlSecret.grantRead(meditationAudioWorker);
    mediaBucket.grantPut(meditationAudioWorker);
    mediaBucket.grantRead(meditationAudioWorker);
    meditationAnalyticsTable.grantWriteData(meditationAudioWorker);
    meditationJobsTable.grantReadWriteData(meditationAudioWorker);
    voiceAdminTable.grantReadData(meditationAudioWorker);

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
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    meditationJobsTable.grantReadWriteData(createMeditationJob);
    meditationAudioWorker.grantInvoke(createMeditationJob);
    authJwtSecret.grantRead(createMeditationJob);

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
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    meditationJobsTable.grantReadData(getMeditationJob);
    authJwtSecret.grantRead(getMeditationJob);

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
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    meditationAnalyticsTable.grantReadData(analyticsList);
    authJwtSecret.grantRead(analyticsList);

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
          MEDITATION_LISTENER_MIX_TABLE_NAME: meditationListenerMixTable.tableName,
          MEDIA_BUCKET_NAME: mediaBucket.bucketName,
          MEDIA_CLOUDFRONT_DOMAIN: mediaDistribution.domainName,
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
          VOICE_ADMIN_TABLE_NAME: voiceAdminTable.tableName,
        },
      },
    );
    meditationAnalyticsTable.grantReadData(libraryList);
    meditationListenerMixTable.grantReadData(libraryList);
    authJwtSecret.grantRead(libraryList);
    voiceAdminTable.grantReadData(libraryList);
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

    const libraryPrograms = new lambda_nodejs.NodejsFunction(
      this,
      "LibraryProgramsFunction",
      {
        entry: path.join(__dirname, "../lambdas/library-programs.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(15),
        memorySize: 256,
        environment: {
          VOICE_ADMIN_TABLE_NAME: voiceAdminTable.tableName,
        },
      },
    );
    voiceAdminTable.grantReadData(libraryPrograms);

    httpApi.addRoutes({
      path: "/library/programs",
      methods: [apigwv2.HttpMethod.GET, apigwv2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "LibraryProgramsIntegration",
        libraryPrograms,
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
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    meditationAnalyticsTable.grantReadWriteData(libraryDraft);
    authJwtSecret.grantRead(libraryDraft);

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
        environment: {
          VOICE_ADMIN_TABLE_NAME: voiceAdminTable.tableName,
        },
      },
    );
    voiceAdminTable.grantReadData(fishSpeakersList);

    httpApi.addRoutes({
      path: "/fish/speakers",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "FishSpeakersListIntegration",
        fishSpeakersList,
      ),
    });

    const orpheusSpeakersList = new lambda_nodejs.NodejsFunction(
      this,
      "OrpheusSpeakersListFunction",
      {
        entry: path.join(__dirname, "../lambdas/orpheus-speakers.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
      },
    );

    httpApi.addRoutes({
      path: "/orpheus/speakers",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "OrpheusSpeakersListIntegration",
        orpheusSpeakersList,
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
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    meditationAnalyticsTable.grantWriteData(meditationRating);
    authJwtSecret.grantRead(meditationRating);

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
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    meditationAnalyticsTable.grantWriteData(meditationFavourite);
    authJwtSecret.grantRead(meditationFavourite);

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
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    meditationAnalyticsTable.grantWriteData(meditationArchive);
    authJwtSecret.grantRead(meditationArchive);

    httpApi.addRoutes({
      path: "/library/meditations/archive",
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new integrations.HttpLambdaIntegration(
        "MeditationArchiveIntegration",
        meditationArchive,
      ),
    });

    const meditationPublic = new lambda_nodejs.NodejsFunction(
      this,
      "MeditationPublicFunction",
      {
        entry: path.join(__dirname, "../lambdas/meditation-public.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment: {
          MEDITATION_ANALYTICS_TABLE_NAME: meditationAnalyticsTable.tableName,
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    meditationAnalyticsTable.grantWriteData(meditationPublic);
    authJwtSecret.grantRead(meditationPublic);

    httpApi.addRoutes({
      path: "/library/meditations/public",
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new integrations.HttpLambdaIntegration(
        "MeditationPublicIntegration",
        meditationPublic,
      ),
    });

    const meditationMix = new lambda_nodejs.NodejsFunction(
      this,
      "MeditationMixFunction",
      {
        entry: path.join(__dirname, "../lambdas/meditation-mix.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment: {
          MEDITATION_ANALYTICS_TABLE_NAME: meditationAnalyticsTable.tableName,
          MEDITATION_LISTENER_MIX_TABLE_NAME: meditationListenerMixTable.tableName,
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    meditationAnalyticsTable.grantWriteData(meditationMix);
    meditationListenerMixTable.grantReadWriteData(meditationMix);
    authJwtSecret.grantRead(meditationMix);

    httpApi.addRoutes({
      path: "/library/meditations/mix",
      methods: [apigwv2.HttpMethod.PATCH],
      integration: new integrations.HttpLambdaIntegration(
        "MeditationMixIntegration",
        meditationMix,
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
          SOUND_CATALOG_TABLE_NAME: soundCatalogTable.tableName,
        },
      },
    );
    mediaBucket.grantRead(listBackgroundAudio);
    soundCatalogTable.grantReadData(listBackgroundAudio);

    const adminSounds = new lambda_nodejs.NodejsFunction(this, "AdminSoundsFunction", {
      entry: path.join(__dirname, "../lambdas/admin-sounds.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
      environment: {
        MEDIA_BUCKET_NAME: mediaBucket.bucketName,
        MEDIA_CLOUDFRONT_DOMAIN: mediaDistribution.domainName,
        SOUND_CATALOG_TABLE_NAME: soundCatalogTable.tableName,
        AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        ADMIN_EMAILS: adminEmails,
        CLAUDE_SECRET_ARN: claudeApiKeySecret.secretArn,
      },
    });
    mediaBucket.grantReadWrite(adminSounds);
    mediaBucket.grantDelete(adminSounds);
    soundCatalogTable.grantReadWriteData(adminSounds);
    authJwtSecret.grantRead(adminSounds);
    claudeApiKeySecret.grantRead(adminSounds);

    httpApi.addRoutes({
      path: "/admin/sounds",
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.PATCH,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "AdminSoundsIntegration",
        adminSounds,
      ),
    });

    const adminSoundsTrim = new lambda_nodejs.NodejsFunction(
      this,
      "AdminSoundsTrimFunction",
      {
        entry: path.join(__dirname, "../lambdas/admin-sounds-trim.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(180),
        memorySize: 2048,
        ephemeralStorageSize: cdk.Size.mebibytes(2048),
        layers: [ffmpegLayer],
        environment: {
          MEDIA_BUCKET_NAME: mediaBucket.bucketName,
          SOUND_CATALOG_TABLE_NAME: soundCatalogTable.tableName,
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
          ADMIN_EMAILS: adminEmails,
        },
      },
    );
    mediaBucket.grantReadWrite(adminSoundsTrim);
    soundCatalogTable.grantReadWriteData(adminSoundsTrim);
    authJwtSecret.grantRead(adminSoundsTrim);

    httpApi.addRoutes({
      path: "/admin/sounds/trim",
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "AdminSoundsTrimIntegration",
        adminSoundsTrim,
      ),
    });

    const adminFactoryMixes = new lambda_nodejs.NodejsFunction(
      this,
      "AdminFactoryMixesFunction",
      {
        entry: path.join(__dirname, "../lambdas/admin-factory-mixes.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(15),
        memorySize: 256,
        environment: {
          SOUND_CATALOG_TABLE_NAME: soundCatalogTable.tableName,
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
          ADMIN_EMAILS: adminEmails,
        },
      },
    );
    soundCatalogTable.grantReadWriteData(adminFactoryMixes);
    authJwtSecret.grantRead(adminFactoryMixes);

    httpApi.addRoutes({
      path: "/admin/factory-mixes",
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.PATCH,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "AdminFactoryMixesIntegration",
        adminFactoryMixes,
      ),
    });

    const adminPrograms = new lambda_nodejs.NodejsFunction(
      this,
      "AdminProgramsFunction",
      {
        entry: path.join(__dirname, "../lambdas/admin-programs.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(60),
        memorySize: 256,
        environment: {
          VOICE_ADMIN_TABLE_NAME: voiceAdminTable.tableName,
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
          ADMIN_EMAILS: adminEmails,
          CLAUDE_SECRET_ARN: claudeApiKeySecret.secretArn,
        },
      },
    );
    voiceAdminTable.grantReadWriteData(adminPrograms);
    authJwtSecret.grantRead(adminPrograms);
    claudeApiKeySecret.grantRead(adminPrograms);

    httpApi.addRoutes({
      path: "/admin/programs",
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.PATCH,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "AdminProgramsIntegration",
        adminPrograms,
      ),
    });

    const adminVoice = new lambda_nodejs.NodejsFunction(this, "AdminVoiceFunction", {
      entry: path.join(__dirname, "../lambdas/admin-voice.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(180),
      memorySize: 2048,
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
      layers: [ffmpegLayer],
      environment: {
        MEDIA_BUCKET_NAME: mediaBucket.bucketName,
        MEDIA_CLOUDFRONT_DOMAIN: mediaDistribution.domainName,
        VOICE_ADMIN_TABLE_NAME: voiceAdminTable.tableName,
        AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        ADMIN_EMAILS: adminEmails,
        FISH_AUDIO_SECRET_ARN: fishApiKeySecret.secretArn,
        FISH_TTS_MODEL: "s2.1-pro-free",
        MEDIMADE_API_URL: httpApi.apiEndpoint,
      },
    });
    mediaBucket.grantReadWrite(adminVoice);
    voiceAdminTable.grantReadWriteData(adminVoice);
    authJwtSecret.grantRead(adminVoice);
    fishApiKeySecret.grantRead(adminVoice);

    httpApi.addRoutes({
      path: "/admin/voice",
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.PATCH,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "AdminVoiceIntegration",
        adminVoice,
      ),
    });

    // --- Python: script embeddings (fastembed + BGE-small ONNX) — shared layer
    const fastembedLayerRoot = path.join(__dirname, "../layers/fastembed");
    const fastembedPackageInit = path.join(
      fastembedLayerRoot,
      "python/lib/python3.12/site-packages/fastembed/__init__.py",
    );
    if (!fs.existsSync(fastembedPackageInit)) {
      throw new Error(
        "Fastembed Lambda layer missing. From backend/ run: ./scripts/build-fastembed-layer " +
          "(Docker preferred; manylinux wheel fallback), then commit layers/fastembed/python/. " +
          "See layers/fastembed/README.md.",
      );
    }

    const fastembedLayer = new lambda.LayerVersion(this, "FastembedLayer", {
      code: lambda.Code.fromAsset(fastembedLayerRoot),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description:
        "fastembed + BGE-small-en-v1.5 ONNX (rebuild: scripts/build-fastembed-layer)",
    });

    const scriptEmbed = new lambda.Function(this, "ScriptEmbedFunction", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../lambdas-python/script-embed"),
      ),
      layers: [fastembedLayer],
      timeout: cdk.Duration.minutes(5),
      memorySize: 3008,
      ephemeralStorageSize: cdk.Size.mebibytes(1024),
      description: "Embed text / NN search / async store for Script Lab V3 (fastembed)",
      environment: {
        FASTEMBED_CACHE_PATH: "/opt/python/model_cache",
        VOICE_ADMIN_TABLE_NAME: voiceAdminTable.tableName,
      },
    });
    voiceAdminTable.grantReadWriteData(scriptEmbed);

    const adminScriptLab = new lambda_nodejs.NodejsFunction(
      this,
      "AdminScriptLabFunction",
      {
        entry: path.join(__dirname, "../lambdas/admin-script-lab.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(300),
        memorySize: 2048,
        ephemeralStorageSize: cdk.Size.mebibytes(1024),
        layers: [ffmpegLayer],
        environment: {
          MEDIA_BUCKET_NAME: mediaBucket.bucketName,
          MEDIA_CLOUDFRONT_DOMAIN: mediaDistribution.domainName,
          VOICE_ADMIN_TABLE_NAME: voiceAdminTable.tableName,
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
          ADMIN_EMAILS: adminEmails,
          FISH_AUDIO_SECRET_ARN: fishApiKeySecret.secretArn,
          CLAUDE_SECRET_ARN: claudeApiKeySecret.secretArn,
          FISH_TTS_MODEL: "s2.1-pro-free",
          SCRIPT_EMBED_FUNCTION_NAME: scriptEmbed.functionName,
        },
      },
    );
    mediaBucket.grantReadWrite(adminScriptLab);
    voiceAdminTable.grantReadWriteData(adminScriptLab);
    authJwtSecret.grantRead(adminScriptLab);
    fishApiKeySecret.grantRead(adminScriptLab);
    claudeApiKeySecret.grantRead(adminScriptLab);
    scriptEmbed.grantInvoke(adminScriptLab);

    const adminScriptLabUrl = adminScriptLab.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"],
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: [
          "content-type",
          "authorization",
          "x-medimade-authorization",
        ],
      },
    });
    const scriptLabUrlInvokeFn = new lambda.CfnPermission(
      this,
      "AdminScriptLabPublicInvokeFunction",
      {
        action: "lambda:InvokeFunction",
        functionName: adminScriptLab.functionName,
        principal: "*",
      },
    );
    scriptLabUrlInvokeFn.addPropertyOverride("InvokedViaFunctionUrl", true);

    httpApi.addRoutes({
      path: "/admin/script-lab",
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.PATCH,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "AdminScriptLabIntegration",
        adminScriptLab,
      ),
    });

    httpApi.addRoutes({
      path: "/media/background-audio",
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration(
        "ListBackgroundAudioIntegration",
        listBackgroundAudio,
      ),
    });

    const journalTranscribe = new lambda_nodejs.NodejsFunction(
      this,
      "JournalTranscribeFunction",
      {
        entry: path.join(__dirname, "../lambdas/journal-transcribe.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(120),
        memorySize: 512,
        environment: {
          OPENAI_SECRET_ARN: openAiApiKeySecret.secretArn,
          MEDIA_BUCKET_NAME: mediaBucket.bucketName,
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    openAiApiKeySecret.grantRead(journalTranscribe);
    mediaBucket.grantPut(journalTranscribe);
    authJwtSecret.grantRead(journalTranscribe);

    httpApi.addRoutes({
      path: "/journal/transcribe",
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "JournalTranscribeIntegration",
        journalTranscribe,
      ),
    });

    const journalStore = new lambda_nodejs.NodejsFunction(this, "JournalStoreFunction", {
      entry: path.join(__dirname, "../lambdas/journal-store.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        JOURNAL_TABLE_NAME: journalTable.tableName,
        /** Legacy `journal/stores/{ownerId}.json` — read + delete on first GET after DDB migration. */
        MEDIA_BUCKET_NAME: mediaBucket.bucketName,
        AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
      },
    });
    journalTable.grantReadWriteData(journalStore);
    mediaBucket.grantRead(journalStore);
    mediaBucket.grantDelete(journalStore);
    authJwtSecret.grantRead(journalStore);

    httpApi.addRoutes({
      path: "/journal/store",
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.PUT,
        apigwv2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "JournalStoreIntegration",
        journalStore,
      ),
    });

    const journalVoiceUpload = new lambda_nodejs.NodejsFunction(
      this,
      "JournalVoiceUploadFunction",
      {
        entry: path.join(__dirname, "../lambdas/journal-voice-upload.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(30),
        memorySize: 512,
        environment: {
          MEDIA_BUCKET_NAME: mediaBucket.bucketName,
          MEDIA_CLOUDFRONT_DOMAIN: mediaDistribution.domainName,
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    mediaBucket.grantPut(journalVoiceUpload);
    authJwtSecret.grantRead(journalVoiceUpload);

    httpApi.addRoutes({
      path: "/journal/voice",
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "JournalVoiceUploadIntegration",
        journalVoiceUpload,
      ),
    });

    const journalInsights = new lambda_nodejs.NodejsFunction(
      this,
      "JournalInsightsFunction",
      {
        entry: path.join(__dirname, "../lambdas/journal-insights.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(60),
        memorySize: 1024,
        environment: {
          CLAUDE_SECRET_ARN: claudeApiKeySecret.secretArn,
          JOURNAL_TABLE_NAME: journalTable.tableName,
          JOURNAL_INSIGHTS_TABLE_NAME: journalInsightsTable.tableName,
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    claudeApiKeySecret.grantRead(journalInsights);
    journalTable.grantReadData(journalInsights);
    journalInsightsTable.grantReadWriteData(journalInsights);
    authJwtSecret.grantRead(journalInsights);

    httpApi.addRoutes({
      path: "/journal/insights",
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "JournalInsightsIntegration",
        journalInsights,
      ),
    });

    const journalWeeklyReflection = new lambda_nodejs.NodejsFunction(
      this,
      "JournalWeeklyReflectionFunction",
      {
        entry: path.join(__dirname, "../lambdas/journal-weekly-reflection.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(60),
        memorySize: 1024,
        environment: {
          CLAUDE_SECRET_ARN: claudeApiKeySecret.secretArn,
          JOURNAL_TABLE_NAME: journalTable.tableName,
          JOURNAL_INSIGHTS_TABLE_NAME: journalInsightsTable.tableName,
          MEDITATION_ANALYTICS_TABLE_NAME: meditationAnalyticsTable.tableName,
          MEDITATION_JOBS_TABLE_NAME: meditationJobsTable.tableName,
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    claudeApiKeySecret.grantRead(journalWeeklyReflection);
    journalTable.grantReadData(journalWeeklyReflection);
    journalInsightsTable.grantReadWriteData(journalWeeklyReflection);
    meditationAnalyticsTable.grantReadData(journalWeeklyReflection);
    meditationJobsTable.grantReadData(journalWeeklyReflection);
    authJwtSecret.grantRead(journalWeeklyReflection);

    httpApi.addRoutes({
      path: "/journal/weekly-reflection",
      methods: [
        apigwv2.HttpMethod.GET,
        apigwv2.HttpMethod.POST,
        apigwv2.HttpMethod.OPTIONS,
      ],
      integration: new integrations.HttpLambdaIntegration(
        "JournalWeeklyReflectionIntegration",
        journalWeeklyReflection,
      ),
    });

    const journalImportPdf = new lambda_nodejs.NodejsFunction(
      this,
      "JournalImportPdfFunction",
      {
        entry: path.join(__dirname, "../lambdas/journal-import-pdf.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(90),
        memorySize: 512,
        environment: {
          CLAUDE_SECRET_ARN: claudeApiKeySecret.secretArn,
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    claudeApiKeySecret.grantRead(journalImportPdf);
    authJwtSecret.grantRead(journalImportPdf);

    httpApi.addRoutes({
      path: "/journal/import/pdf",
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "JournalImportPdfIntegration",
        journalImportPdf,
      ),
    });

    const journalImportOcr = new lambda_nodejs.NodejsFunction(
      this,
      "JournalImportOcrFunction",
      {
        entry: path.join(__dirname, "../lambdas/journal-import-ocr.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_20_X,
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
        environment: {
          AUTH_JWT_SECRET_ARN: authJwtSecret.secretArn,
        },
      },
    );
    authJwtSecret.grantRead(journalImportOcr);
    journalImportOcr.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["textract:DetectDocumentText"],
        resources: ["*"],
      }),
    );

    httpApi.addRoutes({
      path: "/journal/import/ocr",
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.OPTIONS],
      integration: new integrations.HttpLambdaIntegration(
        "JournalImportOcrIntegration",
        journalImportOcr,
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

    // Worker fans out one concurrent VoiceFx execution per speech section
    // (direct IAM invoke). HTTP route stays for short admin/preview clips.
    const voiceFx = new lambda.Function(this, "VoiceFxFunction", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../lambdas-python/voice-fx"),
      ),
      layers: [pedalboardLayer],
      timeout: cdk.Duration.minutes(5),
      memorySize: 3008,
      description: "Apply Pedalboard effects to voice audio (S3 or base64)",
      environment: {
        MEDIA_BUCKET_NAME: mediaBucket.bucketName,
      },
    });
    mediaBucket.grantReadWrite(voiceFx);
    meditationAudioWorker.addEnvironment(
      "VOICE_FX_FUNCTION_NAME",
      voiceFx.functionName,
    );
    voiceFx.grantInvoke(meditationAudioWorker);

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
    new cdk.CfnOutput(this, "OrpheusTtsUrl", {
      description:
        "OpenAI-compatible speech: POST JSON { model, input, voice, response_format, speed }",
      value: `${httpApi.apiEndpoint}/v1/audio/speech`,
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
    new cdk.CfnOutput(this, "AdminScriptLabUrl", {
      description:
        "Lambda Function URL for Script Lab generate-script — set NEXT_PUBLIC_MEDIMADE_SCRIPT_LAB_URL",
      value: adminScriptLabUrl.url,
    });
    new cdk.CfnOutput(this, "FishAudioSecretName", {
      description: "Put your Fish Audio API key as the secret string value",
      value: FISH_AUDIO_SECRET_NAME,
    });
    new cdk.CfnOutput(this, "RunpodsSecretName", {
      description: "Put your RunPod API key as the secret string value",
      value: RUNPODS_SECRET_NAME,
    });
    new cdk.CfnOutput(this, "RunpodsUrlSecretName", {
      description:
        "Put your RunPod runsync URL as the secret string value (e.g. https://api.runpod.ai/v2/{id}/runsync)",
      value: RUNPODS_URL_SECRET_NAME,
    });
    new cdk.CfnOutput(this, "ClaudeSecretName", {
      description: "Put your Anthropic API key as the secret string value",
      value: CLAUDE_SECRET_NAME,
    });
    new cdk.CfnOutput(this, "OpenAiSecretName", {
      description:
        "Put your OpenAI API key (Whisper) as the secret string value — used for journal voice transcription",
      value: OPENAI_SECRET_NAME,
    });
    new cdk.CfnOutput(this, "BrevoSecretName", {
      description: "Put your Brevo API key as the secret string value (transactional email)",
      value: BREVO_SECRET_NAME,
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
