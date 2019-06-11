'use strict';

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

let configFile;
let config;

try {
    config = yaml.safeLoad(fs.readFileSync(path.resolve(__dirname,'config.yml'), 'utf8'))
} catch (e) {
    console.log(e);
    process.exit(-1)
}

let logfile = path.resolve(__dirname, 'amex-offer-monitor.log');
let loglevel = 'info';
var cardcount = 1; //this will be updated later


var arg_username;
var arg_password;

//debug vars
var debug_fake_data = false; //skips the amex lookup, loads a fake table instead to not pound their server
var debug_max_cards = -1; //if >= 0, only look at N cards, instead of all cards by default
var debug_nomail = false; //skip the email

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
    }
});

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


let au = arg_username ? arg_username : config.amex.un? config.amex.un : null;
let ap = arg_password ? arg_password : config.amex.p ? config.amex.p : null;

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

logger.info("Starting execution of amex-offer-monitor");

const START = "https://online.americanexpress.com/myca/logon/us/action/LogonHandler?request_type=LogonHandler&Face=en_US&DestPage=https%3A%2F%2Fonline.americanexpress.com%2Fmyca%2Faccountsummary%2Fus%2Faccounthome%3Frequest_type%3Dauthreg_acctAccountSummary%26sorted_index%3D0%26inav%3Dmenu_myacct_acctsum";

const nightmare = new Nightmare({ show: true });

      nightmare.on('console', (log, msg) => {
         console.log(msg)
      });
      nightmare.on('logger', (info, msg) => {
         logger.info(msg)
      });

const amexLogin = async nightmare => {
  console.log('Logging into amex.com');
  logger.info('Logging into amex.com');

// Go to initial start page, navigate to Detail search
  try {
    await nightmare
      .goto(START)
      .wait('input[name="UserID"]')
      .type('input[name="UserID"]', au)
      .wait('input[name="Password"]')
      .type('input[name="Password"]', ap)
      .click('input[id="lilo_formSubmit"]');

    let logged_in = false;
    for(let i =0; i< 30; i++) {
      await nightmare.wait(1000);
      if(await nightmare.exists('input[id="onl-social"]')) {
         if(amex.config.l4s) {
             await nightmare
                 .type('input[id="' + amex.config.l4s + '"]')
                 .click('button[type="submit"]')
                 .wait(2000);
         } else {
            await nightmare.end();
            throw "Amex asked for last 4 ssn to continue, but you did not provide it in config file, can't continue";
         }
      }
      if(await nightmare.exists('a[href="/offers/eligible"]')) {
          await nightmare
              .click('a[href="/offers/eligible"]')
              .wait(2000);
          logged_in = true;
      }
      if(logged_in) { break; }
    }
    if(logged_in) { 
        console.log("Logged in and ready");
        logger.info("Logged in and ready");
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

    const viewall = await nightmare.exists('a[title="View All"]');
    if(viewall) {
        await nightmare.click('a[title="View All"]').wait(500);
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
      console.log("Done with chooseCard " + cardId);
      logger.info("Done with chooseCard " + cardId);
      return result[1];
}


const getOffers = async nightmare => {
  console.log('Now getting offers');
  logger.info('Now getting offers');

// Go to initial start page, navigate to Detail search
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
  let info = await transporter.sendMail({
    from: '"Amex Offer Monitor" <' + config.email.from_address + '>', // sender address
    to: config.email.to, // list of receivers
    subject: "Amex Offer Update", // Subject line
    text: "", // plain text body
    html: message // html body
  });

  console.log("Message sent: %s", info.messageId);
}


const asyncMain = async nightmare => {

    const fs = require('fs')
    var olddata = {};
    if(fs.existsSync(path.resolve(__dirname,"amexoffers-data.json"))) {
        olddata = JSON.parse(fs.readFileSync(path.resolve(__dirname,"amexoffers-data.json")));
    }

    var newdata = {};
    if(debug_fake_data) {
        newdata = JSON.parse(fs.readFileSync(path.resolve(__dirname,"amexoffers-fakedata.json")));
    } else {
        try {
            await amexLogin(nightmare);
            for (let i=0; i< cardcount; i++) {
                let card = await chooseCard(nightmare,i);
                let offers = await getOffers(nightmare);
                newdata[card] = offers;
                if(debug_max_cards >= 0) { cardcount = debug_max_cards; }
            }
        } catch(e) {
            console.error(e);
            logger.error(e);
        }
    }
    await nightmare.end(() => "nightmare ended")
    .then((value) => console.log(value));

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
        let htmlmsg = "<h2>" + header + "</h2><table>";
        let any_offers_match = false;
        if(enable) {
            for(var key in offers) {
                if(offers[key].length > 0) {
                    send_message = true;
                    any_offers_match = true;
                    for(var i = 0; i<offers[key].length; i++) {
                        let offer = offers[key][i][0].split("\n");
                        htmlmsg += "<tr><td>"+offer[0]+"<td>"+offer[1]+"<td>"+ offers[key][i][1] + "<td>" + key + "</tr>";
                    }
                }
            }
            htmlmsg += "</table><br><br>";
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
            var expiring_array = new Array(days_config+1);
            for(let i =0; i< days_config+1; i++) {
                expiring_array[i] = [];
            }

            for(var card in newdata) {
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
                        //console.dir(regexResult);
                        if(regexResult) {
                            //console.debug("regex #2 match");
                            var days_left = 1;
                        }
                        //console.debug("Expiry: \n" + card + "\n" + expiry_string + "\n" + "days_left: " + days_left);
                        if(days_left >= 0 && days_left <= days_config) {
                            let offer = newdata[card][i][0].split("\n");
                            expiring_array[days_left].push("<tr><td>" + newdata[card][i][1] + "<td>" + offer[0] + "<td>" + offer[1] + "<td>" + card + "</tr>");
                        }
                    }
                }
            }

            for (let d = 0; d < days_config+1; d++) {
                for (let i =0 ; i < expiring_array[d].length; i++) {
                    any_expiring = true;
                    htmlmsg += expiring_array[d][i];
                }
            } 
            htmlmsg += "</table><br><br>";
            if(any_expiring) {
                send_message = true;
                notify_message += htmlmsg;
            }
        }
    }


    for(let mode = 0; mode < 2; mode++) {
        let type = mode == 0 ? "enrolled" : "eligible";
        let enable = mode == 0 ? config.amex.notify_all_enrolled : config.amex.notify_all_eligible;
        let htmlmsg = "<h2> Summary of all current " + type + " offers:</h2><table>"; 
        if(enable) {
            for(var card in newdata) {
                let cardoffers = newdata[card];
                for(let i=0; i< cardoffers.length; i++) {
                    let offer = cardoffers[i][0].split("\n");
                    let expy = cardoffers[i][1];
                    let offerstatus = cardoffers[i][2];
                    if(offerstatus == type) {
                       htmlmsg += "<tr><td>" + offer[0] + "<td>" + offer[1] + "<td>" + expy + "<td>" + card + "</tr>\n"; 
                    } 
                }
            }
            htmlmsg += "</table>\n";
            notify_message += htmlmsg;
        }
    }


    notify_message += "</body></html>";

    try {
       await send_email(notify_message);
       if(!debug_fake_data) {
         fs.writeFileSync(path.resolve(__dirname,"./amexoffers-data.json"), JSON.stringify(newdata, null, 2));
       }
    } catch(e) { 
        console.error(e);
        logger.error(e);
    }

    fs.writeFileSync(path.resolve(__dirname, "amexoffers_update.html"), notify_message);

}

////////////////// MAIN THREAD ////////////////////////////

asyncMain(nightmare);
