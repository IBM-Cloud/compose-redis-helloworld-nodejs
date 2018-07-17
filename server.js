/**
 * Copyright 2016 IBM Corp. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the “License”);
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *  https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an “AS IS” BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

"use strict";
/* jshint node:true */

// Add the express web framework
const express = require("express");
const { URL } = require("url");
const app = express();

// Use body-parser to handle the PUT data
const bodyParser = require("body-parser");
app.use(
    bodyParser.urlencoded({
        extended: false
    })
);

// Util is handy to have around, so thats why that's here.
const util = require('util')

// and so is assert
const assert = require('assert');

// We want to extract the port to publish our app on
let port = process.env.PORT || 8080;

// Then we'll pull in the database client library
const redis = require("redis");

// Now lets get cfenv and ask it to parse the environment variable
let cfenv = require('cfenv');

// load local VCAP configuration  and service credentials
let vcapLocal;
try {
  vcapLocal = require('./vcap-local.json');
  console.log("Loaded local VCAP");
} catch (e) { 
    // console.log(e)
}

const appEnvOpts = vcapLocal ? { vcap: vcapLocal} : {}
const appEnv = cfenv.getAppEnv(appEnvOpts);

// Within the application environment (appenv) there's a services object
let services = appEnv.services;

// The services object is a map named by service so we extract the one for Redis
let redis_services = services["compose-for-redis"];

// This check ensures there is a services for Redis databases
assert(!util.isUndefined(redis_services), "Must be bound to compose-for-redis services");

// We now take the first bound Redis service and extract it's credentials object
var credentials = redis_services[0].credentials;

// add the first connection strings to an array
let connectionStrings = [credentials.uri];

// adds all other connection strings
for(var key in credentials) {
    if (key.startsWith('uri_direct_')) {
        connectionStrings.push(credentials[key]);
    }
}

var client;
let reconnectionCounter = 0;
var retryFrequency = 2000;

// initialize client with the first index/connectionString
createClient(connectionStrings[0]);

function createClient(connectionString){
    if (connectionString.startsWith("rediss://")) {
        // If this is a rediss: connection, we have some other steps.
        client = redis.createClient(connectionString, {
            tls: { servername: new URL(connectionString).hostname }
        });
        // This will, with node-redis 2.8, emit an error:
        // "node_redis: WARNING: You passed "rediss" as protocol instead of the "redis" protocol!"
        // This is a bogus message and should be fixed in a later release of the package.
    } else {
        client = redis.createClient(connectionString);
    }
    errorHandler();
}

// checks to see if client is emitting an error.
function errorHandler() {
    client.on("error", function(err) {
        // Exist app if there is not a successful connection after 5 retries.
        if (reconnectionCounter > 5) {
            console.log('Maximum number of reconnection attempts reached. exiting...')
            process.exit(1)
        }
        console.log("Error " + err);
        if (err.code === 'ETIMEDOUT') {
            // retry connection after a certain amount of time.
            setTimeout(nextClient, retryFrequency);
        }
    });
}

// connects to the next connection string
function nextClient() {
    client.quit();
    rotateConnectionStrings();
    createClient(connectionStrings[0]);
    retryFrequency *= 5;
    reconnectionCounter++;
}

// rotates the values in the connectionStrings array to the left
function rotateConnectionStrings() {
    connectionStrings.push(connectionStrings[0]);
    connectionStrings.shift();
}

// Add a word to the database
function addWord(word, definition) {
    return new Promise(function(resolve, reject) {
        // use the connection to add the word and definition entered by the user
            client.hset("words", word, definition, function(
                error,
                result
            ) {
                if (error) {
                    reject(error);
                } else {
                    reconnectionCounter = 0;
                    retryFrequency = 2000;
                    resolve("success\n");
                }
            });
    });
}

// Get words from the database
function getWords() {
    return new Promise(function(resolve, reject) {
        // use the connection to return us all the documents in the words hash.
        client.hgetall("words", function(err, resp) {
            if (err) {
                reject(err);
            } else {
                resolve(resp);
            }
        });
    });
}

// We can now set up our web server. First up we set it to server static pages
app.use(express.static(__dirname + "/public"));

// The user has clicked submit to add a word and definition to the hash
// Send the data to the addWord function and send a response if successful
app.put("/words", function(request, response) {
    console.log('put');
    addWord(request.body.word, request.body.definition)
        .then(function(resp) {
            response.send(resp);
        })
        .catch(function(err) {
            console.log(err);
            // if the current connextion is down or retring to connect, 
            // pass the arguments back in after a connection is established
            if (err.code === "NR_CLOSED") {
                return addWord(request.body.word, request.body.definition)
            }
            response.status(500).send(err);
        });
});

// Read from the hash when the page is loaded or after a word is successfully added
// Use the getWords function to get a list of words and definitions from the hash
app.get("/words", function(request, response) {
    console.log('get')
    getWords()
        .then(function(words) {
            response.send(words);
        })
        .catch(function(err) {
            console.log(err);
            if (err.code === "NR_CLOSED") {
              return getWords()
            }
            response.status(500).send(err);
        });
});

// Listen for a connection.
app.listen(port, function() {
    console.log("Server is listening on port " + port);
});