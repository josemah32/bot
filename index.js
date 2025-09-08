require('dotenv').config();
const path = require('path');
const express = require('express');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { ActivityType } = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;
const ADMIN_PASSWORD = "germangey";
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

// -------------------- Supabase --------------------
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Funciones de tokens
// Sumar/restar tokens
async function changeTokens(userId, amount) {
  const { error } = await supabase.rpc('increment_tokens', {
    uid: userId, // PASAR SIEMPRE COMO STRING
    delta: amount
  });

  if (error) {
    console.error('Error cambiando tokens:', error.message);
    return false;
  }
  return true;
}

// Obtener tokens
async function getTokens(userId) {
  const { data, error } = await supabase
    .from('users_tokens')
    .select('tokens')
    .eq('user_id', userId) // STRING
    .maybeSingle();

  if (error) {
    console.error('getTokens error:', error);
    return 0;
  }

  return Number(data?.tokens || 0);
}

// Fijar tokens
async function setTokens(userId, value) {
  const { error } = await supabase.from('users_tokens').upsert(
    { user_id: userId, tokens: value },
    { onConflict: 'user_id' }
  );

  if (error) console.error('setTokens error:', error);
  return value;
}

// -------------------- Express --------------------
const fs = require("fs");
const https = require("https");
const app = express();
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const options = {
  key: fs.readFileSync("/etc/secrets/origin.key"),   // clave privada
  cert: fs.readFileSync("/etc/secrets/origin.pem"),  // certificado
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (req, res) => {
  const pass = req.query.pass;
  if (pass !== ADMIN_PASSWORD) return res.status(403).send('❌ Acceso denegado');
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.post('/send-embed', async (req, res) => {
  try {
    const { channelId, title, description, color, image, thumbnail, author, footer, fields } = req.body;
    if (!channelId) return res.status(400).send('❌ No se proporcionó un ID de canal');

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) return res.status(400).send('❌ Canal inválido o el bot no tiene acceso');

    const embed = new EmbedBuilder();
    if (title) embed.setTitle(title);
    if (description) embed.setDescription(description);
    embed.setColor(color ? parseInt(color.replace('#', ''), 16) : 0x0099ff);
    if (image) embed.setImage(image);
    if (thumbnail) embed.setThumbnail(thumbnail);
    if (author) embed.setAuthor({ name: author });
    if (footer) embed.setFooter({ text: footer });
    if (fields?.length) embed.addFields(fields.map(f => ({ name: f.name, value: f.value })));

    await channel.send({ embeds: [embed] });
    res.status(200).send('✅ Embed enviado correctamente');
  } catch (err) {
    console.error('Error send-embed:', err);
    res.status(500).send('❌ Error al enviar el embed');
  }
});

app.post('/send-tokens', async (req, res) => {
  try {
    const { cantidad, canalId, mensaje } = req.body;
    const channel = await client.channels.fetch(canalId);
    const boton = new ButtonBuilder()
      .setCustomId(`claim_tokens_${cantidad}`)
      .setLabel(`¡Reclamar ${cantidad} tokens!`)
      .setStyle(ButtonStyle.Primary);
    const row = new ActionRowBuilder().addComponents(boton);
    await channel.send({ content: mensaje || `Haz click para reclamar ${cantidad} tokens!`, components: [row] });
    res.status(200).send('Mensaje de tokens enviado');
  } catch (err) {
    console.error('Error send-tokens:', err);
    res.status(500).send('Error al enviar mensaje de tokens');
  }
});


app.post('/set-bot-status', async (req, res) => {
  try {
    if (!client.isReady()) return res.status(500).send('Bot no listo');
    const { type, name, status } = req.body;
    if (!type || !name || !status) return res.status(400).send('Datos incompletos');

    const activityTypeMap = {
      PLAYING: ActivityType.Playing,
      WATCHING: ActivityType.Watching,
      LISTENING: ActivityType.Listening,
      STREAMING: ActivityType.Streaming,
      COMPETING: ActivityType.Competing
    };

    await client.user.setPresence({
      activities: [{ name, type: activityTypeMap[type] || ActivityType.Playing }],
      status
    });

    res.status(200).send('✅ Estado del bot actualizado');
  } catch (err) {
    console.error('Error al cambiar estado:', err);
    res.status(500).send('❌ Error interno');
  }
});

https.createServer(options, app).listen(PORT, HOST, () => {
  console.log(`Servidor HTTPS corriendo en https://${HOST}:${PORT}`);
});

// -------------------- Discord Bot --------------------

const EPHEMERAL = 64;

// Manejo global de errores
process.on('unhandledRejection', console.error);
process.on('uncaughtException', console.error);
client.on('error', console.error);

client.once('ready', () => console.log(`Conectado como ${client.user.tag}`));

client.on('messageCreate', async message => {
  if (message.author.bot) return;

  await supabase.rpc('increment_tokens', {
    uid: message.author.id, // ID de Discord como string
    delta: 1               // siempre 1 token entero por mensaje
  });

  console.log(`[TOKENS] ${message.author.tag} +1`);
});

// -------------------- Comandos --------------------
const commands = [
  new SlashCommandBuilder().setName('admin').setDescription('Usa tus tokens para acciones').toJSON(),
  new SlashCommandBuilder().setName('tokens').setDescription('Muestra tus tokens').toJSON(),
  new SlashCommandBuilder()
    .setName('robar')
    .setDescription('Intenta robar tokens a alguien')
    .addUserOption(opt => opt.setName('objetivo').setDescription('Usuario a robar').setRequired(true))
    .addIntegerOption(opt => opt.setName('cantidad').setDescription('Cantidad de tokens').setRequired(true))
    .toJSON(),
  new SlashCommandBuilder().setName('info').setDescription('Muestra info del sistema').toJSON()
];

const rest = new REST({ version: '10' }).setToken(TOKEN);
(async () => {
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log('Comandos registrados');
  } catch (err) {
    console.error('Error registrando comandos:', err);
  }
})();

// -------------------- Eventos --------------------
client.on('messageCreate', async message => {
  if (message.author.bot) return;
  try {
    await changeTokens(message.author.id, 1);
    console.log(`[TOKENS] ${message.author.tag} +1`);
  } catch (err) {
    console.error('Error guardando tokens:', err);
  }
});

client.on('interactionCreate', async interaction => {
  const userId = interaction.user?.id;

  async function safeReply(inter, options) {
    try {
      if (!inter) return null;
      if (inter.replied || inter.deferred) return await inter.followUp(options).catch(console.error);
      return await inter.reply(options).catch(console.error);
    } catch (e) { console.error('safeReply error:', e); }
  }

  try {
    // -------------------- Comandos ChatInput --------------------
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'tokens') {
        const t = await getTokens(userId);
        return await safeReply(interaction, { content: `💰 Tienes ${t} tokens.`, flags: EPHEMERAL });
      }

      if (interaction.commandName === 'info') {
        return await safeReply(interaction, {
          content: `
🛜**La WEB del bot** 
- Se encuentra en desarollo 🚧 
- Puedes intentar al panel de administrador, adivinando la contraseña 
- Puedes acceder atraves de este enlace: https://bot-bnzz.onrender.com/
📖 **Sistema de Tokens**
- Por cada mensaje enviado ganas: +1 token
- Coste de acciones: 🔇 Silenciar → 0.1 tokens * segundos, 🔈 Ensordecer → 0.1 tokens * segundos, ❌ Desconectar → 1 token
- Comandos: /tokens, /admin, /info
          `,
          flags: EPHEMERAL
        });
      }

      if (interaction.commandName === 'admin') {
        const tokensUser = await getTokens(userId);
        if (tokensUser < 1) return await safeReply(interaction, { content: '❌ Necesitas al menos 1 token para usar admin.', flags: EPHEMERAL });

        const miembrosVC = (await interaction.guild.members.fetch()).filter(m => m.voice.channel && m.id !== userId);
        if (!miembrosVC.size) return await safeReply(interaction, { content: '❌ No hay miembros en canales de voz.', flags: EPHEMERAL });

        await interaction.deferReply({ flags: EPHEMERAL }).catch(()=>{});
        const select = new StringSelectMenuBuilder()
          .setCustomId('select_member')
          .setPlaceholder('Selecciona un usuario')
          .addOptions(miembrosVC.map(m => ({ label: m.user.username, value: m.id })));

        return await safeReply(interaction, { content: 'Selecciona un usuario para aplicar acción:', components: [new ActionRowBuilder().addComponents(select)], flags: EPHEMERAL });
      }

      if (interaction.commandName === 'robar') {
        const objetivo = interaction.options.getUser('objetivo');
        const cantidad = interaction.options.getInteger('cantidad');
        const tokensUser = await getTokens(userId);
        if (!objetivo) return await safeReply(interaction, { content: '❌ Usuario objetivo inválido.', flags: EPHEMERAL });

        const coste = Math.ceil(cantidad * 0.5);
        const probabilidad = Math.max(10, 70 - cantidad * 2);
        if (tokensUser < coste) return await safeReply(interaction, { content: `❌ Necesitas al menos ${coste} tokens para intentar el robo.`, flags: EPHEMERAL });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(JSON.stringify({ type: 'robo', objetivoId: objetivo.id, cantidad, coste, probabilidad }))
            .setLabel('Confirmar robo')
            .setStyle(ButtonStyle.Danger)
        );

        return await safeReply(interaction, {
          content: `⚠️ Vas a intentar robar **${cantidad} tokens** a ${objetivo.tag}.\nCoste: **${coste} tokens**\nProbabilidad de éxito: **${probabilidad}%**\n\n¿Confirmas?`,
          components: [row],
          flags: EPHEMERAL
        });
      }
    }

    // -------------------- Selecciones --------------------
    if (interaction.isStringSelectMenu() && interaction.customId === 'select_member') {
      const targetId = interaction.values[0];
      const miembro = await interaction.guild.members.fetch(targetId).catch(()=>null);
      if (!miembro || !miembro.voice.channel) return await safeReply(interaction, { content: '❌ Usuario no válido o no está en VC.', flags: EPHEMERAL });

      const acciones = ['silenciar', 'ensordecer', 'desconectar'];
      const botones = new ActionRowBuilder().addComponents(
        acciones.map(a => new ButtonBuilder().setCustomId(`accion_${a}_${targetId}`).setLabel(a.charAt(0).toUpperCase() + a.slice(1)).setStyle(ButtonStyle.Primary))
      );

      return await safeReply(interaction, { content: `Usuario seleccionado: ${miembro.user.tag}. Elige acción:`, components: [botones], flags: EPHEMERAL });
    }

    // -------------------- Botones --------------------
    if (interaction.isButton()) {
      const custom = interaction.customId;

      // accion_xxx -> mostrar modal o confirmar
      if (custom.startsWith('accion_')) {
        const [_, accion, targetId] = custom.split('_');
        const miembro = await interaction.guild.members.fetch(targetId).catch(()=>null);
        if (!miembro) return await safeReply(interaction, { content: '❌ Usuario no encontrado.', flags: EPHEMERAL });

        if (['silenciar', 'ensordecer'].includes(accion)) {
          const modal = new ModalBuilder().setCustomId(`modal_${accion}_${targetId}`).setTitle(`Duración de ${accion}`);
          const input = new TextInputBuilder().setCustomId('tiempo').setLabel('Duración en segundos').setStyle(TextInputStyle.Short).setRequired(true);
          modal.addComponents(new ActionRowBuilder().addComponents(input));
          return await interaction.showModal(modal);
        }

        if (accion === 'desconectar') {
          const coste = 1;
          const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`confirmar_${accion}_${targetId}_${coste}`).setLabel(`Confirmar (${coste} tokens)`).setStyle(ButtonStyle.Danger)
          );
          return await safeReply(interaction, { content: `Desconectar a ${miembro.user.tag} cuesta ${coste} token. ¿Confirmas?`, components: [confirmRow], flags: EPHEMERAL });
        }
      }

      // confirmar_* -> cobrar y aplicar
      if (custom.startsWith('confirmar_')) {
        const [_, accion, targetId, costeStr] = custom.split('_');
        const coste = Number(costeStr) || 0;
        const tokensUser = await getTokens(userId);
        if (tokensUser < coste) return await safeReply(interaction, { content: '❌ No tienes suficientes tokens.', flags: EPHEMERAL });

        const miembro = await interaction.guild.members.fetch(targetId).catch(()=>null);
        if (!miembro) return await safeReply(interaction, { content: '❌ Usuario no encontrado.', flags: EPHEMERAL });

        await changeTokens(userId, -coste);
        try { await aplicarEfecto(miembro, accion); } catch (err) {
          console.error(err);
          await changeTokens(userId, coste);
          return await safeReply(interaction, { content: '❌ No se pudo aplicar la acción.', flags: EPHEMERAL });
        }

        await logAccion(client, interaction.user.tag, accion, miembro.user.tag, 0, coste);

        if (interaction.message) {
          try {
            return await interaction.update({ content: `✅ ${miembro.user.tag} ha sido ${accion} por ${interaction.user.tag} (-${coste} tokens).`, components: [] });
          } catch {
            return await safeReply(interaction, { content: `✅ ${miembro.user.tag} ha sido ${accion} (-${coste} tokens).`, flags: EPHEMERAL });
          }
        } else return await safeReply(interaction, { content: `✅ ${miembro.user.tag} ha sido ${accion} (-${coste} tokens).`, flags: EPHEMERAL });
      }

      // ROBO
      let data;
      try { data = JSON.parse(custom); } catch { data = null; }
      if (data && data.type === 'robo') {
        const { objetivoId, cantidad, coste, probabilidad } = data;
        const tokensUser = await getTokens(userId);
        if (tokensUser < coste) return await safeReply(interaction, { content: '❌ No tienes suficientes tokens.', flags: EPHEMERAL });

        const objetivoTokens = await getTokens(objetivoId);
        const miembro = await interaction.guild.members.fetch(objetivoId).catch(()=>null);
        if (!miembro) return await safeReply(interaction, { content: '❌ Usuario no encontrado.', flags: EPHEMERAL });

        await changeTokens(userId, -coste);

        const exito = Math.random() * 100 < probabilidad;
        let resultadoMsg, mensajePublico;
        if (exito) {
          const robado = Math.min(cantidad, objetivoTokens);
          if (robado > 0) {
            await changeTokens(objetivoId, -robado);
            await changeTokens(userId, robado);
          }
          resultadoMsg = `✅ Has robado **${robado} tokens** de ${miembro.user.tag}. Te quedan ${await getTokens(userId)} tokens.`;
          mensajePublico = `💰 **${interaction.user.username}** ha robado **${robado} tokens** de **${miembro.user.username}**!`;
        } else {
          resultadoMsg = `❌ Fallaste el robo a ${miembro.user.tag}. Perdiste ${coste} tokens. Te quedan ${await getTokens(userId)} tokens.`;
          mensajePublico = `❌ **${interaction.user.username}** falló el robo a **${miembro.user.username}** y perdió ${coste} tokens.`;
        }

        await logAccion(client, interaction.user.tag, `Robo ${exito ? 'exitoso' : 'fallido'}`, miembro.user.tag, 0, coste);
        if (interaction.channel) await interaction.channel.send(mensajePublico);
        return await safeReply(interaction, { content: resultadoMsg, flags: EPHEMERAL });
      }
    }

    // MODALES
    if (interaction.isModalSubmit()) {
      const parts = interaction.customId?.split('_') || [];
      if (parts[0] === 'modal') {
        const accion = parts[1];
        const targetId = parts[2];
        const tiempo = Number(interaction.fields.getTextInputValue('tiempo')) || 30;
        const coste = 0.1 * tiempo;
        const tokensUser = await getTokens(userId);
        if (tokensUser < coste) return await safeReply(interaction, { content: `❌ Necesitas ${coste.toFixed(1)} tokens.`, flags: EPHEMERAL });

        await changeTokens(userId, -coste);
        const miembro = await interaction.guild.members.fetch(targetId).catch(()=>null);
        if (!miembro) {
          await changeTokens(userId, coste);
          return await safeReply(interaction, { content: '❌ Usuario no encontrado.', flags: EPHEMERAL });
        }

        try { await aplicarEfecto(miembro, accion, tiempo); } catch (err) {
          console.error(err);
          await changeTokens(userId, coste);
          return await safeReply(interaction, { content: '❌ No se pudo aplicar la acción.', flags: EPHEMERAL });
        }

        await logAccion(client, interaction.user.tag, accion, miembro.user.tag, tiempo, coste);
        return await safeReply(interaction, { content: `✅ ${accion} aplicado a ${miembro.user.tag} por ${tiempo}s (-${coste.toFixed(1)} tokens).`, flags: EPHEMERAL });
      }
    }

  } catch (err) {
    console.error(err);
    if (interaction) {
      try {
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: '❌ Error interno.', flags: EPHEMERAL });
        else await interaction.followUp({ content: '❌ Error interno.', flags: EPHEMERAL });
      } catch (e) { console.error(e); }
    }
  }
});

// -------------------- Funciones auxiliares --------------------
async function logAccion(client, usuario, accion, target, duracion, coste) {
  try {
    const canalLogs = await client.channels.fetch(LOG_CHANNEL_ID).catch(()=>null);
    if (!canalLogs) return;
    const embed = new EmbedBuilder()
      .setTitle('📝 Acción Admin')
      .setColor(0xffa500)
      .addFields(
        { name: 'Usuario', value: usuario, inline: true },
        { name: 'Objetivo', value: target, inline: true },
        { name: 'Acción', value: accion, inline: true },
        { name: 'Duración', value: `${duracion || 0}s`, inline: true },
        { name: 'Coste', value: `${coste || 0}`, inline: true }
      )
      .setTimestamp();
    await canalLogs.send({ embeds: [embed] });
  } catch (err) { console.error(err); }
}

async function aplicarEfecto(member, efecto, duracion = 30) {
  if (!member?.voice?.channel) return { error: 'Usuario no en VC' };
  try {
    switch (efecto) {
      case 'silenciar':
        await member.voice.setMute(true);
        setTimeout(() => member.voice.setMute(false).catch(()=>{}), duracion * 1000);
        break;
      case 'ensordecer':
        await member.voice.setDeaf(true);
        setTimeout(() => member.voice.setDeaf(false).catch(()=>{}), duracion * 1000);
        break;
      case 'desconectar':
        if (typeof member.voice.disconnect === 'function') await member.voice.disconnect();
        else if (typeof member.voice.setChannel === 'function') await member.voice.setChannel(null);
        else throw new Error('Desconectar no disponible');
        break;
      default:
        return { error: 'Acción desconocida' };
    }
    return { success: true };
  } catch (err) {
    console.error(err);
    return { error: 'Error al aplicar efecto' };
  }
}

// -------------------- Login --------------------
client.login(TOKEN).catch(console.error);
