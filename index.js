require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  ActivityType 
} = require('discord.js');
const fetch = require('node-fetch');
const express = require('express');
const fs = require('fs'); // Para manejar archivos

// Variables de entorno
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const TWITCH_CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const TWITCH_USER = process.env.TWITCH_USER || "rickyedit";
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;
const YOUTUBE_CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

// Configuración del cliente de Discord
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Servidor Express para Uptime Robot
const app = express();
app.get('/', (req, res) => res.send("Bot en ejecución."));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor Express en puerto ${PORT}`));

// Estado personalizado en Discord
client.once('ready', () => {
  console.log(`✅ Conectado como ${client.user.tag}`);
  client.user.setActivity("Viendo locas de Twitter", { type: ActivityType.Watching });

  monitorStream();
  monitorYoutube();
});

/* ===== Integración de Twitch ===== */
async function getTwitchAccessToken() {
  const url = `https://id.twitch.tv/oauth2/token?client_id=${TWITCH_CLIENT_ID}&client_secret=${TWITCH_CLIENT_SECRET}&grant_type=client_credentials`;
  const response = await fetch(url, { method: 'POST' });
  const data = await response.json();
  return data.access_token;
}

async function getStreamData(accessToken) {
  const url = `https://api.twitch.tv/helix/streams?user_login=${TWITCH_USER}`;
  const response = await fetch(url, {
    headers: {
      'Client-ID': TWITCH_CLIENT_ID,
      'Authorization': `Bearer ${accessToken}`
    }
  });
  const data = await response.json();
  return data.data && data.data.length > 0 ? data.data[0] : null;
}

async function createTwitchEmbed() {
  const accessToken = await getTwitchAccessToken();
  const streamData = await getStreamData(accessToken);
  if (!streamData) return null;

  return new EmbedBuilder()
    .setColor("#9146FF")
    .setTitle(`¡${TWITCH_USER} está en directo en Twitch!`)
    .setURL(`https://www.twitch.tv/${TWITCH_USER}`)
    .setDescription(streamData.title || "¡No te pierdas el directo!")
    .addFields(
      { name: "Juego", value: streamData.game_name || "Desconocido", inline: true },
      { name: "Viewers", value: streamData.viewer_count?.toString() || "Desconocido", inline: true }
    )
    .setImage(streamData.thumbnail_url.replace("{width}", "1280").replace("{height}", "720"))
    .setFooter({ text: "¡Vamos, entra ya!" })
    .setTimestamp();
}

let isLive = false;
async function monitorStream() {
  const accessToken = await getTwitchAccessToken();
  setInterval(async () => {
    try {
      const streamData = await getStreamData(accessToken);
      if (streamData && !isLive) {
        const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
        if (channel) {
          const embed = await createTwitchEmbed();
          if (embed) channel.send({ content: "@everyone", embeds: [embed] });
        }
        isLive = true;
      } else if (!streamData && isLive) {
        isLive = false;
      }
    } catch (error) {
      console.error("Error en monitorStream:", error);
    }
  }, 60000);
}

/* ===== Integración de YouTube ===== */
let lastVideoId = null;
const LAST_VIDEO_FILE = 'lastVideoId.json';

// Leer el último video notificado desde el archivo, si existe
if (fs.existsSync(LAST_VIDEO_FILE)) {
  try {
    const data = fs.readFileSync(LAST_VIDEO_FILE, 'utf8');
    lastVideoId = JSON.parse(data);
    console.log("Último video leído desde archivo:", lastVideoId);
  } catch (err) {
    console.error("Error leyendo lastVideoId.json:", err);
  }
}

// Función para guardar el último video notificado
function saveLastVideoId(videoId) {
  try {
    fs.writeFileSync(LAST_VIDEO_FILE, JSON.stringify(videoId), 'utf8');
  } catch (err) {
    console.error("Error guardando lastVideoId.json:", err);
  }
}

// Obtener último video de YouTube
async function getLatestYoutubeVideo() {
  if (!YOUTUBE_API_KEY || !YOUTUBE_CHANNEL_ID) {
    console.error("Falta configurar YOUTUBE_API_KEY o YOUTUBE_CHANNEL_ID.");
    return null;
  }
  const url = `https://www.googleapis.com/youtube/v3/search?key=${YOUTUBE_API_KEY}&channelId=${YOUTUBE_CHANNEL_ID}&part=snippet,id&order=date&maxResults=1`;
  const response = await fetch(url);
  const data = await response.json();
  if (data.items && data.items.length > 0 && data.items[0].id.kind === "youtube#video") {
    return data.items[0];
  }
  return null;
}

// Monitorear YouTube de forma automática
async function monitorYoutube() {
  setInterval(async () => {
    try {
      const video = await getLatestYoutubeVideo();
      if (!video) return;

      // Si es la primera vez, "primamos" lastVideoId sin enviar notificación
      if (!lastVideoId) {
        lastVideoId = video.id.videoId;
        saveLastVideoId(lastVideoId);
        console.log("Se ha primado el último video:", lastVideoId);
        return;
      }

      // Si el video nuevo es distinto al último notificado, se envía la notificación
      if (video.id.videoId !== lastVideoId) {
        const channel = await client.channels.fetch(DISCORD_CHANNEL_ID);
        if (channel) {
          const embed = new EmbedBuilder()
            .setColor("#FF0000")
            .setTitle("¡Nuevo video de RickyEdit en YouTube!")
            .setURL(`https://www.youtube.com/watch?v=${video.id.videoId}`)
            .setDescription(video.snippet.title)
            .setImage(video.snippet.thumbnails.high.url)
            .setFooter({ text: "¡Mira el nuevo video ya!" })
            .setTimestamp(new Date(video.snippet.publishedAt));

          channel.send({ content: "@everyone", embeds: [embed] });
        }
        lastVideoId = video.id.videoId;
        saveLastVideoId(lastVideoId);
      }
    } catch (error) {
      console.error("Error en monitorYoutube:", error);
    }
  }, 60000);
}

/* ===== Comandos Manuales ===== */
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Comando para Twitch
  if (message.content === "!directo") {
    const embed = await createTwitchEmbed();
    message.channel.send(embed ? { content: "@everyone", embeds: [embed] } : "El canal no está en directo en este momento.");
  }

  // Comando para YouTube
  if (message.content === "!youtube") {
    const video = await getLatestYoutubeVideo();
    if (video) {
      // Si es la primera vez, "primamos" sin notificar
      if (!lastVideoId) {
        lastVideoId = video.id.videoId;
        saveLastVideoId(lastVideoId);
        message.channel.send("El último video ya fue notificado previamente.");
        return;
      }
      if (video.id.videoId === lastVideoId) {
        message.channel.send("El último video ya fue notificado.");
      } else {
        const embed = new EmbedBuilder()
          .setColor("#FF0000")
          .setTitle("¡Nuevo video de RickyEdit en YouTube!")
          .setURL(`https://www.youtube.com/watch?v=${video.id.videoId}`)
          .setDescription(video.snippet.title)
          .setImage(video.snippet.thumbnails.high.url)
          .setFooter({ text: "¡Mira el nuevo video ya!" })
          .setTimestamp(new Date(video.snippet.publishedAt));

        message.channel.send({ content: "@everyone", embeds: [embed] });
        lastVideoId = video.id.videoId;
        saveLastVideoId(lastVideoId);
      }
    } else {
      message.channel.send("No se encontró ningún video nuevo.");
    }
  }
});

/* ===== Iniciar el Bot ===== */
client.login(DISCORD_TOKEN);
