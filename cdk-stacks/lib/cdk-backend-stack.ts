// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import {CfnOutput, Stack, StackProps, Duration, CustomResource} from "aws-cdk-lib";
import {Construct} from "constructs";
import * as nodeLambda from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigw2 from "aws-cdk-lib/aws-apigatewayv2";
import * as apigw2Integrations from "aws-cdk-lib/aws-apigatewayv2-integrations";
import * as apigw2Authorizers from "aws-cdk-lib/aws-apigatewayv2-authorizers";
import * as sns from 'aws-cdk-lib/aws-sns';
import * as kms from "aws-cdk-lib/aws-kms"
import {CfnStage} from "aws-cdk-lib/aws-apigatewayv2";
import { loadSSMParams } from '../lib/infrastructure/ssm-params-util';
import * as logs from 'aws-cdk-lib/aws-logs'
import { NagSuppressions } from 'cdk-nag'
import * as utils from './utils/utils'
import path = require('path');

const configParams = require('../config.params.json');

export class CdkBackendStack extends Stack {

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const ssmParams = loadSSMParams(this);

    NagSuppressions.addStackSuppressions(this, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'This is the default Lambda Execution Policy which just grants writes to CloudWatch.'
      },
    ])

    // Unsubscribe SNS Topic
    const aws_sns_kms = kms.Alias.fromAliasName(
        this,
        "aws-managed-sns-kms-key",
        "alias/aws/sns",
    )
      
    const unsubscribeTopic = new sns.Topic(this, 'UnsubscribeTopic',{
        "masterKey": aws_sns_kms
    });

    // custom resource lambda
    const customResourceLambda = new nodeLambda.NodejsFunction(this, `CustomResourceLambda`, {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: 'lib/lambdas/handlers/node/CustomResources/customConfig.mjs',
      timeout: Duration.seconds(60),
      memorySize: 256,
      initialPolicy: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [                
            "ssm:GetParameter",
            "ssm:PutParameter",
            "ssm:DeleteParameter"
        ],
        resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${configParams.CdkAppName}/hashKey`]
        })
      ]
    });

    // config custom resource: StoreHashKey
    // Need to use a custom resource as CDK doesn't support SecureString
    const customResource = new CustomResource(this, `${configParams.CdkAppName}-CustomResource`, {
    resourceType: 'Custom::StoreHashKey',
    serviceToken: customResourceLambda.functionArn,
    properties: {
        HashKeyPath: `/${configParams.CdkAppName}/hashKey`,
        HashKey: utils.generatePassword(),
      }
    });

    // Unsubscribe Handler
    const unsubscribeNodeLambda = new nodeLambda.NodejsFunction(this, 'UnsubscribeNodeLambda', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, 'lambdas/handlers/node/unsubscribe.mjs'),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: { 
          "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
          "ENABLE_SES_ACCOUNT_LEVEL_SUPPRESSION": ssmParams.sesAccountLevelSuppressionEnabled.toString(),
          "UNSUBSCRIBE_SNS_TOPIC_ARN": unsubscribeTopic.topicArn,
          "COMPANY_WEBSITE": ssmParams.companyWebsite
      }
    });

    unsubscribeNodeLambda.role?.attachInlinePolicy(new iam.Policy(this, 'unsubscribeNodeLambdaPolicy', {
        statements: [
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [                
                  "sns:Publish"
                ],
                resources: [unsubscribeTopic.topicArn]
            }),
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [                
                  "ses:DeleteSuppressedDestination",
                  "ses:PutSuppressedDestination"
                ],
                resources: ['*']
            })
        ]
    }));

    NagSuppressions.addResourceSuppressionsByPath(this, '/EmailOneClickUnsubscribe/unsubscribeNodeLambdaPolicy/Resource', [
      {
        id: 'AwsSolutions-IAM5',
        reason: 'Put/DeleteSuppressedDestination add/remove user emails from the account level suppression list.  These methods work at the account level so there is no way to scope this down any further.'
      },
    ])

    // API Gateway Authorizer
    const paramsAndSecrets = lambda.ParamsAndSecretsLayerVersion.fromVersion(lambda.ParamsAndSecretsVersions.V1_0_103,
    {
      cacheSize: 10,
      logLevel: lambda.ParamsAndSecretsLogLevel.INFO,
    });

    const lambdaAuthorizer = new nodeLambda.NodejsFunction(this, 'LambdaAuthorizer', {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(__dirname, 'lambdas/handlers/node/authorizer.mjs'),
        paramsAndSecrets,
        timeout: Duration.seconds(30),
        memorySize: 256,
        environment: { 
            "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
            "HASH_KEY_PATH": `/${configParams.CdkAppName}/hashKey`,
          }
    });
    lambdaAuthorizer.role?.attachInlinePolicy(new iam.Policy(this, 'LambdaAuthorizerPolicy', {
        statements: [
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [                
                    "ssm:GetParameter"
                ],
                resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${configParams.CdkAppName}/hashKey`]
            }),
        ]
    }));

    const authorizer = new apigw2Authorizers.HttpLambdaAuthorizer('AgentPortalLambdaAuthorizer', lambdaAuthorizer,{
        responseTypes: [apigw2Authorizers.HttpLambdaResponseType.SIMPLE],
        identitySource: [
            '$request.querystring.email',
            '$request.querystring.h'
        ],
        resultsCacheTtl: Duration.seconds(0)
    })

    /************* create API Gateway Integration *********/
    const unsubscribeAPI = new apigw2.HttpApi(this, 'UnsubscribeAPI', {
        corsPreflight: {
            allowOrigins: ['*'],
            allowMethods: [apigw2.CorsHttpMethod.GET, apigw2.CorsHttpMethod.POST],
            allowHeaders: apigw.Cors.DEFAULT_HEADERS,
        }
    });

    // Setup the access log for APIGWv2
    const stage = unsubscribeAPI.defaultStage!.node.defaultChild as CfnStage;

    const logGroup = new logs.LogGroup(unsubscribeAPI, 'UnsubscribeAccessLogs', {
        retention: 90, // Keep logs for 90 days
        logGroupName: utils.generatePhysicalName('/aws/vendedlogs/',[configParams.CdkAppName,'APILogs'] ,1000) //https://github.com/aws/aws-cdk/issues/19353
    });

    stage.accessLogSettings = {
        destinationArn: logGroup.logGroupArn,
        format: JSON.stringify({
            requestId: '$context.requestId',
            userAgent: '$context.identity.userAgent',
            sourceIp: '$context.identity.sourceIp',
            requestTime: '$context.requestTime',
            httpMethod: '$context.httpMethod',
            path: '$context.path',
            status: '$context.status',
            responseLength: '$context.responseLength',
          }),
    }

    //Throttling
    stage.defaultRouteSettings = {
        throttlingBurstLimit: 2,
        throttlingRateLimit: 10
    }

    logGroup.grantWrite(new iam.ServicePrincipal('apigateway.amazonaws.com'));

    unsubscribeAPI.addRoutes({
        integration: new apigw2Integrations.HttpLambdaIntegration('unsubscribeGetAPI', unsubscribeNodeLambda),
        path: '/unsubscribe',
        authorizer: authorizer,
        methods: [apigw2.HttpMethod.GET],
    });

    unsubscribeAPI.addRoutes({
        integration: new apigw2Integrations.HttpLambdaIntegration('unsubscribePostAPI', unsubscribeNodeLambda),
        path: '/unsubscribe',
        authorizer: authorizer,
        methods: [apigw2.HttpMethod.POST],
    });

    // Hash Generator Lambda
    const hashGenerator = new nodeLambda.NodejsFunction(this, 'HashGenerator', {
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, 'lambdas/handlers/node/hashGenerator.mjs'),
      paramsAndSecrets,
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: { 
          "APPLICATION_VERSION": `v${this.node.tryGetContext('application_version')} (${new Date().toISOString()})`,
          "HASH_KEY_PATH": `/${configParams.CdkAppName}/hashKey`,
          "UNSUBSCRIBE_ENDPOINT_URL": `${unsubscribeAPI.url}unsubscribe`
        }
    });
    hashGenerator.role?.attachInlinePolicy(new iam.Policy(this, 'HashGeneratorPolicy', {
        statements: [
            new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: [                
                    "ssm:GetParameter"
                ],
                resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/${configParams.CdkAppName}/hashKey`]
            }),
        ]
    }));

    /**************************************************************************************************************
      * CDK Outputs *
    **************************************************************************************************************/

    new CfnOutput(this, "UnsubscribeLambdaName", {
      value: unsubscribeNodeLambda.functionName
    });

    new CfnOutput(this, "HashGeneratorLambdaName", {
      value: hashGenerator.functionName
    });

    new CfnOutput(this, "SampleHashGeneratorCLICommand", {
      value: `aws lambda invoke --function-name '${hashGenerator.functionName}' --cli-binary-format raw-in-base64-out --payload '{"email": "test@example.com"}' 'log.json'`
    });

    new CfnOutput(this, "UnsubscribeAPIEndpoint", {
      value: `${unsubscribeAPI.url}unsubscribe`
    });

    new CfnOutput(this, "UnsubscribeSNSTopic", {
      value: `${unsubscribeTopic.topicName}`
    });

    new CfnOutput(this, "SampleListUnsubscribeHeader", {
      value: `List-Unsubscribe: "<${unsubscribeAPI.url}unsubscribe?e=[email address]&h=[hashed email address]&t=[optional topic]&th=[optional hashed topic]&hkv=[optional hash key version]>"`
    });

    new CfnOutput(this, "SampleListUnsubscribePostHeader", {
      value: `List-Unsubscribe-Post: "List-Unsubscribe=One-Click"`
    });
  }
}
