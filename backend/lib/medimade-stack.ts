import * as path from "path";
import * as cdk from "aws-cdk-lib";
import * as apigwv2 from "aws-cdk-lib/aws-apigatewayv2";
import * as integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambda_nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

/** Create this secret in AWS Secrets Manager before calling the API (see DEPLOY.md). */
export const FISH_AUDIO_SECRET_NAME = "medimade/FISH_AUDIO_API_KEY";

export class MedimadeStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const fishApiKeySecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "FishAudioApiKey",
      FISH_AUDIO_SECRET_NAME,
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

    new cdk.CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
    });
    new cdk.CfnOutput(this, "FishTtsUrl", {
      value: `${httpApi.apiEndpoint}/fish/tts`,
    });
    new cdk.CfnOutput(this, "FishAudioSecretName", {
      description: "Put your Fish Audio API key as the secret string value",
      value: FISH_AUDIO_SECRET_NAME,
    });
  }
}
