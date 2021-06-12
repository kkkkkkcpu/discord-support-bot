const Discord = require("discord.js");
const client = new Discord.Client({disableMentions: "everyone"});
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
    categoryId: {
        type: DataTypes.STRING,
        allowNull: true
    },
    transcriptChannel: {
        type: DataTypes.STRING,
        allowNull: false
    }
});

sequelize.sync({ force: false })
    .then(() => {
        console.log(`Database & tables created!`);
    });

client.on("message", async (message) => {
    try {
        if (message.content.startsWith('support-setup')) {
            return await setupGuild(message);
        }
        const guildSettings = await Servers.findOne({where: {serverId: message.guild.id }});
        if (message.channel.id === guildSettings.channelId) {
            return await createTicket(message, guildSettings);
        }
        if (message.content.startsWith('support-reset')) {
            return await resetGuild(message, guildSettings);
        }
        if (message.content.startsWith('support-settings')) {
            return await fancySettings(message, guildSettings);
        }
        if (message.content.startsWith('support-close') && message.channel.parentID === guildSettings.categoryId && message.channel.id !== guildSettings.channelId) {
            return await closeTicket(message, guildSettings);
        }

    } catch {

    }
});

async function closeTicket(message, guildSettings) {
    // Only allow support role, ticket author, and users with admin permission to close ticket
    if (message.member.hasPermission("ADMINISTRATOR") ||
        message.member.roles.cache.some(role => role.id === guildSettings.supportRole) ||
        message.author.id === message.channel.topic) {
        var log = await createChatlog(message);
        console.log(log);
        var attachment = new Discord.MessageAttachment(Buffer.from(log, 'utf-8'), `transcript-${message.channel.name}-${new Date().toISOString().slice(0,10)}.txt`);
        await message.guild.channels.cache.get(guildSettings.transcriptChannel).send(attachment);
        try {
            await client.users.cache.get(message.channel.topic).send(attachment);
        } catch { };

        await message.reply('Transcript generated; closing ticket in 10 seconds');
        setTimeout(async function() {
            await message.channel.delete();
            return;
        }, 10000);
    }
}

async function createChatlog(message) {
    // Fetch messages in groups of 100 because of discord limitations
    var messagesArr = [];
    var messagesChunk;
    var oldestMessageId = await (await message.channel.messages.fetch({limit: 1})).firstKey()
    do {
        messagesChunk = await message.channel.messages.fetch({limit: 100, before: oldestMessageId});
        let sortedMsgs = messagesChunk.sort();
        oldestMessageId = await sortedMsgs.firstKey();
        messagesArr = sortedMsgs.array().concat(messagesArr);
    } while (messagesChunk.size === 100);

    var formattedChatlog = '';

    messagesArr.forEach( message => {
        formattedChatlog += message.createdAt.toLocaleString() + ' ' + message.author.username + '#' + message.author.discriminator + ' (' + message.author.id + '): ' + message.cleanContent + '\n';
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
        const ticketChannel = await message.guild.channels.create(message.author.username.substr(0, 4) + '-' + message.author.discriminator, {
            type: 'text',
            topic: message.author.id,
            parent: client.channels.cache.get(guildSettings.categoryId)
        });
        await ticketChannel.createOverwrite(message.author, {
            VIEW_CHANNEL: true
        });
        await ticketChannel.send(`Author: ${message.author}
Message:
\`\`\`
${message.cleanContent.substr(0, 1900)}
\`\`\`
Please wait for a <@&${guildSettings.supportRole}> to respond. Type \`support-close\` to close this ticket. Note: you and server admins will receive a transcript of all messages in this channel as-in when the ticket is closed.`);
        await message.delete();
    } else {
        existingChannel.send(`${message.author} You already have a ticket channel! \`\`\`
${message.cleanContent.substr(0, 1990)}
\`\`\``);
        await message.delete();
    }

};

async function fancySettings(message, guildSettings) {
    const embed = new Discord.MessageEmbed()
        .setColor('#FF0000')
        .setTitle(`Settings for Server ${message.guild.name}`)
        .addFields(
            { name: 'Support channel:', value: `<#${guildSettings.channelId}>` },
            { name: 'Support category:', value: `${client.channels.cache.get(guildSettings.categoryId).name}` },
            { name: 'Support role:', value: `${message.guild.roles.cache.get(guildSettings.supportRole).name}`}
        );
    await message.channel.send(embed);
}

async function setupGuild(message) {
    if (message.content.startsWith('support-setup') && ( message.member.hasPermission("ADMINISTRATOR") || message.member.id === '258738798047920128')) {
        if (message.mentions.roles.size != 1) {
            return await message.reply('Please mention one support role');
        }
        const transcriptChannel = await message.guild.channels.create('transcripts', {
            type: 'text',
            topic: 'Transcripts from support bot. Feel free to move or rename this channel anything.',
        });
        await transcriptChannel.overwritePermissions([
            {
                id: message.guild.roles.cache.get(message.mentions.roles.firstKey()).id,
                allow: ['VIEW_CHANNEL']
            },
            {
                id: message.guild.roles.everyone.id,
                deny: ['VIEW_CHANNEL']
            },
            {
                id: client.user.id,
                allow: ['VIEW_CHANNEL']
            }
        ]);
        await Servers.create({
            serverId: message.guild.id,
            channelId: message.channel.id,
            supportRole: message.mentions.roles.firstKey(),
            categoryId: message.channel.parentID,
            transcriptChannel: transcriptChannel.id
        });

        return await message.reply('Setup completed! All messages sent in this channel will create a support ticket. If you wish to have a message that is not deleted, run `support-reset`, send the message, then re-setup.');
    }
}

async function resetGuild(message, guildSettings) {
    if (message.content.startsWith('support-reset') && ( message.member.hasPermission("ADMINISTRATOR") || message.member.id === '258738798047920128')) {
        await guildSettings.destroy();
        return await message.reply('Existing setup deleted. Run `support-setup @role` to re-setup.');
    }
}

client.login(process.env.BOT_TOKEN);