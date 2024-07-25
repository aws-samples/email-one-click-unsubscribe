const Utilities = require('./lib/CommonUtility.mjs')
export async function handler(event, context, callback) {
    console.info("App Version:", process.env.APPLICATION_VERSION)
    console.debug(`Event: `, JSON.stringify(event, null, 2));

    //Retrieve request parameters from the Lambda function input:
    const email = encodeURIComponent(event.queryStringParameters.email)
    const h = event.queryStringParameters.h
    const topic = encodeURIComponent(event.queryStringParameters.topic)
    const th = event.queryStringParameters.th
    let hkv = event.queryStringParameters.hkv

    //Validate email which is required
    let validHash = await Utilities.validateHash(email, h, hkv)
    if (!validHash){
      console.warn(`Invalid email hash: ${email}`)
    }

    //If a topic was provided, validate it as well
    let validTopic = true
    if(topic && th){
      validTopic = await Utilities.validateHash(topic, th, hkv)
      if (!validTopic){
        console.warn(`Invalid topic hash: ${topic}`)
      }
    }

    if(validHash && validTopic){
      callback(null, {
        "isAuthorized": true,
      });
    } else {
      callback(null, {
        "isAuthorized": false,
      });
    }
}