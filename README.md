# amex-offer-monitor

## Setup

1. Unpack the code to a folder .../amex-offer-monitor

2. Install the Node.js application by running `npm install` from the directory (Install node.js on your system first if you don't have it.)
 (For Headless Linux - see [here](https://github.com/karwosts/amex-offer-monitor/issues/12#issuecomment-921815146) )

4. Rename config.yml.example to config.yml

4. Amex credentials - either update your username & password in the config file, or if you don't want to leave them in plaintext on your harddrive, supply them some other way via `--username <username> --password <password>` on each run of the script

5. Email support - If you want to receive email updates from amex-offer-monitor, you need an email account to send the mail from. I recommend a free/throwaway mail.com account, but you can use others. Update config.yml with your inbox address, and your sender's email, password, smtp\_port, and smtp\_server. (smtp settings configured for mail.com)

6. Automation - the script is intended to be run once per day or so. You can do this with cron on linux or taskschd.msc on windows, so you just get a daily digest of your amex offer status.  

7. To launch the script, open a command window or powershell, and from the script directory run `node amex-offer-monitor.js`

## Configuration Options

* notify\_new: Email will contain all new offers detected since the last time the script ran
* notify\_removed: Email will contain all offers no longer detected that existed the last time the script ran

* notify\_eligible\_expiry: Get a reminder about any eligible offers (not added to card) which are expiring soon. 
* notify\_enrolled\_expiry: Get a reminder about any enrolled offers (added to card) which are expiring soon. 

* notify\_eligible\_expiry\_days: Number of days in advance to warn about expiration for eligible offers (max 10)
* notify\_enrolled\_expiry\_days: Number of days in advance to warn about expiration for enrolled offers (max 10)

* notify\_all\_enrolled : Receive a summary about all enrolled offers on all cards
* notify\_all\_eligible : Receive a summary about all eligible offers on all cards (probably huge!)

* notify\_offer\_limit\_warning : Print a warning message at the top of the email for any card which has hit the max of 100 eligible offers. This means some offers may be hidden, and user needs to add offers until the eligible number drops below 100, to ensure there aren't any hidden offers. 

* notify\_advertisements : Print a list in the email of all "advertisements" which are populated in the offer section. These are advertisements, usually from Amex, which aren't considered traditional "Buy X get Y" amex offers. Things like upgrade offers, referral offers, 0% offers, etc may appear here. Also has a lot of less useful things like ads for shoprunner, credit monitoring, etc. Printed in a separate list at the end of the email.

* filter\_offers: A list of strings indicating offers or merchants you are not interested in. If the text of an amex offer matches any of the strings listed here, it will be hidden from the result email. See the example config file for examples.

* filter\_advertisements: A list of strings indicating advertisements you are not interested in. If the text of an advertisement matches any of the strings listed here, it will be hidden from the result email. See the example config file for examples.

## Other notes

Occasionally on login, amex will throw an extra security page asking for the last 4 of your SSN. This seems to only happen if you try to login very frequently or regularly. If it happens to you and you want to allow the tool to continue, you can add an amex:l4s key to the config file with the last 4 digits of your SSN. I understand this is sensitive and some people may not be comfortable providing that information, so it's optional. If you don't provide it the tool will just exit when this page is encountered. Recommend not enabling it unless this prompt becomes a persistent problem for you. 

### Multiple Accounts ###
If you want to handle multiple amex accounts, you can create a separate config file for each account. Add a amex:historyfile key to each config file indicating a filename in the directory that you want to use for each account. You may also customize the email subject with a email:subject key. This should allow you to run the program for multiple accounts without thrashing the data between the two. To run with a config file other than the default config.yml, launch `node amex-offer-monitor.js --config mycustomconfigfile.yml`


## Example Output

![example output](https://raw.githubusercontent.com/karwosts/amex-offer-monitor/master/example_output.PNG)
