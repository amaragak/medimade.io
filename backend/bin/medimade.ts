#!/usr/bin/env npx tsx
import * as cdk from "aws-cdk-lib";
import { MedimadeStack } from "../lib/medimade-stack";

const app = new cdk.App();

new MedimadeStack(app, "MedimadeBackend", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    // Primary region: London. Override with CDK_DEFAULT_REGION for dual-stack deploys.
    region: process.env.CDK_DEFAULT_REGION ?? "eu-west-2",
  },
  description: "medimade.io backend — HTTP API + Fish Audio TTS Lambda",
});

app.synth();
