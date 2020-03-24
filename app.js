"use strict";

const express = require("express");
const app = express();
const url = require('url');
const request = require('request');
const csvtojson = require('csvtojson');
const cheerio = require('cheerio');
const mongodb = require('mongodb');

const port = process.env.PORT || 3000;

const dataURL = "http://raw.githubusercontent.com/CSSEGISandData/COVID-19/master/csse_covid_19_data/csse_covid_19_daily_reports/";

let dataFile = "";
let dataObject = [];
let nationalData = {};
let provincialData = {};

const specificCountries = ["Canada", "US", "China", "Australia", "Denmark", "France", "Netherlands", "United Kingdom"];

let presentDate = "";
let pastDate = "";

let dataFetched = false;

function generateDateString(d) {
  let currentYear = d.getFullYear();
  let currentMonth = d.getMonth()+1;
  let currentDate = d.getDate();
  let string;
  if (currentMonth < 10) {
    string = "0" + currentMonth.toString();
  } else {
    string = currentMonth.toString();
  }
  if (currentDate < 10) {
    string = string + "-0" + currentDate.toString();
  } else {
    string = string + "-" + currentDate.toString();
  }
  string = string + "-" + currentYear.toString();
  return string;
}

function getCurrentDate() {
  let d = new Date();
  presentDate = generateDateString(d);
  console.log("Current Date: "+ presentDate);
  getPreviousDate();
}
function getPreviousDate() {
  let d = new Date();
  d.setDate(d.getDate() - 1);
  pastDate = generateDateString(d);
  console.log("Previous Date: " + pastDate);
}

function retrieveOfficialData() {
  request("https://api.ontario.ca/api/drupal/page%2F2019-novel-coronavirus?fields=body", function(error, response, body) {
    let outputData = JSON.parse(body);
    const $ = cheerio.load(outputData["body"]["und"][0]["safe_value"]);
    for (let i = 0; i < dataObject.length; i++) {
      if (dataObject[i]["Province_State"] === "Ontario") {
        dataObject[i]["Confirmed"] = $("tr:contains('Confirmed positive')").eq(0).children().eq(1).text();
        dataObject[i]["Recovered"] = $("tr:contains('Resolved')").eq(0).children().eq(1).text();
        dataObject[i]["Deaths"] = $("tr:contains('Deceased')").eq(0).children().eq(1).text();
        console.log("Retrieved official data for ONTARIO");
        break;
      }
    }
    getAllNationalData();
    getAllProvincialData();
  });
}

function getNewData() {
  request(dataURL + presentDate + ".csv", function (error, response, body) {
    if (body.length > 50) {
      dataFile = body;
      console.log("Retrieved today's data.");
      parseData();
      dataFetched = true;
    } else {
      request(dataURL + pastDate + ".csv", function (error, response, body) {
        dataFile = body;
        console.log("Retrieved yesterday's data.");
        parseData();
        dataFetched = true;
      });
    }
  });
}

function parseData() {
  csvtojson().fromString(dataFile).then((jsonObj) => {
    dataObject = jsonObj;
    console.log("Parsed data");
    retrieveOfficialData();
  })
}

function getProvincialCases(province) {
  let obj = [];
  for (let i = 0; i < dataObject.length; i++) {
    if (dataObject[i]["Province_State"].toLowerCase() === province) {
      let caseVar = dataObject[i]["Confirmed"];
      let deathsVar = dataObject[i]["Deaths"];
      let recoveriesVar = dataObject[i]["Recovered"];
      obj = {"confirmed_cases": caseVar, "deaths": deathsVar, "recoveries": recoveriesVar};
      break;
    }
  }
  return obj;
}

function getNationalCases(country) {
  let obj = [];
  for (let i = 0; i < dataObject.length; i++) {
    if (dataObject[i]["Country_Region"].toLowerCase() === country) {
      let caseVar = dataObject[i]["Confirmed"];
      let deathsVar = dataObject[i]["Deaths"];
      let recoveriesVar = dataObject[i]["Recovered"];
      obj = {"confirmed_cases": caseVar, "deaths": deathsVar, "recoveries": recoveriesVar};
      break;
    }
  }
  return obj;
}

function getAllProvincialData() {
  let obj = {};
  for (let i = 0; i < dataObject.length; i++) {
    const regionName = dataObject[i]["Province_State"];
    if (!regionName) continue;
    obj[regionName] = {
      country: dataObject[i]["Country_Region"],
      last_update : dataObject[i]["Last Update"],
      confirmed : +dataObject[i]["Confirmed"],
      deaths : +dataObject[i]["Deaths"],
      recovered : +dataObject[i]["Recovered"],
      latitude : parseFloat(dataObject[i]["Lat"]),
      longitude : parseFloat(dataObject[i]["Long_"])
    };

  }
  provincialData = obj;
  console.log("Provincial data generated");
}
function getAllNationalData() {
  let obj = {};
  for (let i = 0; i < dataObject.length; i++) {
    const regionName = dataObject[i]["Country_Region"];
    if (specificCountries.includes(regionName)) {
      obj[regionName] = {confirmed : 0, deaths : 0, recovered : 0};
      continue;
    }
    obj[regionName] = {
      last_update : dataObject[i]["Last Update"],
      confirmed : +dataObject[i]["Confirmed"],
      deaths : +dataObject[i]["Deaths"],
      recovered : +dataObject[i]["Recovered"],
      latitude : parseFloat(dataObject[i]["Lat"]),
      longitude : parseFloat(dataObject[i]["Long_"])
    };
  }
  nationalData = obj;
  getSpecialCountryData();
  console.log("Country data generated");
}

function getSpecialCountryData() {
  for (let i = 0; i < dataObject.length; i++) {
    const regionName = dataObject[i]["Country_Region"];
    if (!specificCountries.includes(regionName)) continue;
    const {Confirmed = 0, Deaths = 0, Recovered = 0} = dataObject[i];
    nationalData[regionName].confirmed += +Confirmed;
    nationalData[regionName].deaths += +Deaths;
    nationalData[regionName].recovered += +Recovered;
  }
}

function refreshAllData() {
  getCurrentDate();
  getNewData();
}

setInterval(refreshAllData, 10800000);

app.get("/log_json", function(req, res) {
  res.json(dataObject);
});

app.get("/get_ontario_cases", function(req, res) {
  let ontarioData = getProvincialCases("ontario");
  res.end(ontarioData["confirmed_cases"] + " " + ontarioData["deaths"] + " " + ontarioData["recoveries"]);
});

app.get("/get_provincial_cases", function(req, res) {
  let parameters = url.parse(req.url,true).query;
  let obj = getProvincialCases(parameters["province"]);
  console.log("User requested data for province: " + parameters["province"].toUpperCase());
  res.json(obj);
});

app.get("/get_national_cases", function(req, res) {
  let parameters = url.parse(req.url,true).query;
  let obj = getNationalCases(parameters["country"]);
  console.log("User requested data for country: " + parameters["country"].toUpperCase());
  res.json(obj);
});

app.get("/get_country_data", function(req, res) {
  res.end(JSON.stringify(nationalData));
  console.log("User requested country JSON");
});

app.get("/get_provincial_data", function(req, res) {
  res.end(JSON.stringify(provincialData));
  console.log("User requested province JSON");
});

const listener = app.listen(port, function() {
  console.log("Listening on port " + listener.address().port);
  refreshAllData();
});