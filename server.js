const express = require('express');
const app = express();
const request = require('request');
const rp = require('request-promise');
const TOKEN ="ZBesZ0aHx2yb-JwAY.UIctkt-YpG0WwpePuDTkqe-7KH2p4iLc6xQ6ROCXvxG1xwD2zFbz9A1WHgVZsp2FVfC2h9Q3Wy9rSeOdrkkNV7pw3V-WuuyKm5Bu84qxBbz0rm";
app.set('port', 1337);

let auth = {
  Authorization: 'bearer '+TOKEN
};
app.get('/', (req,res)=>{
  console.log("hi");
  let questions;
  rp({
    url: 'https://api.surveymonkey.net/v3/surveys/81804596/details',
    headers: auth
  })
  .then(function(smres){
    console.log("Successfully receives survey details");
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
    res.json(allResponses);
  })
  .catch(err=>{
    console.log(err);
    res.sendStatus(500);
  });

  function requestAllResponsePages(){
    let responsesUri = 'https://api.surveymonkey.net/v3/surveys/81804596/responses/bulk?per_page=100';
    let responsesDataToReturn;
    return new Promise((resolve, reject)=>{
      rp({
        url: responsesUri,
        headers: auth
      })
      .then(function(responsePage1){
        console.log("Received first responses page");
        let responses = JSON.parse(responsePage1);
        let numPages = Math.ceil(responses.total/responses.per_page);
        let processedResponsePage = processReponsePage(responses);
        //console.log(processedResponsePage);
        responsesDataToReturn = processedResponsePage.data;
        let processedPages = 1;
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

app.listen(app.get('port'), ()=>console.log(`Server listening on port ${app.get('port')}`));
