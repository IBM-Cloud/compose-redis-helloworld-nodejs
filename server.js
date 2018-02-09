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

 // First add the obligatory web framework
var express = require('express');
var app = express();
var bodyParser = require('body-parser');
const url = require("url");


app.use(bodyParser.urlencoded({
  extended: false
}));

// Util is handy to have around, so thats why that's here.
const util = require('util')
// and so is assert
const assert = require('assert');

// We want to extract the port to publish our app on
var port = process.env.PORT || 8080;

// Then we'll pull in the database client library
var redis = require("redis");

// Now lets get cfenv and ask it to parse the environment variable
var cfenv = require('cfenv');
var appenv = cfenv.getAppEnv();

// Within the application environment (appenv) there's a services object
var services = appenv.services;
// The services object is a map named by service so we extract the one for Redis
var redis_services = services["compose-for-redis"];

// This check ensures there is a services for Redis databases
assert(!util.isUndefined(redis_services), "Must be bound to compose-for-redis services");

// We now take the first bound Redis service and extract it's credentials object
var credentials = redis_services[0].credentials;

/// This is the Redis connection. From the application environment, we got the
// credentials and the credentials contain a URI for the database. Here, we
// connect to that URI
let client = null;

if (credentials.uri.startsWith("rediss://")) {
  // If this is a rediss: connection, we have some other steps.
  client = redis.createClient(credentials.uri, {
    tls: { servername: url.parse(credentials.uri).hostname }
  });
  // This will, with node-redis 2.8, emit an error:
  // "node_redis: WARNING: You passed "rediss" as protocol instead of the "redis" protocol!"
  // This is a bogus message and should be fixed in a later release of the package.
} else {
  client = redis.createClient(credentials.uri);
}

client.on("error", function (err) {
    console.log("Error " + err);
});

// We can now set up our web server. First up we set it to server static pages
app.use(express.static(__dirname + '/public'));

app.put("/words", function(request, response) {

  // use the connection to add the word and definition entered by the user
  client.hset("words", request.body.word, request.body.definition, function(error, result) {
      if (error) {
        response.status(500).send(error);
      } else {
        response.send("success");
      }
    });
});

// Then we create a route to handle our example database call
app.get("/words", function(request, response) {

    // and we call on the connection to return us all the documents in the
    // words hash.

    client.hgetall("words",function(err, resp) {
      if (err) {
        response.status(500).send(err);
      } else {
        response.send(resp);
      }
    });
});

// Now we go and listen for a connection.
app.listen(port);
