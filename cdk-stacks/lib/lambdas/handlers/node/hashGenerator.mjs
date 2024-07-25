// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

const Utilities = require('./lib/CommonUtility.mjs')

exports.handler = async (event, context, callback) => {

    try {
        console.info("App Version:", process.env.APPLICATION_VERSION)
        console.debug(`Event: `, JSON.stringify(event, null, 2));

        //Retrieve request parameters from the Lambda function input:
        const email = encodeURIComponent(event.email)
        let topic = false
        if(event.topic) topic = encodeURIComponent(event.topic)
        const hkv = event.hashKeyVersion

        let unsubURL = `${process.env.UNSUBSCRIBE_ENDPOINT_URL}?`

        let emailHash = await Utilities.createHash(email, hkv)
        let response = {
            email: email,
            emailHash: emailHash,
        }
        unsubURL += `email=${email}&h=${emailHash}`

        //If a topic was provided, create a hash for it as well
        if(topic){
            let topicHash = await Utilities.createHash(topic, hkv)
            response.topic = topic;
            response.topicHash = topicHash;
            unsubURL += `&topic=${topic}&th=${topicHash}`
        }

        //If a Hash Key Version was supplied then make sure it's returned
        if (hkv) {
            response.hashKeyVersion = hkv;
            unsubURL += `&hkv=${hkv}`
        }

        //Append sample List-Unsubscribe Headers
        response.unsubURL = unsubURL
        response['List-Unsubscribe'] = `<${unsubURL}>`
        response['List-Unsubscribe-Post'] = `List-Unsubscribe=One-Click`

        callback(null,response)
    }
    catch (error) {
        console.error(error);
        callback(error)
    }
}