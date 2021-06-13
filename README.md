# Discord Support Bot
A simple ticket support bot where users simply send a message in a designated channel to create a ticket. Very much inspired by https://github.com/DiscordSupportBot/DiscordSupportBot.v1 and written in discord.js

### Features:
- Send message in channel to create ticket
- Simple setup; just type `support-setup @supportrole #transcriptchannel` in the ticket creation channel
- Automatically send transcript of tickets when tickets are closed to channel and DM
- Discord buttons instead of commands for users!
- Place new tickets in specified categories, auto-create category if existing categories are full
- One ticket per user enforced
- Add users to a support ticket to view and chat with `support-add`
- Temporary voice channels! These voice channels can be activated by just clicking a button and joining, and can be seen by all users who can see the support ticket, and delete once done
- Built for multiple server use; all servers are separate and can use their own settings
- No sensitive data is stored on the bot's server!
