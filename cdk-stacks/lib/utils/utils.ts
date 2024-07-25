import * as cdk from 'aws-cdk-lib';
import crypto = require('crypto');

//https://github.com/aws/aws-cdk/discussions/25257
/**
 * @internal This is an internal core function and should not be called directly by Solutions Constructs clients.
 *
 * @summary Creates a physical resource name in the style of the CDK (string+hash) - this value incorporates Stack ID,
 * so it will remain static in multiple updates of a single stack, but will be different in a separate stack instance
 * @param {string[]} parts - the various string components of the name (eg - stackName, solutions construct ID, L2 construct ID)
 * @param {number} maxLength - the longest string that can be returned
 * @returns {string} - a string with concatenated parts (truncated if neccessary) + a hash of the full concatenated parts
 *
 */
export function generatePhysicalName(
    prefix: string,
    parts: string[],
    maxLength: number,
  ): string {
    // The result will consist of:
    //    -The prefix - unaltered
    //    -The parts concatenated, but reduced in size to meet the maxLength limit for the overall name
    //    -A hyphen delimiter
    //    -The GUID portion of the stack arn
  
    const stackIdGuidLength = 36;
    const prefixLength = prefix.length;
    const maxPartsLength = maxLength - prefixLength - 1 - stackIdGuidLength; // 1 is the hyphen
  
    // Extract the Stack ID Guid
    const uniqueStackIdPart = cdk.Fn.select(2, cdk.Fn.split('/', `${cdk.Aws.STACK_ID}`));
  
    let allParts: string = '';
  
    parts.forEach((part) => {
      allParts += part;
    });
  
    if (allParts.length > maxPartsLength) {
      const subStringLength = maxPartsLength / 2;
      allParts = allParts.substring(0, subStringLength) + allParts.substring(allParts.length - subStringLength);
    }
  
    const finalName  = prefix.toLowerCase() + allParts + '-' + uniqueStackIdPart;
    return finalName;
  }

  export function generatePassword (length = 20, characters = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz~!@-#$') {
    return Array.from(crypto.randomFillSync(new Uint32Array(length)))
      .map((x) => characters[x % characters.length])
      .join('')
  }