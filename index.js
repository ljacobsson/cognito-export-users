#!/usr/bin/env node

const AWS = require('aws-sdk');
const bluebird = require('bluebird');
const fs = require('fs');
const JSONStream = require('JSONStream');
const meow = require('meow');
const path = require('path');
const term = require('terminal-kit').terminal;

const time = require('./timer.js');

const cli = meow(`
    Usage
      cognito-export-users <user-pool-id> <options>
    
      AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY can be specified in env variables or ~/.aws/credentials

    Options
      --file File name to export/import single pool users to (defaults to user-pool-id.json)
      --dir Path to export all pools, all users to (defaults to current dir)
`);

if (!cli.input[0]) {
  cli.showHelp();
}

const credentials = new AWS.SharedIniFileCredentials({
  profile: process.env.AWS_PROFILE
});

AWS.config.credentials = credentials;
AWS.config.update({
  region: "eu-west-1"
});

const UserPoolId = cli.input[0];
const region = UserPoolId.substring(0, UserPoolId.indexOf('_'));

const cognitoIsp = new AWS.CognitoIdentityServiceProvider({ region });

const file = path.join(
  cli.flags.dir || '.',
  cli.flags.file || `${UserPoolId}.json`,
);

const writeStream = fs.createWriteStream(file);
const stringify = JSONStream.stringify();

stringify.pipe(writeStream);

let userCount = 0;

const getUsers = async (token, requestNumber = 1, attemptNumber = 1) => {
  const promise = bluebird.resolve(cognitoIsp.listUsers({
    UserPoolId,
    PaginationToken: token,
  }).promise());

  let nextToken;
  let nextRequestNumber;
  let nextAttemptNumber;

  try {
    const {
      Users,
      PaginationToken,
    } = await promise;

    Users.forEach(item => stringify.write(item));

    term(`Request #${requestNumber}: `).green('success')(` - retrieved users (${userCount + 1} - ${userCount + Users.length})\n`);

    userCount += Users.length;

    time.resetWaitTime();

    nextRequestNumber = requestNumber + 1;
    nextAttemptNumber = 1;

    nextToken = PaginationToken;
  } catch (e) {
    term(`Request #${requestNumber} (attempt#: ${attemptNumber}): `).red(`fail - ${e.code}\n`);

    await time.wait();
    time.increaseWaitTime();

    nextToken = token;
    nextRequestNumber = requestNumber;
    nextAttemptNumber = attemptNumber + 1;
  }

  if (nextToken === undefined) {
    stringify.end();
    writeStream.end();
    term.cyan('Export Finished\n');
  } else {
    getUsers(nextToken, nextRequestNumber, nextAttemptNumber);
  }
};

getUsers();
