const express = require('express');
const app = express();
const request = require('request');
const rp = require('request-promise');
const {TOKEN} = require("./.config.js");
const fs = require('fs');
const https = require('https');
const http = require('http');
app.set('port', 1337);
app.use(express.static("static"));

let auth = {
  Authorization: 'bearer '+TOKEN
};
let cached = null;
let last_cached_time = 0;

app.use((req,res,next)=>{
  if (req.hostname.indexOf("localhost") > -1 || req.hostname.indexOf("techlaunch") > -1){
    res.header("Access-Control-Allow-Origin", "*");
    res.header('Access-Control-Allow-Headers', "Content-Type")
  }
	next();
});

app.use(ensureSecure);

app.get('/api/surveyquestions', (req,res)=>{
  console.log("Received request for questions");
  rp({
    url: 'https://api.surveymonkey.net/v3/surveys/81804596/details',
    headers: auth
  })
  .then(smResp=>{
    smResp = JSON.parse(smResp);
    console.log(smResp);
    res.json(smResp);
  })
});

app.get('/api/instructors', (req,res)=>{
  console.log("Received request for instructors");
  rp({
    url: "https://api.surveymonkey.net/v3/surveys/81804596/pages/247249300/questions/983930695",
    headers: auth
  })
  .then(smResp=>{
    smResp = JSON.parse(smResp);
    console.log(smResp);
    let instructors = smResp.answers.choices.reduce((acc,choice)=>{
      acc[choice.id]=choice.text;
      return acc;
    },{});
    res.json(instructors);
  })
});

app.get('/api/page1', (req,res)=>{
  rp({
    url: 'https://api.surveymonkey.net/v3/surveys/81804596/responses/bulk?per_page=100&start_modified_at='+new Date().toISOString(),
    headers: auth
  })
  .then(smres=>{
    smres=JSON.parse(smres);
    res.json(smres);
  })
  .catch(err=>{
    console.log(err);
    res.sendStatus(500);
  });
});

app.get('/api/surveyresults', (req,res)=>{
  console.log("hi");
  // if (!req.query.forcerefresh){
  //   if (cached && typeof last_cached_time == "number" && new Date().getTime() - last_cached_time < CACHE_TIMEOUT){
  //     return res.json(cached);
  //   }
  // }
  let questions;
  rp({
    url: 'https://api.surveymonkey.net/v3/surveys/81804596/details',
    headers: auth
  })
  .then(function(smres){
    console.log("Successfully received survey details");
    smres = JSON.parse(smres);
    questions = smres.pages.reduce((acc,pg)=>acc.concat(pg.questions), [])
                    .map(q=>({id:q.id, answers: q.answers, text: q.headings[0].heading}));
    let questionHash = {};
    questions.forEach(q=>{
      questionHash[q.id] = q;
      if (q.answers && q.answers.choices){
        q.answerChoiceHash = {};
        q.answers.choices.forEach(choice=>{
          q.answerChoiceHash[choice.id] = choice.text;
        })
        delete q.answers;
      }
    })
    questions = questionHash;
    //res.json(questions);
    //answers: { choices: [{text id},{text, id}]}
    return requestAllResponsePages();
  })
  .then(function(allResponses){
    last_cached_time = new Date();
    cached = allResponses;
    let stringified = JSON.stringify(allResponses);
    res.header('content-length', Buffer.byteLength(stringified, 'utf-8'));
    res.header('Content-Type', 'application/json; charset=utf-8')
    res.json(allResponses);
  })
  .catch(err=>{
    console.log(err);
    res.sendStatus(500);
  });

  function requestAllResponsePages(){
    let responsesUri = 'https://api.surveymonkey.net/v3/surveys/81804596/responses/bulk?per_page=100';
    let responsesDataToReturn;
    if (cached && last_cached_time){
      responsesUri += "&start_modified_at="+last_cached_time.toISOString();
      responsesDataToReturn = cached;
    }
    return new Promise((resolve, reject)=>{
      rp({
        url: responsesUri,
        headers: auth
      })
      .then(function(responsePage1){
        console.log("Received first responses page");
        let responses = JSON.parse(responsePage1);
        let numPages = Math.ceil(responses.total/responses.per_page);
        if (numPages === 0){
          resolve(cached);
          return;
        }
        let processedResponsePage = processReponsePage(responses);
        //console.log(processedResponsePage);
        if (cached)
          responsesDataToReturn = cached.concat(processedResponsePage.data);
        else
          responsesDataToReturn = processedResponsePage.data;

        if (numPages === 1){
          console.log("resolved with first request");
          resolve(responsesDataToReturn);
          return;
        }
        let processedPages = 1;
        console.log("getting ready to send "+numPages+" more requests");
        for(let i = 2; i<= numPages; i++){
          request({url: responsesUri+"&page="+i, headers: auth}, function(err, res, body){
            let responsePage = JSON.parse(body);
            console.log(processedPages);
            processedResponsePage = processReponsePage(responsePage);
            responsesDataToReturn = responsesDataToReturn.concat(processedResponsePage.data);
            processedPages++;
            if (processedPages === numPages){
              console.log("Resolving...");
              resolve(responsesDataToReturn);
            }
          })
        }

      })
      .catch(err=>{
        reject({processedPages,numPages, err});
      })
    });
  }
  function processReponsePage(responses){
    responses.data.forEach(fullResponse=>{
      fullResponse.answers = {};
      fullResponse.pages.forEach(page=>{
        page.questions.forEach(q=>{
          fullResponse.answers[q.id] = {
            text: questions[q.id].text,
            ansID: q.answers[0].choice_id || "text",
            answer: q.answers&&q.answers[0].choice_id ? questions[q.id].answerChoiceHash[q.answers[0].choice_id] : q.answers[0].text
          };
        })
      });
      delete fullResponse.pages;
    });
    return responses;
  }

});

function ensureSecure(req, res, next){
  if(req.secure || req.hostname.indexOf('localhost') >= 0){
    // OK, continue
    console.log("secure middleware continuing");
    return next();
  };
  console.log("Secure middleware forwarding to",'https://' + req.hostname + ':' + app.get('port') + req.url);
  res.redirect('https://' + req.hostname + ":" + app.get('port') + req.url); // express 4.x
};


const env = process.env.NODE_ENV || 'dev';

if (env === 'dev'){
  http.createServer(app)
  .listen(app.get('port'), ()=>console.log(`Server listening on port ${app.get('port')}`));
}
else {
  let httpsOptions = {
    key: fs.readFileSync('/etc/letsencrypt/live/apps.techlaunch.io/privkey.pem'),
    cert: fs.readFileSync('/etc/letsencrypt/live/apps.techlaunch.io/fullchain.pem'),
    ca: fs.readFileSync('/etc/letsencrypt/live/apps.techlaunch.io/chain.pem')
  };
  
  https.createServer(httpsOptions, app)
    .listen(app.get('port'), ()=>console.log(`Server listening on port ${app.get('port')}`));
}


