'use strict';
/*
 * Gregor Thomson - 2029108
 *
 * Honours Project
 */

// server init
var express = require('express');
var app = express();
var async = require('async');
var wordVecs = require('./data/wordvecs25000.js').wordVecs;
var word2Vec = require('./word2Vec.js');
var stopWords = require('./data/words.js').stopWords;
var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
var xhr = new XMLHttpRequest();


app.disable('x-powered-by');

var handlebars = require('express-handlebars').create({defaultLayout:'main'});

app.engine('handlebars', handlebars.engine);

app.set('view engine', 'handlebars');
app.use(require('body-parser').urlencoded({
  extended: true
}));

app.set('port', process.env.PORT || 3000);

// set static to /public
app.use(express.static(__dirname + '/public'));

// -----------------------------------------------------------------------------
// database init -
var MongoClient = require('mongodb').MongoClient;
var string = require('string');
const url = 'mongodb://localhost:27017/honoursProject';


// -----------------------------------------------------------------------------
// base directory
app.get('/', function(req, res){
  res.render('home');
});


/*
 * generates word relavence score for description and normilises
 * d = job descripton, s = skill
 * skillMap = Map({skill, score})
 */
function generateScore(skillMap, d, s){
  var sLen = s.split(" ").length;
  return (1/d.length) * (skillMap.get(s)/sLen);
}

/*
 * generates a skill map Map({skill, score})
 * skills = Array(skill1, score1, skill2, score2, ..., skillN, scoreN)
 */
function generateSkillMap(skills){
  var i = 0;
  var map = new Map();
  while (i < skills.length){
    if (map.has(skills[i])) {
      map.set(skills[i], map.get(skills[i]) + parseFloat(skills[i+1]));
    }
    else {
      map.set(skills[i],parseFloat(skills[i+1]));
    }
    i += 2;
  }
  return map;
}

/*
 * strips out stop words in job description
 */
function stripStopWords(d){
  var newDescription = [];
  for (var i = 0; i < d.length; i ++){
    if (stopWords.indexOf(d[i]) == -1){   // isn't a stop word
      newDescription.push(d[i])
    }
  }
  return newDescription;
}


/*
 * Process algorithm 1: word embedding words
 * uses word embeddings on each word in the description
 * to find related words. Then uses thoughs words to
 * match to skills.
 */
app.post('/process', function(req, res){
  var description = req.body.description;
  var skills = [];
  var words = new Set();
  var skillWordsMap = new Map();
  var skillList = [];
  var skillMap = new Map();
  var originalSkillMap = new Map();

  // replace punctuation with space
  var originalDescription = description.replace(/['";:,.\/?\\-]/g, ' ');
  // strip the rest of the punctuation
  originalDescription = string(originalDescription).stripPunctuation().s;
  // split on space
  originalDescription = originalDescription.split(" ");
  // remove stop words
  var jobDescription = stripStopWords(originalDescription);

  // Connect to the db
  MongoClient.connect(url, function(err, db) {
    if(err) {
      console.log("Failed to connect to server: ", err)
    }
    else {
      console.log("Connected to DB");
      var collection = db.collection('skills');

      // for each word in description
      async.eachSeries(jobDescription,function(w, callback) {
        w = w.toLowerCase();
        collection.findOne({word: w}, function(err, result) {
          if (result){
            // add to matched words
            words.add(w);
            // add to skills
            var i = 0;
            var originalSkill;
            result.skills.split(";").forEach(function(s){
              s = s.replace(/[\[\]{()}]/g, '').trim();
              originalSkill = s;
              s = s.toLowerCase()
              // add skill and score
              // array [skill1,score1, skill2, score2, ... , skilln, scoren]
              skills.push(s);

              // create Map<skill, words used>
              // used to find which words mapped to a skill
              if (i%2 == 0){  // for skills, not scores
                if (skillWordsMap.has(s)) {
                  skillWordsMap.set(s, skillWordsMap.get(s).add(w));
                }
                else {
                  skillWordsMap.set(s,new Set().add(w));
                  originalSkillMap.set(s, originalSkill); // for display purposes
                }
              }
              i++;
            });

          }
          callback(err);
        });
      },function(err) {
          if (err){
            console.log("Error: ", err);
          }
          else {
            skillMap = generateSkillMap(skills);
            skills = Array.from(skillWordsMap.keys())

            for (var i = 0; i < skills.length; i++){
              // normilise score
              skillMap.set(skills[i], generateScore(skillMap, jobDescription, skills[i]));

              // create return list
              skillList.push({skill: originalSkillMap.get(skills[i]),
                              score: skillMap.get(skills[i]),
                              words: Array.from(skillWordsMap.get(skills[i]))
                            });
            }

            // get top ten skills
            var score = [];
            var topTen = [];
            skillList.forEach(function(skill) {
              score.push(skill.score);
            });

            var max = score[0];
            var maxIndex = 0;
            for (var i = 0; i < 10 && i < score.length; i ++){
              for (var j = 1; j < score.length; j++) {
                  if (score[j] > max) {
                      maxIndex = j;
                      max = score[j];
                  }
              }
              topTen.push(skillList[maxIndex]);
              // set score to min
              score[maxIndex] = -1;
              max = score[0];
              maxIndex = 0;
            }

            //TODO fix textbox highlight to only show words
            words.delete("c");
            words = Array.from(words).sort();

            res.render('overview',{
              "skills" : topTen,
              "words" : words,
              "description" : description,
              "alg1": 1
            });
          }
      });
    }
  });
});

function processFile(file, processFileCallback) {
}

/*
 * Process algorithm 2: word embedding vectors
 * uses word embeddings to create a word embedding
 * vector for the job description. Compare this
 * vector to the skill vectors.
 */
app.post('/process2', function(req, res){
  var OriginalDescript = req.body.description;
  var descriptVec = [];
  // replace punctuation with space
  var jobDescription = OriginalDescript.replace(/['";:,.\/?\\-]/g, ' ');
  // strip the rest of the punctuation
  jobDescription = string(jobDescription).stripPunctuation().s;
  // split on space
  jobDescription = jobDescription.split(" ");
  // remove stop words
  var description = stripStopWords(jobDescription);
  var matched = 0;  // number of words matched to a vector

  // init description vector
  for (var i = 0; i < 300; i++){
    descriptVec[i] = 0;
  }

  // for each word in description
  var word = "";
  var currentVec = [];
  for (var i = 0; i < description.length; i++) {
    word = description[i].toLowerCase();
    // add to description vector
    currentVec = wordVecs[word];
    if (currentVec !== undefined){
      matched++;
      for (var j = 0; j < currentVec.length; j++){
        descriptVec[j] += currentVec[j];
      }
    }

  }

  // get average vector
  if (matched != 0){
    for (var x = 0; x < descriptVec.length; x++){
      descriptVec[x] = descriptVec[x]/matched;
    }
  }
  else {  // no word in description matched.
    skillVector = null;
  }

  // Connect to the db
  MongoClient.connect(url, function(err, db) {
    if(err) {
      console.log("Failed to connect to server: ", err)
    }
    else {
      console.log("Connected to DB");
      var collection = db.collection('skillVec');
      collection.find({}).toArray(function (err, result) {
        if (err) {
          res.send(err);
        } else if (result.length) {
          // get 10 closest skills vectors to description vector
          var simSkills = word2Vec.getNClosestMatches(10, descriptVec, result);
          // only get skill
          var skills = [];
          var words = [];
          for (var j = 0; j < simSkills.length; j++){
            skills.push({
              "skill": simSkills[j][0],
              "score": simSkills[j][1]
            });
            words.push(simSkills[j][0]);
          }
          res.render('overview',{
            // Pass the returned database documents
            "skills" : skills,
            "description" : OriginalDescript,
            "words" : words,
            "alg2": 1
          });
        } else {
          res.send('No documents found');
        }
        //Close connection
        db.close();
      });
    }
  });
});

/*
 * Algorithm for alg3
 *
 */
app.post('/process3', function(req, res){
  var description = req.body.description;
  var skills = [];
  var words = new Set();
  var skillWordsMap = new Map();
  var skillList = [];
  var skillMap = new Map();
  var originalSkillMap = new Map();
  const MAX_WIKI_VIEWS = 40175; // used to normilise wiki score
  const LAMBDA = 0.5; // used weight scoring. >0.5 similarity is weighted more <0.5 wiki_popularity is weighted more


  // replace punctuation with space
  var originalDescription = description.replace(/['";:,.\/?\\-]/g, ' ');
  // strip the rest of the punctuation
  originalDescription = string(originalDescription).stripPunctuation().s;
  // split on space
  originalDescription = originalDescription.split(" ");
  // remove stop words
  var jobDescription = stripStopWords(originalDescription);

  // Connect to the db
  MongoClient.connect(url, function(err, db) {
    if(err) {
      console.log("Failed to connect to server: ", err)
    }
    else {
      console.log("Connected to DB");
      var collection = db.collection('skills');

      // for each word in description
      async.eachSeries(jobDescription,function(w, callback) {
        w = w.toLowerCase();
        collection.findOne({word: w}, function(err, result) {
          if (result){
            // add to matched words
            words.add(w);
            // add to skills
            var i = 0;
            var originalSkill;
            result.skills.split(";").forEach(function(s){
              s = s.replace(/[\[\]{()}]/g, '').trim();
              originalSkill = s;
              s = s.toLowerCase()
              // add skill and score
              // array [skill1,score1, skill2, score2, ... , skilln, scoren]
              skills.push(s);

              // create Map<skill, words used>
              // used to find which words mapped to a skill
              if (i%2 == 0){  // for skills, not scores
                if (skillWordsMap.has(s)) {
                  skillWordsMap.set(s, skillWordsMap.get(s).add(w));
                }
                else {
                  skillWordsMap.set(s,new Set().add(w));
                  originalSkillMap.set(s, originalSkill); // for display purposes
                }
              }
              i++;
            });

          }
          callback(err);
        });
      },function(err) {
          if (err){
            console.log("Error: ", err);
          }
          else {
            skillMap = generateSkillMap(skills);
            skills = Array.from(skillWordsMap.keys())

            // normilise score
            for (var i = 0; i < skills.length; i++){
              skillMap.set(skills[i], generateScore(skillMap, jobDescription, skills[i]));
            }

            // add wiki popularity to score to upweight more relevent skills
            MongoClient.connect(url, function(err, db) {
              if(err) {
                console.log("Failed to connect to server: ", err)
              }
              else {
                console.log("Connected to DB");
                var collection = db.collection('skillWiki');
                // for (var i = 0; i < skillsInDescription.length; i++) {
                async.each(skills,function(s, callback) {
                  s = s.toLowerCase();
                  collection.findOne({skill: s}, function(err, result) {
                    if (err) {
                      res.send(err);
                      callback(err);
                    }
                    else if (result !== null) {
                      // score = (1-lambda)score * (lambda)average_views
                      skillMap.set(result.skill, (1 - LAMBDA)* parseFloat(skillMap.get(result.skill)) * (LAMBDA * (parseFloat(result.average_views) / MAX_WIKI_VIEWS) ));
                    }
                    callback();
                  });


                }, function(err, result) {
                  if (err){
                    console.log("Error: ", err);
                  }
                  else {

                    console.log(skillMap);

                    // create return list {skill:x, score:y, words:z}
                    for (var i = 0; i < skills.length; i++){
                      skillList.push({skill: originalSkillMap.get(skills[i]),
                                      score: skillMap.get(skills[i]),
                                      words: Array.from(skillWordsMap.get(skills[i]))
                                    });
                    }

                    // get top ten skills
                    var score = [];
                    var topTen = [];
                    for (var i = 0; i < skillList.length; i++){
                      score.push(skillList[i].score);
                    }

                    var max = score[0]; //initial max
                    var maxIndex = 0;
                    // find max score
                    for (var i = 0; i < 10 && i < score.length; i ++){
                      for (var j = 1; j < score.length; j++) {
                          if (score[j] > max) {
                              maxIndex = j;
                              max = score[j];
                          }
                      }
                      topTen.push(skillList[maxIndex]);
                      // set score to min
                      score[maxIndex] = -1;
                      max = score[0];
                      maxIndex = 0;
                    }

                    //TODO fix textbox highlight to only show words
                    words.delete("c");
                    words = Array.from(words).sort();

                    res.render('overview',{
                      "skills" : topTen,
                      "words" : words,
                      "description" : description,
                      "alg3": 1
                    });
                  }
                }); // ./async.eachSeries
              }
          }); // ./mongodbClient
        }
      }); // ./async.eachSeries
    }
  }); // ./mongodbClient
});


/*
 * Algorithm for alg4
 * Make use of the tree structure
 *
 */
app.post('/process4', function(req, res){
  var OriginalDescript = req.body.description;

  res.render('overview',{
    "skills" : [],
    "description" : OriginalDescript,
    "words" : [],
    "alg4": 1
  });
});



app.use(function(req, res, next){
  console.log("Looking for URL " + req.url);
  next();
});

/*
 * render about page
 */
app.get('/about', function(req, res){
  res.render('about');
});

/*
 * render contact page
 */
app.get('/contact', function(req, res){
  res.render('contact');
});


/*
 * page not found: 404
 */
app.use(function(req, res){
  res.type('text/html');
  res.status('404');
  res.render('404');
});

/*
 * server error: 500
 */
app.use(function(err, req, res, next) {
  console.error(err.stack);
  res.status(500);
  res.render('500');
});


// -----------------------------------------------------------------------------
app.listen(app.get('port'), function(){
    console.log('Express started press Ctrl-C to terminate');
});

module.exports = {"app": app,
                  "MongoClient": MongoClient
                  };
