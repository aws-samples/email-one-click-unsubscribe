// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
const crypto = require('crypto');
const http = require('http')

//SSM & Secrets Extension Helper Functions
const request = (name, version = '1') => new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 2773,
      path: `/systemsmanager/parameters/get?name=${name}&version=${version}&withDecryption=true`,
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN,
      },
    };
    
    console.log(options)

    const req = http.request(options, (res) => {
      res.on('data', (d) => {
        try {
          const json = JSON.parse(d.toString());
          resolve(json.Parameter.Value);
        } catch(error) {
          reject(error);
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.end();
});

const getLocalParameter = async (name, version) => {
    const response = await request(name, version);
    return response;
}

export function  uuid () {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        let r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

export function validateEmailAddress (email) {
    const emailRegEx = /^[^\s@]+@[^\s@]+$/
    return emailRegEx.test(email)
}

export function wait (time) {
    return new Promise((resolve) => {
        setTimeout(() => resolve(), time);
    });
}

export async function createHash (value, version) {
    let hashKey = await getLocalParameter(process.env.HASH_KEY_PATH, version);
    return crypto.createHash('sha256').update(`${value}||${hashKey}`).digest('hex');
}

export async function validateHash (value, providedHash, version) {
    let hashKey = await getLocalParameter(process.env.HASH_KEY_PATH, version);
    const hash = crypto.createHash('sha256').update(`${value}||${hashKey}`).digest('hex');
    return hash === providedHash;
}
