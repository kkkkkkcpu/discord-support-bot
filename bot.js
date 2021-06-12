const Discord = require("discord.js");
const client = new Discord.Client({disableMentions: "everyone"});
const disbut = require('discord-buttons');
disbut(client);
const { Sequelize, DataTypes } = require('sequelize');
require('sqlite3');
require('dotenv').config()

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: 'data/data.sqlite'
});

const Servers = sequelize.define('servers', {
    serverId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true
    },
    channelId: {
        type: DataTypes.STRING,
        allowNull: false
    },
    supportRole: {
        type: DataTypes.STRING,
        allowNull: false
    },
    categoryList: {
        type: DataTypes.STRING,
        allowNull: false,
        get() {
            return this.getDataValue('categoryList').split(';');
        },
        set(val) {
            if (!Array.isArray(val)) {
                throw TypeError;
            }
            this.setDataValue('categoryList', val.join(';'));
        }
    },
    transcriptChannel: {
        type: DataTypes.STRING,
        allowNull: true
    }
});

sequelize.sync({ alter: true })
    .then(() => {
        console.log(`Database & tables updated!`);
    });

client.on("message", async (message) => {
    try {
        // Eval command for debugging.
        /*
        if (message.content.startsWith("s-eval")) {
            const guildSettings = await Servers.findOne({where: {serverId: message.guild.id }});
            if(message.author.id !== '258738798047920128') return;
            try {
                const code = message.content.substr(7);
                let evaled = eval(code);

                if (typeof evaled !== "string")
                    evaled = require("util").inspect(evaled);

                await message.channel.send(clean(evaled), {code:"xl"});
            } catch (err) {
                await message.channel.send(`\`ERROR\` \`\`\`xl\n${clean(err)}\n\`\`\``);
            }
        }

         */

        // Delete "bot pinned a message to this channel" messages
        if (message.type === "PINS_ADD" && message.author.id === client.user.id) return await message.delete();
        if (message.content.startsWith('support-setup')) {
            return await setupGuild(message);
        }
        const guildSettings = await Servers.findOne({where: {serverId: message.guild.id }});
        if (guildSettings == null) {
            return;
        }
        if (message.channel.id === guildSettings.channelId) {
            return await createTicket(message, guildSettings);
        }
        if (message.content.startsWith('support-reset')) {
            return await resetGuild(message, guildSettings);
        }
        if (message.content.startsWith('support-settings')) {
            return await fancySettings(message, guildSettings);
        }
        if (message.content.startsWith('support-close')) {
            return await closeTicketCmd(message, guildSettings);
        }
        if (message.content.startsWith('support-add') && isTicketChannel(message.channel, guildSettings)) {
            return await addCommand(message, guildSettings);
        }
        if (message.content.startsWith('support-help')) {
            return await helpCommand(message, guildSettings);
        }
        if (message.content.startsWith('support-togglecategory')) {
            return await toggleCategory(message, guildSettings);
        }
        if (message.content.startsWith('support-prunecategories')) {
            return await pruneInvalidCategories(message, guildSettings);
        }
    }

     catch (err) {
        console.log(err);
    }
});

async function toggleCategory(message, guildSettings) {
    if (!( message.member.hasPermission("ADMINISTRATOR") || message.member.id === '258738798047920128')) {
        return;
    }
    var category = message.channel.parentID;
    if (guildSettings.categoryList.includes(category)) {
        if (guildSettings.categoryList.length === 1) {
            return await message.reply("You must have at least one category enabled!");
        }
        await removeCategory(message.category.id, guildSettings);
        return await message.reply("Successfully disabled this category for ticket use. Note that all existing tickets in this category will no longer work.")
    } else {
        await addCategory(message.category.id, guildSettings);
        return await message.reply("Successfully enabled this category for ticket use. Note that the bot will try to fill up other categories first before using this one.")
    }
}

async function helpCommand(message, guildSettings) {
    const commands = new Discord.MessageEmbed()
        .setColor('#FF0000')
        .setTitle('Commands for Support Bot')
        .setURL('https://github.com/burturt/discord-support-bot')
        .addFields(
            { name: 'support-setup @role [#channel]', value: 'Admin only; sets up a support channel and allows @role to close tickets as well as admins and optionally specify #channel as a transcript channel. If no transcript channel is specified, transcripts will be disabled.'},
            { name: 'support-reset', value: 'Admin only; clears the setup to allow changing settings. If the same category is used when setting up again, no ticket data is lost.'},
            { name: 'support-settings', value: 'Print out current server setup information. Useful for debugging.'},
            { name: 'support-help', value: 'Show this help message'},
            { name: 'support-add @user1 @user2', value: 'Add users to a ticket. Must run in ticket channel, may contain any number of user mentions OR a **single** user ID.'},
            { name: 'support-close', value: 'Close a ticket. Can only be run by ticket author, admins, and support role.'},
            { name: 'support-togglecategory', value: 'Admin only; toggle the use of a category for tickets. Uses category of channel command is run in.'},
            { name: 'support-prunecategory', value: 'Automatically remove all invalid categories from settings.'}
        )
        .setFooter(`Requested by ${message.author.tag}`);
    return await message.channel.send(commands);

}

function isTicketChannel(channel, guildSettings) {
    return guildSettings.categoryList.includes(channel.parentID) && channel.id !== guildSettings.channelId;
}

async function closeTicketCmd(message, guildSettings) {
    return closeTicket(message.member, message.channel, message.guild, guildSettings);
}

async function closeTicket(member, channel, guild, guildSettings) {
    // Only allow support role, ticket author, and users with admin permission to close ticket
    if (guildSettings == null || !isTicketChannel(channel, guildSettings)) {
        return;
    }
    if (member.hasPermission("ADMINISTRATOR") ||
        member.roles.cache.some(role => role.id === guildSettings.supportRole) ||
        member.id === channel.topic) {
        if (channel.topic.startsWith('CLOSING') || !channel.name.startsWith('ticket-')) {
            return;
        }
        const ticketUserId = channel.topic;
        await channel.edit({
            topic: `CLOSING ${channel.topic}`
        });

        // Disable Close Ticket button
        try {
            const firstMessage = (await channel.messages.fetchPinned()).sort().first();
            if (!firstMessage.content.startsWith("Author:")) {
                throw new Error;
            }
            let disabledCloseButton = new disbut.MessageButton()
                .setStyle('red')
                .setLabel('Close Ticket')
                .setID('close')
                .setDisabled(true);
            await firstMessage.edit(firstMessage.content,{
                component: disabledCloseButton
            });
        } catch {

        }

        await channel.send('Closing ticket in 10 seconds; generating transcript if enabled.');
        // await message.reply('Transcript generated; closing ticket in 10 seconds');
        setTimeout(async function() {
            // Skip if transcript disabled
            if (!guildSettings.transcriptChannel == null) {
                var log = await createChatlog(channel);
                log += `Ticket closed by ${member.user.tag} (${member.id})`
                var attachment = new Discord.MessageAttachment(Buffer.from(log, 'utf-8'), `transcript-${channel.name}-${new Date().toISOString().slice(0,10)}.txt`);
                await guild.channels.cache.get(guildSettings.transcriptChannel).send(attachment);
                try {
                    await client.users.cache.get(ticketUserId).send(attachment);
                } catch { };
            }
            await channel.delete();
            return;
        }, 10000);
    } else {
        return await channel.send(`<@${member.id}> You do not have permission to close this ticket.`);
    }
}

client.on('clickButton', async (button) => {
    if (button.id === 'close') {
        const guildSettings = await Servers.findOne({where: {serverId: button.guild.id }});
        await closeTicket(button.clicker.member, button.channel, button.guild, guildSettings);
    }
    await button.defer();

});

async function createChatlog(channel) {
    // Fetch messages in groups of 100 because of discord limitations
    var messagesArr = await (await channel.messages.fetch({limit: 1})).array();
    var messagesChunk;
    var oldestMessageId = await (await channel.messages.fetch({limit: 1})).firstKey()
    do {
        messagesChunk = await channel.messages.fetch({limit: 100, before: oldestMessageId});
        let sortedMsgs = messagesChunk.sort();
        oldestMessageId = await sortedMsgs.firstKey();
        messagesArr = sortedMsgs.array().concat(messagesArr);
    } while (messagesChunk.size === 100);

    var formattedChatlog = '';

    messagesArr.forEach( message => {
        if (message.content != null) {
            formattedChatlog += message.createdAt.toLocaleString() + ' ' + message.author.tag + ' (' + message.author.id + '): ' + message.cleanContent + '\n';
        }
    });
    return formattedChatlog;
}

async function createTicket(message, guildSettings) {
    if (message.author.bot) {
        if (message.author.id !== client.user.id) {
            return await message.delete();
        }
        return;
    }
    const existingChannel = message.guild.channels.cache.find(channel => channel.topic === message.author.id);
    if (existingChannel == null) {
        let ticketChannel, categoryIdx = -1;
        while (ticketChannel == null && categoryIdx <= guildSettings.categoryList.length) {
            categoryIdx++;
            var category = client.channels.cache.get(guildSettings.categoryList[categoryIdx]);
            if (category == null) continue;
             try {
                 ticketChannel = await message.guild.channels.create('ticket-' + message.author.username.substr(0, 8) + '-' + message.author.discriminator, {
                     type: 'text',
                     topic: message.author.id,
                     parent: client.channels.cache.get(guildSettings.categoryList[categoryIdx])
                 });
             } catch {
             }
        }
        // If no space left, make a new category
        if (ticketChannel == null) {
            var newCategory = await message.guild.channels.create('tickets-AUTOGENERATED', {
                type: 'category',
                permissionOverwrites: [{
                        id: guildSettings.supportRole,
                        allow: "VIEW_CHANNEL"
                    },
                    {
                        id: message.guild.roles.everyone,
                        deny: 'VIEW_CHANNEL'
                    },
                    {
                        id: client.user,
                        allow: 'VIEW_CHANNEL'
                    }]
            });
            ticketChannel = await message.guild.channels.create('ticket-' + message.author.username.substr(0, 8) + '-' + message.author.discriminator, {
                type: 'text',
                topic: message.author.id,
                parent: newCategory
            });
            await addCategory(newCategory.id, guildSettings);
        }

        await ticketChannel.createOverwrite(message.author, {
            VIEW_CHANNEL: true
        });
        let closeButton = new disbut.MessageButton()
            .setStyle('red')
            .setLabel('Close Ticket')
            .setID('close');
        var firstMessage = await ticketChannel.send(`Author: ${message.author}
Message:
\`\`\`
${message.cleanContent.substr(0, 1900)}
\`\`\`
Please wait for a <@&${guildSettings.supportRole}> to respond. Click the button below or type \`support-close\` to close this ticket. Note: you and server admins will receive a transcript of all messages in this channel as-in when the ticket is closed.`, closeButton);
        await firstMessage.pin();
        await message.delete();
    } else {
        existingChannel.send(`${message.author} You already have a ticket channel! \`\`\`
${message.cleanContent.substr(0, 1990)}
\`\`\``);
        await message.delete();
    }

};

async function removeCategory(categoryId, guildSettings) {
    var oldCategoryList = guildSettings.categoryList.map((x) => x);
    oldCategoryList.splice(guildSettings.categoryList.indexOf(categoryId), 1);
    await guildSettings.update({
        categoryList: oldCategoryList
    });
}

async function addCategory(categoryId, guildSettings) {
    var oldCategoryList = guildSettings.categoryList.map((x) => x);
    oldCategoryList.push(categoryId);
    await guildSettings.update({
        categoryList: oldCategoryList
    });
}

async function fancySettings(message, guildSettings) {
    if (guildSettings == null) {
        return await message.reply('Server is not set up.');
    }
    var categoryNames = '';
    guildSettings.categoryList.forEach( categoryId => {
        try {
            categoryNames += client.channels.cache.get(categoryId).name + ', ';
        } catch {categoryNames += 'deleted-category, '}
        });
    categoryNames = categoryNames.substr(0, categoryNames.length - 2);
    const embed = new Discord.MessageEmbed()
        .setColor('#FF0000')
        .setTitle(`Settings for Server ${message.guild.name}`)
        .addFields(
            { name: 'Support channel:', value: `<#${guildSettings.channelId}>` },
            { name: 'Support categorys:', value: `${categoryNames}` },
            { name: 'Support role:', value: `${message.guild.roles.cache.get(guildSettings.supportRole).name}`}
        );
    await message.channel.send(embed);
}

async function setupGuild(message) {
    if (message.content.startsWith('support-setup') && ( message.member.hasPermission("ADMINISTRATOR") || message.member.id === '258738798047920128')) {
        if (message.mentions.roles.size != 1) {
            return await message.reply('Please mention one support role');
        }
        let transcriptChannel;
        if (message.mentions.channels.size === 1) {
            transcriptChannel = message.mentions.channels.first().id;
        } else {
            transcriptChannel = null;
        }
        await Servers.create({
            serverId: message.guild.id,
            channelId: message.channel.id,
            supportRole: message.mentions.roles.firstKey(),
            categoryList: [message.channel.parentID],
            transcriptChannel: transcriptChannel
        });

        return await message.reply('Setup completed! All messages sent in this channel will create a support ticket. If you wish to have a message that is not deleted invite users to send a message here, edit your command message. This message will auto-delete in 10 seconds')
            .then(message => {
                setTimeout(() => message.delete(), 10000);
            });
    }
}

async function resetGuild(message, guildSettings) {
    if (message.content.startsWith('support-reset') && ( message.member.hasPermission("ADMINISTRATOR") || message.member.id === '258738798047920128')) {
        await guildSettings.destroy();
        return await message.reply('Existing setup deleted. Run `support-setup @role` to re-setup.');
    }
}

async function addCommand(message, guildSettings) {
    if (!isTicketChannel(message.channel, guildSettings)) return;
    // Test for mentions and add all mentioned users
    if (message.mentions.members.size > 0) {
        var list = '';
        for (var mention of message.mentions.members) {
            try {
                await message.channel.createOverwrite(mention[1], {
                    VIEW_CHANNEL: true
                });
                list += '<@' + mention[1].id + '> '
            } catch {

            }

        }
        return await message.reply(`Successfully added ${list}to the ticket`);
    }
    // Test for user named being a user id after getting arguments
    let argument = message.content.split(/ (.+)/)[1];
    if (argument == null) {
        return await message.reply("Usage: `support-add USER` where USER can be multiple @mention or a single user id");
    }

    // Try converting and using userid
    try {
        var user = await message.guild.members.cache.get(argument.trim());
        await message.channel.createOverwrite(user, {
            VIEW_CHANNEL: true
        });
        return await message.reply(`Successfully added ${user} to the ticket`);
    } catch {
        return await message.reply(`Invalid user. Usage: \`support-add USER\` where USER can be multiple @mention or a single user id`);
    }

}

async function pruneInvalidCategories(message, guildSettings) {
    if (!( message.member.hasPermission("ADMINISTRATOR") || message.member.id === '258738798047920128')) return;
    for (const category of guildSettings.categoryList) {
        try {
            var tempCategory = message.guild.channels.cache.get(category);
            if (tempCategory == null && guildSettings.categoryList.length !== 1) {
                await removeCategory(category.id, guildSettings);
            }
        } catch {}
    };
    message.reply('Successfully removed all invalid categories.')
}

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    client.user.setPresence({
        status: "online",
        activity: {
            name: "tickets. Run support-help!",
            type: "WATCHING"
        }
    });
});

client.login(process.env.BOT_TOKEN);