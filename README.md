# amex-offer-monitor

## Setup

1. Unpack the code to a folder .../amex-offer-monitor

2. Install the Node.js application with 'npm-install'
3. Rename config.yml.example to config.yml

4. Amex credentials - either update your username & password in the config file, or if you don't want to leave them in plaintext on your harddrive, supply them some other way via --username <username> --password <password> on each run of the script

5. Email support - If you want to receive email updates from amex-offer-monitor, you need an email account to send the mail from. I recommend a free/throwaway mail.com account, but you can use others. Update config.yml with your inbox address, and your sender's email, password, smtp\_port, and smtp\_server. (smtp settings configured for mail.com)

## Configuration Options

* notify\_new: Email will contain all new offers detected since the last time the script ran
* notify\_removed: Email will contain all offers no longer detected that existed the last time the script ran

* notify\_eligible\_expiry: Get a reminder about any eligible offers (not added to card) which are expiring soon. 
* notify\_enrolled\_expiry: Get a reminder about any enrolled offers (added to card) which are expiring soon. 

* notify\_eligible\_expiry\_days: Number of days in advance to warn about expiration for eligible offers (max 10)
* notify\_enrolled\_expiry\_days: Number of days in advance to warn about expiration for enrolled offers (max 10)

* notify\_all\_enrolled : Receive a summary about all enrolled offers on all cards
* notify\_all\_eligible : Receive a summary about all eligible offers on all cards (probably huge!)
