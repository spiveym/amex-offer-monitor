'use strict';
///////////////////////////////////////////////////////////////////////////////
// Dependencies
///////////////////////////////////////////////////////////////////////////////

const async = require('async');
const yaml = require('js-yaml');
const fs = require('fs');
const winston = require('winston');
const path = require('path');
const os = require('os');
const moment = require('moment-timezone');
const nodemailer = require('nodemailer');
const Nightmare = require('nightmare');
const sprintf = require('sprintf-js').sprintf;

///////////////////////////////////////////////////////////////////////////////
// Variable Initialization
///////////////////////////////////////////////////////////////////////////////

const START = "https://online.americanexpress.com/myca/logon/us/action/LogonHandler?request_type=LogonHandler&Face=en_US&DestPage=https%3A%2F%2Fonline.americanexpress.com%2Fmyca%2Faccountsummary%2Fus%2Faccounthome%3Frequest_type%3Dauthreg_acctAccountSummary%26sorted_index%3D0%26inav%3Dmenu_myacct_acctsum";

var config;
var arg_username;
var arg_password;
var cardcount = 1; //this will be updated later
var nocred_mode = false;
var loglevel = 'info';
var configfile = path.resolve(__dirname,'config.yml');
var logfile = path.resolve(__dirname, 'amex-offer-monitor.log');
var historyfile = path.resolve(__dirname, 'amexoffers-data.json');
var fakedatafile = path.resolve(__dirname, 'amexoffers-fakedata.json');
var resultfile = path.resolve(__dirname, 'amexoffers-result.html');
var leaveopen = false;
var slowmo = true;
var slowmo_factor = 1;

//debug vars
var debug_fake_data = false; //skips the amex lookup, loads a fake table instead to not pound their server
var debug_max_cards = -1; //if >= 0, only look at N cards, instead of all cards by default
var debug_nomail = false; //skip the email

///////////////////////////////////////////////////////////////////////////////
// Command-line processing
///////////////////////////////////////////////////////////////////////////////

process.argv.forEach((arg, i, argv) => {
    switch (arg) {
        case '--username':
            arg_username = argv[i + 1];
            break;
        case '--password':
            arg_password = argv[i + 1];
            break;
        case '--loglevel':
            loglevel = argv[i + 1];
            break;
        case '--fakedata':
            debug_fake_data = true;
            break;
        case '--nomail':
            debug_nomail = true;
            break;
        case '--maxcards':
            debug_max_cards = argv[i+1];
            break;
        case '--nocred': //use this if you don't want to provide your credentials into 
                         //the script, but instead want to type them directly into the
                         //electron window
            nocred_mode = true;
            break;
        case '--config':
            configfile = argv[i+1];
            break;
        case '--leaveopen':
            leaveopen = true;
            break;
    }
});

///////////////////////////////////////////////////////////////////////////////
// Configuration File Processing
///////////////////////////////////////////////////////////////////////////////

config = yaml.safeLoad(fs.readFileSync(configfile, 'utf8'))

///////////////////////////////////////////////////////////////////////////////
// Options final resolve
///////////////////////////////////////////////////////////////////////////////

const logger = new (winston.Logger)({
    transports: [
        new (winston.transports.File)({
            timestamp: true,
            json: false,
            level: loglevel,
            filename: logfile
        })
    ]
});

if(config.amex.historyfile) {
    historyfile = path.resolve(__dirname, config.amex.historyfile);
}

var au = null;
var ap = null;

if(!nocred_mode) {
    au = arg_username ? arg_username : config.amex.un? config.amex.un : null;
    ap = arg_password ? arg_password : config.amex.p ? config.amex.p : null;
    if(!au) {
        let msg = "Must specify a username in config (config.amex.un) or with --username arg";
        console.error(msg);
        logger.error(msg);
        process.exit(1);
    }
    if(!ap) {
        let msg = "Must specify a password in config (config.amex.p) or with --password arg";
        console.error(msg);
        logger.error(msg);
        process.exit(1);
    }
}

const nightmare = new Nightmare({ show: true });
      nightmare.on('console', (log, msg) => {
         console.log(msg)
      });
      nightmare.on('logger', (info, msg) => {
         logger.info(msg)
      });

///////////////////////////////////////////////////////////////////////////////
// Support Functions
///////////////////////////////////////////////////////////////////////////////
//
const getRandomWait = () => {
  if(slowmo) {
    var min = Math.ceil(10000*slowmo_factor);
    var max = Math.floor(30000*slowmo_factor);
    var wait = Math.floor(Math.random() * (max - min)) + min; //The maximum is exclusive and the minimum is inclusive
    var wait_seconds = wait/1000;
    console.log('Sleeping for ' + wait_seconds + ' seconds for slowmo');
    return wait;
  } else {
    return 0;
  }
}

const amexLogin = async nightmare => {
  console.log('Logging into amex.com');
  logger.info('Logging into amex.com');

  try {
    let logged_in = false;
    if(nocred_mode) {
        await nightmare
        .goto(START)
        .wait(10000)
        .wait('a[href="/offers/eligible"]')
        .click('a[href="/offers/eligible"]')
        .wait(2000);
        logged_in = true;
    } else {
        await nightmare
          .goto(START)
          .wait('input[name="UserID"]')
          .type('input[name="UserID"]', au)
          .wait('input[name="Password"]')
          .type('input[name="Password"]', ap)
          .click('input[id="lilo_formSubmit"]');

        for(let i =0; i< 30; i++) {
          await nightmare.wait(1000);
          if(await nightmare.exists('input[id="onl-social"]')) {
             await nightmare.wait(5000);
             if(config.amex.l4s) {
                 await nightmare
                     .type('input[id="onl-social"]', config.amex.l4s)
                     .wait(1000)
                     .click('button[title="Click here to confirm the security information you entered"]')
                     .wait(5000);
             } else {
                await nightmare.end();
                throw "Amex asked for last 4 ssn to continue, but you did not provide it in config file, can't continue";
             }
          }
          if(await nightmare.exists('a[href="/offers/eligible"]')) {
              //await nightmare
              //    .click('a[href="/offers/eligible"]')
              //    .wait(2000);
              logged_in = true;
          }
          if(logged_in) { break; }
        }
    }
    if(logged_in) { 
        console.log("Logged in and ready");
        logger.info("Logged in and ready");
        await nightmare.wait(getRandomWait());
        return true;
    } else {
        console.log("Login Failed");
        logger.info("Login Failed");
        process.exit(1);
    }
  } catch(e) {
    console.error(e);
    logger.error(e);
    process.exit(1);
  }
}  

const gotoMain = async (nightmare) => {

    await nightmare.click('a[href="/dashboard?inav=MYCA_Home"]').
        wait(2000);
    await nightmare.wait(getRandomWait());

}

const chooseCard = async (nightmare, cardId) => {

  console.log('Choosing a card (id = ' + cardId + ') ...');
  logger.info('Choosing a card (id = ' + cardId + ') ...');


    var ready = false;
    while(!ready) {
      ready = await nightmare
      .wait('button[class*="axp-account-switcher"]')
      .click('button[class*="axp-account-switcher"]')
      .wait(1000)
      .exists('div[id="accounts"]');
      console.log("Ready = " + ready);
    }

    //if there's more than 4 cards in the switcher list, expand the list to view them all in the switcher
    await nightmare.wait(getRandomWait());
    const viewall = await nightmare.exists('a[title="View All"]');
    if(viewall) {
        await nightmare.click('a[title="View All"]').wait(500);
        await nightmare.wait(getRandomWait());
    }

      let result = await nightmare
      .evaluate((id)=>{
        var elements = Array.from(document.querySelectorAll('header[role="listitem"]'));
        if(elements.length == 0) {
            throw "found no cards in the card switcher!"
        }
        console.log("Found " + elements.length + " cards and choosing number " + id + "\n");
        //logger.info("Found " + elements.length + " cards and choosing number " + id + "\n");
        elements[id].click();
        return [elements.length, elements[id].childNodes[0].childNodes[0].childNodes[1].innerText];
      }, cardId);
      console.dir(result);
      logger.debug(JSON.stringify(result, null, 2));
      cardcount = result[0];
      await nightmare.wait(1000);

      //if the switcher is still open, try to close it
      if(await nightmare.exists('div[id="accounts"]')) {
         console.debug("switcher is still open, attempting to close it");
         await nightmare
          .click('button[class*="axp-account-switcher"]')
          .wait(1000);
      }

      console.log("Done with chooseCard " + cardId);
      logger.info("Done with chooseCard " + cardId);
      return result[1];
}


const getOffers = async nightmare => {
  console.log('Now getting offers');
  logger.info('Now getting offers');

  await nightmare.wait('a[href="/offers"]')
                 .click('a[href="/offers"]');
  await nightmare.wait(getRandomWait());

  try {
    //eligible offers
    const eligible_result = await nightmare
      .wait('a[href="/offers/eligible"]')
      .click('a[href="/offers/eligible"]')
      .wait('section[class="offers-list"]')
      .wait(1000)
      .evaluate(() => {
         let offers = [...document.querySelectorAll('div[class^="offer-info offer-column"]')]
           .map(el => el.innerText);
         let expys = [...document.querySelectorAll('div[class^="offer-expires offer-column"]')]
           .map(el => el.innerText);
         return [offers, expys];
      });
      console.dir(eligible_result);
      logger.debug(eligible_result);
      await nightmare.wait(2000);
      await nightmare.wait(getRandomWait());

      if(eligible_result[0].length != eligible_result[1].length) {
        throw "found a different number of offers than expiration dates"; 
      }
      var transpose_result = []
      for(let i =0; i< eligible_result[0].length; i++) {
        transpose_result.push([eligible_result[0][i], eligible_result[1][i], 'eligible']);
      }

    //enrolled offers
    const enrolled_result = await nightmare
      .wait('a[href="/offers/enrolled"]')
      .click('a[href="/offers/enrolled"]')
      .wait('section[class="offers-list"]')
      .wait(1000)
      .evaluate(() => {
         let offers = [...document.querySelectorAll('div[class^="offer-info offer-column"]')]
           .map(el => el.innerText);
         let expys = [...document.querySelectorAll('div[class^="offer-expires offer-column"]')]
           .map(el => el.innerText);
         return [offers, expys];
      });
      console.dir(enrolled_result);
      console.debug(enrolled_result);
      await nightmare.wait(2000);
      await nightmare.wait(getRandomWait());

      if(enrolled_result[0].length != enrolled_result[1].length) {
        throw "found a different number of offers than expiration dates"; 
      }
      for(let i =0; i< enrolled_result[0].length; i++) {
        transpose_result.push([enrolled_result[0][i], enrolled_result[1][i], 'enrolled']);
      }

      return transpose_result;

  } catch(e) {
    console.error(e);
    logger.error(e);
    return [];
  }
}  


const send_email = async message => {

  // create reusable transporter object using the default SMTP transport
  let transporter = nodemailer.createTransport({
    host: config.email.from_smtp_server,
    port: config.email.from_smtp_port,
    secure: false, // true for 465, false for other ports
    auth: {
      user: config.email.from_address,
      pass: config.email.from_p
    }
  });

  // send mail with defined transport object
  let timestamp = moment().format("MMM Do, h:mm a");
  let emailsubject = (config.email.subject ? config.email.subject : "Amex Offer Update") + " : " + timestamp;
  let info = await transporter.sendMail({
    from: '"Amex Offer Monitor" <' + config.email.from_address + '>', // sender address
    to: config.email.to, // list of receivers
    subject: emailsubject,
    text: "", // plain text body
    html: message // html body
  });

  console.log("Message sent: %s", info.messageId);
}


const printHtmlTable = data => {

    console.debug("printHtmlTable: \n");
    console.debug(data);
    logger.debug("printHtmlTable: \n");
    logger.debug(data);
    let alloffers = {};
    for(var card in data) {
        if(Array.isArray(data[card])) {
            for(var i = 0; i< data[card].length; i++) {
                let offerraw = data[card][i][0];
                let offerexpiry = data[card][i][1];
                let offerkey = offerraw + offerexpiry;
                if(offerkey in alloffers) {
                    alloffers[offerkey].cards.push(card);
                } else {
                    let offerobj = {};
                    offerobj.deal = "";
                    offerobj.merchant = "";
                    if(offerraw.includes("\n")) {
                        [offerobj.deal, offerobj.merchant] = offerraw.split("\n");
                    } else {
                        offerobj.deal = offerraw; 
                    }
                    offerobj.expiry = offerexpiry;
                    offerobj.cards = [card];
                    alloffers[offerkey] = offerobj;
                }
            }
        }
    }

    let html = "<table border='1'>";
    for(var offerkey in alloffers) {
        html += "<tr>";
        html += "<td>" + alloffers[offerkey].deal;
        html += "<td>" + alloffers[offerkey].merchant;
        html += "<td>" + alloffers[offerkey].expiry;
        html += "<td>" + alloffers[offerkey].cards.join("<br>");
        html += "</tr>\n";
    }
    html += "</table>";

    console.debug("END printHtmlTable\n");
    logger.debug("END printHtmlTable\n");
    return html;
}


const printSummaryTable = data => {

    console.debug("printSummaryTable: \n");
    console.debug(data);
    logger.debug("printSummaryTable: \n");
    logger.debug(data);
    let html = "<table border='1'>";
    html += "<tr><td>Card<td># Eligible<td># Enrolled</tr>";
    for(var card in data) {
        html += "<tr>";
        html += "<td>" + card;
        let count_eligible = 0;
        let count_enrolled = 0;
        if(Array.isArray(data[card])) {
            for(var i = 0; i< data[card].length; i++) {
                if(data[card][i][2] == 'eligible') { count_eligible++; }
                if(data[card][i][2] == 'enrolled') { count_enrolled++; }
            }
        }
        html += "<td>" + count_eligible + "<td>" + count_enrolled + "</tr>";
    }
    html += "</table>";

    console.debug("END printSummaryTable\n");
    logger.debug("END printSummaryTable\n");
    return html;

}


const asyncMain = async nightmare => {

    const fs = require('fs')
    var olddata = {};
    if(fs.existsSync(historyfile)) {
        olddata = JSON.parse(fs.readFileSync(historyfile));
    }

    var newdata = {};
    if(debug_fake_data) {
        newdata = JSON.parse(fs.readFileSync(fakedatafile));
    } else {
        try {
            await amexLogin(nightmare);
            for (let i=0; i< cardcount; i++) {
                if(debug_max_cards >= 0) { cardcount = debug_max_cards; }
                let card = await chooseCard(nightmare,i);
                if(card.includes('Canceled')) { continue; }
                let offers = await getOffers(nightmare);
                newdata[card] = offers;
                await gotoMain(nightmare);
            }
        } catch(e) {
            console.error(e);
            logger.error(e);
        }
    }

    if(!leaveopen) {
    await nightmare.end(() => "nightmare ended")
    .then((value) => console.log(value));
    }

    console.log("Done with all Electron Execution. Data collected: \n");
    console.dir(newdata);
    logger.debug("Done with all Electron Execution. Data collected: \n");
    logger.debug(JSON.stringify(newdata, null, 2));



    /*
     * data = {
     *          card1 : [ 
     *                      ["Offer", "Expiration", "enrolled"],
     *                      ["Offer", "Expiration", "eligible"],
     *                      ["Offer", "Expiration", "enrolled"],
     *                  ],
     *          card2 : [ 
     *                      ["Offer", "Expiration", "eligible"],
     *                      ["Offer", "Expiration", "enrolled"],
     *                      ["Offer", "Expiration", "eligible"],
     *                  ],
     */

    var cardsadded = [];
    var cardsremoved = [];
    var addedoffers = {};
    var removedoffers = {};
    var expiringSoonEnrolledOffers = {};
    var expiringSoonEligibleOffers = {};
    
    for (var key in olddata) {
        if(!(key in newdata)) {
            cardsremoved.push(key);
        }
    }

    //it through newdata
    //if matches olddata, delete olddata
    //if doesnt match olddata, it's new
    //whatever remains in olddata is dead offer
    //
    for (var key in newdata) {
        if(!(key in olddata)) {
            cardsadded.push(key);
            addedoffers[key] = newdata[key]; 
            removedoffers[key] = [];
        } else {
            var cardoffers_new = newdata[key];
            var cardoffers_old = olddata[key];
            addedoffers[key] = [];

            for(let i=0; i< cardoffers_new.length; i++) {
                var offer = cardoffers_new[i][0];
                var match = false;
                for(let j=0; j< cardoffers_old.length; j++) {
                    if(cardoffers_old[j][0] == offer) {
                        match = true;
                        cardoffers_old.splice(j,1);
                        break;
                    }
                }
                if(match == false) {
                    //offer is new
                    addedoffers[key].push(cardoffers_new[i]);
                }
            }
            //whatever's left, is a removed offer
            removedoffers[key] = cardoffers_old;
        }
    }

    console.log("Cards Added: \n");
    console.dir(cardsadded);
    console.log("Cards Removed: \n");
    console.dir(cardsremoved);
    console.log("Offers Added: \n");
    console.dir(addedoffers);
    console.log("Offers Removed: \n");
    console.dir(removedoffers);

    logger.info("Cards Added: \n");
    logger.info(JSON.stringify(cardsadded, null, 2));
    logger.info("Cards Removed: \n");
    logger.info(JSON.stringify(cardsremoved, null, 2));
    logger.info("Offers Added: \n");
    logger.info(JSON.stringify(addedoffers, null, 2));
    logger.info("Offers Removed: \n");
    logger.info(JSON.stringify(removedoffers, null, 2));

    var send_message = false;
    var notify_message = "<html><body>"

    if(cardsadded.length > 0) {
        notify_message += "<h2>New Cards Found:</h2> <br>";
        notify_message += cardsadded.join("<br>");
        notify_message += "<br><br>";
        send_message = true;
    }   
    if(cardsremoved.length > 0) {
        notify_message += "<h2>Old Cards Not Found:</h2> <br>";
        notify_message += cardsremoved.join("<br>");
        notify_message += "<br><br>";
        send_message = true;
    }   

    for(let mode = 0; mode < 2; mode++) {
        let header = mode == 0 ? "New Offers Found" : "Old Offers Removed";
        let enable = mode == 0 ? config.amex.notify_new : config.amex.notify_removed;
        let offers = mode == 0 ? addedoffers : removedoffers;
        let htmlmsg = "<h2>" + header + "</h2>";
        let any_offers_match = false;
        if(enable) {
            for(var key in offers) {
                if(Array.isArray(offers[key]) && offers[key].length > 0) {
                    send_message = true;
                    any_offers_match = true;
                }
            }
            htmlmsg += printHtmlTable(offers);
            if(any_offers_match) {
                notify_message += htmlmsg;
            }
        }
    }

    for(let mode = 0; mode < 2; mode++) {
        let enabled = mode == 0 ? config.amex.notify_enrolled_expiry : config.amex.notify_eligible_expiry;
        if(enabled) {
            let any_expiring = false;
            let type = mode == 0 ? 'enrolled' : 'eligible';
            //console.debug("Checking for " + type + " expirations\n");
            let days_config = mode == 0 ? config.amex.notify_enrolled_expiry_days : config.amex.notify_eligible_expiry_days;
            let htmlmsg = "<h2> " + type + " Offers Expiring Soon:</h2><table>";
            let tempdata = {};
            var expiring_array = new Array(days_config+1);
            for(let i =0; i< days_config+1; i++) {
                expiring_array[i] = [];
            }

            for(var card in newdata) {
                tempdata[card] = [];
                for(let d = 0; d< days_config+1; d++) {
                    for(let i=0; i<newdata[card].length; i++) {
                        //console.debug("Expiry type: " + newdata[card][i][2] + "\n");
                        if(newdata[card][i][2] == type) {
                            let expiry_string = newdata[card][i][1];
                            var myRe = new RegExp('Expires in (\\d) days');
                            var regexResult = myRe.exec(expiry_string);
                            //console.dir(regexResult);
                            var days_left = -1;
                            if(regexResult) {
                                //console.debug("regex #1 match");
                                var days_left = regexResult[1]; 
                            }
                            myRe = new RegExp('Expires tomorrow');
                            regexResult = myRe.exec(expiry_string);
                            if(regexResult) {
                                var days_left = 1;
                            }
                            myRe = new RegExp('Expires today');
                            regexResult = myRe.exec(expiry_string);
                            if(regexResult) {
                                var days_left = 0;
                            }
                            if(days_left == d) {
                                any_expiring = true;
                                tempdata[card].push(newdata[card][i]);
                            }
                        }
                    }
                }
            }

            htmlmsg += printHtmlTable(tempdata);
            if(any_expiring) {
                send_message = true;
                notify_message += htmlmsg;
            }
        }
    }

    if(config.amex.notify_summary_table) {
        notify_message += "<h2> Count of all offers for cards:</h2><table>"; 
        notify_message += printSummaryTable(newdata);
    }

    for(let mode = 0; mode < 2; mode++) {
        let type = mode == 0 ? "enrolled" : "eligible";
        let enable = mode == 0 ? config.amex.notify_all_enrolled : config.amex.notify_all_eligible;
        let htmlmsg = "<h2> Summary of all current " + type + " offers:</h2><table>"; 
        let any_offers = false;
        if(enable) {
            let tempdata = {};
            for(var card in newdata) {
                tempdata[card] = [];
                let cardoffers = newdata[card];
                for(let i=0; i< cardoffers.length; i++) {
                    let offerstatus = cardoffers[i][2];
                    if(offerstatus == type) {
                        send_message = true;
                        any_offers = true;
                        tempdata[card].push(cardoffers[i]);
                    } 
                }
            }
            htmlmsg += printHtmlTable(tempdata);
            notify_message += any_offers ? htmlmsg : "";
        }
    }



    notify_message += "</body></html>";

    try {
       if(!debug_nomail) { 
           if(send_message) {
               await send_email(notify_message);
           } else {
              console.log("Script ran successfully but didn't find any reason to send an email, so nothing sent");
              logger.info("Script ran successfully but didn't find any reason to send an email, so nothing sent");
           }
       }
       if(!debug_fake_data) {
         fs.writeFileSync(historyfile, JSON.stringify(newdata, null, 2));
       }
    } catch(e) { 
        console.error(e);
        logger.error(e);
    }

    fs.writeFileSync(resultfile, notify_message);

}

////////////////// MAIN THREAD ////////////////////////////

logger.info("Starting execution of amex-offer-monitor");
asyncMain(nightmare);
