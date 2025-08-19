require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');

// Crear cliente con los intents necesarios
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Tomar el token desde el .env
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
    console.error("❌ No se encontró DISCORD_TOKEN en el archivo .env");
    process.exit(1);
}

// Evento cuando el bot esté listo
client.once('ready', () => {
    console.log(`✅ Bot listo! Conectado como ${client.user.tag}`);
});

// Escuchar mensajes
client.on('messageCreate', message => {
    // Ignorar mensajes de otros bots
    if (message.author.bot) return;

    // Comando simple: !hola
    if (message.content === '!hola') {
        message.channel.send('¡Hola! 👋');
    }
});

// Iniciar sesión con el token
client.login(TOKEN);
