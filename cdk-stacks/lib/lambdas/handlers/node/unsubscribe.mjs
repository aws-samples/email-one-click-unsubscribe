// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { SESv2Client, PutSuppressedDestinationCommand, DeleteSuppressedDestinationCommand } from "@aws-sdk/client-sesv2";
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns'
const ses = new SESv2Client({});
const sns = new SNSClient({});

async function sesUnsubscribe(email) {
    const input = { 
        EmailAddress: email, 
        Reason: "COMPLAINT",
      };
  
    const command = new PutSuppressedDestinationCommand(input);
  
    return await ses.send(command);
}

//function to publish to an sns topic
async function snsPublish(message, topicArn) {
    const input = {
        Message: message,
        TopicArn: topicArn
    };

    const command = new PublishCommand(input);

    return await sns.send(command);
}

exports.handler = async (event, context, callback) => {

    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.debug(`Event: `, JSON.stringify(event, null, 2));

        //GET requests to return a customer provided website.
        if (event.requestContext.http.method === 'GET'){
            callback(null, {
                statusCode: 200, 
                headers: {"content-type": "text/html"},
                body: `<html><body><a href="${process.env.COMPANY_WEBSITE}">${process.env.COMPANY_WEBSITE}</a></body></html>`})
            return
        }

        //Optionally add to SES Account Level Suppression List
        if (process.env.ENABLE_SES_ACCOUNT_LEVEL_SUPPRESSION.toLowerCase() === 'true'){
            await sesUnsubscribe(decodeURIComponent(event.queryStringParameters.email)) 
        }

        //Publish to SNS Topic
        await snsPublish(JSON.stringify(event,null,2), process.env.UNSUBSCRIBE_SNS_TOPIC_ARN)

        callback(null,{message:'unsubscribed'})
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}