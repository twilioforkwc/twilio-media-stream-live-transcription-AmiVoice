"use strict";

require('dotenv').config();
const env = process.env;
const Fs = require('fs');
const Path = require('path');
var Http = require('http');
var HttpDispatcher = require('httpdispatcher');
var WebSocketServer = require('websocket').server;
const { AmiVoiceService } = require("./amivoice-service");

var dispatcher = new HttpDispatcher();
var wsserver = Http.createServer(handleRequest);

const HTTP_SERVER_PORT = 8080;

var mediaws = new WebSocketServer({
  httpServer: wsserver,
  autoAcceptConnections: true,
});

function log(message, ...args) {
  console.log(new Date(), message, ...args);
}

function handleRequest(request, response){
  try {
    dispatcher.dispatch(request, response);
  } catch(err) {
    console.error(err);
  }
}

dispatcher.onPost('/twiml', function(req,res) {
  log('POST TwiML');

  var filePath = Path.join(__dirname+'/templates', 'streams.xml');
  var stat = Fs.statSync(filePath);

  res.writeHead(200, {
    'Content-Type': 'text/xml',
    'Content-Length': stat.size
  });

  var readStream = Fs.createReadStream(filePath);
  readStream.pipe(res);
});

mediaws.on('connect', function(connection) {
  log('Media WS: Connection accepted');
  new MediaStream(connection);
});

class MediaStream {
  constructor(connection) {
    connection.on('message', this.processMessage.bind(this));
    connection.on('close', this.close.bind(this));
    this.messageCount = 0;
    this.started = false;
    this.mediaData = '';
    this.amiVoiceConnections = {};
  }

  processMessage(message) {
    if (message.type === 'utf8') {
      var data = JSON.parse(message.utf8Data);
      if (data.event === "connected") {
        log('Media WS: Connected event received: ', data);
      }
      if (data.event === "start") {
        log('Media WS: Start event received: ', data);
        data.start.tracks.forEach(track => {
          this.amiVoiceConnections[track] = new AmiVoiceService(env.AMIVOICE_API_KEY, track);
          this.amiVoiceConnections[track].on('transcription', this.receivedMessage);
        });
      }
      if (data.event === "media") {
        //log('Media WS: Media event received: ', data);
        this.amiVoiceConnections[data.media.track].send(data.media.payload);
      }
      if (data.event === "close") {
        log('Media WS: Close event received: ', data);
        this.close();
      }
      this.messageCount++;
    } else if (message.type === 'binary') {
      log('Media WS: binary message received (not supported)');
    }
  }

  close(){
    log('Media WS: Closed. Received a total of [' + this.messageCount + '] messages');
    Object.keys(this.amiVoiceConnections).forEach(key => {
      this.amiVoiceConnections[key].close();
    });
    this.amiVoiceConnections = {};
  }

  receivedMessage(data) {
    console.log(`${data.track}:${data.body.text}`);
  }

}

wsserver.listen(HTTP_SERVER_PORT, function(){
  console.log("Server listening on: http://localhost:%s", HTTP_SERVER_PORT);
});
