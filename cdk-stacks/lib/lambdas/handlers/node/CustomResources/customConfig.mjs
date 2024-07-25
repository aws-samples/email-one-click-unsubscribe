const crypto = require('crypto');
var cfnResponse = require('cfn-response');
const { SSMClient, DeleteParameterCommand, PutParameterCommand } = require('@aws-sdk/client-ssm');


/****************
 * Helper Functions
****************/
async function putSSMSecureString(path, value) {
    const client = new SSMClient();
  
    const input = {
      Name: path,
      Value: value,
      Type: 'SecureString',
      Overwrite: false,
    };

    console.debug(input);
  
    const command = new PutParameterCommand(input);
  
    return await client.send(command);
}

async function deleteSSMSecureString(path) {
    const client = new SSMClient();
  
    const input = {
      Name: path,
    };
  
    const command = new DeleteParameterCommand(input);
  
    return await client.send(command);
}

/****************
 * Main
****************/
export async function handler(event, context) {
    console.log('Received event:', JSON.stringify(event, null, 2));

    const props = event.ResourceProperties
    const requestType = event.RequestType
    let physicalId = event.PhysicalResourceId

    if (requestType === 'Create') {
        physicalId = `vce.config.${crypto.randomUUID()}`
    } else if(!physicalId) {
        await sendResponse(event, context, 'FAILED', `invalid request: request type is '${requestType}' but 'PhysicalResourceId' is not defined`)
    }

    try{

      switch (event.ResourceType){
        case 'Custom::StoreHashKey':
            const hashKeyPath = props.HashKeyPath
            const hashKey = props.HashKey

            if (requestType === 'Create' || requestType === 'Update'){
                await putSSMSecureString(hashKeyPath, hashKey)
                await sendResponse(event, context, 'SUCCESS', {});
            } else if(requestType === 'Delete'){
                //await deleteSSMSecureString(hashKeyPath)
                await sendResponse(event, context, 'SUCCESS', {});
            } else {
                await sendResponse(event, context, 'SUCCESS', {});
            }
            break;
        default:
            await sendResponse(event, context, 'SUCCESS', {});
            break;
      }
    }
    catch (ex){
      console.log(ex);
      await sendResponse(event, context, 'SUCCESS', {}); //TODO changed to FAILED when finished testing.
    }
};

const sendResponse = async (event, context, status, data) => {
  await new Promise(() => cfnResponse.send(event, context, status, data));
  return;
};
